// ============================================
// Maria Claude - Main Agent with Skill Routing
// ============================================

import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
    SKILL_REGISTRY,
    getSkill,
    getSkillDescriptions,
    buildSystemContext
} from "./skills/index.js";
import { staticTools, createContextTools, getVerifiedContracts, translateContract } from "./tools.js";
import type { CategoryCode, WorkflowInput, WorkflowOutput, RequestContext } from "./types.js";

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
// Classification Prompt
// ============================================

const CLASSIFICATION_PROMPT = `Eres el clasificador de intenciones para CEA Querétaro. Tu trabajo es categorizar cada mensaje del usuario en una de las siguientes categorías AGORA:

${getSkillDescriptions()}

REGLAS DE CLASIFICACIÓN:

1. CON (Consultas):
   - "Hola", saludos simples
   - "¿Cuánto debo?" → CON (consulta de saldo)
   - "¿Cuál es el horario?" → CON
   - "¿Cuál es el estado de mi ticket?" → CON

2. FAC (Facturación):
   - "Quiero mi recibo por correo" → FAC
   - "No entiendo mi recibo" → FAC
   - "Quiero aclarar un cobro" → FAC
   - "Necesito carta de no adeudo" → FAC
   - "Tengo saldo a favor" → FAC
   - "Crédito a favor" → FAC

3. CTR (Contratos):
   - "Quiero un contrato nuevo" → CTR
   - "Cambio de nombre/titular" → CTR
   - "Quiero dar de baja" → CTR
   - "Cambio de tarifa" → CTR

4. CVN (Convenios):
   - "Quiero un plan de pago" → CVN
   - "No puedo pagar todo" → CVN
   - "Soy pensionado" → CVN
   - "Programa de tercera edad" → CVN

5. REP (Reportes de Servicio):
   - "Hay una fuga" → REP
   - "No tengo agua" → REP
   - "El agua sale turbia" → REP
   - "El drenaje está tapado" → REP
   - Cualquier emergencia → REP

6. SRV (Servicios Técnicos):
   - "Mi medidor está mal" → SRV
   - "Quiero reportar mi lectura" → SRV
   - "Me robaron el medidor" → SRV
   - "Necesito reconexión" → SRV

Si detectas un número de contrato (6+ dígitos), menciónalo.

Responde SOLO con el código de categoría (CON, FAC, CTR, CVN, REP, SRV) y si encontraste un contrato.`;

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
    - Para REVISAR RECIBO: pide foto del recibo (NO PDF, no puedes abrirlos)
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

16. DOCUMENTOS Y ARCHIVOS (PDF, DOC, XLS, etc.):
    - NO puedes abrir, leer ni procesar documentos adjuntos
    - Si el usuario envía un documento, responde: "Por el momento no puedo abrir documentos, ¿me puedes mandar una foto?"
    - Si el usuario dice que no puede o no quiere enviar foto, usa handoff_to_human con motivo "El usuario envió un documento que no puedo procesar y no puede enviar foto"
