// ============================================
// Core: get_contract_details — contract detail orchestration
// Extracted verbatim from tools/cea-api.ts (getContratoTool handler).
// ============================================

import {
    fetchWithRetry,
    buildContratoSOAP,
    parseContratoResponse,
    parseXMLValue,
    fetchPuntoServicioEstado,
    CEA_API_BASE,
} from "../services/soap-client.js";
import { resolveContract } from "../services/contract-resolver.js";
import { renderTemplate } from "../config/response-templates.js";
import type { ToolResultObject } from "./types.js";

export async function getContratoCore(rawContrato: string): Promise<ToolResultObject> {
    const contrato = await resolveContract(rawContrato);
    console.log(`[get_contract_details] Fetching contract: ${contrato}`);

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
            return {
                success: false,
                error: parsed.error,
                formatted_response: `No encontré información para el contrato ${contrato}. ¿Puedes verificar el número?`
            };
        }

        // ENRICHMENT: Get real service status from punto de servicio
        const numeroContador = parseXMLValue(xml, "numeroContador");
        console.log(`[get_contract_details] numeroContador from XML: ${numeroContador}`);
        if (numeroContador && parsed.data) {
            try {
                const psEstado = await fetchPuntoServicioEstado(numeroContador);
                if (psEstado) {
                    console.log(`[get_contract_details] Punto servicio enrichment: ${parsed.data.estado} -> ${psEstado}`);
                    parsed.data.estado = psEstado;
                }
            } catch (e) {
                console.log(`[get_contract_details] Punto servicio enrichment failed, using default status`);
            }
        } else {
            console.log(`[get_contract_details] Enrichment skipped: numeroContador=${numeroContador}`);
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

        return {
            success: true,
            formatted_response: formattedResponse,
            data: parsed.data
        };
    } catch (error) {
        console.error(`[get_contract_details] Error:`, error);
        return {
            success: false,
            error: `No se pudo consultar el contrato: ${error instanceof Error ? error.message : 'Error desconocido'}`,
            formatted_response: "El sistema de consulta no está disponible en este momento. ¿Puedes intentar en unos minutos?"
        };
    }
}
