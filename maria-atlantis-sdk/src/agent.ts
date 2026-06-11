// ============================================
// Maria Atlantis SDK - Slim Agent Orchestrator
// Uses SDK query() with sessions, skills, and hooks
// ============================================

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createToolServer } from "./tools/index.js";
import type { WorkflowInput, WorkflowOutput, RequestContext } from "./types.js";

// ============================================
// Session Store (SDK sessions for conversation continuity)
// ============================================

interface SessionEntry {
    sessionId: string;
    lastAccess: Date;
    contractNumber?: string;
    verifiedContracts: Set<string>;
    pendingLectura?: boolean;
}

const sessionStore = new Map<string, SessionEntry>();

// Cleanup old sessions (1 hour expiry)
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessionStore.entries()) {
        if (now - entry.lastAccess.getTime() > 3600000) {
            sessionStore.delete(id);
        }
    }
}, 300000);

function getSession(conversationId: string): { session: SessionEntry; isNew: boolean } {
    const existing = sessionStore.get(conversationId);
    if (existing) {
        existing.lastAccess = new Date();
        return { session: existing, isNew: false };
    }
    const newEntry: SessionEntry = {
        sessionId: crypto.randomUUID(),
        lastAccess: new Date(),
        verifiedContracts: new Set()
    };
    sessionStore.set(conversationId, newEntry);
    return { session: newEntry, isNew: true };
}

// ============================================
// System Prompt (global conversation rules)
// ============================================

