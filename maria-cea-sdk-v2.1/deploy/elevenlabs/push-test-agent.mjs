#!/usr/bin/env node
// ============================================
// Push a TEST ElevenLabs agent for Maria CEA voice (Option B: EL Conversational AI).
//
// SAFE: creates a NEW agent (clone) + NEW webhook tools pointing at your deployed
// v2.1 voice server. Does NOT touch the live "Maria CEA" agent. Validate the test
// agent via the EL dashboard "Test AI agent" widget (the only phone number is the
// live SIP one, so don't bind a number to the test agent).
//
// Prerequisites:
//   1. The v2.1 voice server deployed and reachable at VOICE_SERVER_URL.
//   2. ELEVENLABS_API_KEY with Conversational AI (agents + tools) WRITE access.
//   3. Project built (npm run build) so dist/voice/system-prompt.js exists.
//
// Usage:
//   ELEVENLABS_API_KEY=xi-... \
//   VOICE_SERVER_URL=https://your-host:3004 \
//   VOICE_AGENT_VOICE_ID=CaJslL1xziwefCeTNzHv \
//   node deploy/elevenlabs/push-test-agent.mjs
//
// Re-running: creating tools/agents will create NEW copies each time (no upsert).
// Delete old test tools/agents in the dashboard if you re-run.
// ============================================

import { VOICE_SYSTEM_PROMPT } from "../../dist/voice/system-prompt.js";

const API = "https://api.elevenlabs.io/v1";
const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_SERVER_URL = (process.env.VOICE_SERVER_URL || "").replace(/\/+$/, "");
const VOICE_ID = process.env.VOICE_AGENT_VOICE_ID || "CaJslL1xziwefCeTNzHv"; // Cristina Campos
const AGENT_NAME = process.env.TEST_AGENT_NAME || "Maria CEA (TEST v2.1)";
const FIRST_MESSAGE = "Hola, soy María de CEA Querétaro. ¿En qué puedo ayudarte?";

if (!API_KEY) { console.error("Missing ELEVENLABS_API_KEY"); process.exit(1); }
if (!VOICE_SERVER_URL) { console.error("Missing VOICE_SERVER_URL (e.g. https://host:3004)"); process.exit(1); }

// ---- helpers -------------------------------------------------------------

const str = (description, opts = {}) => ({ type: "string", description, ...opts });
const int = (description) => ({ type: "integer", description });

// Every tool receives the EL system dynamic variables so the server can key the
// shared session by identity. Our voice/tools.ts reads system__caller_id /
// system__conversation_id (and plain phone/conversation_id) — see identityKey().
// NOTE: confirm EL fills these as dynamic variables on first live test (the one
// remaining deploy-time unknown). value_type:"dynamic_variable" is the documented
// mechanism; if the field name differs in your EL version, set it in the dashboard.
const SYSTEM_FIELDS = {
    system__conversation_id: { type: "string", description: "ID de conversación", value_type: "dynamic_variable", dynamic_variable: "system__conversation_id" },
    system__caller_id: { type: "string", description: "Número del que llama", value_type: "dynamic_variable", dynamic_variable: "system__caller_id" },
};

// ---- the 13 tools --------------------------------------------------------
// `props` = business params the LLM fills. System fields are appended automatically.

