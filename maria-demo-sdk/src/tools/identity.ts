// ============================================
// Identity Tools - Contract holder validation, customer search
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getContrato, getCliente, ContratoNoEncontradoError } from "../services/supra-client.js";
import type { RequestContext } from "../types.js";

const normalizeForMatch = (s: string): string =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function flexibleNameMatch(userInput: string, titular: string): { matched: boolean; matchedToken?: string } {
    const MIN_TOKEN_LEN = 3;
    const titularTokens = new Set(
        normalizeForMatch(titular).split(/\s+/).filter(t => t.length >= MIN_TOKEN_LEN)
    );
    const userTokens = normalizeForMatch(userInput).split(/\s+/).filter(t => t.length >= MIN_TOKEN_LEN);
    const hit = userTokens.find(t => titularTokens.has(t));
    return hit ? { matched: true, matchedToken: hit } : { matched: false };
}

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
        async ({ contrato, nombre_proporcionado }) => {
            console.log(`[validate_contract_holder] Context: conv=${ctx.conversationId}`);
            console.log(`[validate_contract_holder] Validating "${nombre_proporcionado}" against contract ${contrato}`);

            try {
                const contract = await getContrato(contrato);
                const titular = contract.nombreTitular ?? "";

                const match = flexibleNameMatch(nombre_proporcionado, titular);
                if (match.matched) {
                    ctx.verifiedContracts.add(contrato);
                    console.log(`[validate_contract_holder] Contract ${contrato} verified (matched "${match.matchedToken}")`);
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        validated: true,
                        method: "token_overlap",
                        matched_token: match.matchedToken,
                    }) }] };
                }

                console.log(`[validate_contract_holder] No token overlap between "${nombre_proporcionado}" and titular "${titular}"`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    validated: false,
                    message: "El nombre no coincide con el titular del contrato. ¿Puedes verificar e intentarlo de nuevo?"
                }) }] };

            } catch (error) {
                console.error(`[validate_contract_holder] Error:`, error);

                if (error instanceof ContratoNoEncontradoError) {
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        validated: false,
                        not_found: true,
                        message: "No encontré tu contrato, ¿puedes revisar el número?"
                    }) }] };
                }

                // API down (network, 5xx) — fail-open so a single outage doesn't block users
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
            const cliente = await getCliente(contract_number);

            const result = {
                success: true,
                found: true,
                customer: {
                    id: cliente.id,
                    nombre: cliente.nombre,
                    contrato: cliente.contrato,
                    email: cliente.email || null,
                    whatsapp: cliente.whatsapp || cliente.telefono || null,
                    recibo_digital: cliente.reciboDigital,
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
                        found: false,
                        message: "Cliente no encontrado"
                    })
                }]
            };
        }
    }
);
