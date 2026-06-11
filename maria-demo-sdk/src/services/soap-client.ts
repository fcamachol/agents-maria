// ============================================
// Maria CEA SDK - SOAP Client & Database Services
// Extracted from tools.ts — handles all CEA API
// communication, XML parsing, and database queries
// ============================================

import { config } from "dotenv";
config();

import { ProxyAgent, fetch as undiciFetch } from "undici";
import pg from "pg";
import type {
    ConsumoResponse,
    ContratoResponse,
    FacturaInfo,
    FacturaPendiente,
} from "../types.js";

// ============================================
// Configuration
// ============================================

export const CEA_API_BASE = "https://aquacis-cf.ceaqueretaro.gob.mx/Comercial/services";
export const PROXY_URL = process.env.CEA_PROXY_URL || null;

const PG_CONFIG = {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'agora_production',
    max: parseInt(process.env.PGPOOL_MAX || '10'),
    ssl: process.env.PGSSLMODE !== 'disable' ? { rejectUnauthorized: false } : false,
};

export const pgPool = new pg.Pool(PG_CONFIG);

const HYDRA_PG_CONFIG = {
    host: process.env.HYDRA_PGHOST || 'hydrabd.cluster-cuoflxxjyxja.us-east-1.rds.amazonaws.com',
    port: parseInt(process.env.HYDRA_PGPORT || '5432'),
    user: process.env.HYDRA_PGUSER || 'usrhydra',
    password: process.env.HYDRA_PGPASSWORD || '',
    database: process.env.HYDRA_PGDATABASE || 'hydradb',
    max: parseInt(process.env.HYDRA_PGPOOL_MAX || '5'),
    ssl: { rejectUnauthorized: false },
};

export const hydraPool = new pg.Pool(HYDRA_PG_CONFIG);

// ============================================
// PostgreSQL Helpers
// ============================================

export async function pgQuery<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
    const client = await pgPool.connect();
    try {
        const result = await client.query(query, params);
        return result.rows as T[];
    } finally {
        client.release();
    }
}

export async function hydraQuery<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
    const client = await hydraPool.connect();
    try {
        const result = await client.query(query, params);
        return result.rows as T[];
    } finally {
        client.release();
    }
}

// ============================================
// Utility Functions
// ============================================

export async function fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3,
    delayMs = 1500
): Promise<Response> {
    let lastError: Error | null = null;
    // Extract endpoint name from URL for readable logs
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

export function parseXMLValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
}

export function getMexicoDate(): Date {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
}

// ============================================
// SOAP Builders
// ============================================