`;

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
    const contextualInput = `${buildSystemContext()}\n${input.input_as_text}`;

    // Build per-request context — closures guarantee correct values even under concurrency
    const reqCtx: RequestContext = {
        conversationId,
        chatwootConversationId: input.chatwootConversationId || 0,
        chatwootAccountId: input.chatwootAccountId || 0,
        onLecturaTicketCreated: () => { conversation.pendingLectura = false; },
    };

    const allTools = [...staticTools, ...createContextTools(reqCtx)];

    try {
        // Step 1: Classification
        console.log(`[Workflow] Running classification...`);

        let category: CategoryCode = "CON"; // Default
        let keywordMatched = false;
        let extractedContract: string | undefined;

        // Simple classification based on keywords
        const inputLower = input.input_as_text.toLowerCase();

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
        } else if (inputLower.includes("saldo a favor") || inputLower.includes("crédito a favor") ||
                   inputLower.includes("credito a favor") ||
                   inputLower.includes("recibo") || inputLower.includes("factura") ||
                   inputLower.includes("aclaración") || inputLower.includes("ajuste") ||
                   inputLower.includes("cobro") || inputLower.includes("pagar") ||
                   inputLower.includes("pago")) {
            category = "FAC";
            keywordMatched = true;
        } else if (inputLower.includes("contrato nuevo") || inputLower.includes("nuevo contrato") ||
                   inputLower.includes("nuevo servicio") || inputLower.includes("contratación") ||
                   inputLower.includes("contratacion") || inputLower.includes("quiero contratar") ||
                   inputLower.includes("toma nueva") || inputLower.includes("nueva toma") ||
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
            // Flag "reportar lectura" context so media pipeline skips detailed medidor analysis
            if (inputLower.includes("lectura")) {
                conversation.pendingLectura = true;
            }
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
        // Strip all image/media analysis sections to avoid picking up meter readings or serial numbers
        const textForContractSearch = input.input_as_text
            .replace(/\[Imagen enviada por el usuario\]:[\s\S]*/g, '')
            .replace(/\[ANÁLISIS DE [^\]]+\]:[\s\S]*?(?=\n\n|\[|$)/g, '');
        const contractMatch = textForContractSearch.match(/\b(\d{6,10})\b/);
        if (contractMatch) {
            extractedContract = contractMatch[1];

            // Old SIGE contracts are 9 digits, new Hydra contracts are 6 digits
            if (extractedContract.length === 9) {
                const translated = await translateContract(extractedContract);
                if (translated) {
                    console.log(`[Workflow] Translated SIGE contract ${extractedContract} → Hydra ${translated}`);
                    conversation.contractNumber = translated;
                    extractedContract = translated;
                } else {
                    console.log(`[Workflow] SIGE contract ${extractedContract} not found in Hydra mapping`);
                    conversation.contractNumber = extractedContract;
                }
            } else {
                conversation.contractNumber = extractedContract;
            }
        }

        console.log(`[Workflow] Classification: ${category}`);
        if (extractedContract) {
            console.log(`[Workflow] Extracted contract: ${extractedContract}`);
        }

        // Step 2: Get the appropriate skill
        const skill = getSkill(category);
        console.log(`[Workflow] Using skill: ${skill.name}`);

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
            name: "maria-cea-tools",
            version: "1.0.0",
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
                // Server environment settings
                persistSession: false,
                tools: [],  // Disable built-in Claude Code tools, only use MCP tools
                cwd: process.cwd(),
                stderr: (data: string) => {
                    console.error(`[Claude Code STDERR]: ${data}`);
                },
                env: process.env
            }
        });

        // Collect each assistant turn as a separate message
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
                            // SDK returns MCP-prefixed names like "mcp__maria-cea-tools__create_ticket"
                            // Strip prefix to get bare tool name for guard checks
                            const bareName = block.name.replace(/^mcp__[^_]+__/, "");
                            toolsUsed.push(bareName);
                            hasToolUse = true;
                        }
                    }
                } else if (typeof content === "string") {
                    turnText += content;
                }
                // Skip text from turns that have tool calls — it's just preamble
                if (turnText.trim() && !hasToolUse) {
                    outputMessages.push(turnText.trim());
                }
            } else if (message.type === "result") {
                console.log(`[Workflow] Completed. Cost: $${message.total_cost_usd}`);
            }
        }

        let output = outputMessages.join("\n\n");

        console.log(`[Workflow] Tools called: [${toolsUsed.join(", ")}]`);

        // Guard: detect hallucinated folios — if output mentions a folio-like pattern but create_ticket was never called
        const hasFolioPattern = /\bCEA-\d{4,8}-\d{3,6}\b/i.test(output) || /\bfolio\s*[#:]?\s*\d{4,}/i.test(output);
        const calledCreateTicket = toolsUsed.includes("create_ticket");
        if (hasFolioPattern && !calledCreateTicket) {
            console.warn(`[Workflow] BLOCKED: Hallucinated folio detected without create_ticket call. Tools: [${toolsUsed.join(", ")}]. Output: "${output.substring(0, 200)}"`);
            output = "Hubo un problema al registrar tu reporte. Déjame intentarlo de nuevo. ¿Podrías repetir tu solicitud?";
            outputMessages.length = 0;
            outputMessages.push(output);
        }

        // Sync verified contracts from tools.ts tracking map into conversation entry
        const newlyVerified = getVerifiedContracts(conversationId);
        for (const contract of newlyVerified) {
            conversation.verifiedContracts.add(contract);
        }

        // Step 5: Update conversation history
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
    return {
        status: "healthy",
        skills: Object.values(SKILL_REGISTRY).map(s => `${s.code}: ${s.name}`),
        conversationCount: conversationStore.size
    };
}
