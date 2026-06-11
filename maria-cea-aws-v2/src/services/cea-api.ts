// ============================================
// CEA SOAP API Service
// All SOAP operations with input validation + XML escaping
// ============================================

import { ProxyAgent, fetch as undiciFetch } from "undici";
import { validateContrato, validateContador, escapeXml, ValidationError } from "./validation.js";
import type { ConsumoResponse, ContratoResponse } from "../types.js";

// ============================================
// Configuration
// ============================================

const CEA_API_BASE = "https://aquacis-cf.ceaqueretaro.gob.mx/Comercial/services";
const PROXY_URL = process.env.CEA_PROXY_URL || null;

// Credentials from env — not hardcoded in SOAP XML
const SOAP_USER = process.env.CEA_SOAP_USER || "WSGESTIONDEUDA";
const SOAP_PASS = process.env.CEA_SOAP_PASSWORD || "WSGESTIONDEUDA";

// ============================================
// HTTP Client with Retry
// ============================================

export async function fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3,
    delayMs = 1500
): Promise<Response> {
    let lastError: Error | null = null;
    const endpoint = url.split('/').pop() || url;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            let response: Response;

            if (PROXY_URL && url.includes('ceaqueretaro.gob.mx')) {
                if (attempt === 1) console.log(`[API] ${endpoint} via proxy`);
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
                console.warn(`[API] ${endpoint} attempt ${attempt}/${maxRetries} failed: HTTP ${response.status}, retrying in ${delayMs * attempt}ms...`);
                await new Promise(r => setTimeout(r, delayMs * attempt));
                continue;
            }

            if (!response.ok) {
                console.error(`[API] ${endpoint} FAILED after ${maxRetries} attempts: HTTP ${response.status}`);
            }

            return response;
        } catch (error) {
            lastError = error as Error;
            console.warn(`[API] ${endpoint} attempt ${attempt}/${maxRetries} error: ${lastError.message}`);

            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, delayMs * attempt));
            }
        }
    }

    console.error(`[API] ${endpoint} FAILED after ${maxRetries} attempts: ${lastError?.message}`);
    throw lastError || new Error(`${endpoint} failed after ${maxRetries} retries`);
}

// ============================================
// XML Helpers
// ============================================

export function parseXMLValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
}

// ============================================
// SOAP Credential Block (reusable)
// ============================================

function soapCredentials(): string {
    return `<wsse:Security mustUnderstand="1">
            <wsse:UsernameToken wsu:Id="UsernameTokenWSGESTIONDEUDA">
                <wsse:Username>${escapeXml(SOAP_USER)}</wsse:Username>
                <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(SOAP_PASS)}</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>`;
}

// ============================================
// SOAP Builders — all inputs validated + escaped
// ============================================