export function buildDeudaTotalConFacturasSOAP(contrato: string, explotacion: string): string {
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
            <explotacion>${explotacion}</explotacion>
            <idioma>es</idioma>
        </int:getDeudaTotalConFacturas>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildDeudaContratoSOAP(contrato: string, explotacion: string): string {
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
            <explotacion>${explotacion}</explotacion>
            <idioma>es</idioma>
        </int:getDeudaContrato>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildConsumoSOAP(contrato: string, explotacion: string = "1"): string {
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

export function buildContratoSOAP(contrato: string): string {
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

export function buildPuntoServicioPorContadorSOAP(numeroContador: string): string {
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
// Response Parsers
// ============================================

export const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
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

export function parseDeudaTotalConFacturasResponse(xml: string): {
    success: boolean;
    totalDeuda?: number;
    cantidadFacturas?: number;
    nombreCliente?: string;
    facturas?: FacturaPendiente[];
    error?: string;
    codigoError?: number;
} {
    try {
        if (xml.includes("<faultstring>") || xml.includes("<error>")) {
            const faultMsg = parseXMLValue(xml, "faultstring") || parseXMLValue(xml, "error") || "Error desconocido";
            return { success: false, error: faultMsg };
        }

        // Check for API-level error codes (e.g., -501 = contract not found)
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

export function parseDeudaContratoResponse(xml: string): {
    success: boolean;
    totalDeuda?: number;
    direccion?: string;
    nombreCliente?: string;
    mensaje?: string;
    error?: string;
    codigoError?: number;
} {
    try {
        if (xml.includes("<faultstring>") || xml.includes("<error>")) {
            const faultMsg = parseXMLValue(xml, "faultstring") || parseXMLValue(xml, "error") || "Error desconocido";
            return { success: false, error: faultMsg };
        }

        // Check for API-level error codes (e.g., -501 = contract not found)
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

export function mapEstadoContrato(raw: string): 'activo' | 'suspendido' | 'cortado' {
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

        // Debug: log raw estado value and surrounding XML to diagnose tag name
        const rawEstado = parseXMLValue(xml, "estado");
        console.log(`[parseContratoResponse] Raw estado: "${rawEstado}"`);
        const estadoSnippet = xml.match(/estado[^<]*<[^>]+>[^<]*/gi);
        console.log(`[parseContratoResponse] Estado XML matches: ${JSON.stringify(estadoSnippet)}`);

        // Build address from calle + numero (API uses these tags, not "direccion")
        const calle = parseXMLValue(xml, "calle") || "";
        const numero = parseXMLValue(xml, "numero") || "";
        const direccion = [calle, numero].filter(Boolean).join(" ");
        const echoedContrato = parseXMLValue(xml, "numeroContrato") || parseXMLValue(xml, "contrato") || "";
        const titular = parseXMLValue(xml, "nombreTitular") || parseXMLValue(xml, "titular") || "";

        // Contract not found: API responded with a well-formed but empty body
        // (no echoed contract number, no titular, no address fields).
        if (!echoedContrato && !titular && !calle && !numero) {
            console.log(`[parseContratoResponse] Contract not found (empty response body)`);
            return { success: false, error: "Contract not found", codigoError: -501 };
        }

        return {
            success: true,
            data: {
                numeroContrato: echoedContrato,
                titular: titular,
                direccion: direccion,
                colonia: parseXMLValue(xml, "municipio") || parseXMLValue(xml, "colonia") || "",
                codigoPostal: parseXMLValue(xml, "codigoPostal") || parseXMLValue(xml, "cp") || "",
                tarifa: parseXMLValue(xml, "descUso") || parseXMLValue(xml, "tarifa") || "",
                estado: mapEstadoContrato(parseXMLValue(xml, "estadoContador") || parseXMLValue(xml, "estado") || ""),
                fechaAlta: parseXMLValue(xml, "fechaAlta") || "",
                ultimaLectura: parseXMLValue(xml, "ultimaLectura") || undefined,
                explotacion: parseXMLValue(xml, "explotacion") || ""
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

export async function fetchPuntoServicioEstado(numeroContador: string): Promise<'activo' | 'suspendido' | 'cortado' | null> {
    try {
        console.log(`[fetchPuntoServicioEstado] Calling API for contador: ${numeroContador}`);
        const response = await fetchWithRetry(
            `${CEA_API_BASE}/InterfazGenericaContadoresWS`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                body: buildPuntoServicioPorContadorSOAP(numeroContador)
            }
        );
        const xml = await response.text();
        console.log(`[fetchPuntoServicioEstado] Response (first 500): ${xml.substring(0, 500)}`);
        const result = parsePuntoServicioEstado(xml);
        console.log(`[fetchPuntoServicioEstado] Parsed estado: ${result}`);
        return result;
    } catch (e) {
        console.log(`[fetchPuntoServicioEstado] Error: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

// ============================================
// Recibo PDF Fetcher
// ============================================

export async function fetchReciboPdf(contrato: string, explotacion: string, numFactura?: string): Promise<Buffer | null> {
    try {
        // If no invoice number provided, get the latest from getFacturas
        let facturaNum = numFactura;
        if (!facturaNum) {
            console.log(`[fetchReciboPdf] No factura number, fetching latest for contract ${contrato} (explotacion=${explotacion})`);
            const facturasResponse = await fetchWithRetry(
                `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
                { method: 'POST', headers: { 'Content-Type': 'text/xml;charset=UTF-8' }, body: buildGetFacturasSOAP(contrato, explotacion) }
            );
            const parsed = parseGetFacturasResponse(await facturasResponse.text());
            if (!parsed.success || parsed.facturas.length === 0) {
                console.log(`[fetchReciboPdf] No facturas found for contract ${contrato} in explotacion ${explotacion}`);
                return null;
            }
            console.log(`[fetchReciboPdf] Found ${parsed.facturas.length} facturas with explotacion=${explotacion}`);
            // Get the most recent factura (first in list)
            facturaNum = parsed.facturas[0].numero;
            console.log(`[fetchReciboPdf] Using latest factura: ${facturaNum}`);
        }

        // Fetch the PDF
        console.log(`[fetchReciboPdf] Fetching PDF for factura ${facturaNum}, contrato ${contrato}`);
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
            console.log(`[fetchReciboPdf] No PDF data in response. Response (first 500 chars): ${pdfXml.substring(0, 500)}`);
            return null;
        }

        console.log(`[fetchReciboPdf] Got PDF data, ${base64Match[1].length} base64 chars`);
        return Buffer.from(base64Match[1], 'base64');
    } catch (error) {
        console.error(`[fetchReciboPdf] Error:`, error);
        return null;
    }
}