const TOOLS = [
    { name: "validar_titular", description: "Valida la identidad: compara el nombre dado con el titular del contrato. Úsala ANTES de dar saldo, consumo, datos del contrato, recibos o reportes del contrato.",
      props: { contrato: str("Número de contrato CEA", { required: true }), nombre_titular: str("Nombre del titular que dio el usuario", { required: true }) } },
    { name: "consultar_saldo", description: "Saldo y adeudo de un contrato. Requiere identidad validada.",
      props: { contrato: str("Número de contrato CEA", { required: true }) } },
    { name: "consultar_consumo", description: "Historial de consumo de agua. Requiere identidad validada.",
      props: { contrato: str("Número de contrato CEA", { required: true }), year: int("Año a filtrar (opcional)") } },
    { name: "consultar_contrato", description: "Datos del contrato y titular. Requiere identidad validada.",
      props: { contrato: str("Número de contrato CEA", { required: true }) } },
    { name: "consultar_tickets", description: "Reportes activos del cliente por contrato. Requiere identidad validada.",
      props: { contrato: str("Número de contrato CEA", { required: true }) } },
    { name: "enviar_recibo", description: "Envía el recibo digital al WhatsApp del cliente (vía AGORA). Requiere identidad validada. No leas el enlace en voz.",
      props: { contrato: str("Número de contrato CEA", { required: true }), periodo: str("Mes/periodo del recibo (opcional)") } },
    { name: "crear_reporte", description: "Crea un reporte. tipo: fuga, fuga_domicilio, drenaje, sin_agua, baja_presion, calidad, medidor. Fugas/drenaje en vía pública solo requieren ubicación.",
      props: { tipo: str("Tipo de reporte", { required: true }), ubicacion: str("Dirección o cruce (requerido en vía pública)"), descripcion: str("Descripción del problema"), contrato: str("Contrato (requerido para reportes en domicilio)") } },
    { name: "actualizar_reporte", description: "Actualiza el estado de un reporte. Los usuarios no pueden cerrarlo.",
      props: { folio: str("Folio del reporte", { required: true }), status: str("Nuevo estado (opcional)") } },
    { name: "buscar_folio", description: "Consulta un reporte por su folio.",
      props: { folio: str("Folio que dio el usuario", { required: true }) } },
    { name: "info_oficina", description: "Información de la oficina principal de CEA (Pabellón Campestre).",
      props: {} },
    { name: "oficina_cercana", description: "Oficina o cajero más cercano por colonia (sin GPS en llamada).",
      props: { colonia: str("Colonia del usuario") } },
    { name: "transferir_humano", description: "Transfiere la llamada a un asesor humano.",
      props: { motivo: str("Motivo breve de la transferencia", { required: true }) } },
    { name: "revisar_whatsapp", description: "Revisa si el cliente envió una foto/mensaje por WhatsApp durante la llamada (p. ej. dijo 'ya la mandé').",
      props: {} },
];

async function el(path, method, body) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
    return text ? JSON.parse(text) : {};
}

function buildToolConfig(t) {
    const properties = {};
    const required = [];
    for (const [key, def] of Object.entries(t.props)) {
        const { required: req, ...rest } = def;
        properties[key] = rest;
        if (req) required.push(key);
    }
    Object.assign(properties, SYSTEM_FIELDS);
    return {
        tool_config: {
            type: "webhook",
            name: t.name,
            description: t.description,
            response_timeout_secs: 20,
            api_schema: {
                url: `${VOICE_SERVER_URL}/webhook/${t.name}`,
                method: "POST",
                request_body_schema: { type: "object", properties, required },
                content_type: "application/json",
            },
        },
    };
}

async function main() {
    console.log(`Pushing TEST agent against voice server: ${VOICE_SERVER_URL}\n`);

    // 1. Create the 13 webhook tools.
    const toolIds = [];
    for (const t of TOOLS) {
        const created = await el("/convai/tools", "POST", buildToolConfig(t));
        const id = created.id || created.tool_id;
        toolIds.push(id);
        console.log(`  tool ${t.name} -> ${id}`);
    }

    // 2. Create the TEST agent (clone of Maria CEA) with the derived voice prompt,
    //    voice, Spanish, and the tools attached.
    const agentBody = {
        name: AGENT_NAME,
        conversation_config: {
            agent: {
                first_message: FIRST_MESSAGE,
                language: "es",
                prompt: {
                    prompt: VOICE_SYSTEM_PROMPT,
                    tool_ids: toolIds,
                },
            },
            tts: { voice_id: VOICE_ID },
        },
    };
    const agent = await el("/convai/agents/create", "POST", agentBody);
    console.log(`\nTEST agent created: ${agent.agent_id || JSON.stringify(agent)}`);
    console.log("Validate it in the ElevenLabs dashboard via 'Test AI agent'. The live Maria CEA is untouched.");
}

main().catch((e) => { console.error("\nPush failed:", e.message); process.exit(1); });