export function buildDeudaTotalConFacturasSOAP(contrato: string): string {
    const safe = escapeXml(validateContrato(contrato));
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:int="http://interfazgenericagestiondeuda.occamcxf.occam.agbar.com/" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        ${soapCredentials()}
    </soapenv:Header>
    <soapenv:Body>
        <int:getDeudaTotalConFacturas>
            <contrato>${safe}</contrato>
            <explotacion>12</explotacion>
            <idioma>es</idioma>
        </int:getDeudaTotalConFacturas>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildDeudaContratoSOAP(contrato: string): string {
    const safe = escapeXml(validateContrato(contrato));
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:int="http://interfazgenericagestiondeuda.occamcxf.occam.agbar.com/" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        ${soapCredentials()}
    </soapenv:Header>
    <soapenv:Body>
        <int:getDeudaContrato>
            <tipoIdentificador>CONTRATO</tipoIdentificador>
            <valor>${safe}</valor>
            <explotacion>12</explotacion>
            <idioma>es</idioma>
        </int:getDeudaContrato>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildConsumoSOAP(contrato: string, explotacion: string = "1"): string {
    const safe = escapeXml(validateContrato(contrato));
    const safeExpl = escapeXml(explotacion);
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        ${soapCredentials()}
    </soapenv:Header>
    <soapenv:Body>
        <occ:getConsumos>
            <explotacion>${safeExpl}</explotacion>
            <contrato>${safe}</contrato>
            <idioma>es</idioma>
        </occ:getConsumos>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildContratoSOAP(contrato: string): string {
    const safe = escapeXml(validateContrato(contrato));
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        ${soapCredentials()}
    </soapenv:Header>
    <soapenv:Body>
        <occ:consultaDetalleContrato>
            <numeroContrato>${safe}</numeroContrato>
            <idioma>es</idioma>
        </occ:consultaDetalleContrato>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildPuntoServicioPorContadorSOAP(numeroContador: string): string {
    const safe = escapeXml(validateContador(numeroContador));
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:int="http://interfazgenericacontadores.occamcxf.occam.agbar.com/" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        ${soapCredentials()}
    </soapenv:Header>
    <soapenv:Body>
        <int:getPuntoServicioPorContador>
            <listaNumSerieContador>${safe}</listaNumSerieContador>
            <usuario>${escapeXml(SOAP_USER)}</usuario>
            <idioma>es</idioma>
            <opciones></opciones>
        </int:getPuntoServicioPorContador>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildGetFacturasSOAP(contrato: string, explotacion: string = "1"): string {
    const safe = escapeXml(validateContrato(contrato));
    const safeExpl = escapeXml(explotacion);
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        ${soapCredentials()}
    </soapenv:Header>
    <soapenv:Body>
        <occ:getFacturas>
            <explotacion>${safeExpl}</explotacion>
            <contrato>${safe}</contrato>
            <idioma>es</idioma>
        </occ:getFacturas>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildGetPdfFacturaSOAP(numFactura: string, numContrato: string): string {
    const safeFactura = escapeXml(numFactura.trim());
    const safeContrato = escapeXml(validateContrato(numContrato));
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <soapenv:Header>
        ${soapCredentials()}
    </soapenv:Header>
    <soapenv:Body>
        <occ:getPdfFactura>
            <numFactura>${safeFactura}</numFactura>
            <numContrato>${safeContrato}</numContrato>
        </occ:getPdfFactura>
    </soapenv:Body>
</soapenv:Envelope>`;
}

// ============================================
// Response Types
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

export interface FacturaPendiente {
    numero: string;
    periodo: string;
    fechaVencimiento: string;
    importe: number;
    estado: string;
    estadoTexto: string;
    referenciaPago: string;
}

export interface DeudaTotalResult {
    success: boolean;
    totalDeuda?: number;
    cantidadFacturas?: number;
    nombreCliente?: string;
    facturas?: FacturaPendiente[];
    error?: string;
    codigoError?: number;
}

export interface DeudaContratoResult {
    success: boolean;
    totalDeuda?: number;
    direccion?: string;
    nombreCliente?: string;
    mensaje?: string;
    error?: string;
    codigoError?: number;
}

// ============================================
// Response Parsers
// ============================================

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function parseDeudaTotalConFacturasResponse(xml: string): DeudaTotalResult {
    try {
        if (xml.includes("<faultstring>") || xml.includes("<error>")) {
            const faultMsg = parseXMLValue(xml, "faultstring") || parseXMLValue(xml, "error") || "Error desconocido";
            return { success: false, error: faultMsg };
        }

        const codigoErrorStr = parseXMLValue(xml, "codigoError") || "0";
        const codigoError = parseInt(codigoErrorStr, 10);
        if (codigoError !== 0) {
            const descripcionError = parseXMLValue(xml, "descripcionError") || parseXMLValue(xml, "descripcionMensaje") || "Error en la consulta";
            console.warn(`[parseDeudaTotalConFacturasResponse] API error code ${codigoError}: ${descripcionError}`);
            return { success: false, error: descripcionError, codigoError };
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

export function parseDeudaContratoResponse(xml: string): DeudaContratoResult {
    try {
        if (xml.includes("<faultstring>") || xml.includes("<error>")) {
            const faultMsg = parseXMLValue(xml, "faultstring") || parseXMLValue(xml, "error") || "Error desconocido";
            return { success: false, error: faultMsg };
        }

        const codigoErrorStr = parseXMLValue(xml, "codigoError") || "0";
        const codigoError = parseInt(codigoErrorStr, 10);
        if (codigoError !== 0) {
            const descripcionError = parseXMLValue(xml, "descripcionError") || parseXMLValue(xml, "descripcionMensaje") || "Error en la consulta";
            console.warn(`[parseDeudaContratoResponse] API error code ${codigoError}: ${descripcionError}`);
            return { success: false, error: descripcionError, codigoError };
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

export function parseConsumoResponse(xml: string): ConsumoResponse {
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

        const consumoMatches = xml.match(/<Consumo>[\s\S]*?<\/Consumo>/g) ||
            xml.match(/<consumo>[\s\S]*?<\/consumo>/gi) ||
            xml.match(/<lectura>[\s\S]*?<\/lectura>/gi) || [];

        for (const consumoXml of consumoMatches) {
            const año = parseInt(parseXMLValue(consumoXml, "año") || "0");
            const metrosCubicos = parseFloat(parseXMLValue(consumoXml, "metrosCubicos") || parseXMLValue(consumoXml, "consumo") || parseXMLValue(consumoXml, "m3") || "0");
            const periodo = parseXMLValue(consumoXml, "periodo") || "";
            const fechaLectura = parseXMLValue(consumoXml, "fechaLectura") || "";
            const estimado = parseXMLValue(consumoXml, "estimado") === "true";

            let mes = "";
            const mesMatch = periodo.match(/<([A-Z]{3})>/);
            if (mesMatch) {
                mes = mesMatch[1];
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

export function parseContratoResponse(xml: string): ContratoResponse {
    try {
        if (xml.includes("<faultstring>") || xml.includes("<error>")) {
            const faultMsg = parseXMLValue(xml, "faultstring") || parseXMLValue(xml, "error") || "Error desconocido";
            return { success: false, error: faultMsg };
        }

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

export function parsePuntoServicioEstado(xml: string): 'activo' | 'suspendido' | 'cortado' | null {
    try {
        const raw = parseXMLValue(xml, "estadoPuntoServicio");
        if (!raw) return null;
        const normalized = raw.trim().toUpperCase();
        if (normalized.includes("CORTADO")) return 'cortado';
        if (normalized.includes("SUSPENDIDO")) return 'suspendido';
        if (normalized.includes("ACTIVO")) return 'activo';
        console.log(`[parsePuntoServicioEstado] Unrecognized value: "${raw}"`);
        return null;
    } catch {
        return null;
    }
}

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
// High-Level Operations (validated → SOAP → parse)
// ============================================

/** Fetch debt via getDeudaContrato (primary endpoint) */
export async function getDeudaContrato(rawContrato: string): Promise<DeudaContratoResult> {
    const contrato = validateContrato(rawContrato);
    const response = await fetchWithRetry(
        `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
            body: buildDeudaContratoSOAP(contrato)
        }
    );
    const xml = await response.text();
    console.log(`[cea-api] getDeudaContrato response: ${xml.length} chars`);
    return parseDeudaContratoResponse(xml);
}

/** Fetch debt with invoice breakdown */
export async function getDeudaTotalConFacturas(rawContrato: string): Promise<DeudaTotalResult> {
    const contrato = validateContrato(rawContrato);
    const response = await fetchWithRetry(
        `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
            body: buildDeudaTotalConFacturasSOAP(contrato)
        }
    );
    const xml = await response.text();
    console.log(`[cea-api] getDeudaTotalConFacturas response: ${xml.length} chars`);
    return parseDeudaTotalConFacturasResponse(xml);
}

/** Fetch consumption history */
export async function getConsumos(rawContrato: string, explotacion: string = "1"): Promise<ConsumoResponse> {
    const contrato = validateContrato(rawContrato);
    const response = await fetchWithRetry(
        `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
            body: buildConsumoSOAP(contrato, explotacion)
        }
    );
    const xml = await response.text();
    return parseConsumoResponse(xml);
}

/** Fetch contract details — returns raw XML too for enrichment */
export async function getContratoDetails(rawContrato: string): Promise<{ parsed: ContratoResponse; rawXml: string }> {
    const contrato = validateContrato(rawContrato);
    const response = await fetchWithRetry(
        `${CEA_API_BASE}/InterfazGenericaContratacionWS`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
            body: buildContratoSOAP(contrato)
        }
    );
    const xml = await response.text();
    return { parsed: parseContratoResponse(xml), rawXml: xml };
}

/** Fetch punto de servicio status by meter number */
export async function fetchPuntoServicioEstado(rawContador: string): Promise<'activo' | 'suspendido' | 'cortado' | null> {
    try {
        const numeroContador = validateContador(rawContador);
        console.log(`[cea-api] fetchPuntoServicioEstado for meter: ${numeroContador}`);
        const response = await fetchWithRetry(
            `${CEA_API_BASE}/InterfazGenericaContadoresWS`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                body: buildPuntoServicioPorContadorSOAP(numeroContador)
            }
        );
        const xml = await response.text();
        console.log(`[cea-api] fetchPuntoServicioEstado response: ${xml.length} chars`);
        return parsePuntoServicioEstado(xml);
    } catch (e) {
        console.log(`[cea-api] fetchPuntoServicioEstado error: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

/** Fetch facturas list for a contract */
export async function getFacturas(rawContrato: string, explotacion: string = "1"): Promise<{ success: boolean; facturas: FacturaInfo[]; error?: string }> {
    const contrato = validateContrato(rawContrato);
    const response = await fetchWithRetry(
        `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
            body: buildGetFacturasSOAP(contrato, explotacion)
        }
    );
    const xml = await response.text();
    return parseGetFacturasResponse(xml);
}

/** Fetch receipt PDF as buffer */
export async function fetchReciboPdf(rawContrato: string, numFactura?: string): Promise<Buffer | null> {
    const contrato = validateContrato(rawContrato);
    try {
        let facturaNum = numFactura;
        if (!facturaNum) {
            console.log(`[cea-api] fetchReciboPdf: No factura number, fetching latest for ${contrato}`);
            let parsed: { success: boolean; facturas: FacturaInfo[]; error?: string } = { success: false, facturas: [] };
            for (const expl of ["1", "12"]) {
                parsed = await getFacturas(contrato, expl);
                if (parsed.success && parsed.facturas.length > 0) {
                    console.log(`[cea-api] Found ${parsed.facturas.length} facturas with explotacion=${expl}`);
                    break;
                }
            }
            if (!parsed.success || parsed.facturas.length === 0) {
                console.log(`[cea-api] No facturas found for contract ${contrato}`);
                return null;
            }
            facturaNum = parsed.facturas[0].numero;
            console.log(`[cea-api] Using latest factura: ${facturaNum}`);
        }

        console.log(`[cea-api] Fetching PDF for factura ${facturaNum}, contrato ${contrato}`);
        const pdfResponse = await fetchWithRetry(
            `${CEA_API_BASE}/InterfazGenericaContratacionWS`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                body: buildGetPdfFacturaSOAP(facturaNum, contrato)
            }
        );
        const pdfXml = await pdfResponse.text();

        const base64Match = pdfXml.match(/<pdf>([^<]+)<\/pdf>/) || pdfXml.match(/<return[^>]*>([^<]+)<\/return>/);
        if (!base64Match || !base64Match[1]) {
            console.log(`[cea-api] No PDF data in response (${pdfXml.length} chars)`);
            return null;
        }

        console.log(`[cea-api] Got PDF data, ${base64Match[1].length} base64 chars`);
        return Buffer.from(base64Match[1], 'base64');
    } catch (error) {
        console.error(`[cea-api] fetchReciboPdf error:`, error);
        return null;
    }
}

// Re-export validation for consumers
export { ValidationError } from "./validation.js";
