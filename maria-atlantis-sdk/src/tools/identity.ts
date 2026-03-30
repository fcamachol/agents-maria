// ============================================
// Identity Tools - Contract holder validation, customer search
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { matchName } from "../services/name-matching.js";
import {
    fetchWithRetry,
    buildContratoSOAP,
    parseContratoResponse,
    parseXMLValue,
    fetchPuntoServicioEstado,
    pgQuery,
    CEA_API_BASE,
} from "../services/soap-client.js";
import { resolveContract } from "../services/contract-resolver.js";
import type { RequestContext } from "../types.js";

// ============================================
// VALIDATE CONTRACT HOLDER (context tool)
// ============================================

export function createValidateContractHolderTool(ctx: RequestContext) {
    return tool(
        "validate_contract_holder",
        `Valida la identidad del usuario comparando el nombre proporcionado con el titular del contrato.

USA ESTA HERRAMIENTA ANTES de mostrar datos sensibles (saldo, detalles, consumo, tickets) de un contrato.

PARÁMETROS:
- contrato: Número de contrato Hydropolis
- nombre_proporcionado: Nombre o apellido que el usuario proporcionó

RETORNA:
- validated: true si el nombre coincide con el titular
- validated: false si no coincide
- skipped: true si no se pudo verificar (sin datos de titular o error de API)`,
        {
            contrato: z.string().describe("Número de contrato Hydropolis"),
            nombre_proporcionado: z.string().describe("Nombre o apellido proporcionado por el usuario")
        },
        async ({ contrato: rawContrato, nombre_proporcionado }) => {
            const contrato = await resolveContract(rawContrato);
            console.log(`[validate_contract_holder] Context: conv=${ctx.conversationId}`);
            console.log(`[validate_contract_holder] Validating "${nombre_proporcionado}" against contract ${contrato}`);

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
                    console.log(`[validate_contract_holder] API error or no data, skipping verification`);
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        validated: true,
                        skipped: true,
                        reason: "No se pudo obtener datos del contrato"
                    }) }] };
                }

                // ENRICHMENT: Get real service status from punto de servicio
                const numeroContador = parseXMLValue(xml, "numeroContador");
                console.log(`[validate_contract_holder] numeroContador from XML: ${numeroContador}`);
                if (numeroContador && parsed.data) {
                    try {
                        const psEstado = await fetchPuntoServicioEstado(numeroContador);
                        if (psEstado) {
                            console.log(`[validate_contract_holder] Punto servicio enrichment: ${parsed.data.estado} -> ${psEstado}`);
                            parsed.data.estado = psEstado;
                        }
                    } catch (e) {
                        console.log(`[validate_contract_holder] Punto servicio enrichment failed, using default status`);
                    }
                } else {
                    console.log(`[validate_contract_holder] Enrichment skipped: numeroContador=${numeroContador}`);
                }

                const titular = parsed.data.titular;

                if (!titular || titular.trim() === "") {
                    console.log(`[validate_contract_holder] No titular data, skipping verification`);
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        validated: true,
                        skipped: true,
                        reason: "El contrato no tiene datos de titular"
                    }) }] };
                }

                const nameResult = matchName(nombre_proporcionado, titular);
                console.log(`[validate_contract_holder] Match result: ${JSON.stringify(nameResult)}`);

                if (nameResult.match) {
                    // Mark contract as verified for this conversation
                    ctx.verifiedContracts.add(contrato);
                    console.log(`[validate_contract_holder] Contract ${contrato} verified for conversation ${ctx.conversationId}`);

                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        validated: true,
                        confidence: nameResult.confidence,
                        method: nameResult.method,
                        estado: parsed.data.estado
                    }) }] };
                }

                return { content: [{ type: "text" as const, text: JSON.stringify({
                    validated: false,
                    message: "El nombre no coincide con el titular del contrato. ¿Puedes verificar e intentarlo de nuevo?"
                }) }] };

            } catch (error) {
                console.error(`[validate_contract_holder] Error:`, error);
                // Fail-open: don't block the user if the API is down
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    validated: true,
                    skipped: true,
                    reason: "Error al verificar, se omite validación"
                }) }] };
            }
        }
    );
}

// ============================================
// SEARCH CUSTOMER BY CONTRACT
// ============================================

export const searchCustomerByContractTool = tool(
    "search_customer_by_contract",
    "Busca un cliente por su número de contrato en la base de datos Hydropolis (AGORA contacts).",
    {
        contract_number: z.string().describe("Número de contrato Hydropolis")
    },
    async ({ contract_number }) => {
        console.log(`[search_customer] Searching for contract: ${contract_number}`);

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

            const contact = contacts[0];
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

            return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
            console.error(`[search_customer] Error:`, error);
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
