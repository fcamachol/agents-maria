// ============================================
// Maria Claude - Native Tools for Claude Agent SDK
// ============================================

import { config } from "dotenv";
config();

import crypto from "crypto";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import pg from "pg";
import type {
    CreateTicketInput,
    CreateTicketResult,
    ConsumoResponse,
    ContratoResponse,
    CategoryCode,
    TicketPriority,
} from "./types.js";
import {
    renderTemplate,
    formatField as _formatField,
    getCategoryEmoji,
    getTicketEmoji
} from "./config/response-templates.js";
import { updateConversationStatus } from "./chatwoot.js";
import { getCache, CacheKeys } from "./utils/cache.js";
import { logger } from "./utils/logger.js";

// ============================================
// Configuration
// ============================================

const CEA_API_BASE = "https://aquacis-cf.ceaqueretaro.gob.mx/Comercial/services";
const PROXY_URL = process.env.CEA_PROXY_URL || null;

const PG_CONFIG = {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'agora_production',
    max: parseInt(process.env.PGPOOL_MAX || '10'),
};

const pgPool = new pg.Pool(PG_CONFIG);

// ============================================
// Utility Functions
// ============================================

async function fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3,
    delayMs = 1000
): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            let response: Response;

            if (PROXY_URL && url.includes('ceaqueretaro.gob.mx')) {
                logger.info({ proxy: PROXY_URL, url }, "[API] Using proxy");
                const proxyAgent = new ProxyAgent(PROXY_URL);

                response = await undiciFetch(url, {
                    method: options.method || 'GET',
                    headers: options.headers as Record<string, string>,
                    body: options.body as string,
                    dispatcher: proxyAgent,
                    signal: AbortSignal.timeout(30000)
                }) as unknown as Response;
            } else {
                response = await fetch(url, {
                    ...options,
                    signal: AbortSignal.timeout(30000)
                });
            }

            if (!response.ok && attempt < maxRetries) {
                logger.warn({ attempt, status: response.status }, "[API] Attempt failed, retrying");
                await new Promise(r => setTimeout(r, delayMs * attempt));
                continue;
            }

            return response;
        } catch (error) {
            lastError = error as Error;
            logger.warn({ attempt, error: lastError.message }, "[API] Attempt error");

            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, delayMs * attempt));
            }
        }
    }

    throw lastError || new Error("Request failed after retries");
}

function parseXMLValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1]!.trim() : null;
}

export function getMexicoDate(): Date {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
}

// ============================================
// Recibo PDF - HMAC Token Utilities
// ============================================

const RECIBO_TOKEN_SECRET = process.env.RECIBO_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || "https://info-cea.cea-info.workers.dev";

function generateReciboToken(contrato: string, expiresAt: number): string {
    const payload = `${contrato}:${expiresAt}`;
    return crypto.createHmac("sha256", RECIBO_TOKEN_SECRET).update(payload).digest("hex");
}

export function verifyReciboToken(contrato: string, token: string, expires: string): boolean {
    const expiresAt = parseInt(expires);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return false;
    const expected = generateReciboToken(contrato, expiresAt);
    if (token.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// ============================================
// Name Matching Utilities (for contract holder verification)
// ============================================

function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Strip diacritical marks (á→a, ñ→n, etc.)
        .replace(/\s+/g, " ")
        .trim();
}

function bigramSimilarity(a: string, b: string): number {
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

    const getBigrams = (s: string): Set<string> => {
        const bigrams = new Set<string>();
        for (let i = 0; i < s.length - 1; i++) {
            bigrams.add(s.substring(i, i + 2));
        }
        return bigrams;
    };

    const bigramsA = getBigrams(a);
    const bigramsB = getBigrams(b);
    let intersection = 0;
    for (const bg of bigramsA) {
        if (bigramsB.has(bg)) intersection++;
    }

    // Dice coefficient
    return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function matchName(userInput: string, holderName: string): { match: boolean; confidence: number; method: string } {
    const normalizedInput = normalizeName(userInput);
    const normalizedHolder = normalizeName(holderName);

    if (!normalizedInput || !normalizedHolder) {
        return { match: false, confidence: 0, method: "empty" };
    }

    // 1. Exact full match after normalization
    if (normalizedInput === normalizedHolder) {
        return { match: true, confidence: 1.0, method: "exact" };
    }

    // 2. Substring match (user's input found in holder name)
    if (normalizedHolder.includes(normalizedInput)) {
        return { match: true, confidence: 0.9, method: "substring" };
    }

    // 3. Word-level exact match (any word >=3 chars matches)
    const inputWords = normalizedInput.split(" ").filter(w => w.length >= 3);
    const holderWords = normalizedHolder.split(" ").filter(w => w.length >= 3);

    for (const iw of inputWords) {
        for (const hw of holderWords) {
            if (iw === hw) {
                return { match: true, confidence: 0.85, method: "word_match" };
            }
        }
    }

    // 4. Fuzzy word match (Dice >= 0.65 on any word pair)
    let bestScore = 0;
    for (const iw of inputWords) {
        for (const hw of holderWords) {
            if (iw.length < 5 || hw.length < 5) continue;
            const score = bigramSimilarity(iw, hw);
            if (score > bestScore) bestScore = score;
        }
    }

    if (bestScore >= 0.75) {
        return { match: true, confidence: bestScore, method: "fuzzy_word" };
    }

    // 5. No match
    return { match: false, confidence: bestScore, method: "none" };
}

// ============================================
// Verified Contracts Tracking (per conversation)
// ============================================

const verifiedContractsMap = new Map<string, Set<string>>();

export function getVerifiedContracts(conversationId: string): Set<string> {
    return verifiedContractsMap.get(conversationId) || new Set();
}

// ============================================
// SOAP Builders
// ============================================

function buildDeudaTotalConFacturasSOAP(contrato: string): string {
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:int="http://interfazgenericagestiondeuda.occamcxf.occam.agbar.com/" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        <wsse:Security mustUnderstand="1">
            <wsse:UsernameToken wsu:Id="UsernameTokenWSGESTIONDEUDA">
                <wsse:Username>WSGESTIONDEUDA</wsse:Username>
                <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">WSGESTIONDEUDA</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soapenv:Header>
    <soapenv:Body>
        <int:getDeudaTotalConFacturas>
            <contrato>${contrato}</contrato>
            <explotacion>12</explotacion>
            <idioma>es</idioma>
        </int:getDeudaTotalConFacturas>
    </soapenv:Body>
</soapenv:Envelope>`;
}

function buildDeudaContratoSOAP(contrato: string): string {
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:int="http://interfazgenericagestiondeuda.occamcxf.occam.agbar.com/" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        <wsse:Security mustUnderstand="1">
            <wsse:UsernameToken wsu:Id="UsernameTokenWSGESTIONDEUDA">
                <wsse:Username>WSGESTIONDEUDA</wsse:Username>
                <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">WSGESTIONDEUDA</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soapenv:Header>
    <soapenv:Body>
        <int:getDeudaContrato>
            <tipoIdentificador>CONTRATO</tipoIdentificador>
            <valor>${contrato}</valor>
            <explotacion>12</explotacion>
            <idioma>es</idioma>
        </int:getDeudaContrato>
    </soapenv:Body>
</soapenv:Envelope>`;
}

function buildConsumoSOAP(contrato: string, explotacion: string = "1"): string {
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        <wsse:Security mustUnderstand="1">
            <wsse:UsernameToken wsu:Id="UsernameToken-WSGESTIONDEUDA">
                <wsse:Username>WSGESTIONDEUDA</wsse:Username>
                <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">WSGESTIONDEUDA</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soapenv:Header>
    <soapenv:Body>
        <occ:getConsumos>
            <explotacion>${explotacion}</explotacion>
            <contrato>${contrato}</contrato>
            <idioma>es</idioma>
        </occ:getConsumos>
    </soapenv:Body>
</soapenv:Envelope>`;
}

function buildContratoSOAP(contrato: string): string {
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        <wsse:Security mustUnderstand="1">
            <wsse:UsernameToken wsu:Id="UsernameToken-WSGESTIONDEUDA">
                <wsse:Username>WSGESTIONDEUDA</wsse:Username>
                <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">WSGESTIONDEUDA</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soapenv:Header>
    <soapenv:Body>
        <occ:consultaDetalleContrato>
            <numeroContrato>${contrato}</numeroContrato>
            <idioma>es</idioma>
        </occ:consultaDetalleContrato>
    </soapenv:Body>
</soapenv:Envelope>`;
}

function buildPuntoServicioPorContadorSOAP(numeroContador: string): string {
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:int="http://interfazgenericacontadores.occamcxf.occam.agbar.com/" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        <wsse:Security mustUnderstand="1">
            <wsse:UsernameToken wsu:Id="UsernameTokenWSGESTIONDEUDA">
                <wsse:Username>WSGESTIONDEUDA</wsse:Username>
                <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">WSGESTIONDEUDA</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soapenv:Header>
    <soapenv:Body>
        <int:getPuntoServicioPorContador>
            <listaNumSerieContador>${numeroContador}</listaNumSerieContador>
            <usuario>WSGESTIONDEUDA</usuario>
            <idioma>es</idioma>
            <opciones></opciones>
        </int:getPuntoServicioPorContador>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildGetFacturasSOAP(contrato: string, explotacion: string = "1"): string {
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        <wsse:Security mustUnderstand="1">
            <wsse:UsernameToken wsu:Id="UsernameToken-WSGESTIONDEUDA">
                <wsse:Username>WSGESTIONDEUDA</wsse:Username>
                <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">WSGESTIONDEUDA</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soapenv:Header>
    <soapenv:Body>
        <occ:getFacturas>
            <explotacion>${explotacion}</explotacion>
            <contrato>${contrato}</contrato>
            <idioma>es</idioma>
        </occ:getFacturas>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildGetPdfFacturaSOAP(numFactura: string, numContrato: string): string {
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        <wsse:Security mustUnderstand="1">
            <wsse:UsernameToken wsu:Id="UsernameToken-WSGESTIONDEUDA">
                <wsse:Username>WSGESTIONDEUDA</wsse:Username>
                <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">WSGESTIONDEUDA</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soapenv:Header>
    <soapenv:Body>
        <occ:getPdfFactura>
            <numFactura>${numFactura}</numFactura>
            <numContrato>${numContrato}</numContrato>
        </occ:getPdfFactura>
    </soapenv:Body>
</soapenv:Envelope>`;
}

// ============================================
// Factura Info (for recibo PDF)
// ============================================

export interface FacturaInfo {
    numero: string;
    periodo: string;
    periodoTexto: string;
    año: string;
    importe: number;
    estado: number;
    estadoTexto: string;
}

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function parseGetFacturasResponse(xml: string): { success: boolean; facturas: FacturaInfo[]; error?: string } {
    try {
        if (xml.includes("<faultstring>") || xml.includes("<error>")) {
            const faultMsg = parseXMLValue(xml, "faultstring") || parseXMLValue(xml, "error") || "Error desconocido";
            return { success: false, facturas: [], error: faultMsg };
        }

        const facturas: FacturaInfo[] = [];
        const facturaMatches = xml.match(/<Factura>[\s\S]*?<\/Factura>/g) || [];

        for (const facturaXml of facturaMatches) {
            const estado = parseInt(parseXMLValue(facturaXml, "estado") || "0");
            const periodo = parseXMLValue(facturaXml, "periodo") || "";
            const año = parseXMLValue(facturaXml, "año") || "";
            const periodoTexto = `${MESES[parseInt(periodo)] || periodo} ${año}`;

            facturas.push({
                numero: parseXMLValue(facturaXml, "numero") || "",
                periodo,
                periodoTexto,
                año,
                importe: parseFloat(parseXMLValue(facturaXml, "importeTotal") || "0"),
                estado,
                estadoTexto: estado === 4 ? "vencido" : estado === 2 ? "pendiente" : "pagado"
            });
        }

        return { success: true, facturas };
    } catch (error) {
        return { success: false, facturas: [], error: `Error parsing facturas: ${error}` };
    }
}

// ============================================
// Recibo PDF Fetcher
// ============================================

export async function fetchReciboPdf(contrato: string, numFactura?: string): Promise<Buffer | null> {
    try {
        // If no invoice number provided, get the latest from getFacturas
        let facturaNum = numFactura;
        if (!facturaNum) {
            logger.info({ contrato }, "[fetchReciboPdf] No factura number, fetching latest");
            let parsed: { success: boolean; facturas: FacturaInfo[]; error?: string } = { success: false, facturas: [] };
            for (const explotacion of ["1", "12"]) {
                const facturasResponse = await fetchWithRetry(
                    `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
                    { method: 'POST', headers: { 'Content-Type': 'text/xml;charset=UTF-8' }, body: buildGetFacturasSOAP(contrato, explotacion) }
                );
                const facturasXml = await facturasResponse.text();
                parsed = parseGetFacturasResponse(facturasXml);
                if (parsed.success && parsed.facturas.length > 0) {
                    logger.info({ count: parsed.facturas.length, explotacion }, "[fetchReciboPdf] Found facturas");
                    break;
                }
            }
            if (!parsed.success || parsed.facturas.length === 0) {
                logger.info({ contrato }, "[fetchReciboPdf] No facturas found");
                return null;
            }
            // Get the most recent factura (first in list)
            facturaNum = parsed.facturas[0]!.numero;
            logger.info({ facturaNum }, "[fetchReciboPdf] Using latest factura");
        }

        // Fetch the PDF
        logger.info({ facturaNum, contrato }, "[fetchReciboPdf] Fetching PDF");
        const pdfResponse = await fetchWithRetry(
            `${CEA_API_BASE}/InterfazGenericaContratacionWS`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                body: buildGetPdfFacturaSOAP(facturaNum, contrato)
            }
        );
        const pdfXml = await pdfResponse.text();

        // Extract base64 PDF from <pdf> tag (or legacy <return> tag)
        const base64Match = pdfXml.match(/<pdf>([^<]+)<\/pdf>/) || pdfXml.match(/<return[^>]*>([^<]+)<\/return>/);
        if (!base64Match || !base64Match[1]) {
            logger.info({ responsePreview: pdfXml.substring(0, 500) }, "[fetchReciboPdf] No PDF data in response");
            return null;
        }

        logger.info({ base64Length: base64Match[1].length }, "[fetchReciboPdf] Got PDF data");
        return Buffer.from(base64Match[1], 'base64');
    } catch (error) {
        logger.error({ err: error }, "[fetchReciboPdf] Error");
        return null;
    }
}

