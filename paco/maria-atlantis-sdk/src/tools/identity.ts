// ============================================
// Identity Tools - Contract holder validation, customer search
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { validarContrato, getCliente } from "../services/supra-client.js";
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
        async ({ contrato, nombre_proporcionado }) => {
            console.log(`[validate_contract_holder] Context: conv=${ctx.conversationId}`);
            console.log(`[validate_contract_holder] Validating "${nombre_proporcionado}" against contract ${contrato}`);

            try {
                const result = await validarContrato(contrato, nombre_proporcionado);

                if (result.validated) {
                    // Mark contract as verified for this conversation
                    ctx.verifiedContracts.add(contrato);
                    console.log(`[validate_contract_holder] Contract ${contrato} verified for conversation ${ctx.conversationId}`);

                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        validated: true,
                        confidence: result.confidence,
                        method: result.method,
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
