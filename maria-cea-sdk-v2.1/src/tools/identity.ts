// ============================================
// Identity Tools - Contract holder validation, customer search
//
// Thin SDK `tool()` wrappers over `../core/identity.ts`. The validate wrapper
// owns the per-conversation verified-state mutation; the core stays stateless.
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { toToolResult } from "../core/types.js";
import { validateContractHolderCore, searchCustomerByContractCore } from "../core/identity.js";
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
- contrato: Número de contrato CEA
- nombre_proporcionado: Nombre o apellido que el usuario proporcionó

RETORNA:
- validated: true si el nombre coincide con el titular
- validated: false si no coincide
- contract_not_found: true si el contrato NO existe (validated será false)
- skipped: true si no se pudo verificar por falla de API (validated será true, fail-open)`,
        {
            contrato: z.string().describe("Número de contrato CEA"),
            nombre_proporcionado: z.string().describe("Nombre o apellido proporcionado por el usuario")
        },
        async ({ contrato: rawContrato, nombre_proporcionado }) => {
            console.log(`[validate_contract_holder] Context: conv=${ctx.conversationId}`);
            const { result, verified, contrato } = await validateContractHolderCore(rawContrato, nombre_proporcionado);

            if (verified) {
                // Mark contract as verified for this conversation
                ctx.verifiedContracts.add(contrato);
                console.log(`[validate_contract_holder] Contract ${contrato} verified for conversation ${ctx.conversationId}`);
            }

            return toToolResult(result);
        }
    );
}

// ============================================
// SEARCH CUSTOMER BY CONTRACT
// ============================================

export const searchCustomerByContractTool = tool(
    "search_customer_by_contract",
    "Busca un cliente por su número de contrato en la base de datos CEA (AGORA contacts).",
    {
        contract_number: z.string().describe("Número de contrato CEA")
    },
    async ({ contract_number }) => toToolResult(await searchCustomerByContractCore(contract_number))
);
