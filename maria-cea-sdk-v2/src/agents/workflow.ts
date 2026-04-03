// ============================================
// Main Workflow - Classification → Routing → Execution
// ============================================

import { Agent, AgentInputItem, Runner, withTrace } from "@openai/agents";
import { cfg } from "../config/index.js";
import type { Classification, WorkflowInput, WorkflowOutput } from "../config/types.js";
import { conversationStore } from "../services/conversation-store.js";
import { runWithChatwootContext, type ChatwootContext } from "../services/context.js";
import { buildSystemContext } from "../utils/date.js";
import { childLogger } from "../utils/logger.js";
import { classificationAgent, agentMap, allAgentNames } from "./definitions.js";
import { createTicketDirect } from "../tools/tickets.js";

const log = childLogger("workflow");

async function runAgentWithHistory(
    runner: Runner,
    agent: Agent<unknown>,
    history: AgentInputItem[]
): Promise<{ output: string; newItems: AgentInputItem[]; toolsUsed: string[] }> {
    const result = await runner.run(agent, history);
    const toolsUsed: string[] = [];

    for (const item of result.newItems) {
        const raw = (item as Record<string, unknown>).rawItem || item;
        if ((raw as Record<string, unknown>).type === "hosted_tool_call" && (raw as Record<string, string>).name) {
            toolsUsed.push((raw as Record<string, string>).name);
        }
    }

    let output = result.finalOutput;

    if (!output) {
        for (let i = result.newItems.length - 1; i >= 0; i--) {
            const raw = (result.newItems[i] as Record<string, unknown>).rawItem || result.newItems[i];
            const r = raw as Record<string, unknown>;
            if (r.role === "assistant" && r.content) {
                if (typeof r.content === "string") {
                    output = r.content;
                    break;
                } else if (Array.isArray(r.content)) {
                    output = (r.content as Record<string, string>[]).map((c) => c.text || c.output_text || "").filter(Boolean).join("");
                    if (output) break;
                }
            }
        }
    }

    const newItems = result.newItems.map((item: unknown) => (item as Record<string, unknown>).rawItem || item) as AgentInputItem[];
    return { output: output || "", newItems, toolsUsed };
}

export async function runWorkflow(input: WorkflowInput): Promise<WorkflowOutput> {
    const startTime = Date.now();
    const conversationId = input.conversationId || crypto.randomUUID();
    const requestId = input.requestId || crypto.randomUUID().slice(0, 8);

    const chatwootConversationId = input.conversationId ? parseInt(input.conversationId, 10) : undefined;
    const chatwootContext: ChatwootContext = {
        conversationId: Number.isInteger(chatwootConversationId) ? chatwootConversationId : undefined,
        contactId: input.contactId,
    };

    return runWithChatwootContext(chatwootContext, async () => {
        return withTrace("María-CEA-v2", async () => {
            log.info({ requestId, conversationId, inputLength: input.input_as_text.length }, "Workflow start");

            const conversation = conversationStore.get(conversationId);

            if (chatwootContext.conversationId) conversation.chatwootConversationId = chatwootContext.conversationId;
            if (chatwootContext.contactId) conversation.chatwootContactId = chatwootContext.contactId;

            const contextualInput = `${buildSystemContext()}\n${input.input_as_text}`;
            const userMessage: AgentInputItem = {
                role: "user",
                content: [{ type: "input_text", text: contextualInput }],
            };
            const workingHistory: AgentInputItem[] = [...conversation.history, userMessage];
            const toolsUsed: string[] = [];

            const runner = new Runner({
                traceMetadata: { __trace_source__: "cea-agent-v2", conversation_id: conversationId },
            });

            try {
                // Step 1: Classification
                const classificationResult = await runner.run(classificationAgent, workingHistory);
                if (!classificationResult.finalOutput) throw new Error("Classification failed - no output");

                const classification = classificationResult.finalOutput.classification as Classification;
                const extractedContract = classificationResult.finalOutput.extractedContract;

                log.info({ requestId, classification, extractedContract }, "Classified");

                if (extractedContract) conversation.contractNumber = extractedContract;
                conversation.classification = classification;

                let output: string;
                let newItems: AgentInputItem[] = [];

                // Step 2: Handle hablar_asesor specially
                if (classification === "hablar_asesor") {
                    const ticketResult = await createTicketDirect({
                        service_type: "urgente",
                        titulo: "Solicitud de contacto con asesor humano",
                        descripcion: `El usuario solicitó hablar con un asesor humano. Mensaje: ${input.input_as_text}`,
                        contract_number: conversation.contractNumber || null,
                        priority: "urgente",
                    });
                    const folio = ticketResult.folio || "PENDING";
                    output = `He creado tu solicitud con el folio ${folio}. Te conectaré con un asesor humano. Por favor espera un momento 💧`;
                    toolsUsed.push("create_ticket");
                } else {
                    // Step 3: Route to specialist
                    const selectedAgent = agentMap[classification];
                    log.info({ requestId, agent: selectedAgent.name }, "Routing");

                    const agentResult = await runAgentWithHistory(runner, selectedAgent, workingHistory);
                    output = agentResult.output;
                    newItems = agentResult.newItems;
                    toolsUsed.push(...agentResult.toolsUsed);
                }

                // Step 4: Update conversation history
                conversation.history.push(userMessage);
                if (newItems.length > 0) {
                    conversation.history.push(...newItems);
                } else if (output) {
                    conversation.history.push({
                        role: "assistant",
                        content: [{ type: "output_text", text: output }],
                    } as AgentInputItem);
                }

                // Trim history to configured limit
                if (conversation.history.length > cfg.MAX_HISTORY_MESSAGES) {
                    conversation.history = conversation.history.slice(-cfg.MAX_HISTORY_MESSAGES);
                }

                const processingTime = Date.now() - startTime;
                log.info({ requestId, classification, processingTime, toolsUsed }, "Workflow complete");

                return { output_text: output, classification, toolsUsed };
            } catch (error) {
                const processingTime = Date.now() - startTime;
                log.error({ requestId, err: error, processingTime }, "Workflow error");

                return {
                    output_text: "Lo siento, tuve un problema procesando tu mensaje. ¿Podrías intentar de nuevo? 💧",
                    error: error instanceof Error ? error.message : "Unknown error",
                    toolsUsed,
                };
            }
        });
    });
}

export function getAgentHealth() {
    return {
        status: "healthy",
        agents: allAgentNames,
        conversationCount: conversationStore.size(),
    };
}