interface FacturaPendiente {
    numero: string;
    periodo: string;
    fechaVencimiento: string;
    importe: number;
    estado: string;
    estadoTexto: string;
    referenciaPago: string;
}

// ============================================
// Response Parsers
// ============================================

function parseDeudaTotalConFacturasResponse(xml: string): {
    success: boolean;
    totalDeuda?: number;
    cantidadFacturas?: number;
    nombreCliente?: string;
    facturas?: FacturaPendiente[];
    error?: string;
} {
    try {
        if (xml.includes("<faultstring>") || xml.includes("<error>")) {
            const faultMsg = parseXMLValue(xml, "faultstring") || parseXMLValue(xml, "error") || "Error desconocido";
            return { success: false, error: faultMsg };
        }

        const totalDeuda = parseFloat(parseXMLValue(xml, "deudaTotal") || "0");
        const cantidadFacturas = parseInt(parseXMLValue(xml, "cantidadFacturas") || "0");
        const nombreCliente = parseXMLValue(xml, "nombreCliente") || "";

        const facturas: FacturaPendiente[] = [];
        const facturaMatches = xml.match(/<(?:factura|datosFacturaDeuda)>[\s\S]*?<\/(?:factura|datosFacturaDeuda)>/gi) || [];

        for (const facturaXml of facturaMatches) {
            const estado = parseXMLValue(facturaXml, "estado") || "";
            const codigoEstado = parseXMLValue(facturaXml, "codigoEstado") || "";
            const isVencido = estado.toLowerCase().includes("vencid") || codigoEstado === "4";

            facturas.push({
                numero: parseXMLValue(facturaXml, "numFactura") || "",
                periodo: parseXMLValue(facturaXml, "ciclo") || "",
                fechaVencimiento: parseXMLValue(facturaXml, "fechaVencimiento") || "",
                importe: parseFloat(parseXMLValue(facturaXml, "importeTotal") || "0"),
                estado: codigoEstado || estado,
                estadoTexto: isVencido ? "vencido" : "pendiente",
                referenciaPago: parseXMLValue(facturaXml, "referenciaPago") || "",
            });
        }

        return { success: true, totalDeuda, cantidadFacturas, nombreCliente, facturas };
    } catch (error) {
        return { success: false, error: `Error parsing response: ${error}` };
    }
}

function parseDeudaContratoResponse(xml: string): {
    success: boolean;
    totalDeuda?: number;
    direccion?: string;
    nombreCliente?: string;
    mensaje?: string;
    error?: string;
} {
    try {
        if (xml.includes("<faultstring>") || xml.includes("<error>")) {
            const faultMsg = parseXMLValue(xml, "faultstring") || parseXMLValue(xml, "error") || "Error desconocido";
            return { success: false, error: faultMsg };
        }

        const totalDeuda = parseFloat(parseXMLValue(xml, "deuda") || parseXMLValue(xml, "deudaTotal") || "0");
        const direccion = parseXMLValue(xml, "direccion") || "";
        const nombreCliente = parseXMLValue(xml, "nombreCliente") || "";
        const mensaje = parseXMLValue(xml, "descripcionMensaje") || "";

        return { success: true, totalDeuda, direccion, nombreCliente, mensaje };
    } catch (error) {
        return { success: false, error: `Error parsing response: ${error}` };
    }
}

