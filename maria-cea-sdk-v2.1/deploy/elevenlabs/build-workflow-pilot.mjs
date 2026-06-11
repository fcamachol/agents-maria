// ============================================
// Build a TEST clone of the live Maria CEA agent and attach a "top intents"
// workflow: classify -> (identity -> consumo | saldo) | fuga.
//
// SAFE: creates a NEW agent; the live agent is never touched. Reuses the live
// agent's existing 13 tools (shared workspace tools, correct tunnel URL) via
// tool_ids — no duplicate tools created.
//
//   node deploy/elevenlabs/build-workflow-pilot.mjs
// ============================================
import { el, LIVE_AGENT_ID } from "./_el.mjs";

const live = await el(`/convai/agents/${LIVE_AGENT_ID}`);
const lcc = live.conversation_config;
const lp = lcc.agent.prompt;

// Map tool name -> id from the live agent so we can scope tools per node.
const tid = {};
for (const id of lp.tool_ids || []) {
    const t = await el(`/convai/tools/${id}`);
    tid[(t.tool_config || t).name] = id;
}
const need = ["validar_titular", "consultar_consumo", "consultar_saldo", "crear_reporte", "transferir_humano"];
for (const n of need) if (!tid[n]) throw new Error(`Missing tool ${n} on live agent`);

// ---- Clone config (faithful but minimal; tools:[] so tool_ids is authoritative) ----
const conversation_config = {
    agent: {
        first_message: lcc.agent.first_message,
        language: lcc.agent.language,
        prompt: {
            prompt: lp.prompt,
            llm: lp.llm,
            temperature: lp.temperature,
            tool_ids: lp.tool_ids,
            built_in_tools: lp.built_in_tools,
            tools: [],
        },
    },
    tts: { voice_id: lcc.tts?.voice_id, model_id: lcc.tts?.model_id || "eleven_turbo_v2_5" },
};

// ---- Workflow graph ----
const node = (type, extra = {}) => ({ type, ...extra });
const oa = (label, prompt, toolIds, pos, edge_order) => node("override_agent", {
    label, additional_prompt: prompt, additional_tool_ids: toolIds, position: pos, edge_order,
});
const uncond = (source, target) => ({ source, target, forward_condition: { type: "unconditional" } });
const llm = (source, target, condition) => ({ source, target, forward_condition: { type: "llm", condition } });

