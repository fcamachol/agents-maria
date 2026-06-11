// ============================================
// Maria Ultimate - Main Agent with Skill Loader + Guards
// ============================================

import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
    loader,
    getSkill,
    getSkillDescriptions,
    buildSystemPrompt,
    reloadSkills,
    buildSystemContext
} from "./skills/index.js";
import { staticTools, createContextTools, getVerifiedContracts } from "./tools.js";
import { GuardSystem } from "./guards.js";
import type { CategoryCode, WorkflowInput, WorkflowOutput, RequestContext } from "./types.js";

// ============================================
// Guard System (singleton)
// ============================================

const guardSystem = new GuardSystem();

// ============================================
// Conversation Store
// ============================================

interface ConversationEntry {
    history: Array<{ role: "user" | "assistant"; content: string }>;
    lastAccess: Date;
    contractNumber?: string;
    category?: CategoryCode;
    verifiedContracts: Set<string>;
    pendingLectura?: boolean;
}

const conversationStore = new Map<string, ConversationEntry>();

// Cleanup old conversations (1 hour expiry)
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of conversationStore.entries()) {
        if (now - entry.lastAccess.getTime() > 3600000) {
            conversationStore.delete(id);
        }
    }
}, 300000);

function getConversation(id: string): ConversationEntry {
    const existing = conversationStore.get(id);
    if (existing) {
        existing.lastAccess = new Date();
        return existing;
    }

    const newEntry: ConversationEntry = {
        history: [],
        lastAccess: new Date(),
        verifiedContracts: new Set()
    };
    conversationStore.set(id, newEntry);
    return newEntry;
}

// ============================================
// Classification (keyword-based + sticky routing)
// ============================================

function classifyMessage(inputText: string, previousCategory?: CategoryCode): {
    category: CategoryCode;
    keywordMatched: boolean;
    extractedContract?: string;
} {
    const inputLower = inputText.toLowerCase();
    let category: CategoryCode = "CON";
    let keywordMatched = false;

    // Check each skill's trigger keywords from loaded skills
    const allSkills = loader.getAllSkills();

    // Priority-based keyword matching using skill triggers
    // REP first (emergency priority)
    const repSkill = allSkills.get("REP");
    if (repSkill?.triggers.keywords.some(kw => inputLower.includes(kw))) {
        category = "REP";
        keywordMatched = true;
    }
    // CON location-related
    else if (inputLower.includes("oficina") || inputLower.includes("cajero") ||
             inputLower.includes("sucursal") || inputLower.includes("donde pago") ||
             inputLower.includes("dónde pago") || inputLower.includes("ubicación") ||
             inputLower.includes("cerca de mí") || inputLower.includes("horario")) {
        category = "CON";
        keywordMatched = true;
    }
    // FAC
    else if (inputLower.includes("saldo a favor") || inputLower.includes("crédito a favor") ||
             inputLower.includes("credito a favor") ||
             inputLower.includes("recibo") || inputLower.includes("factura") ||
             inputLower.includes("aclaración") || inputLower.includes("ajuste") ||
             inputLower.includes("cobro") || inputLower.includes("pagar") ||
             inputLower.includes("pago")) {
        category = "FAC";
        keywordMatched = true;
    }
    // CTR
    else if (inputLower.includes("contrato nuevo") || inputLower.includes("nuevo contrato") ||
             inputLower.includes("nuevo servicio") || inputLower.includes("contratación") ||
             inputLower.includes("contratacion") || inputLower.includes("quiero contratar") ||
             inputLower.includes("toma nueva") || inputLower.includes("nueva toma") ||
             inputLower.includes("cambio de titular") || inputLower.includes("cambio de nombre") ||
             inputLower.includes("dar de baja") || inputLower.includes("dar de alta") ||
             inputLower.includes("baja de contrato") || inputLower.includes("alta de contrato")) {
        category = "CTR";
        keywordMatched = true;
    }
    // CVN
    else if (inputLower.includes("convenio") || inputLower.includes("plan de pago") ||
             inputLower.includes("pensionado") || inputLower.includes("tercera edad") ||
             inputLower.includes("no puedo pagar")) {
        category = "CVN";
        keywordMatched = true;
    }
    // SRV
    else if (inputLower.includes("medidor") || inputLower.includes("lectura") ||
             inputLower.includes("reconexión") || inputLower.includes("instalación")) {
        category = "SRV";
        keywordMatched = true;
    }
    // CNS
    else if (inputLower.includes("consumo") || inputLower.includes("historial de consumo") ||
             inputLower.includes("cuánta agua") || inputLower.includes("cuanta agua") ||
             inputLower.includes("metros cúbicos") || inputLower.includes("metros cubicos") ||
             inputLower.includes("cuanto gasto") || inputLower.includes("cuánto gasté")) {
        category = "CNS";
        keywordMatched = true;
    }
    // CON saldo keywords (lower priority than FAC)
    else if (inputLower.includes("saldo") || inputLower.includes("cuánto debo") ||
             inputLower.includes("deuda") || inputLower.includes("adeudo")) {
        category = "CON";
        keywordMatched = true;
    }

    // Sticky routing: keep previous category if no keyword matched
    if (!keywordMatched && previousCategory) {
        category = previousCategory;
    }

    // Extract contract number (strip image analysis sections first)
    const textForContractSearch = inputText
        .replace(/\[Imagen enviada por el usuario\]:[\s\S]*/g, '')
        .replace(/\[ANÁLISIS DE [^\]]+\]:[\s\S]*?(?=\n\n|\[|$)/g, '');
    const contractMatch = textForContractSearch.match(/\b(\d{6,10})\b/);

    return {
        category,
        keywordMatched,
        extractedContract: contractMatch?.[1]
    };
}