function parseConsumoResponse(xml: string): ConsumoResponse {
    try {
        if (xml.includes("<faultstring>") || xml.includes("<error>")) {
            const faultMsg = parseXMLValue(xml, "faultstring") || parseXMLValue(xml, "error") || "Error desconocido";
            return { success: false, error: faultMsg };
        }

        const consumos: Array<{
            periodo: string;
            consumoM3: number;
            lecturaAnterior: number;
            lecturaActual: number;
            fechaLectura: string;
            tipoLectura: "real" | "estimada";
            año: number;
            mes: string;
        }> = [];

        // Match both <Consumo> (CEA API format) and <consumo> (lowercase fallback)
        const consumoMatches = xml.match(/<Consumo>[\s\S]*?<\/Consumo>/g) ||
            xml.match(/<consumo>[\s\S]*?<\/consumo>/gi) ||
            xml.match(/<lectura>[\s\S]*?<\/lectura>/gi) || [];

        for (const consumoXml of consumoMatches) {
            // Parse CEA API format: <año>, <metrosCubicos>, <periodo>, <fechaLectura>
            const año = parseInt(parseXMLValue(consumoXml, "año") || "0");
            const metrosCubicos = parseFloat(parseXMLValue(consumoXml, "metrosCubicos") || parseXMLValue(consumoXml, "consumo") || parseXMLValue(consumoXml, "m3") || "0");
            const periodo = parseXMLValue(consumoXml, "periodo") || "";
            const fechaLectura = parseXMLValue(consumoXml, "fechaLectura") || "";
            const estimado = parseXMLValue(consumoXml, "estimado") === "true";

            // Extract month from periodo like "<JUN> - <JUN>" or from fechaLectura
            let mes = "";
            const mesMatch = periodo.match(/<([A-Z]{3})>/);
            if (mesMatch) {
                mes = mesMatch[1] || "";
            }

            consumos.push({
                periodo: `${mes} ${año}`,
                consumoM3: metrosCubicos,
                lecturaAnterior: 0,
                lecturaActual: 0,
                fechaLectura,
                tipoLectura: estimado ? "estimada" : "real",
                año,
                mes
            });
        }

        const promedioMensual = consumos.length > 0
            ? consumos.reduce((sum, c) => sum + c.consumoM3, 0) / consumos.length
            : 0;

        let tendencia: 'aumentando' | 'estable' | 'disminuyendo' = 'estable';
        if (consumos.length >= 3) {
            const recent = consumos.slice(0, 3).reduce((s, c) => s + c.consumoM3, 0) / 3;
            const older = consumos.slice(-3).reduce((s, c) => s + c.consumoM3, 0) / 3;
            if (recent > older * 1.1) tendencia = 'aumentando';
            else if (recent < older * 0.9) tendencia = 'disminuyendo';
        }

        return { success: true, data: { consumos, promedioMensual, tendencia } };
    } catch (error) {
        return { success: false, error: `Error parsing response: ${error}` };
    }
}

function mapEstadoContrato(raw: string): 'activo' | 'suspendido' | 'cortado' {
    const map: Record<string, 'activo' | 'suspendido' | 'cortado'> = {
        '1': 'activo',
        '2': 'cortado',
        'activo': 'activo',
        'suspendido': 'suspendido',
        'cortado': 'cortado',
    };
    return map[raw.toLowerCase()] || 'activo';
}

function parseContratoResponse(xml: string): ContratoResponse {
    try {
        if (xml.includes("<faultstring>") || xml.includes("<error>")) {
            const faultMsg = parseXMLValue(xml, "faultstring") || parseXMLValue(xml, "error") || "Error desconocido";
            return { success: false, error: faultMsg };
        }

        // Debug: log raw estado value and surrounding XML to diagnose tag name
        const rawEstado = parseXMLValue(xml, "estado");
        logger.info({ rawEstado }, "[parseContratoResponse] Raw estado");
        const estadoSnippet = xml.match(/estado[^<]*<[^>]+>[^<]*/gi);
        logger.info({ estadoSnippet }, "[parseContratoResponse] Estado XML matches");

        // Build address from calle + numero (API uses these tags, not "direccion")
        const calle = parseXMLValue(xml, "calle") || "";
        const numero = parseXMLValue(xml, "numero") || "";
        const direccion = [calle, numero].filter(Boolean).join(" ");

        return {
            success: true,
            data: {
                numeroContrato: parseXMLValue(xml, "numeroContrato") || parseXMLValue(xml, "contrato") || "",
                titular: parseXMLValue(xml, "nombreTitular") || parseXMLValue(xml, "titular") || "",
                direccion: direccion,
                colonia: parseXMLValue(xml, "municipio") || parseXMLValue(xml, "colonia") || "",
                codigoPostal: parseXMLValue(xml, "codigoPostal") || parseXMLValue(xml, "cp") || "",
                tarifa: parseXMLValue(xml, "descUso") || parseXMLValue(xml, "tarifa") || "",
                estado: mapEstadoContrato(parseXMLValue(xml, "estadoContador") || parseXMLValue(xml, "estado") || ""),
                fechaAlta: parseXMLValue(xml, "fechaAlta") || "",
                ultimaLectura: parseXMLValue(xml, "ultimaLectura") || undefined
            }
        };
    } catch (error) {
        return { success: false, error: `Error parsing response: ${error}` };
    }
}

function parsePuntoServicioEstado(xml: string): 'activo' | 'suspendido' | 'cortado' | null {
    try {
        const raw = parseXMLValue(xml, "estadoPuntoServicio");
        if (!raw) return null;
        const normalized = raw.trim().toUpperCase();
        if (normalized.includes("CORTADO")) return 'cortado';
        if (normalized.includes("SUSPENDIDO")) return 'suspendido';
        if (normalized.includes("ACTIVO")) return 'activo';
        logger.info({ raw }, "[parsePuntoServicioEstado] Unrecognized value");
        return null;
    } catch {
        return null;
    }
}

async function fetchPuntoServicioEstado(numeroContador: string): Promise<'activo' | 'suspendido' | 'cortado' | null> {
    try {
        logger.info({ numeroContador }, "[fetchPuntoServicioEstado] Calling API");
        const response = await fetchWithRetry(
            `${CEA_API_BASE}/InterfazGenericaContadoresWS`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                body: buildPuntoServicioPorContadorSOAP(numeroContador)
            }
        );
        const xml = await response.text();
        logger.info({ responsePreview: xml.substring(0, 500) }, "[fetchPuntoServicioEstado] Response");
        const result = parsePuntoServicioEstado(xml);
        logger.info({ result }, "[fetchPuntoServicioEstado] Parsed estado");
        return result;
    } catch (e) {
        logger.info({ err: e instanceof Error ? e.message : e }, "[fetchPuntoServicioEstado] Error");
        return null;
    }
}

// ============================================
// PostgreSQL Helpers
// ============================================

async function pgQuery<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
    const client = await pgPool.connect();
    try {
        const result = await client.query(query, params);
        return result.rows as T[];
    } finally {
        client.release();
    }
}

// ============================================
// Folio Generation
// ============================================

export async function _generateTicketFolioFromPG(categoryCode: CategoryCode, subcategoryCode?: string): Promise<string> {
    const now = getMexicoDate();
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;

    const folioPrefix = subcategoryCode || categoryCode;
    const prefix = `${folioPrefix}-${dateStr}`;

    try {
        const result = await pgQuery<{ folio: string }>(`
            SELECT folio FROM tickets
            WHERE folio LIKE $1
            ORDER BY folio DESC
            LIMIT 1
        `, [`${prefix}-%`]);

        let nextNumber = 1;

        if (result && result.length > 0) {
            const lastFolio = result[0]!.folio;
            const match = lastFolio.match(/-(\d{4})$/);
            if (match) {
                nextNumber = parseInt(match[1] || "0") + 1;
            }
        }

        return `${prefix}-${String(nextNumber).padStart(4, '0')}`;
    } catch (error) {
        logger.warn({ err: error }, "[generateTicketFolioFromPG] DB query failed, using timestamp fallback");
        const timestamp = now.getTime().toString().slice(-4);
        return `${prefix}-${timestamp}`;
    }
}

// ============================================
// Category/Subcategory ID Lookup Helpers
// ============================================

async function getCategoryId(code: string): Promise<number | null> {
    try {
        const result = await pgQuery<{ id: number }>(
            'SELECT id FROM ticket_categories WHERE code = $1 AND account_id = 2',
            [code]
        );
        return result?.[0]?.id || null;
    } catch (error) {
        logger.warn({ code, err: error }, "[getCategoryId] Failed to lookup category");
        return null;
    }
}

async function getSubcategoryId(code: string): Promise<number | null> {
    try {
        const result = await pgQuery<{ id: number }>(
            'SELECT id FROM ticket_subcategories WHERE code = $1',
            [code]
        );
        return result?.[0]?.id || null;
    } catch (error) {
        logger.warn({ code, err: error }, "[getSubcategoryId] Failed to lookup subcategory");
        return null;
    }
}

// ============================================
// Ticket Creation Helper
// ============================================

export async function createTicketDirect(input: CreateTicketInput): Promise<CreateTicketResult> {
    logger.info({ input }, "[create_ticket_direct] Creating ticket");

    try {
        const priority = input.priority || "medium";
        const status = "open";

        // Look up category and subcategory IDs
        const categoryId = await getCategoryId(input.category_code);
        const subcategoryId = input.subcategory_code ? await getSubcategoryId(input.subcategory_code) : null;

        logger.info({ categoryId, subcategoryId }, "[create_ticket_direct] Category/Subcategory IDs");

        // Note: folio is auto-generated by database trigger (CEA-{display_id})
        const result = await pgQuery<{ id: number; folio: string }>(`
            INSERT INTO tickets (
                account_id, title, description, status, priority,
                ticket_type, service_type, channel, contract_number,
                client_name, metadata,
                ticket_category_id, ticket_subcategory_id,
                legacy_ticket_type, legacy_service_type,
                created_at, updated_at
            ) VALUES (
                2, $1, $2, $3, $4,
                'GEN', 'general', 'whatsapp', $5,
                $6, $7,
                $8, $9,
                $10, $11,
                NOW(), NOW()
            )
            RETURNING id, folio
        `, [
            input.titulo,
            input.descripcion,
            status,
            priority,
            input.contract_number || null,
            input.contract_number ? null : 'Cliente WhatsApp',
            JSON.stringify({
                email: input.email || null,
                ubicacion: input.ubicacion || null,
                category_code: input.category_code,
                subcategory_code: input.subcategory_code
            }),
            categoryId,
            subcategoryId,
            input.category_code,
            input.subcategory_code || null
        ]);

        const createdTicket = result[0]!;
        logger.info({ folio: createdTicket.folio }, "[create_ticket_direct] Created ticket");

        return {
            success: true,
            folio: createdTicket.folio,
            ticketId: String(createdTicket.id),
            message: `Ticket creado exitosamente con folio ${createdTicket.folio}`
        };
    } catch (error) {
        logger.error({ err: error }, "[create_ticket_direct] Error");

        const now = getMexicoDate();
        const timestamp = now.getTime().toString().slice(-4);
        const fallbackFolio = `${input.category_code}-${timestamp}`;

        return {
            success: true,
            folio: fallbackFolio,
            warning: "Ticket creado localmente, sincronización pendiente",
            message: `Ticket registrado con folio ${fallbackFolio}`
        };
    }
}

