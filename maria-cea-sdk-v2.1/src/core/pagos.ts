// ============================================
// Core: get_pagos — recibos / facturación history (amounts + paid status)
//
// Distinct from core/deuda.ts (current debt) and core/recibo.ts (PDF link):
// this returns the recent invoices with their billed amount and status
// (pagado / pendiente / vencido) so Maria can answer "cuánto pagué / cuánto
// fue mi recibo de tal mes". Sourced from CEA getFacturas, zone resolved via
// the shared contract-info cache.
// ============================================

import {
    fetchWithRetry,
    buildGetFacturasSOAP,
    parseGetFacturasResponse,
    CEA_API_BASE,
} from "../services/soap-client.js";
import { resolveContract } from "../services/contract-resolver.js";
import { getContractInfo } from "../services/contract-info.js";
import type { ToolResultObject } from "./types.js";

export interface ReciboLite {
    periodo: string;   // "Mayo 2026"
    año: number;
    importe: number;   // pesos
    estado: string;    // "pagado" | "pendiente" | "vencido"
}

export async function getPagosCore(rawContrato: string, meses = 6, year?: number): Promise<ToolResultObject> {
    const contrato = await resolveContract(rawContrato);
    console.log(`[get_pagos] Fetching recibos for contract: ${contrato}, meses: ${meses}, year: ${year || "recientes"}`);

    const info = await getContractInfo(contrato);
    if (!info) {
        return {
            success: false,
            error: "contrato_no_encontrado",
            formatted_response: `No encontré el contrato ${contrato} en el sistema. ¿Puedes verificar el número?`,
        };
    }

    try {
        const response = await fetchWithRetry(
            `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
            {
                method: "POST",
                headers: { "Content-Type": "text/xml;charset=UTF-8" },
                body: buildGetFacturasSOAP(contrato, info.explotacion),
            }
        );
        const parsed = parseGetFacturasResponse(await response.text());
        if (!parsed.success) {
            return { success: false, error: parsed.error };
        }

        // getFacturas returns most-recent-first. Filter by year if asked, else
        // take the most recent `meses` invoices.
        let facturas = parsed.facturas;
        if (year) facturas = facturas.filter((f) => parseInt(f.año, 10) === year);
        const recibos: ReciboLite[] = (year ? facturas : facturas.slice(0, Math.max(1, meses))).map((f) => ({
            periodo: f.periodoTexto,
            año: parseInt(f.año, 10) || 0,
            importe: f.importe,
            estado: f.estadoTexto,
        }));

        return { success: true, contrato, year: year || "recientes", recibos };
    } catch (error) {
        console.error(`[get_pagos] Error:`, error);
        return {
            success: false,
            error: `No se pudo consultar los recibos: ${error instanceof Error ? error.message : "Error desconocido"}`,
        };
    }
}