// ============================================
// Main Workflow
// ============================================

export async function runWorkflow(input: WorkflowInput): Promise<WorkflowOutput> {
    const startTime = Date.now();
    const conversationId = input.conversationId || crypto.randomUUID();

    console.log(`\n========== WORKFLOW START ==========`);
    console.log(`ConversationId: ${conversationId}`);
    console.log(`Input: "${input.input_as_text}"`);

    const conversation = getConversation(conversationId);

    // Build per-request context
    const reqCtx: RequestContext = {
        conversationId,
        chatwootConversationId: input.chatwootConversationId || 0,
        chatwootAccountId: input.chatwootAccountId || 0,
        onLecturaTicketCreated: () => { conversation.pendingLectura = false; },
    };

    const allTools = [...staticTools, ...createContextTools(reqCtx)];

    try {
        // Step 1: Classification
        const { category, extractedContract } = classifyMessage(
            input.input_as_text,
            conversation.category
        );

        if (extractedContract) {
            conversation.contractNumber = extractedContract;
        }

        // Flag "reportar lectura" context
        if (category === "SRV" && input.input_as_text.toLowerCase().includes("lectura")) {
            conversation.pendingLectura = true;
        }

        console.log(`[Workflow] Classification: ${category}`);
        if (extractedContract) {
            console.log(`[Workflow] Extracted contract: ${extractedContract}`);
        }

        // Step 2: Get the appropriate skill prompt
        const skill = getSkill(category);
        if (!skill) {
            throw new Error(`Skill not found for category: ${category}`);
        }
        console.log(`[Workflow] Using skill: ${skill.name} v${skill.version}`);

        const skillPrompt = buildSystemPrompt(category);
        if (!skillPrompt) {
            throw new Error(`Could not build system prompt for category: ${category}`);
        }

        // Step 3: Build conversation history
        const historyText = conversation.history
            .slice(-10)
            .map(msg => `${msg.role === 'user' ? 'Usuario' : 'María'}: ${msg.content}`)
            .join('\n');

        // Step 3.5: Build user context from metadata
        let userContext = '';
        if (input.metadata?.name) userContext += `Nombre de perfil WhatsApp (NO es el titular del contrato, NO usar para verificacion): ${input.metadata.name}\n`;
        if (input.metadata?.phone) userContext += `Teléfono: ${input.metadata.phone}\n`;
        if (input.metadata?.email) userContext += `Email: ${input.metadata.email}\n`;

        // Extract contract from custom_attributes if available
        const customContrato = input.metadata?.custom_attributes?.contrato;
        if (customContrato) {
            conversation.contractNumber = String(customContrato);
        }
        if (conversation.contractNumber) userContext += `Número de contrato: ${conversation.contractNumber}\n`;

        // Step 4: Assemble full prompt
        const verifiedList = [...conversation.verifiedContracts];
        const verifiedContext = verifiedList.length > 0
            ? `\nContratos ya verificados en esta conversacion: ${verifiedList.join(", ")}`
            : "";

        const fullPrompt = `${skillPrompt}

CONTEXTO ACTUAL:
${buildSystemContext()}${verifiedContext}
${userContext ? `\nINFORMACIÓN DEL USUARIO:\n${userContext}` : ''}

${historyText ? `HISTORIAL DE CONVERSACIÓN:\n${historyText}\n` : ''}

MENSAJE DEL USUARIO:
${input.input_as_text}`;

        const outputMessages: string[] = [];
        const toolsUsed: string[] = [];

        // Create MCP server with our tools
        const mcpServerConfig = createSdkMcpServer({
            name: "maria-cea-tools",
            version: "2.0.0",
            tools: allTools
        });

        // Run query with Claude Agent SDK
        console.log(`[Workflow] Starting Claude query...`);
        const result = query({
            prompt: fullPrompt,
            options: {
                model: "claude-sonnet-4-5-20250929",
                maxBudgetUsd: 0.50,
                permissionMode: "bypassPermissions",
                allowDangerouslySkipPermissions: true,
                mcpServers: {
                    "maria-cea-tools": mcpServerConfig
                },
                persistSession: false,
                tools: [],
                cwd: process.cwd(),
                stderr: (data: string) => {
                    console.error(`[Claude Code STDERR]: ${data}`);
                },
                env: process.env
            }
        });

        // Collect each assistant turn
        for await (const message of result) {
            if (message.type === "assistant") {
                let turnText = "";
                let hasToolUse = false;
                const content = message.message.content;
                if (Array.isArray(content)) {
                    for (const block of content) {
                        if (block.type === "text") {
                            turnText += block.text;
                        } else if (block.type === "tool_use") {
                            const bareName = block.name.replace(/^mcp__[^_]+__/, "");
                            toolsUsed.push(bareName);
                            hasToolUse = true;
                        }
                    }
                } else if (typeof content === "string") {
                    turnText += content;
                }
                if (turnText.trim() && !hasToolUse) {
                    outputMessages.push(turnText.trim());
                }
            } else if (message.type === "result") {
                console.log(`[Workflow] Completed. Cost: $${message.total_cost_usd}`);
            }
        }

        let output = outputMessages.join("\n\n");

        console.log(`[Workflow] Tools called: [${toolsUsed.join(", ")}]`);

        // Step 5: Run guards on output
        const guardResult = guardSystem.runAll(output, toolsUsed);
        if (!guardResult.passed) {
            console.warn(`[Workflow] GUARD BLOCKED (${guardResult.guardName}): ${guardResult.severity}. Tools: [${toolsUsed.join(", ")}]. Output: "${output.substring(0, 200)}"`);
            if (guardResult.message) {
                output = guardResult.message;
                outputMessages.length = 0;
                outputMessages.push(output);
            }
        }

        // Sync verified contracts from tools.ts tracking map
        const newlyVerified = getVerifiedContracts(conversationId);
        for (const contract of newlyVerified) {
            conversation.verifiedContracts.add(contract);
        }

        // Step 6: Update conversation history
        conversation.history.push({ role: "user", content: input.input_as_text });
        conversation.history.push({ role: "assistant", content: output });
        conversation.category = category;

        // Limit history length
        if (conversation.history.length > 20) {
            conversation.history = conversation.history.slice(-20);
        }

        const processingTime = Date.now() - startTime;
        console.log(`[Workflow] Complete in ${processingTime}ms`);
        console.log(`[Workflow] Output: "${output.substring(0, 100)}..."`);
        console.log(`========== WORKFLOW END ==========\n`);

        return {
            output_text: output,
            output_messages: outputMessages,
            category,
            toolsUsed
        };

    } catch (error) {
        console.error(`[Workflow] Error:`, error);

        const errorMsg = "Lo siento, tuve un problema procesando tu mensaje. ¿Podrías intentar de nuevo?";
        return {
            output_text: errorMsg,
            output_messages: [errorMsg],
            error: error instanceof Error ? error.message : "Unknown error",
            toolsUsed: []
        };
    }
}

// ============================================
// Pending Lectura Flag
// ============================================

export function isPendingLectura(conversationId: string): boolean {
    return conversationStore.get(conversationId)?.pendingLectura === true;
}

export function clearPendingLectura(conversationId: string): void {
    const entry = conversationStore.get(conversationId);
    if (entry) {
        entry.pendingLectura = false;
    }
}

// ============================================
// Health Check
// ============================================

export function getAgentHealth(): { status: string; skills: string[]; conversationCount: number } {
    const allSkills = loader.getAllSkills();
    return {
        status: "healthy",
        skills: Array.from(allSkills.values()).map(s => `${s.code}: ${s.name} v${s.version}`),
        conversationCount: conversationStore.size
    };
}

// ============================================
// Skill Reload (for hot-reload endpoint)
// ============================================

export { reloadSkills };