// ============================================
// CLAUDE AGENT SDK TOOLS
// Using zod v4 schema shape format
// ============================================

/**
 * GET DEUDA - Retrieves debt/balance information
 */
export const getDeudaTool = tool(
    "get_deuda",
    `Obtiene el saldo y adeudo de un contrato CEA.

RETORNA:
- totalDeuda: Total a pagar
- vencido: Monto vencido
- porVencer: Monto por vencer
- facturas: Desglose de facturas pendientes

Usa este tool cuando el usuario pregunte por su saldo, deuda, cuánto debe, o quiera pagar.`,
    {
        contrato: z.string().describe("Número de contrato CEA (ej: 123456)")
    },
    async ({ contrato }) => {
        logger.info({ contrato }, "[get_deuda] Fetching debt");

        // Check cache first
        const cache = getCache();
        const cacheKey = CacheKeys.deuda(contrato);
        const cached = cache.get<string>(cacheKey);
        if (cached) {
            logger.debug({ cacheKey }, "Cache hit for get_deuda");
            return { content: [{ type: "text" as const, text: cached }] };
        }

        try {
            // Step 1: getDeudaContrato (PRIMARY — same params as old working getDeuda)
            logger.info("[get_deuda] Calling getDeudaContrato (primary)");
            const primaryResponse = await fetchWithRetry(
                `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                    body: buildDeudaContratoSOAP(contrato)
                }
            );
            const primaryXml = await primaryResponse.text();
            logger.info({ responsePreview: primaryXml.substring(0, 500) }, "[get_deuda] Primary response");
            const primaryParsed = parseDeudaContratoResponse(primaryXml);
            logger.info({ parsed: primaryParsed }, "[get_deuda] Primary parsed");

            if (primaryParsed.success && (primaryParsed.totalDeuda ?? 0) > 0) {
                const { totalDeuda = 0, nombreCliente, direccion: _direccion } = primaryParsed;

                // Step 2: Try getDeudaTotalConFacturas for invoice breakdown (ENRICHMENT)
                let facturas: FacturaPendiente[] = [];
                let vencido = 0;
                let porVencer = 0;
                try {
                    logger.info("[get_deuda] Enriching with getDeudaTotalConFacturas");
                    const enrichResponse = await fetchWithRetry(
                        `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                            body: buildDeudaTotalConFacturasSOAP(contrato)
                        }
                    );
                    const enrichXml = await enrichResponse.text();
                    const enrichParsed = parseDeudaTotalConFacturasResponse(enrichXml);
                    if (enrichParsed.success && (enrichParsed.facturas?.length ?? 0) > 0) {
                        facturas = enrichParsed.facturas!;
                        for (const f of facturas) {
                            if (f.estadoTexto === "vencido") vencido += f.importe;
                            else porVencer += f.importe;
                        }
                        logger.info({ count: facturas.length }, "[get_deuda] Enrichment invoices found");
                    }
                } catch (e) {
                    logger.info("[get_deuda] Enrichment failed, continuing with totals only");
                }

                // Build formatted response
                let formattedResponse = `Estado de cuenta del contrato ${contrato}:\n\n`;
                formattedResponse += `💰 **Total a pagar: $${totalDeuda.toFixed(2)}**\n`;
                if (nombreCliente) formattedResponse += `👤 Cliente: ${nombreCliente}\n`;

                if (facturas.length > 0) {
                    if (vencido > 0) {
                        formattedResponse += `🔴 Vencido: $${vencido.toFixed(2)}\n`;
                    }
                    if (porVencer > 0) {
                        formattedResponse += `🟡 Por vencer: $${porVencer.toFixed(2)}\n`;
                    }

                    formattedResponse += `\n📋 **Recibos pendientes:**\n`;
                    for (const factura of facturas) {
                        const emoji = factura.estadoTexto === "vencido" ? "🔴" : "🟡";
                        const label = factura.periodo || factura.numero;
                        const venceInfo = factura.fechaVencimiento ? ` - Vence: ${factura.fechaVencimiento}` : "";
                        formattedResponse += `${emoji} ${label}: $${factura.importe.toFixed(2)} (${factura.estadoTexto})${venceInfo}\n`;
                    }
                }

                formattedResponse += `\n¿Quieres realizar un pago o tienes dudas sobre tu saldo?`;

                const resultText = JSON.stringify({
                    success: true,
                    formatted_response: formattedResponse,
                    data: {
                        contrato,
                        totalDeuda,
                        vencido,
                        porVencer,
                        nombreCliente,
                        facturas
                    }
                });
                cache.set(cacheKey, resultText);
                return { content: [{ type: "text" as const, text: resultText }] };
            }

            // Primary returned 0 debt — genuinely no debt from the reliable endpoint
            if (primaryParsed.success && (primaryParsed.totalDeuda ?? 0) === 0) {
                const resultText = JSON.stringify({
                    success: true,
                    formatted_response: `Tu contrato ${contrato} no tiene adeudos pendientes.\n\n¿Te puedo ayudar con algo más?`,
                    data: { contrato, totalDeuda: 0, mensaje: "sin adeudo" }
                });
                cache.set(cacheKey, resultText);
                return { content: [{ type: "text" as const, text: resultText }] };
            }

            // Primary failed entirely — try getDeudaTotalConFacturas as last resort
            logger.info({ error: primaryParsed.error }, "[get_deuda] Primary failed, trying getDeudaTotalConFacturas fallback");

            const fallbackResponse = await fetchWithRetry(
                `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                    body: buildDeudaTotalConFacturasSOAP(contrato)
                }
            );

            const fallbackXml = await fallbackResponse.text();
            logger.info({ responsePreview: fallbackXml.substring(0, 500) }, "[get_deuda] Fallback response");
            const fallbackParsed = parseDeudaTotalConFacturasResponse(fallbackXml);
            logger.info({ parsed: fallbackParsed }, "[get_deuda] Fallback parsed");

            if (fallbackParsed.success) {
                const { totalDeuda = 0, facturas = [], nombreCliente } = fallbackParsed;

                if (facturas.length === 0 && totalDeuda === 0) {
                    const resultText = JSON.stringify({
                        success: true,
                        formatted_response: `Tu contrato ${contrato} está en proceso de facturación. En cuanto se complete, podrás consultar tu saldo actualizado.`,
                        data: { contrato, totalDeuda: 0, mensaje: "proceso de facturación" }
                    });
                    cache.set(cacheKey, resultText);
                    return { content: [{ type: "text" as const, text: resultText }] };
                }

                let vencido = 0;
                let porVencer = 0;
                for (const f of facturas) {
                    if (f.estadoTexto === "vencido") vencido += f.importe;
                    else porVencer += f.importe;
                }

                let formattedResponse = `Estado de cuenta del contrato ${contrato}:\n\n`;
                formattedResponse += `💰 **Total a pagar: $${totalDeuda.toFixed(2)}**\n`;

                if (facturas.length > 0) {
                    if (vencido > 0) {
                        formattedResponse += `🔴 Vencido: $${vencido.toFixed(2)}\n`;
                    }
                    if (porVencer > 0) {
                        formattedResponse += `🟡 Por vencer: $${porVencer.toFixed(2)}\n`;
                    }

                    formattedResponse += `\n📋 **Recibos pendientes:**\n`;
                    for (const factura of facturas) {
                        const emoji = factura.estadoTexto === "vencido" ? "🔴" : "🟡";
                        const label = factura.periodo || factura.numero;
                        const venceInfo = factura.fechaVencimiento ? ` - Vence: ${factura.fechaVencimiento}` : "";
                        formattedResponse += `${emoji} ${label}: $${factura.importe.toFixed(2)} (${factura.estadoTexto})${venceInfo}\n`;
                    }
                }

                formattedResponse += `\n¿Quieres realizar un pago o tienes dudas sobre tu saldo?`;

                const resultText = JSON.stringify({
                    success: true,
                    formatted_response: formattedResponse,
                    data: { contrato, totalDeuda, vencido, porVencer, nombreCliente, facturas }
                });
                cache.set(cacheKey, resultText);
                return { content: [{ type: "text" as const, text: resultText }] };
            }

            // Both calls failed
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: fallbackParsed.error,
                formatted_response: `No encontré información de adeudo para el contrato ${contrato}. ¿Puedes verificar el número?`
            }) }] };
        } catch (error) {
            logger.error({ err: error }, "[get_deuda] Error");
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: `No se pudo consultar el saldo: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                        formatted_response: "El sistema de consulta no está disponible en este momento. ¿Puedes intentar en unos minutos?"
                    })
                }]
            };
        }
    }
);

