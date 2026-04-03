// ============================================
// SOAP Response Parsers - Using fast-xml-parser
// ============================================

import { parseSOAPBody, getNestedValue, extractValue, extractNumber, hasFault } from "../utils/xml.js";
import type { DeudaResponse, ConsumoResponse, ContratoResponse, ConsumoHistorial } from "../config/types.js";

export function parseDeudaResponse(xml: string): DeudaResponse {
    try {
        const body = parseSOAPBody(xml);
        const fault = hasFault(body);
        if (fault) return { success: false, error: fault };

        // Navigate to the response payload — structure varies by SOAP version
        const ret = getNestedValue(body, "getDeudaResponse.return") as Record<string, unknown> | undefined;
        const src = ret || body;

        const totalDeuda = extractNumber(src as Record<string, unknown>, "deudaTotal", "deuda");
        const saldoAnterior = extractNumber(src as Record<string, unknown>, "saldoAnteriorTotal", "saldoAnterior");
        const deudaActual = extractNumber(src as Record<string, unknown>, "deuda");

        const conceptos = [];
        if (saldoAnterior > 0) {
            conceptos.push({
                periodo: "Saldo anterior",
                concepto: "Adeudo de periodos anteriores",
                monto: saldoAnterior,
                fechaVencimiento: "",
                estado: "vencido" as const,
            });
        }
        if (deudaActual > 0) {
            conceptos.push({
                periodo: "Periodo actual",
                concepto: "Consumo del periodo",
                monto: deudaActual,
                fechaVencimiento: "",
                estado: "por_vencer" as const,
            });
        }

        return {
            success: true,
            data: {
                totalDeuda,
                vencido: saldoAnterior,
                porVencer: deudaActual,
                conceptos,
                nombreCliente: extractValue(src as Record<string, unknown>, "nombreCliente"),
                direccion: extractValue(src as Record<string, unknown>, "direccion"),
            },
        };
    } catch (error) {
        return { success: false, error: `Error parsing deuda response: ${error}` };
    }
}

export function parseConsumoResponse(xml: string): ConsumoResponse {
    try {
        const body = parseSOAPBody(xml);

        // Check for faults in the raw XML as a fallback
        if (xml.includes("<faultstring>")) {
            const fault = hasFault(body);
            if (fault) return { success: false, error: fault };
        }

        // Navigate to consumos array — may be nested
        const ret = getNestedValue(body, "getConsumosResponse.return") as Record<string, unknown> | undefined;
        const src = ret || body;

        // Consumo items — fast-xml-parser returns array or single object
        let rawConsumos = getNestedValue(src, "Consumo") || getNestedValue(src, "consumos") || [];
        if (!Array.isArray(rawConsumos)) rawConsumos = [rawConsumos];

        const consumos: ConsumoHistorial[] = (rawConsumos as Record<string, unknown>[]).map((c) => {
            let periodo = String(c.periodo || "");
            // Clean HTML entities that CEA API sometimes returns
            periodo = periodo.replace(/&lt;|&gt;/g, "").replace(/ - .*/, "").trim();

            const año = String(c["año"] || c.anio || "");
            if (año && periodo) periodo = `${periodo} ${año}`;

            return {
                periodo,
                consumoM3: Math.max(0, parseFloat(String(c.metrosCubicos || 0))),
                lecturaAnterior: parseFloat(String(c.lecturaAnterior || 0)),
                lecturaActual: parseFloat(String(c.lecturaActual || 0)),
                fechaLectura: String(c.fechaLectura || "").split("T")[0],
                tipoLectura: c.estimado === true || c.estimado === "true" ? "estimada" : "real",
            };
        });

        const recentConsumos = consumos.slice(0, 12);
        const promedioMensual = recentConsumos.length > 0
            ? recentConsumos.reduce((sum, c) => sum + c.consumoM3, 0) / recentConsumos.length
            : 0;

        let tendencia: "aumentando" | "estable" | "disminuyendo" = "estable";
        if (consumos.length >= 6) {
            const recent = consumos.slice(0, 3).reduce((s, c) => s + c.consumoM3, 0) / 3;
            const older = consumos.slice(3, 6).reduce((s, c) => s + c.consumoM3, 0) / 3;
            if (recent > older * 1.2) tendencia = "aumentando";
            else if (recent < older * 0.8) tendencia = "disminuyendo";
        }

        return { success: true, data: { consumos, promedioMensual, tendencia } };
    } catch (error) {
        return { success: false, error: `Error parsing consumo response: ${error}` };
    }
}

export function parseContratoResponse(xml: string): ContratoResponse {
    try {
        const body = parseSOAPBody(xml);
        const fault = hasFault(body);
        if (fault) return { success: false, error: fault };

        const ret = getNestedValue(body, "consultaDetalleContratoResponse.return") as Record<string, unknown> | undefined;
        const src = (ret || body) as Record<string, unknown>;

        const calle = extractValue(src, "calle");
        const numero = extractValue(src, "numero");
        const municipio = extractValue(src, "municipio");
        const dirCorrespondencia = extractValue(src, "dirCorrespondencia");

        let direccion = dirCorrespondencia;
        if (!direccion && calle) {
            direccion = `${calle} ${numero}`.trim();
            if (municipio) direccion += `, ${municipio}`;
        }

        const fechaBaja = extractValue(src, "fechaBaja");
        const estado = fechaBaja ? "suspendido" : "activo";
        const fechaAlta = extractValue(src, "fechaAlta").split("T")[0];

        return {
            success: true,
            data: {
                numeroContrato: extractValue(src, "numeroContrato"),
                titular: extractValue(src, "titular"),
                direccion,
                colonia: extractValue(src, "municipio", "provincia"),
                codigoPostal: extractValue(src, "codigoPostal", "cp"),
                tarifa: extractValue(src, "descUso", "tipoUso"),
                estado: estado as "activo" | "suspendido" | "cortado",
                fechaAlta,
                ultimaLectura: extractValue(src, "numeroContador") || undefined,
            },
        };
    } catch (error) {
        return { success: false, error: `Error parsing contrato response: ${error}` };
    }
}
