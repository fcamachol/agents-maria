// ============================================
// Core: get_consumo — consumption history orchestration
// Extracted verbatim from tools/cea-api.ts (getConsumoTool handler).
// ============================================

import {
    fetchWithRetry,
    buildConsumoSOAP,
    parseConsumoResponse,
    CEA_API_BASE,
} from "../services/soap-client.js";
import { resolveContract } from "../services/contract-resolver.js";
import { getContractInfo, invalidateContractInfo } from "../services/contract-info.js";
import type { ConsumoResponse } from "../types.js";
import type { ToolResultObject } from "./types.js";

export async function getConsumoCore(rawContrato: string, year?: number): Promise<ToolResultObject> {
    const contrato = await resolveContract(rawContrato);
    console.log(`[get_consumo] Fetching consumption for contract: ${contrato}, year: ${year || 'all'}`);

    const info = await getContractInfo(contrato);
    if (!info) {
        return {
            success: false,
            error: "contrato_no_encontrado",
            formatted_response: `No encontré el contrato ${contrato} en el sistema. ¿Puedes verificar el número?`
        };
    }

    const fetchConsumos = async (explotacion: string): Promise<ConsumoResponse> => {
        const response = await fetchWithRetry(
            `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                body: buildConsumoSOAP(contrato, explotacion)
            }
        );
        return parseConsumoResponse(await response.text());
    };

    try {
        let parsed = await fetchConsumos(info.explotacion);

        // Defense in depth: if the cached zone returns no data, the zone may have
        // changed. Invalidate, re-resolve once, and retry.
        if ((!parsed.success || !parsed.data || parsed.data.consumos.length === 0)) {
            console.log(`[get_consumo] empty result with cached explotacion=${info.explotacion}, refreshing zone`);
            await invalidateContractInfo(contrato);
            const refreshed = await getContractInfo(contrato);
            if (refreshed && refreshed.explotacion && refreshed.explotacion !== info.explotacion) {
                parsed = await fetchConsumos(refreshed.explotacion);
            }
        }

        if (!parsed.success) {
            return { error: parsed.error, success: false };
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

        return result;
    } catch (error) {
        console.error(`[get_consumo] Error:`, error);
        return {
            success: false,
            error: `No se pudo consultar el consumo: ${error instanceof Error ? error.message : 'Error desconocido'}`
        };
    }
}