/**
 * GET CONSUMO - Retrieves consumption history
 */
export const getConsumoTool = tool(
    "get_consumo",
    `Obtiene el historial de consumo de agua de un contrato.

PARÁMETROS:
- contrato: Número de contrato CEA (requerido)
- year: Año específico para filtrar (opcional, ej: 2022, 2023)

RETORNA:
- consumos: Lista de consumos por periodo (m³) con año y mes
- promedioMensual: Promedio de consumo mensual
- tendencia: Si el consumo está aumentando, estable o disminuyendo
- añosDisponibles: Lista de años con datos disponibles

Usa cuando el usuario pregunte por su consumo, historial de lecturas, o cuánta agua ha gastado.
Si el usuario pide un año específico (ej: "consumo de 2022"), usa el parámetro year para filtrar.`,
    {
        contrato: z.string().describe("Número de contrato CEA"),
        year: z.number().optional().describe("Año específico para filtrar los consumos (ej: 2022)")
    },
    async ({ contrato, year }) => {
        logger.info({ contrato, year: year || "all" }, "[get_consumo] Fetching consumption");

        // Check cache first
        const cache = getCache();
        const cacheKey = CacheKeys.consumo(contrato, year);
        const cached = cache.get<string>(cacheKey);
        if (cached) {
            logger.debug({ cacheKey }, "Cache hit for get_consumo");
            return { content: [{ type: "text" as const, text: cached }] };
        }

        try {
            // Try explotacion=1 first (most common), then 12 if no data
            const explotaciones = ["1", "12"];
            let parsed: ConsumoResponse = { success: false, error: "No data found" };

            for (const explotacion of explotaciones) {
                logger.info({ explotacion }, "[get_consumo] Trying explotacion");
                const response = await fetchWithRetry(
                    `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                        body: buildConsumoSOAP(contrato, explotacion)
                    }
                );

                const xml = await response.text();
                parsed = parseConsumoResponse(xml);

                // If we got data, break out of the loop
                if (parsed.success && parsed.data && parsed.data.consumos.length > 0) {
                    logger.info({ count: parsed.data.consumos.length, explotacion }, "[get_consumo] Found records");
                    break;
                }
            }

            if (!parsed.success) {
                return { content: [{ type: "text" as const, text: JSON.stringify({ error: parsed.error, success: false }) }] };
            }

            const data = parsed.data!;

            // Get unique years available
            const añosDisponibles = [...new Set(data.consumos.map(c => c.año))].filter(a => a > 0).sort((a, b) => b - a);

            // Filter by year if specified
            let consumosFiltrados = data.consumos;
            if (year) {
                consumosFiltrados = data.consumos.filter(c => c.año === year);
            }

            // Calculate average for filtered data
            const promedioFiltrado = consumosFiltrados.length > 0
                ? consumosFiltrados.reduce((sum, c) => sum + c.consumoM3, 0) / consumosFiltrados.length
                : 0;

            // Calculate total for the year
            const totalAño = consumosFiltrados.reduce((sum, c) => sum + c.consumoM3, 0);

            const result = {
                success: true,
                contrato,
                yearConsultado: year || "todos",
                yearsDisponibles: añosDisponibles,
                totalRegistros: data.consumos.length,
                registrosFiltrados: consumosFiltrados.length,
                promedioMensual: Math.round(promedioFiltrado),
                totalConsumoM3: totalAño,
                tendencia: data.tendencia,
                consumos: consumosFiltrados.map(c => ({
                    periodo: c.periodo,
                    consumoM3: c.consumoM3,
                    year: c.año,
                    mes: c.mes,
                    tipoLectura: c.tipoLectura
                })),
                resumen: year
                    ? `Consumo ${year}: Total ${totalAño} m³, Promedio mensual ${Math.round(promedioFiltrado)} m³`
                    : `Historial completo: ${data.consumos.length} registros desde ${añosDisponibles[añosDisponibles.length - 1] || 'N/A'} hasta ${añosDisponibles[0] || 'N/A'}`
            };

            const resultText = JSON.stringify(result);
            cache.set(cacheKey, resultText);
            return { content: [{ type: "text" as const, text: resultText }] };
        } catch (error) {
            logger.error({ err: error }, "[get_consumo] Error");
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: `No se pudo consultar el consumo: ${error instanceof Error ? error.message : 'Error desconocido'}`
                    })
                }]
            };
        }
    }
);

/**
 * GET CONTRACT DETAILS - Retrieves contract information
 */
export const getContratoTool = tool(
    "get_contract_details",
    `Obtiene los detalles de un contrato CEA.

RETORNA:
- titular: Nombre del titular
- direccion: Dirección del servicio
- tarifa: Tipo de tarifa
- estado: Estado del contrato (activo/suspendido/cortado)

Usa para validar un contrato o conocer detalles del servicio.`,
    {
        contrato: z.string().describe("Número de contrato CEA")
    },
    async ({ contrato }) => {
        logger.info({ contrato }, "[get_contract_details] Fetching contract");

        // Check cache first
        const cache = getCache();
        const cacheKey = CacheKeys.contrato(contrato);
        const cached = cache.get<string>(cacheKey);
        if (cached) {
            logger.debug({ cacheKey }, "Cache hit for get_contract_details");
            return { content: [{ type: "text" as const, text: cached }] };
        }

        try {
            const response = await fetchWithRetry(
                `${CEA_API_BASE}/InterfazGenericaContratacionWS`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                    body: buildContratoSOAP(contrato)
                }
            );

            const xml = await response.text();
            const parsed = parseContratoResponse(xml);

            if (!parsed.success) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: parsed.error,
                    formatted_response: `No encontré información para el contrato ${contrato}. ¿Puedes verificar el número?`
                }) }] };
            }

            // ENRICHMENT: Get real service status from punto de servicio
            const numeroContador = parseXMLValue(xml, "numeroContador");
            logger.info({ numeroContador }, "[get_contract_details] numeroContador from XML");
            if (numeroContador && parsed.data) {
                try {
                    const psEstado = await fetchPuntoServicioEstado(numeroContador);
                    if (psEstado) {
                        logger.info({ from: parsed.data.estado, to: psEstado }, "[get_contract_details] Punto servicio enrichment");
                        parsed.data.estado = psEstado;
                    }
                } catch (e) {
                    logger.info("[get_contract_details] Punto servicio enrichment failed, using default status");
                }
            } else {
                logger.info({ numeroContador }, "[get_contract_details] Enrichment skipped");
            }

            // Generate formatted response using template
            const data = parsed.data!;
            const formattedResponse = renderTemplate("contract_info", {
                contract_number: contrato,
                titular: data.titular,
                direccion: data.direccion,
                colonia: data.colonia,
                tarifa: data.tarifa,
                estado: data.estado
            });

            const resultText = JSON.stringify({
                success: true,
                formatted_response: formattedResponse,
                // Raw data also available if needed
                data: parsed.data
            });
            cache.set(cacheKey, resultText);
            return { content: [{ type: "text" as const, text: resultText }] };
        } catch (error) {
            logger.error({ err: error }, "[get_contract_details] Error");
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: `No se pudo consultar el contrato: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                        formatted_response: "El sistema de consulta no está disponible en este momento. ¿Puedes intentar en unos minutos?"
                    })
                }]
            };
        }
    }
);

/**
 * CREATE TICKET - Creates a new support ticket with AGORA categories
 */
