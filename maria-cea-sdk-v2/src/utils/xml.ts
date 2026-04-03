// ============================================
// XML Parsing - fast-xml-parser instead of regex
// ============================================

import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: true,
    trimValues: true,
});

/**
 * Parse SOAP XML into a plain object. Returns the Body content.
 */
export function parseSOAPBody(xml: string): Record<string, unknown> {
    const parsed = parser.parse(xml);
    const envelope = parsed?.Envelope || parsed?.["soapenv:Envelope"] || parsed;
    const body = envelope?.Body || envelope?.["soapenv:Body"] || envelope;
    return body as Record<string, unknown>;
}

/**
 * Safely extract a nested value by dot-path.
 * e.g. getNestedValue(obj, "getDeudaResponse.return.deudaTotal")
 */
export function getNestedValue(obj: unknown, path: string): unknown {
    let current: unknown = obj;
    for (const key of path.split(".")) {
        if (current == null || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

/**
 * Extract a string value from parsed XML body, with fallback keys.
 */
export function extractValue(body: Record<string, unknown>, ...paths: string[]): string {
    for (const path of paths) {
        const val = getNestedValue(body, path);
        if (val != null && val !== "") return String(val);
    }
    return "";
}

/**
 * Extract a number value, defaulting to 0 and clamping to >= 0.
 */
export function extractNumber(body: Record<string, unknown>, ...paths: string[]): number {
    const raw = extractValue(body, ...paths);
    const num = parseFloat(raw);
    return isNaN(num) ? 0 : Math.max(0, num);
}

/**
 * Check if SOAP response contains a fault.
 */
export function hasFault(body: Record<string, unknown>): string | null {
    const fault = getNestedValue(body, "Fault.faultstring");
    if (fault) return String(fault);

    const codigoError = getNestedValue(body, "getDeudaResponse.return.codigoError");
    if (codigoError && codigoError !== "0" && codigoError !== 0) {
        const desc = getNestedValue(body, "getDeudaResponse.return.descripcionError");
        return desc ? String(desc) : `Error code: ${codigoError}`;
    }

    return null;
}