const SYSTEM_PROMPT = `Eres María, una agente de atención de Hydropolis. Ayudas a ciudadanos con consultas sobre agua y drenaje. NUNCA te presentes como "asistente virtual" ni "bot" — habla como una persona real. Cuando saludes usa un tono natural y cercano, por ejemplo: "¡Hola! Soy María de Hydropolis, ¿en qué te puedo ayudar hoy?"

⚠️ REGLAS OBLIGATORIAS DE CONVERSACIÓN:

1. RESPUESTAS CORTAS: Máximo 2-3 oraciones por mensaje. Estilo WhatsApp, no corporativo. NO uses emojis al final de los mensajes.
2. UNA PREGUNTA POR MENSAJE: PROHIBIDO dar múltiples opciones. Pregunta UNA cosa específica.
3. NO USES HERRAMIENTAS PREMATURAMENTE: Primero entiende qué información específica necesita el usuario.
3b. HORARIOS Y OFICINAS: PROHIBIDO llamar get_main_office o find_nearest_locations sin que el usuario haya dado su ubicación primero. Cuando pregunten horarios o dónde pagar, responde SOLO con: "Si quieres dime dónde estás y te doy los horarios de la oficina más cercana a ti." NO busques ni muestres ninguna oficina hasta tener ubicación. Después de dar info de oficina, siempre termina con "¿Te puedo ayudar con algo más?"
4. NUNCA MENCIONES CÓDIGOS: PROHIBIDO mencionar FAC-004, INF-GEN, TRA-NUE, etc. Solo menciona el FOLIO después de crear el ticket.
5. CUANDO UNA HERRAMIENTA FALLA: Dilo claramente, no inventes datos.
6. SALUDO: SOLO saluda cuando el mensaje es un saludo simple SIN petición concreta. Si incluye petición, ve directo a resolverla.
7. MOSTRAR DATOS COMPLETOS: Si consultas datos exitosamente, muéstralos TODOS de una vez.
8. RESPUESTAS CON DATOS: Cuando un tool retorna "formatted_response", muéstralo directamente. NO agregues texto antes ni después.
9. TRANSFERENCIA A HUMANO: Si el usuario pide hablar con una persona, usa handoff_to_human.
10. USUARIOS NO PUEDEN CERRAR TICKETS: Responde que necesitan un asesor y usa handoff_to_human.
11. PAGOS:
    - LINK/ENLACE/LIGA DE PAGO: Si el usuario pide un link, enlace o liga para pagar en línea, usa get_payment_link con su número de contrato. Si no tienes el contrato todavía, pídeselo primero y después llama a la herramienta; la herramienta valida que el contrato exista y devuelve el link prellenado. No hace falta verificar el nombre del titular para entregar el link.
    - CÓMO PAGAR EN GENERAL: Si solo preguntan "cómo puedo pagar" sin pedir un link, muestra esta respuesta exacta:
"Puedes pagar de estas formas:

*En línea:*
• https://supra.humansoftware.mx/portal

*En persona:*
• Oficinas y módulos Hydropolis
• Cajeros automáticos Hydropolis
• Tiendas de conveniencia (Oxxo, 7-Eleven)
• Bancos autorizados

¿Necesitas saber dónde hay un punto de pago cerca de ti, o quieres que te mande el link prellenado con tu contrato?"
12. EVIDENCIA FOTOGRÁFICA: La foto es OPCIONAL, nunca obligatoria. Pregunta "¿Me puedes mandar una foto para agregarla a tu reporte?" Si el usuario dice que no tiene o no quiere, continúa sin foto. Si NO tienes foto/video de una FUGA y no puedes evaluar la gravedad, pregunta "¿Qué tan grave es la fuga?" antes de crear el ticket (para determinar urgencia). Para LECTURAS pide foto del medidor. Para RECIBOS pide foto (NO PDF).
13. REPORTES (create_ticket): NUNCA pidas nombre completo al usuario para crear un reporte. Usa el nombre del perfil de WhatsApp o "Cliente WhatsApp" como client_name. Solo necesitas: ubicación, descripción del problema, y gravedad (si no hay foto).
14. ACLARACIONES: Primero crea un ticket (categoría FAC, subcategoría FAC-ACL) con la descripción del problema, LUEGO transfiere a asesor con handoff_to_human. Dale al usuario su folio antes de transferir.
15. SEGUIMIENTO NATURAL: Después de mostrar datos, incluye pregunta de seguimiento en el MISMO mensaje.
16. VERIFICACIÓN DE IDENTIDAD POR NOMBRE:
    - ANTES de mostrar datos de un contrato, DEBES verificar la identidad.
    - PREREQUISITO: Necesitas el número de contrato primero.
    - PASO 1 (confirmar contrato): Cuando el usuario te dé un número de contrato por primera vez, usa get_contract_details para confirmar que existe. Si la herramienta devuelve "No encontré tu contrato", muestra ese mensaje tal cual y NO pidas nombre hasta que el usuario dé otro número válido.
    - PASO 2 (verificar titular): Si el contrato existe y NO ha sido verificado, pregunta "¿Cuál es el nombre del titular registrado en el contrato?", ESPERA respuesta, usa validate_contract_holder. NUNCA digas "tu nombre completo".
    - MATCHING FLEXIBLE: validate_contract_holder acepta cualquier palabra del nombre del titular. Si el titular es "Roberto Carlos Díaz López", basta con que el usuario diga "Roberto", "Carlos", "Díaz" o "López" — la herramienta lo marcará como validado.
    - PROHIBIDO: NUNCA valides nombres por tu cuenta. SIEMPRE usa validate_contract_holder.
    - EXCEPCIONES: Reportes en vía pública, preguntas generales sin contrato, pagos.
    - 🛑 NUNCA uses el nombre de perfil WhatsApp para verificación.
17. DOCUMENTOS: NO puedes abrir documentos. Pide foto en su lugar.
18. CONSULTA DE TICKETS POR FOLIO: Cuando el usuario mencione un número de ticket, reporte o folio específico, usa lookup_ticket_by_folio. Si el ticket no se encuentra, responde: "No pude encontrar ese número de ticket en nuestro sistema. Déjame canalizarte con un asesor para que te ayude mejor." y usa handoff_to_human. NUNCA inventes el estado de un ticket.`;

// ============================================
// Main Workflow
// ============================================

