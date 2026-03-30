// ============================================
// Tools Index - MCP Server Factory
// ============================================

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getDeudaTool, getConsumoTool, getContratoTool, getReciboPdfTool } from "./supra-api.js";
import { createCreateTicketTool, createGetClientTicketsTool, updateTicketTool, lookupTicketByFolioTool } from "./tickets.js";
import { createValidateContractHolderTool, searchCustomerByContractTool } from "./identity.js";
import { getMainOfficeTool, findNearestLocationsTool, searchLocationTool, reverseGeocodeTool } from "./location.js";
import { extractCEAReceiptTool } from "./vision.js";
import { updateConversationStatus } from "../chatwoot.js";
import type { RequestContext } from "../types.js";

// ============================================
// HANDOFF TO HUMAN (context tool)
// ============================================

export function createHandoffTool(ctx: RequestContext) {
    return tool(
        "handoff_to_human",
        `Transfiere la conversación a un agente humano de Hydropolis.

USA ESTA HERRAMIENTA CUANDO:
- El usuario pida hablar con una persona/humano/agente
- El usuario diga "quiero hablar con alguien"
- El usuario esté frustrado y pida atención personal
- No puedas resolver el problema del usuario`,
        {
            reason: z.string().describe("Motivo de la transferencia (breve)")
        },
        async ({ reason }) => {
            const conversationId = ctx.chatwootConversationId;
            const accountId = ctx.chatwootAccountId;

            console.log(`[handoff_to_human] Context: conv=${conversationId}, acct=${accountId}`);

            if (!conversationId || !accountId) {
                console.log(`[handoff_to_human] Missing context - conversation: ${conversationId}, account: ${accountId}`);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            formatted_response: "No puedo transferir la conversación en este momento. Por favor intenta más tarde o llama al 442-238-8200."
                        })
                    }]
                };
            }

            console.log(`[handoff_to_human] Transferring conversation ${conversationId} to human. Reason: ${reason}`);

            const result = await updateConversationStatus(accountId, conversationId, "open");

            if (result.success) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: true,
                            formatted_response: "Listo, ya le avisé al equipo, en cuanto alguien esté disponible sigue contigo. 😊"
                        })
                    }]
                };
            }

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        message: "No se pudo transferir la conversación",
                        formatted_response: "No pude transferir la conversación. Por favor llama al 442-238-8200 para atención inmediata."
                    })
                }]
            };
        }
    );
}

// ============================================
// MCP Server Factory
// ============================================

export function createToolServer(ctx: RequestContext) {
    const contextTools = [
        createCreateTicketTool(ctx),
        createGetClientTicketsTool(ctx),
        createValidateContractHolderTool(ctx),
        createHandoffTool(ctx),
    ];

    const staticTools = [
        getDeudaTool,
        getConsumoTool,
        getContratoTool,
        getReciboPdfTool,
        updateTicketTool,
        lookupTicketByFolioTool,
        searchCustomerByContractTool,
        getMainOfficeTool,
        findNearestLocationsTool,
        searchLocationTool,
        reverseGeocodeTool,
        extractCEAReceiptTool,
    ];

    return createSdkMcpServer({
        name: "maria-atlantis-tools",
        version: "1.0.0",
        tools: [...staticTools, ...contextTools]
    });
}

// Re-export everything for convenience
export { getDeudaTool, getConsumoTool, getContratoTool, getReciboPdfTool } from "./supra-api.js";
export { createCreateTicketTool, createGetClientTicketsTool, updateTicketTool, lookupTicketByFolioTool } from "./tickets.js";
export { createValidateContractHolderTool, searchCustomerByContractTool } from "./identity.js";
export { getMainOfficeTool, findNearestLocationsTool, searchLocationTool, reverseGeocodeTool } from "./location.js";
export { extractCEAReceiptTool } from "./vision.js";