const workflow = {
    nodes: {
        start_node: node("start", { position: { x: 0, y: 0 }, edge_order: ["e_start"] }),
        classify: oa(
            "Clasificar intención",
            "Saluda brevemente solo si hace falta y averigua qué necesita el usuario: su SALDO/adeudo, su CONSUMO/historial de agua, o reportar una FUGA en vía pública. No pidas datos todavía ni uses herramientas; solo identifica la intención.",
            [], { x: 0, y: 160 }, ["e_data", "e_fuga"]
        ),
        verify_identity: oa(
            "Verificar identidad",
            "Antes de dar saldo o consumo debes validar la identidad. Pide el número de contrato (6 dígitos), repítelo dígito por dígito y espera un sí. Pregunta el nombre del titular. Llama validar_titular. Si el contrato no existe o el nombre no coincide tras dos intentos, dilo.",
            [tid.validar_titular], { x: -200, y: 320 }, ["e_consumo", "e_saldo", "e_transfer"]
        ),
        revisar_consumo: oa(
            "Revisar consumo",
            "El usuario quiere su consumo. Pregunta el periodo (por ejemplo, los últimos doce meses, o un año específico). Llama consultar_consumo pasando meses (por defecto 12) o year. Resume el promedio y el mes más alto; no leas mes por mes.",
            [tid.consultar_consumo], { x: -380, y: 480 }, ["e_consumo_end"]
        ),
        consultar_saldo: oa(
            "Consultar saldo",
            "El usuario quiere su saldo. Llama consultar_saldo con el contrato ya validado. Di el monto en palabras y ofrece las opciones de pago.",
            [tid.consultar_saldo], { x: -120, y: 480 }, ["e_saldo_end"]
        ),
        gather_fuga: oa(
            "Recopilar datos de fuga",
            "El usuario reporta una fuga o problema en vía pública. PREGUNTA y ESPERA: primero la ubicación exacta (calle y cruce o una referencia clara), luego una breve descripción de lo que observa. NUNCA inventes ni asumas la ubicación o la descripción; deben venir del usuario. Una pregunta a la vez. En este paso NO tienes herramientas: no registres nada todavía. Esto es importante.",
            [], { x: 300, y: 320 }, ["e_fuga_ready"]
        ),
        crear_fuga: oa(
            "Registrar fuga",
            "Ya tienes la ubicación y la descripción que el usuario te dio. Llama crear_reporte con tipo fuga y la ubicacion y descripcion EXACTAS del usuario (no las cambies ni inventes). Luego di el folio deletreado.",
            [tid.crear_reporte], { x: 300, y: 500 }, ["e_fuga_end"]
        ),
        transferir: oa(
            "Transferir a asesor",
            "No se pudo confirmar la identidad o el usuario pide un asesor. Llama transferir_humano e indica que lo comunicas con un asesor.",
            [tid.transferir_humano], { x: 120, y: 560 }, ["e_transfer_end"]
        ),
        end_node: node("end", { position: { x: 0, y: 720 } }),
    },
    edges: {
        e_start: uncond("start_node", "classify"),
        e_data: llm("classify", "verify_identity", "El usuario quiere consultar su saldo/adeudo o su consumo/historial de agua."),
        e_fuga: llm("classify", "gather_fuga", "El usuario quiere reportar una fuga, drenaje o problema de agua en vía pública."),
        e_fuga_ready: llm("gather_fuga", "crear_fuga", "El usuario ya proporcionó explícitamente la ubicación exacta de la fuga (calle, cruce o referencia) Y una descripción. Si falta cualquiera de las dos, no avances."),
        e_consumo: llm("verify_identity", "revisar_consumo", "La identidad quedó confirmada y el usuario quiere su consumo o historial."),
        e_saldo: llm("verify_identity", "consultar_saldo", "La identidad quedó confirmada y el usuario quiere su saldo o adeudo."),
        e_transfer: llm("verify_identity", "transferir", "No se pudo confirmar la identidad tras los intentos, o el usuario pide un asesor."),
        e_consumo_end: uncond("revisar_consumo", "end_node"),
        e_saldo_end: uncond("consultar_saldo", "end_node"),
        e_fuga_end: uncond("crear_fuga", "end_node"),
        e_transfer_end: uncond("transferir", "end_node"),
    },
};

// ---- Create the clone (or update an existing test agent), then attach the workflow ----
// Set PATCH_AGENT=<agent_id> to re-apply the workflow to an existing test agent
// instead of creating a new one.
let NEW_ID = process.env.PATCH_AGENT;
if (NEW_ID) {
    console.log("Updating existing TEST agent workflow:", NEW_ID);
} else {
    const created = await el(`/convai/agents/create`, "POST", {
        name: "Maria CEA — Workflow Pilot (TEST)",
        conversation_config,
    });
    NEW_ID = created.agent_id || created.id;
    console.log("Created TEST agent:", NEW_ID);
}

await el(`/convai/agents/${NEW_ID}`, "PATCH", { workflow });

// ---- Verify ----
const after = await el(`/convai/agents/${NEW_ID}`);
const wf = after.workflow || {};
console.log("nodes:", Object.keys(wf.nodes || {}).join(", "));
console.log("edges:", Object.keys(wf.edges || {}).length);
console.log("voice:", after.conversation_config.tts?.voice_id, "| llm:", after.conversation_config.agent.prompt.llm, "| tool_ids:", (after.conversation_config.agent.prompt.tool_ids || []).length);
console.log("NEW_AGENT_ID=" + NEW_ID);