export async function runWorkflow(input: WorkflowInput): Promise<WorkflowOutput> {
    const startTime = Date.now();
    const conversationId = input.conversationId || crypto.randomUUID();

    console.log(`\n========== WORKFLOW START ==========`);
    console.log(`ConversationId: ${conversationId}`);
    console.log(`Input: "${input.input_as_text}"`);

    const { session, isNew } = getSession(conversationId);

    // Extract contract number if present
    const textForContractSearch = input.input_as_text
        .replace(/\[Imagen enviada por el usuario\]:[\s\S]*/g, '')
        .replace(/\[ANÁLISIS DE [^\]]+\]:[\s\S]*?(?=\n\n|\[|$)/g, '');
    const contractMatch = textForContractSearch.match(/\b(\d{6,10})\b/);
    if (contractMatch) {
        const extracted = contractMatch[1];
        session.contractNumber = extracted;
    }

    // Extract contract from custom_attributes
    const customContrato = input.metadata?.custom_attributes?.contrato;
    if (customContrato) {
        session.contractNumber = String(customContrato);
    }

    // Build per-request context
    const reqCtx: RequestContext = {
        conversationId,
        chatwootConversationId: input.chatwootConversationId || 0,
        chatwootAccountId: input.chatwootAccountId || 0,
        onLecturaTicketCreated: () => { session.pendingLectura = false; },
        verifiedContracts: session.verifiedContracts,
    };

    // Build user context
    let userContext = '';
    if (input.metadata?.name) userContext += `Nombre de perfil WhatsApp (NO es el titular, NO usar para verificación): ${input.metadata.name}\n`;
    if (input.metadata?.phone) userContext += `Teléfono: ${input.metadata.phone}\n`;
    if (input.metadata?.email) userContext += `Email: ${input.metadata.email}\n`;
    if (session.contractNumber) userContext += `Número de contrato: ${session.contractNumber}\n`;

    // Verified contracts context
    const verifiedList = [...session.verifiedContracts];
    const verifiedContext = verifiedList.length > 0
        ? `\nContratos ya verificados en esta conversación: ${verifiedList.join(", ")}`
        : "";

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
    const dateStr = now.toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const timeStr = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

    const dynamicPrompt = `CONTEXTO ACTUAL:
Fecha: ${dateStr}
Hora: ${timeStr} (hora de Querétaro)${verifiedContext}
${userContext ? `\nINFORMACIÓN DEL USUARIO:\n${userContext}` : ''}

MENSAJE DEL USUARIO:
${input.input_as_text}`;

    try {
        // Create MCP server with all tools
        const mcpServerConfig = createToolServer(reqCtx);

        console.log(`[Workflow] Starting Claude query (session: ${session.sessionId}, isNew: ${isNew})...`);
        const result = query({
            prompt: dynamicPrompt,
            options: {
                model: "claude-sonnet-4-5-20250929",
                systemPrompt: SYSTEM_PROMPT,
                maxBudgetUsd: 2.00,
                maxTurns: 15,
                permissionMode: "bypassPermissions",
                allowDangerouslySkipPermissions: true,
                mcpServers: {
                    "maria-atlantis-tools": mcpServerConfig
                },
                ...(isNew
                    ? { sessionId: session.sessionId, persistSession: true }
                    : { resume: session.sessionId }),
                tools: [],
                cwd: process.cwd(),
                stderr: (data: string) => {
                    console.error(`[Claude STDERR]: ${data}`);
                },
                env: process.env
            }
        });

        const outputMessages: string[] = [];
        const toolsUsed: string[] = [];

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

        // Guard: detect hallucinated folios (allow legitimate folio mentions from ticket tools)
        const hasFolioPattern = /\bCEA-\d{4,8}-\d{3,6}\b/i.test(output) || /\bfolio\s*[#:]?\s*\d{4,}/i.test(output);
        const ticketToolUsed = toolsUsed.includes("create_ticket") || toolsUsed.includes("get_client_tickets") || toolsUsed.includes("update_ticket") || toolsUsed.includes("lookup_ticket_by_folio");
        if (hasFolioPattern && !ticketToolUsed) {
            console.warn(`[Workflow] BLOCKED: Hallucinated folio detected`);
            output = "Hubo un problema al registrar tu reporte. Déjame intentarlo de nuevo. ¿Podrías repetir tu solicitud?";
            outputMessages.length = 0;
            outputMessages.push(output);
        }

        const processingTime = Date.now() - startTime;
        console.log(`[Workflow] Complete in ${processingTime}ms`);
        console.log(`========== WORKFLOW END ==========\n`);

        return {
            output_text: output,
            output_messages: outputMessages,
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
    return sessionStore.get(conversationId)?.pendingLectura === true;
}

export function clearPendingLectura(conversationId: string): void {
    const entry = sessionStore.get(conversationId);
    if (entry) {
        entry.pendingLectura = false;
    }
}

// ============================================
// Health Check
// ============================================

export function getAgentHealth(): { status: string; conversationCount: number } {
    return {
        status: "healthy",
        conversationCount: sessionStore.size
    };
}