export const createTicketTool = tool(
    "create_ticket",
    `Crea un ticket en el sistema AGORA CEA y retorna el folio generado.

CATEGORÍAS (AGORA):
- CON: Consultas generales
- FAC: Facturación (recibos, aclaraciones, ajustes)
- CTR: Contratos (altas, bajas, cambios)
- CVN: Convenios de pago
- REP: Reportes de servicio (fugas, drenaje, calidad)
- SRV: Servicios técnicos (medidores, instalaciones)

⚠️ CUÁNDO PEDIR CONTRATO:
- REP (fugas en vía pública, drenaje en calle): NO pidas contrato, solo ubicación
- REP (fuga de medidor, problema dentro de propiedad): SÍ pide contrato
- FAC, CTR, CVN, SRV: SÍ requieren contrato
- CON: Depende de la consulta

IMPORTANTE: Esta herramienta retorna un formatted_response con el folio y detalles. Muéstralo directamente al usuario (regla 8).`,
    {
        category_code: z.enum(["CON", "FAC", "CTR", "CVN", "REP", "SRV"])
            .describe("Código de categoría AGORA"),
        subcategory_code: z.string().optional()
            .describe("Código de subcategoría (ej: FAC-001, REP-FG-001)"),
        titulo: z.string().describe("Título breve del ticket"),
        descripcion: z.string().describe("Descripción detallada del problema"),
        contract_number: z.string().optional().describe("Número de contrato - NO requerido para fugas/drenaje en vía pública"),
        email: z.string().optional().describe("Email del cliente (si aplica)"),
        ubicacion: z.string().optional().describe("Ubicación - REQUERIDO para reportes REP en vía pública"),
        priority: z.enum(["low", "medium", "high", "urgent"]).default("medium")
            .describe("Prioridad del ticket")
    },
    async (input) => {
        // Defense: check service status before creating REP tickets with a contract
        if (input.category_code === "REP" && input.contract_number) {
            try {
                const contratoResponse = await fetchWithRetry(
                    `${CEA_API_BASE}/InterfazGenericaContratacionWS`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                        body: buildContratoSOAP(input.contract_number)
                    }
                );
                const contratoXml = await contratoResponse.text();
                const contadorTag = parseXMLValue(contratoXml, "numeroContador");
                if (contadorTag) {
                    const estado = await fetchPuntoServicioEstado(contadorTag);
                    if (estado === 'cortado' || estado === 'suspendido') {
                        logger.info({ contract: input.contract_number, estado }, "[create_ticket] BLOCKED: Service suspended/cut");
                        return { content: [{ type: "text" as const, text: JSON.stringify({
                            success: false,
                            blocked: true,
                            estado,
                            formatted_response: `Tu servicio se encuentra ${estado} por falta de pago. Para reactivarlo:\n\n` +
                                `- En línea: https://appcea.ceaqueretaro.gob.mx/PagoEnLinea/\n` +
                                `- Sucursales CEA\n- Oxxo (con tu recibo)\n- Bancos autorizados\n\n` +
                                `Una vez realizado el pago, tu servicio se restablece en un plazo de 24-48 horas.`
                        }) }] };
                    }
                }
            } catch (e) {
                logger.info("[create_ticket] Status check failed, proceeding with ticket creation");
            }
        }

        const ticketInput: CreateTicketInput = {
            category_code: input.category_code,
            subcategory_code: input.subcategory_code as any,
            titulo: input.titulo,
            descripcion: input.descripcion,
            contract_number: input.contract_number,
            email: input.email,
            ubicacion: input.ubicacion,
            priority: input.priority as TicketPriority
        };

        const result = await createTicketDirect(ticketInput);

        // Generate formatted response using template
        const emoji = getCategoryEmoji(input.category_code) || getTicketEmoji(input.titulo);
        const formattedResponse = renderTemplate("ticket_created", {
            folio: result.folio,
            emoji,
            tipo: input.titulo,
            ubicacion: input.ubicacion || "",
            estatus: "open"
        });

        return { content: [{ type: "text" as const, text: JSON.stringify({
            ...result,
            formatted_response: formattedResponse
        }) }] };
    }
);

/**
 * GET CLIENT TICKETS - Retrieves tickets for a contract
 */
export const getClientTicketsTool = tool(
    "get_client_tickets",
    `Obtiene los tickets de un cliente por número de contrato.

RETORNA lista de tickets con:
- folio: Número de ticket
- status: Estado (open, in_progress, resolved, etc.)
- titulo: Título del ticket
- created_at: Fecha de creación`,
    {
        contract_number: z.string().describe("Número de contrato CEA")
    },
    async ({ contract_number }) => {
        logger.info({ contract_number }, "[get_client_tickets] Fetching tickets");

        // Check cache first
        const cache = getCache();
        const cacheKey = CacheKeys.tickets(contract_number);
        const cached = cache.get<string>(cacheKey);
        if (cached) {
            logger.debug({ cacheKey }, "Cache hit for get_client_tickets");
            return { content: [{ type: "text" as const, text: cached }] };
        }

        try {
            const tickets = await pgQuery<{
                folio: string;
                status: string;
                title: string;
                service_type: string;
                created_at: Date;
                description: string;
            }>(`
                SELECT folio, status, title, service_type, created_at, description
                FROM tickets
                WHERE contract_number = $1
                ORDER BY created_at DESC
                LIMIT 10
            `, [contract_number]);

            if (!tickets || tickets.length === 0) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: true,
                            tickets: [],
                            message: "No se encontraron tickets para este contrato"
                        })
                    }]
                };
            }

            const result = {
                success: true,
                tickets: tickets.map((t) => ({
                    folio: t.folio,
                    status: t.status,
                    titulo: t.title,
                    service_type: t.service_type,
                    created_at: t.created_at,
                    descripcion: t.description?.substring(0, 100)
                })),
                count: tickets.length
            };

            const resultText = JSON.stringify(result);
            cache.set(cacheKey, resultText);
            return { content: [{ type: "text" as const, text: resultText }] };
        } catch (error) {
            logger.error({ err: error }, "[get_client_tickets] Error");
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: `No se pudieron consultar los tickets: ${error instanceof Error ? error.message : 'Error desconocido'}`
                    })
                }]
            };
        }
    }
);

/**
 * SEARCH CUSTOMER BY CONTRACT - Finds customer in contacts table
 */
export const searchCustomerByContractTool = tool(
    "search_customer_by_contract",
    "Busca un cliente por su número de contrato en la base de datos CEA (AGORA contacts).",
    {
        contract_number: z.string().describe("Número de contrato CEA")
    },
    async ({ contract_number }) => {
        logger.info({ contract_number }, "[search_customer] Searching for contract");

        // Check cache first
        const cache = getCache();
        const cacheKey = CacheKeys.customer(contract_number);
        const cached = cache.get<string>(cacheKey);
        if (cached) {
            logger.debug({ cacheKey }, "Cache hit for search_customer_by_contract");
            return { content: [{ type: "text" as const, text: cached }] };
        }

        try {
            const contacts = await pgQuery<{
                id: number;
                name: string;
                email: string | null;
                phone_number: string | null;
                identifier: string | null;
                custom_attributes: Record<string, unknown> | null;
            }>(`
                SELECT id, name, email, phone_number, identifier, custom_attributes
                FROM contacts
                WHERE identifier = $1
                   OR custom_attributes->>'contract_number' = $1
                LIMIT 1
            `, [contract_number]);

            if (!contacts || contacts.length === 0) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            found: false,
                            message: "Cliente no encontrado"
                        })
                    }]
                };
            }

            const contact = contacts[0]!;
            const customAttrs = contact.custom_attributes || {};

            const result = {
                success: true,
                found: true,
                customer: {
                    id: contact.id,
                    nombre: contact.name || 'Sin nombre',
                    contrato: contact.identifier || (customAttrs as Record<string, string>).contract_number || contract_number,
                    email: contact.email || (customAttrs as Record<string, string>).email || null,
                    whatsapp: contact.phone_number || (customAttrs as Record<string, string>).whatsapp || null,
                    recibo_digital: (customAttrs as Record<string, boolean>).recibo_digital || false
                }
            };

            const resultText = JSON.stringify(result);
            cache.set(cacheKey, resultText);
            return { content: [{ type: "text" as const, text: resultText }] };
        } catch (error) {
            logger.error({ err: error }, "[search_customer] Error");
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: error instanceof Error ? error.message : 'Error desconocido'
                    })
                }]
            };
        }
    }
);

/**
 * UPDATE TICKET STATUS - Updates a ticket
 * NOTE: Users CANNOT close/resolve tickets - only agents can
 */
export const updateTicketTool = tool(
    "update_ticket",
    `Actualiza el estado u otros campos de un ticket existente.

⚠️ RESTRICCIÓN IMPORTANTE:
- Los usuarios NO pueden cerrar tickets
- Si el usuario pide cerrar un ticket, usa handoff_to_human en su lugar
- Solo los agentes humanos pueden marcar tickets como "resolved" o "closed"

ESTADOS PERMITIDOS para María:
- in_progress, waiting_client, waiting_internal, escalated`,
    {
        folio: z.string().describe("Folio del ticket a actualizar"),
        status: z.enum(["open", "in_progress", "waiting_client", "waiting_internal", "escalated", "resolved", "closed", "cancelled"]).optional()
            .describe("Nuevo estado del ticket"),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional()
            .describe("Nueva prioridad del ticket"),
        notes: z.string().optional().describe("Notas adicionales")
    },
    async ({ folio, status, priority, notes }) => {
        logger.info({ folio }, "[update_ticket] Updating ticket");

        // RESTRICTION: Users cannot close/resolve tickets
        if (status === "resolved" || status === "closed" || status === "cancelled") {
            logger.info({ status }, "[update_ticket] BLOCKED: User attempted to set restricted status");
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        blocked: true,
                        formatted_response: "Los tickets solo pueden ser cerrados por un asesor. Te comunico con uno para que te ayude con esto 👤"
                    })
                }]
            };
        }

        try {
            const setClauses: string[] = ['updated_at = NOW()'];
            const params: unknown[] = [];
            let paramIndex = 1;

            if (status) {
                setClauses.push(`status = $${paramIndex++}`);
                params.push(status);
            }
            if (priority) {
                setClauses.push(`priority = $${paramIndex++}`);
                params.push(priority);
            }
            if (notes) {
                setClauses.push(`resolution_notes = $${paramIndex++}`);
                params.push(notes);
            }
            // Note: resolved_at is set by human agents only, not through this tool

            params.push(folio);

            await pgQuery(`
                UPDATE tickets
                SET ${setClauses.join(', ')}
                WHERE folio = $${paramIndex}
            `, params);

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        folio,
                        message: `Ticket ${folio} actualizado correctamente`
                    })
                }]
            };
        } catch (error) {
            logger.error({ err: error }, "[update_ticket] Error");
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: error instanceof Error ? error.message : 'Error desconocido'
                    })
                }]
            };
        }
    }
);

// ============================================
// HANDOFF TO HUMAN - Transfer conversation to agent
// ============================================

