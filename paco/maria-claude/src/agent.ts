// ============================================
// Maria Claude - Main Agent with Skill Routing
// ============================================

import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
    SKILL_REGISTRY,
    getSkill,
    buildSystemContext
} from "./skills/index.js";
import { allTools, getVerifiedContracts } from "./tools.js";
import type { CategoryCode, WorkflowInput, WorkflowOutput } from "./types.js";
import { logger } from "./utils/logger.js";
import { sanitizeInput, containsHarmfulPatterns, validateAndCorrect } from "./utils/validator.js";
import { metrics } from "./utils/metrics.js";
import { conversationRateLimiter } from "./utils/ratelimit.js";

// ============================================
// Conversation Store
// ============================================

interface ConversationEntry {
    history: Array<{ role: "user" | "assistant"; content: string }>;
    lastAccess: Date;
    contractNumber?: string;
    category?: CategoryCode;
    verifiedContracts: Set<string>;
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


// Classification is handled inline in runWorkflow() via keyword matching
// and can be upgraded to LLM-based via utils/classifier.ts

// ============================================
// Global Conversation Rules
// These apply to ALL skills
// ============================================

const GLOBAL_CONVERSATION_RULES = `
⚠️ REGLAS OBLIGATORIAS DE CONVERSACIÓN - DEBES SEGUIR ESTAS REGLAS SIEMPRE:

1. RESPUESTAS CORTAS (OBLIGATORIO):
   - Máximo 2-3 oraciones por mensaje
   - Estilo WhatsApp, no corporativo
   - NO uses emojis al final de los mensajes

2. UNA PREGUNTA POR MENSAJE (OBLIGATORIO):
   - PROHIBIDO: "¿Tu saldo, consumo o algo más?" (son 3 opciones)
   - PROHIBIDO: "¿Qué necesitas revisar específicamente?"
   - CORRECTO: Pregunta UNA cosa específica
   - Si no sabes qué necesita, pregunta: "¿Qué necesitas saber de tu contrato?"

3. NO USES HERRAMIENTAS PREMATURAMENTE:
   - Si el usuario dice "quiero revisar mi contrato", pregunta QUÉ necesita revisar
   - NO llames a get_contract_details inmediatamente
   - Primero entiende qué información específica necesita

4. NUNCA MENCIONES CÓDIGOS:
   - PROHIBIDO: FAC-004, CON-002, CTR-001, REP-FG-001, etc.
   - El usuario NO entiende estos códigos
   - Solo menciona el FOLIO después de crear el ticket

5. CUANDO UNA HERRAMIENTA FALLA:
   - Si no puedes obtener los datos, dilo claramente
   - Ejemplo: "No pude consultar los detalles en este momento. ¿Qué información específica necesitas?"
   - NO inventes datos ni digas solo "activo" sin más información

6. SALUDO:
   - SOLO saluda cuando el mensaje es un saludo simple SIN petición concreta (ej: "Hola", "Buenos días")
   - Si el usuario ya incluye una petición (ej: "Hola, quiero consultar mi saldo del contrato 363769"), NO saludes por separado. Ve directo a resolver su petición.
   - Formato de saludo (solo cuando aplica): "¡Hola {NOMBRE}! Soy María de la CEA, ¿en qué te puedo ayudar?"

7. MOSTRAR DATOS COMPLETOS:
   - Si consultas datos exitosamente, muéstralos TODOS de una vez
   - NO preguntes "¿qué quieres saber?" después de consultar
   - Ejemplo: "Tu contrato 523160: Titular Juan Pérez, Calle Principal 123, Tarifa doméstica, Estado activo"

8. RESPUESTAS CON DATOS (CRÍTICO):
   - Cuando un tool retorna "formatted_response", muéstralo directamente
   - NO agregues texto ANTES ("Claro...", "Aquí está...", "Listo...", "Déjame...", "Un momento...")
   - NO agregues texto DESPUÉS (excepto la pregunta de seguimiento de la regla 14)
   - El formatted_response ES tu respuesta, no lo envuelvas en más texto

9. TRANSFERENCIA A HUMANO:
   - Si el usuario dice "quiero hablar con una persona", "agente humano", "hablar con alguien", etc.
   - Usa la herramienta handoff_to_human con el motivo de la transferencia

=====================================
⚠️ REGLAS CRÍTICAS ADICIONALES
=====================================

10. USUARIOS NO PUEDEN CERRAR TICKETS:
    - Si el usuario pide cerrar un ticket, NO uses update_ticket para cerrarlo
    - Responde: "Para cerrar tu ticket necesito comunicarte con un asesor 👤"
    - Usa handoff_to_human en su lugar

11. PAGOS - NO PIDAS CONTRATO:
    - Si el usuario pregunta "quiero pagar" o "cómo puedo pagar"
    - NO pidas número de contrato
    - Solo muestra las opciones de pago directamente

12. EVIDENCIA FOTOGRÁFICA:
    - Para REPORTES (fugas, drenaje, calidad): SIEMPRE pide foto de evidencia
    - Para LECTURAS de medidor: SIEMPRE pide foto del medidor
    - Para REVISAR RECIBO: pide imagen o PDF del recibo
    - Si ya enviaron una foto, NO la pidas de nuevo

13. ACLARACIONES Y AJUSTES:
    - Para aclaraciones: pregunta si tiene contrato, pero si dice que NO, avanza sin él
    - El contrato es ÚTIL pero NO obligatorio para aclaraciones
    - Usa handoff_to_human para transferir a asesor
    - NO intentes resolver aclaraciones, siempre transfiere a asesor

14. SEGUIMIENTO NATURAL (OBLIGATORIO):
    - Después de mostrar información de saldo/deuda, pregunta: "¿Quieres hacer un pago o tienes dudas sobre tu saldo?"
    - Después de mostrar datos de contrato, pregunta: "¿Necesitas realizar algún trámite o tienes alguna duda?"
    - Después de crear un ticket, pregunta: "¿Hay algo más en que pueda ayudarte?"
    - Incluye la pregunta en el MISMO mensaje, separada por una línea en blanco

15. VERIFICACION DE IDENTIDAD POR NOMBRE (OBLIGATORIO):
    - ANTES de mostrar datos de un contrato (saldo, detalles, consumo, tickets), DEBES verificar la identidad
    - PREREQUISITO: Para verificar identidad necesitas el número de contrato. Si NO tienes el contrato (no aparece en "Número de contrato" ni en el historial), PRIMERO pregunta: "¿Me puedes dar tu número de contrato?" NO pidas nombre sin tener contrato.
    - Si el contrato ya fue verificado en esta conversacion (aparece en "Contratos ya verificados"), NO pidas nombre de nuevo
    - Si el contrato NO ha sido verificado:
      a) PREGUNTA al usuario: "Para proteger tus datos, ¿me puedes dar el nombre o apellido del titular del contrato?"
      b) ESPERA a que el usuario RESPONDA con el nombre en un nuevo mensaje. NO continues hasta recibir su respuesta.
      c) Cuando el usuario responda, usa validate_contract_holder con el contrato y el nombre que EL USUARIO ESCRIBIO EN SU MENSAJE (NO el nombre de perfil WhatsApp).
      d) Si validated=true: procede normalmente con la consulta
      e) Si validated=false: responde "El nombre no coincide con el titular del contrato. ¿Puedes verificar e intentarlo de nuevo?"
      f) Despues de 3 intentos fallidos, usa handoff_to_human
    - PROHIBIDO: NUNCA valides nombres por tu cuenta. SIEMPRE usa validate_contract_holder. Tu NO tienes acceso a los datos del titular — solo la herramienta puede verificar.
    - EXCEPCIONES (NO pidas verificacion):
      * Reportes de servicio (REP) en via publica
      * Preguntas generales sin contrato (horarios, requisitos, formas de pago)
      * Cuando el usuario pregunta "quiero pagar" (regla 11)

    🛑 PROHIBICION ABSOLUTA - NOMBRE DE PERFIL WHATSAPP:
    - El campo "Nombre de perfil WhatsApp" en INFORMACION DEL USUARIO es SOLO para saludo.
    - NUNCA lo uses como parametro nombre_proporcionado de validate_contract_holder.
    - SIEMPRE espera a que el usuario ESCRIBA el nombre en un mensaje.
`;

// ============================================
// Main Workflow
// ============================================

export async function runWorkflow(input: WorkflowInput): Promise<WorkflowOutput> {
    const startTime = Date.now();
    const conversationId = input.conversationId || crypto.randomUUID();

    logger.info({ conversationId }, "Workflow started");
    logger.info({ conversationId, input: input.input_as_text.slice(0, 100) }, "Processing input");

    // Set conversation ID for contract verification tracking
    process.env.CURRENT_CONVERSATION_ID = conversationId;

    // Set Chatwoot context for handoff tool
    if (input.chatwootAccountId) {
        process.env.CURRENT_CHATWOOT_ACCOUNT_ID = String(input.chatwootAccountId);
    }
    if (input.chatwootConversationId) {
        process.env.CURRENT_CHATWOOT_CONVERSATION_ID = String(input.chatwootConversationId);
    }

    const conversation = getConversation(conversationId);

    // Input validation
    const sanitizedInput = sanitizeInput(input.input_as_text);
    if (containsHarmfulPatterns(sanitizedInput)) {
        logger.warn({ conversationId, input: sanitizedInput.slice(0, 50) }, "Harmful pattern detected");
        return {
            output_text: "No puedo procesar ese tipo de mensaje. ¿En qué te puedo ayudar?",
            output_messages: ["No puedo procesar ese tipo de mensaje. ¿En qué te puedo ayudar?"],
            toolsUsed: []
        };
    }

    // Rate limiting
    const rateCheck = conversationRateLimiter.isAllowed(conversationId);
    if (!rateCheck.allowed) {
        logger.warn({ conversationId, remaining: rateCheck.remaining }, "Rate limit exceeded");
        return {
            output_text: "Estás enviando mensajes muy rápido. Por favor espera un momento.",
            output_messages: ["Estás enviando mensajes muy rápido. Por favor espera un momento."],
            toolsUsed: []
        };
    }

    try {
        // Step 1: Classification
        logger.info({ conversationId }, "Running classification");

        let category: CategoryCode = "CON"; // Default
        let keywordMatched = false;
        let extractedContract: string | undefined;

        // Simple classification based on keywords
        const inputLower = sanitizedInput.toLowerCase();

        if (inputLower.includes("fuga") || inputLower.includes("no hay agua") ||
            inputLower.includes("agua turbia") || inputLower.includes("drenaje") ||
            inputLower.includes("no tengo agua") || inputLower.includes("inundación")) {
            category = "REP";
            keywordMatched = true;
        } else if (inputLower.includes("oficina") || inputLower.includes("cajero") ||
                   inputLower.includes("sucursal") || inputLower.includes("donde pago") ||
                   inputLower.includes("dónde pago") || inputLower.includes("ubicación") ||
                   inputLower.includes("cerca de mí") || inputLower.includes("horario")) {
            category = "CON";
            keywordMatched = true;
        } else if (inputLower.includes("recibo") || inputLower.includes("factura") ||
                   inputLower.includes("aclaración") || inputLower.includes("ajuste") ||
                   inputLower.includes("cobro") || inputLower.includes("pagar") ||
                   inputLower.includes("pago")) {
            category = "FAC";
            keywordMatched = true;
        } else if (inputLower.includes("contrato nuevo") || inputLower.includes("nuevo contrato") ||
                   inputLower.includes("cambio de titular") || inputLower.includes("cambio de nombre") ||
                   inputLower.includes("dar de baja") || inputLower.includes("dar de alta") ||
                   inputLower.includes("baja de contrato") || inputLower.includes("alta de contrato")) {
            category = "CTR";
            keywordMatched = true;
        } else if (inputLower.includes("convenio") || inputLower.includes("plan de pago") ||
                   inputLower.includes("pensionado") || inputLower.includes("tercera edad") ||
                   inputLower.includes("no puedo pagar")) {
            category = "CVN";
            keywordMatched = true;
        } else if (inputLower.includes("medidor") || inputLower.includes("lectura") ||
                   inputLower.includes("reconexión") || inputLower.includes("instalación")) {
            category = "SRV";
            keywordMatched = true;
        } else if (inputLower.includes("consumo") || inputLower.includes("historial de consumo") ||
                   inputLower.includes("cuánta agua") || inputLower.includes("cuanta agua") ||
                   inputLower.includes("metros cúbicos") || inputLower.includes("metros cubicos") ||
                   inputLower.includes("cuanto gasto") || inputLower.includes("cuánto gasté")) {
            category = "CNS";
            keywordMatched = true;
        } else if (inputLower.includes("saldo") || inputLower.includes("cuánto debo") ||
                   inputLower.includes("deuda") || inputLower.includes("adeudo")) {
            category = "CON";
            keywordMatched = true;
        }

        // Sticky routing: if no keyword matched and the previous turn had
        // a specific skill, keep it — the user is likely following up
        if (!keywordMatched && conversation.category) {
            category = conversation.category;
        }

        // Extract contract number if present
        const contractMatch = input.input_as_text.match(/\b(\d{6,10})\b/);
        if (contractMatch) {
            extractedContract = contractMatch[1];
            conversation.contractNumber = extractedContract;
        }

        logger.info({ conversationId, category }, "Classification result");
        if (extractedContract) {
            logger.info({ conversationId, contract: extractedContract }, "Extracted contract");
        }

        // Step 2: Get the appropriate skill
        const skill = getSkill(category);
        logger.info({ conversationId, skill: skill.name }, "Using skill");

        // Step 3: Build conversation history
        const historyText = conversation.history
            .slice(-10) // Last 10 messages
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

        // Step 4: Run the agent with the skill
        // Build verified contracts context
        const verifiedList = [...conversation.verifiedContracts];
        const verifiedContext = verifiedList.length > 0
            ? `\nContratos ya verificados en esta conversacion: ${verifiedList.join(", ")}`
            : "";

        // IMPORTANT: Global rules go FIRST to have priority over skill-specific instructions
        const fullPrompt = `${GLOBAL_CONVERSATION_RULES}

${skill.systemPrompt}

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
            name: "maria-claude-tools",
            version: "1.0.0",
            tools: allTools
        });

        // Run query with Claude Agent SDK
        logger.info({ conversationId }, "Starting Claude query");
        const result = query({
            prompt: fullPrompt,
            options: {
                model: "claude-sonnet-4-5-20250929",
                maxBudgetUsd: 0.50,
                permissionMode: "bypassPermissions",
                allowDangerouslySkipPermissions: true,
                mcpServers: {
                    "maria-claude-tools": mcpServerConfig
                },
                // Server environment settings
                persistSession: false,
                tools: [],  // Disable built-in Claude Code tools, only use MCP tools
                cwd: process.cwd(),
                stderr: (data: string) => {
                    logger.error({ conversationId, stderr: data }, "Claude Code STDERR");
                },
                env: process.env
            }
        });

        // Collect each assistant turn as a separate message
        for await (const message of result) {
            if (message.type === "assistant") {
                let turnText = "";
                const content = message.message.content;
                if (Array.isArray(content)) {
                    for (const block of content) {
                        if (block.type === "text") {
                            turnText += block.text;
                        } else if (block.type === "tool_use") {
                            toolsUsed.push(block.name);
                        }
                    }
                } else if (typeof content === "string") {
                    turnText += content;
                }
                if (turnText.trim()) {
                    outputMessages.push(turnText.trim());
                }
            } else if (message.type === "result") {
                logger.info({ conversationId, costUsd: message.total_cost_usd }, "Query completed");
            }
        }

        const output = outputMessages.join("\n\n");

        // Response validation and auto-correction
        const validation = validateAndCorrect(output);
        const finalOutput = validation.wasCorrected ? validation.corrected : output;

        // Sync verified contracts from tools.ts tracking map into conversation entry
        const newlyVerified = getVerifiedContracts(conversationId);
        for (const contract of newlyVerified) {
            conversation.verifiedContracts.add(contract);
        }

        // Step 5: Update conversation history
        conversation.history.push({ role: "user", content: input.input_as_text });
        conversation.history.push({ role: "assistant", content: finalOutput });
        conversation.category = category;

        // Limit history length
        if (conversation.history.length > 20) {
            conversation.history = conversation.history.slice(-20);
        }

        const processingTime = Date.now() - startTime;
        metrics.recordMessage(conversationId, {
            toolsUsed,
            classification: category,
            responseTimeMs: processingTime
        });

        logger.info({ conversationId, processingTime, outputLength: finalOutput.length }, "Workflow complete");

        return {
            output_text: finalOutput,
            output_messages: outputMessages,
            category,
            toolsUsed
        };

    } catch (error) {
        logger.error({ conversationId, error }, "Workflow error");
        metrics.recordMessage(conversationId, {
            error: error instanceof Error ? error.message : "Unknown error",
            responseTimeMs: Date.now() - startTime
        });

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
// Health Check
// ============================================

export function getAgentHealth() {
    const healthStatus = metrics.getHealthStatus();
    return {
        status: healthStatus.status,
        checks: healthStatus.checks,
        skills: Object.values(SKILL_REGISTRY).map(s => `${s.code}: ${s.name}`),
        conversationCount: conversationStore.size,
        metrics: metrics.getSystemMetrics()
    };
}