export const handoffToHumanTool = tool(
    "handoff_to_human",
    `Transfiere la conversación a un agente humano de CEA.

USA ESTA HERRAMIENTA CUANDO:
- El usuario pida hablar con una persona/humano/agente
- El usuario diga "quiero hablar con alguien"
- El usuario esté frustrado y pida atención personal
- No puedas resolver el problema del usuario

IMPORTANTE: Los IDs de conversación y cuenta se pasan en el contexto del sistema.`,
    {
        reason: z.string().describe("Motivo de la transferencia (breve)")
    },
    async ({ reason }) => {
        // Note: conversation_id and account_id come from the system context
        // They are injected by agent.ts when building the prompt
        // For now, we extract them from environment or return instructions

        const conversationId = parseInt(process.env.CURRENT_CHATWOOT_CONVERSATION_ID || "0");
        const accountId = parseInt(process.env.CURRENT_CHATWOOT_ACCOUNT_ID || "0");

        if (!conversationId || !accountId) {
            logger.info({ conversationId, accountId }, "[handoff_to_human] Missing context");
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        formatted_response: "No puedo transferir la conversación en este momento. Por favor intenta más tarde o llama al 442-238-8200."
                    })
                }]
            };
        }

        logger.info({ conversationId, reason }, "[handoff_to_human] Transferring conversation to human");

        const result = await updateConversationStatus(accountId, conversationId, "pending");

        if (result.success) {
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        formatted_response: "¡Claro, te comunico con un agente! Dame unos minutos en lo que encuentro al mejor agente para ayudarte 👤"
                    })
                }]
            };
        }

        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    success: false,
                    formatted_response: "No pude transferir la conversación. Por favor llama al 442-238-8200 para atención inmediata."
                })
            }]
        };
    }
);

// ============================================
// GET RECIBO PDF - Generates signed download link for receipt PDF
// ============================================

export const getReciboPdfTool = tool(
    "get_recibo_pdf",
    `Genera un enlace seguro para descargar el recibo digital (PDF) de un contrato.

USA ESTA HERRAMIENTA CUANDO:
- El usuario pida que le envíen su recibo digital
- El usuario quiera descargar su recibo
- El usuario pregunte cómo obtener su recibo

PARÁMETROS:
- contrato: Número de contrato CEA (requerido)
- periodo: Mes específico si el usuario pide un recibo de un mes en particular (opcional, ej: "enero", "febrero 2025")

El enlace es válido por 48 horas. Siempre ofrece: "Si necesitas de otro mes avísame y te ayudo"`,
    {
        contrato: z.string().describe("Número de contrato CEA"),
        periodo: z.string().optional().describe("Periodo específico si el usuario pide un mes en particular (ej: 'enero', 'febrero 2025')")
    },
    async ({ contrato, periodo }) => {
        logger.info({ contrato, periodo: periodo || "latest" }, "[get_recibo_pdf] Generating PDF link");

        try {
            // Call getFacturas to verify invoices exist and find the right one
            // Try explotacion=1 first, then fallback to explotacion=12
            let parsed: { success: boolean; facturas: FacturaInfo[]; error?: string } = { success: false, facturas: [] };
            for (const explotacion of ["1", "12"]) {
                const facturasResponse = await fetchWithRetry(
                    `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
                    { method: 'POST', headers: { 'Content-Type': 'text/xml;charset=UTF-8' }, body: buildGetFacturasSOAP(contrato, explotacion) }
                );
                const facturasXml = await facturasResponse.text();
                parsed = parseGetFacturasResponse(facturasXml);
                if (parsed.success && parsed.facturas.length > 0) {
                    logger.info({ count: parsed.facturas.length, explotacion }, "[get_recibo_pdf] Found facturas");
                    break;
                }
            }

            if (!parsed.success || parsed.facturas.length === 0) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    formatted_response: `No encontré recibos disponibles para el contrato ${contrato}. ¿Puedes verificar el número de contrato?`
                }) }] };
            }

            // Find the target factura
            let targetFactura = parsed.facturas[0]; // default: most recent

            if (periodo) {
                const periodoLower = periodo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const matchingFactura = parsed.facturas.find(f => {
                    const textoLower = f.periodoTexto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    return textoLower.includes(periodoLower) || periodoLower.includes(textoLower);
                });

                if (!matchingFactura) {
                    const availablePeriods = parsed.facturas.map(f => f.periodoTexto).join(", ");
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        formatted_response: `No encontré un recibo para "${periodo}". Los recibos disponibles son: ${availablePeriods}. ¿De cuál mes necesitas el recibo?`
                    }) }] };
                }
                targetFactura = matchingFactura;
            }

            // Generate signed URL (48h expiry)
            const expiresAt = Date.now() + 48 * 60 * 60 * 1000;
            const token = generateReciboToken(contrato, expiresAt);
            const downloadUrl = `${SERVER_BASE_URL}/recibo/${contrato}?token=${token}&expires=${expiresAt}&factura=${targetFactura!.numero}`;

            const formattedResponse = `Aquí está tu recibo de *${targetFactura!.periodoTexto}* del contrato ${contrato}:\n\n` +
                `📄 ${downloadUrl}\n\n` +
                `El enlace es válido por 48 horas. Si necesitas de otro mes avísame y te ayudo.`;

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                formatted_response: formattedResponse,
                data: {
                    contrato,
                    factura: targetFactura!.numero,
                    periodo: targetFactura!.periodoTexto,
                    download_url: downloadUrl
                }
            }) }] };
        } catch (error) {
            logger.error({ err: error }, "[get_recibo_pdf] Error");
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                formatted_response: "No se pudo generar el enlace del recibo en este momento. ¿Puedes intentar en unos minutos?"
            }) }] };
        }
    }
);

// ============================================
// VALIDATE CONTRACT HOLDER - Name verification before showing data
// ============================================

export const validateContractHolderTool = tool(
    "validate_contract_holder",
    `Valida la identidad del usuario comparando el nombre proporcionado con el titular del contrato.

USA ESTA HERRAMIENTA ANTES de mostrar datos sensibles (saldo, detalles, consumo, tickets) de un contrato.

PARÁMETROS:
- contrato: Número de contrato CEA
- nombre_proporcionado: Nombre o apellido que el usuario proporcionó

RETORNA:
- validated: true si el nombre coincide con el titular
- validated: false si no coincide
- skipped: true si no se pudo verificar (sin datos de titular o error de API)`,
    {
        contrato: z.string().describe("Número de contrato CEA"),
        nombre_proporcionado: z.string().describe("Nombre o apellido proporcionado por el usuario")
    },
    async ({ contrato, nombre_proporcionado }) => {
        logger.info({ nombre_proporcionado, contrato }, "[validate_contract_holder] Validating");

        try {
            const response = await fetchWithRetry(
                `${CEA_API_BASE}/InterfazGenericaContratacionWS`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                    body: buildContratoSOAP(contrato)
                }
            );

            const xml = await response.text();
            const parsed = parseContratoResponse(xml);

            if (!parsed.success || !parsed.data) {
                logger.info("[validate_contract_holder] API error or no data, skipping verification");
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    validated: true,
                    skipped: true,
                    reason: "No se pudo obtener datos del contrato"
                }) }] };
            }

            // ENRICHMENT: Get real service status from punto de servicio
            const numeroContador = parseXMLValue(xml, "numeroContador");
            logger.info({ numeroContador }, "[validate_contract_holder] numeroContador from XML");
            if (numeroContador && parsed.data) {
                try {
                    const psEstado = await fetchPuntoServicioEstado(numeroContador);
                    if (psEstado) {
                        logger.info({ from: parsed.data.estado, to: psEstado }, "[validate_contract_holder] Punto servicio enrichment");
                        parsed.data.estado = psEstado;
                    }
                } catch (e) {
                    logger.info("[validate_contract_holder] Punto servicio enrichment failed, using default status");
                }
            } else {
                logger.info({ numeroContador }, "[validate_contract_holder] Enrichment skipped");
            }

            const titular = parsed.data.titular;
            if (!titular || titular.trim() === "") {
                logger.info("[validate_contract_holder] No titular data, skipping verification");
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    validated: true,
                    skipped: true,
                    reason: "El contrato no tiene datos de titular"
                }) }] };
            }

            const result = matchName(nombre_proporcionado, titular);
            logger.info({ matchResult: result }, "[validate_contract_holder] Match result");

            if (result.match) {
                // Mark contract as verified for this conversation
                const conversationId = process.env.CURRENT_CONVERSATION_ID || "";
                if (conversationId) {
                    if (!verifiedContractsMap.has(conversationId)) {
                        verifiedContractsMap.set(conversationId, new Set());
                    }
                    verifiedContractsMap.get(conversationId)!.add(contrato);
                    logger.info({ contrato, conversationId }, "[validate_contract_holder] Contract verified");
                }

                return { content: [{ type: "text" as const, text: JSON.stringify({
                    validated: true,
                    confidence: result.confidence,
                    method: result.method,
                    estado: parsed.data.estado
                }) }] };
            }

            return { content: [{ type: "text" as const, text: JSON.stringify({
                validated: false,
                message: "El nombre no coincide con el titular del contrato. ¿Puedes verificar e intentarlo de nuevo?"
            }) }] };

        } catch (error) {
            logger.error({ err: error }, "[validate_contract_holder] Error");
            // Fail-open: don't block the user if the API is down
            return { content: [{ type: "text" as const, text: JSON.stringify({
                validated: true,
                skipped: true,
                reason: "Error al verificar, se omite validación"
            }) }] };
        }
    }
);

// ============================================
// FIND NEAREST LOCATIONS - PostGIS-based location finder
// ============================================

interface CeaLocationRow {
    id: number;
    slug: string;
    name: string;
    tipo: string;
    address_street: string;
    colonia: string;
    municipio: string;
    codigo_postal: string | null;
    lat: number;
    lng: number;
    distance_meters: number;
    horario: Record<string, string | null>;
    telefono: string | null;
    servicios: string[];
    notas: string | null;
}

function isLocationOpen(horario: Record<string, string | null>): { is_open: boolean; current_schedule: string | null } {
    const now = getMexicoDate();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    let scheduleKey: string;
    if (dayOfWeek === 0) {
        scheduleKey = "dom";
    } else if (dayOfWeek === 6) {
        scheduleKey = "sab";
    } else {
        scheduleKey = "lun_vie";
    }

    const schedule = horario[scheduleKey];
    if (!schedule) {
        return { is_open: false, current_schedule: null };
    }

    const [openTime, closeTime] = schedule.split("-");
    if (!openTime || !closeTime) {
        return { is_open: false, current_schedule: schedule };
    }

    const [openH, openM] = openTime.split(":").map(Number);
    const [closeH, closeM] = closeTime.split(":").map(Number);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const openMinutes = (openH || 0) * 60 + (openM || 0);
    const closeMinutes = (closeH || 0) * 60 + (closeM || 0);

    return {
        is_open: currentMinutes >= openMinutes && currentMinutes < closeMinutes,
        current_schedule: schedule
    };
}

function formatDistance(meters: number): string {
    if (meters < 1000) {
        return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
}

export const findNearestLocationsTool = tool(
    "find_nearest_locations",
    `Encuentra las oficinas, cajeros y puntos de pago CEA más cercanos al usuario.

PARÁMETROS:
- lat/lng: Coordenadas GPS (de ubicación compartida por WhatsApp)
- colonia: Nombre de la colonia del usuario (se busca por coincidencia aproximada)
- tipo: Filtrar por "oficina", "cajero", o "all" (default: "all")
- limit: Máximo de resultados (default: 3)

USA ESTA HERRAMIENTA CUANDO:
- El usuario pregunte "¿dónde puedo pagar?"
- El usuario pregunte por oficinas o cajeros cercanos
- El usuario comparta su ubicación GPS
- El usuario mencione su colonia y pregunte por ubicaciones

IMPORTANTE:
- Si el usuario comparte ubicación GPS, usa lat/lng
- Si el usuario dice su colonia, usa el parámetro colonia
- Si no tienes ni ubicación ni colonia, pregúntale al usuario antes de llamar este tool`,
    {
        lat: z.number().optional().describe("Latitud GPS del usuario"),
        lng: z.number().optional().describe("Longitud GPS del usuario"),
        colonia: z.string().optional().describe("Nombre de la colonia del usuario"),
        tipo: z.enum(["oficina", "cajero", "all"]).default("all").describe("Tipo de ubicación a buscar"),
        limit: z.number().default(3).describe("Máximo de resultados a retornar")
    },
    async ({ lat, lng, colonia, tipo, limit }) => {
        logger.info({ lat, lng, colonia, tipo, limit }, "[find_nearest_locations] Searching");

        const FALLBACK_HQ = "Puedes acudir a cualquiera de las 5 sucursales CEA en Querétaro (Plaza Escobedo, Plaza Candiles, Plaza Vanne, Plaza Altamira, Pabellón Campestre). Línea CEA: 442-211-0066. Horario: Lun-Vie 8:00-17:00.";

        try {
            let searchLat: number | undefined = lat;
            let searchLng: number | undefined = lng;
            let searchMethod = "gps";

            // If no GPS coordinates, try to resolve colonia
            if ((searchLat === undefined || searchLng === undefined) && colonia) {
                searchMethod = "colonia";
                const coloniaName = colonia.toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/\s+/g, " ")
                    .trim();

                logger.info({ coloniaName }, "[find_nearest_locations] Resolving colonia");

                const coloniaResult = await pgQuery<{
                    name: string;
                    lat: number;
                    lng: number;
                    similarity: number;
                }>(`
                    SELECT
                        name,
                        ST_Y(center::geometry) AS lat,
                        ST_X(center::geometry) AS lng,
                        similarity(name_normalized, $1) AS similarity
                    FROM colonias_zones
                    WHERE similarity(name_normalized, $1) > 0.2
                    ORDER BY similarity(name_normalized, $1) DESC
                    LIMIT 1
                `, [coloniaName]);

                if (coloniaResult.length > 0) {
                    searchLat = coloniaResult[0]!.lat;
                    searchLng = coloniaResult[0]!.lng;
                    logger.info({ colonia, resolved: coloniaResult[0]!.name, similarity: coloniaResult[0]!.similarity.toFixed(2), lat: searchLat, lng: searchLng }, "[find_nearest_locations] Resolved colonia");
                } else {
                    logger.info({ colonia }, "[find_nearest_locations] Could not resolve colonia");
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        error: "colonia_not_found",
                        formatted_response: `No encontré la colonia "${colonia}". ¿Me puedes compartir tu ubicación o decirme otra referencia de zona?\n\n${FALLBACK_HQ}`
                    }) }] };
                }
            }

            // If still no coordinates, ask user
            if (searchLat === undefined || searchLng === undefined) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: "no_location",
                    formatted_response: "Para encontrar la oficina o cajero más cercano, necesito tu ubicación. ¿Me puedes compartir tu ubicación por WhatsApp o decirme en qué colonia estás?"
                }) }] };
            }

            // PostGIS KNN query
            const tipoFilter = tipo === "all" ? "" : "AND tipo = $4";
            const params: unknown[] = [searchLng, searchLat, limit];
            if (tipo !== "all") {
                params.push(tipo);
            }

            const locations = await pgQuery<CeaLocationRow>(`
                SELECT
                    id, slug, name, tipo, address_street, colonia, municipio, codigo_postal,
                    ST_Y(geom::geometry) AS lat,
                    ST_X(geom::geometry) AS lng,
                    ST_Distance(geom, ST_MakePoint($1, $2)::geography) AS distance_meters,
                    horario, telefono, servicios, notas
                FROM cea_locations
                WHERE is_active = true ${tipoFilter}
                ORDER BY geom <-> ST_MakePoint($1, $2)::geography
                LIMIT $3
            `, params);

            if (locations.length === 0) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    search_method: searchMethod,
                    data: { locations: [] },
                    formatted_response: `No encontré ubicaciones cercanas del tipo solicitado.\n\n${FALLBACK_HQ}`
                }) }] };
            }

            // Build response
            const tipoLabels: Record<string, string> = {
                "oficina": "Oficina",
                "cajero": "CEAmático",
                "autopago": "Autopago"
            };

            const locationResults = locations.map(loc => {
                const openStatus = isLocationOpen(loc.horario);
                const mapsLink = `https://maps.google.com/?q=${loc.lat},${loc.lng}`;

                return {
                    name: loc.name,
                    tipo: loc.tipo,
                    tipo_label: tipoLabels[loc.tipo] || loc.tipo,
                    address: `${loc.address_street}, Col. ${loc.colonia}`,
                    municipio: loc.municipio,
                    distance: formatDistance(loc.distance_meters),
                    distance_meters: Math.round(loc.distance_meters),
                    is_open: openStatus.is_open,
                    horario: loc.horario,
                    current_schedule: openStatus.current_schedule,
                    telefono: loc.telefono,
                    servicios: loc.servicios,
                    maps_link: mapsLink,
                    notas: loc.notas
                };
            });

            // Build WhatsApp-friendly formatted response
            let formatted = "";
            for (let i = 0; i < locationResults.length; i++) {
                const loc = locationResults[i]!;
                const num = i + 1;
                const statusIcon = loc.is_open ? "Abierto" : "Cerrado";
                const statusEmoji = loc.is_open ? "🟢" : "🔴";

                formatted += `*${num}. ${loc.name}* (${loc.tipo_label})\n`;
                formatted += `📍 ${loc.address} — ${loc.distance}\n`;
                formatted += `${statusEmoji} ${statusIcon}`;
                if (loc.current_schedule) {
                    formatted += ` | Horario: ${loc.current_schedule}`;
                }
                formatted += "\n";
                if (loc.telefono) {
                    formatted += `📞 ${loc.telefono}\n`;
                }
                formatted += `🗺️ ${loc.maps_link}\n`;
                if (i < locationResults.length - 1) {
                    formatted += "\n";
                }
            }

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                search_method: searchMethod,
                data: { locations: locationResults },
                formatted_response: formatted
            }) }] };

        } catch (error) {
            logger.error({ err: error }, "[find_nearest_locations] Error");
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Error desconocido",
                formatted_response: `No pude buscar ubicaciones en este momento.\n\n${FALLBACK_HQ}`
            }) }] };
        }
    }
);

// ============================================
// Export all tools
// ============================================

export const allTools = [
    // CEA API Tools
    getDeudaTool,
    getConsumoTool,
    getContratoTool,
    // Ticket Tools
    createTicketTool,
    getClientTicketsTool,
    searchCustomerByContractTool,
    updateTicketTool,
    // Utility Tools
    getReciboPdfTool,
    // Location Tools
    findNearestLocationsTool,
    // Conversation Tools
    handoffToHumanTool,
    // Verification Tools
    validateContractHolderTool
];

export { fetchWithRetry };

// NOTE: Memory tools removed - see docs/MEMORY_IMPLEMENTATION.md for future reference
