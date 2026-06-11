// ============================================
// Complete Maria CEA voice workflow (all v2.1 scenarios), grouped-hub design
// with multi-intent loop-back. Applies to the TEST clone by default.
//
//   PATCH_AGENT=<agent_id> node deploy/elevenlabs/build-workflow-full.mjs   # update existing
//   node deploy/elevenlabs/build-workflow-full.mjs                          # create a new clone
//
// Nodes (14): start, router, verify_identity, datos_contrato, gather_reporte,
//   crear_reporte_node, falta_agua, crear_falta_agua, reconexion, info_general,
//   buscar_folio_node, transferir, continuar, end. (falta de agua: estado/adeudo
//   gate + ASK home-vs-neighbors, then a separate create node so the ticket is
//   never registered before the user answers; reconexión creates an SRV-RCN
//   ticket — all gated behind verify_identity.)
// Identity is a structural gate; reports use gather(no tools)->create to stop
// the model fabricating args; every leaf loops back to router or ends.
// ============================================
import { el, LIVE_AGENT_ID } from "./_el.mjs";

// Map tool name->id from the agent we're targeting (the test agent already has
// test-only tools like consultar_pagos that the live agent lacks).
const live = await el(`/convai/agents/${process.env.PATCH_AGENT || LIVE_AGENT_ID}`);
const lcc = live.conversation_config;
const lp = lcc.agent.prompt;

const tid = {};
for (const id of lp.tool_ids || []) {
    const t = await el(`/convai/tools/${id}`);
    tid[(t.tool_config || t).name] = id;
}
const required = ["validar_titular", "consultar_saldo", "consultar_consumo", "consultar_contrato",
    "consultar_tickets", "enviar_recibo", "revisar_whatsapp", "crear_reporte", "info_oficina",
    "oficina_cercana", "buscar_folio", "transferir_humano"];
for (const n of required) if (!tid[n]) throw new Error(`Missing tool ${n} on live agent`);

// ---- helpers ----
const oa = (label, prompt, toolIds, pos, edge_order) => ({
    type: "override_agent", label, additional_prompt: prompt,
    additional_tool_ids: toolIds, position: pos, edge_order,
});
const uncond = (source, target) => ({ source, target, forward_condition: { type: "unconditional" } });
const llm = (source, target, condition) => ({ source, target, forward_condition: { type: "llm", condition } });

// ---- nodes ----
const nodes = {
    start_node: { type: "start", position: { x: 0, y: 0 }, edge_order: ["e_start"] },

    router: oa("Recepción y enrutamiento",
        "Saluda brevemente solo si hace falta. Identifica qué necesita el usuario y enrútalo: saldo, consumo/historial, datos del contrato, recibo o reportes de su cuenta (requieren identidad); reportar una fuga, un drenaje tapado u otro problema en vía pública o domicilio; reportar falta de agua / que no tiene servicio; solicitar reconexión del servicio tras un corte; opciones de pago, oficinas u horarios; seguimiento a un folio; o hablar con un asesor. En este paso NO uses herramientas; solo conversa para identificar la intención.",
        [], { x: 0, y: 150 }, ["e_r_identity", "e_r_reporte", "e_r_info", "e_r_folio", "e_r_transfer"]),

    verify_identity: oa("Verificar identidad",
        "SI EN ESTA MISMA LLAMADA YA VALIDASTE un contrato con validar_titular y el usuario sigue con ESE mismo contrato, NO lo pidas de nuevo ni vuelvas a llamar validar_titular: continúa de inmediato con su solicitud usando ese contrato. Solo si aún no has validado en esta llamada (o el usuario cambió a otro contrato): pide el número de contrato (6 dígitos), repítelo dígito por dígito y espera un sí, pregunta el nombre del titular, y llama validar_titular. Si el contrato no existe o el nombre no coincide tras dos intentos, indícalo para transferir.",
        [tid.validar_titular], { x: -320, y: 310 }, ["e_id_datos", "e_id_falta", "e_id_reconex", "e_id_reporte", "e_id_transfer"]),

    datos_contrato: oa("Datos del contrato",
        "Identidad ya validada. Atiende con la herramienta correcta: consultar_saldo (saldo/adeudo actual), consultar_consumo (consumo/historial en metros cúbicos y litros: pasa meses, por defecto 12, o year), consultar_pagos (cuánto pagó o cuánto fue su recibo de un mes: importe y si está pagado, pendiente o vencido), consultar_contrato (datos/titular/estado), consultar_tickets (reportes activos), enviar_recibo (recibo por WhatsApp). Si el usuario dice que ya envió una foto por WhatsApp, usa revisar_whatsapp. Di montos y cifras en palabras.",
        [tid.consultar_saldo, tid.consultar_consumo, tid.consultar_contrato, tid.consultar_tickets, tid.enviar_recibo, tid.revisar_whatsapp, ...(tid.consultar_pagos ? [tid.consultar_pagos] : [])],
        { x: -480, y: 470 }, ["e_datos_done"]),

    gather_reporte: oa("Recopilar datos del reporte",
        "El usuario quiere reportar un problema en vía pública o domicilio (fuga, drenaje tapado, baja presión, calidad, medidor). PREGUNTA y ESPERA los datos; NUNCA los inventes. Si es en vía pública: pide la ubicación exacta (calle y cruce o referencia) y una descripción clara del problema (qué pasa, qué tan grande y referencias). Si es una fuga, pregunta y ANOTA si está en la banqueta, en el arroyo de la calle o en la calle (esto es el sub_tipo). Para un drenaje tapado en la red, usa tipo drenaje. Si es en su domicilio: pide su número de contrato y una descripción clara del problema (requerirá validar identidad). En este paso NO tienes herramientas: no registres nada todavía. Esto es importante.",
        [], { x: 300, y: 310 }, ["e_g_crear", "e_g_identity"]),

    crear_reporte_node: oa("Registrar reporte",
        "Ya tienes los datos necesarios; no pidas más. Llama crear_reporte con el tipo correcto. Si es EN DOMICILIO (fuga en casa, baja presión, calidad, medidor): usa el contrato ya validado y NUNCA pidas la dirección, es la del contrato. Si es en VÍA PÚBLICA: usa la ubicación que el usuario ya dio. Si es una fuga y mencionó banqueta, arroyo de la calle o calle, pásalo en sub_tipo. Pasa en descripcion un resumen detallado de lo que el usuario YA te dijo (qué ocurre, magnitud y referencias); no vuelvas a preguntar lo que ya sabes; no inventes. Si el usuario dio su nombre en la llamada, pásalo en nombre. Da el folio deletreado.",
        [tid.crear_reporte], { x: 120, y: 470 }, ["e_crear_done"]),

    falta_agua: oa("Falta de agua",
        "Identidad ya validada y la dirección es la del contrato: NUNCA pidas la dirección. Primero llama consultar_contrato y revisa el campo estado. Si está cortado o suspendido: explica que hay un adeudo, di el saldo con consultar_saldo y las opciones de pago, e indica que lo comunicas con un asesor (no se registra reporte). Si está activo: lo ÚNICO que debes preguntar es si la falta de agua es solo en su domicilio o si sus vecinos también están sin servicio; ESPERA la respuesta. NO registres nada en este paso. Esto es importante.",
        [tid.consultar_contrato, tid.consultar_saldo], { x: -300, y: 470 }, ["e_falta_transfer", "e_falta_crear"]),

    crear_falta_agua: oa("Registrar falta de agua",
        "El contrato está activo y el usuario ya indicó el alcance. Crea el reporte con crear_reporte usando el contrato ya validado (la dirección es la del contrato; NUNCA la pidas): tipo sin_agua si es SOLO su domicilio, o sin_agua_general si los vecinos o la colonia también están sin servicio. Pasa en descripcion lo que el usuario describió: el alcance (solo su domicilio o también vecinos) y cualquier detalle que dio. Si el usuario dio su nombre en la llamada, pásalo en nombre. Da el folio deletreado.",
        [tid.crear_reporte], { x: -300, y: 610 }, ["e_crearfalta_done"]),

    reconexion: oa("Reconexión de servicio",
        "Identidad ya validada. El usuario quiere reconectar su servicio tras un corte. Explica que la reconexión tiene un costo y que el adeudo debe estar liquidado; si quiere, confirma su saldo con consultar_saldo. Cuando el usuario confirme que ya pagó, crea el reporte con crear_reporte tipo reconexion y da el folio deletreado. Pasa en descripcion el contexto que el usuario dio sobre el corte y la reconexión. Si el usuario dio su nombre en la llamada, pásalo en nombre.",
        [tid.consultar_saldo, tid.crear_reporte], { x: 340, y: 590 }, ["e_reconex_done"]),

    info_general: oa("Información general",
        "Atiende información que no requiere identidad. Opciones de pago: dilas de viva voz, sin pedir contrato. Si piden la página, portal o URL para pagar en línea, dala así: doble u doble u doble u punto cea querétaro punto gob punto mx (www.ceaqueretaro.gob.mx). Oficina principal: usa info_oficina. Oficina o cajero más cercano: pide primero la colonia y luego usa oficina_cercana. Horarios: usa info_oficina, no los inventes. Si piden pipas, di exactamente que no ofrecemos servicio de pipas de agua.",
        [tid.info_oficina, tid.oficina_cercana], { x: -120, y: 630 }, ["e_info_done"]),

    buscar_folio_node: oa("Seguimiento de folio",
        "El usuario quiere el estatus de un reporte. Pide el número de folio y ESPERA a que lo dé; no lo inventes. Usa buscar_folio. Si no existe, ofrece transferir a un asesor.",
        [tid.buscar_folio], { x: 180, y: 630 }, ["e_folio_done"]),

    transferir: oa("Transferir a asesor",
        "Llama transferir_humano con un motivo breve e indica que lo comunicas con un asesor.",
        [tid.transferir_humano], { x: 460, y: 470 }, ["e_transfer_end"]),

    continuar: oa("¿Algo más?",
        "Pregunta brevemente si el usuario necesita algo más. No uses herramientas. Si tiene otra solicitud, será reclasificada; si se despide, termina con una despedida cordial.",
        [], { x: 0, y: 700 }, ["e_cont_more", "e_cont_end"]),

    end_node: { type: "end", position: { x: 0, y: 840 } },
};

// ---- edges ----
const edges = {
    e_start: uncond("start_node", "router"),

    e_r_identity: llm("router", "verify_identity", "El usuario quiere su saldo, consumo/historial, datos del contrato, recibo, o sus reportes activos; o reporta falta de agua / que no tiene servicio; o quiere reconexión del servicio tras un corte (todo esto requiere identidad)."),
    e_r_reporte: llm("router", "gather_reporte", "El usuario quiere reportar una fuga, un drenaje tapado, baja presión, calidad del agua o un problema del medidor (NO falta de agua ni reconexión)."),
    e_r_info: llm("router", "info_general", "El usuario pregunta por opciones de pago, oficinas, horarios, ubicaciones o pipas."),
    e_r_folio: llm("router", "buscar_folio_node", "El usuario quiere el estatus o seguimiento de un folio o reporte existente."),
    e_r_transfer: llm("router", "transferir", "El usuario pide hablar con una persona/asesor, o algo como aclaración de cobro, cambio de titular o convenio, o está frustrado."),

    e_id_datos: llm("verify_identity", "datos_contrato", "La identidad quedó confirmada y el usuario quiere consultar datos de su cuenta (saldo, consumo, contrato, reportes o recibo)."),
    e_id_falta: llm("verify_identity", "falta_agua", "La identidad quedó confirmada y el usuario reporta FALTA DE AGUA o que NO tiene servicio de agua (aunque sea en su domicilio). Tiene prioridad sobre el reporte genérico."),
    e_id_reconex: llm("verify_identity", "reconexion", "La identidad quedó confirmada y el usuario quiere reconexión del servicio tras un corte."),
    e_id_reporte: llm("verify_identity", "crear_reporte_node", "La identidad quedó confirmada y el usuario reporta un problema en su domicilio que NO es falta de agua ni reconexión: fuga dentro de casa, baja presión, agua turbia/olor/sabor, o medidor."),
    e_id_transfer: llm("verify_identity", "transferir", "No se pudo confirmar la identidad tras los intentos."),

    e_g_crear: llm("gather_reporte", "crear_reporte_node", "Es un problema en vía pública y el usuario ya dio la ubicación exacta y una descripción."),
    e_g_identity: llm("gather_reporte", "verify_identity", "Es un problema en el domicilio del usuario; ya dio su contrato y descripción y falta validar su identidad."),

    e_falta_transfer: llm("falta_agua", "transferir", "El contrato está cortado o suspendido por adeudo; ya informaste el saldo y las opciones de pago y procede transferir a un asesor."),
    e_falta_crear: llm("falta_agua", "crear_falta_agua", "El contrato está activo y el usuario YA respondió si la falta de agua es solo en su domicilio o si los vecinos también están afectados."),
    e_crearfalta_done: llm("crear_falta_agua", "continuar", "Ya registraste el reporte de falta de agua y diste el folio."),
    e_reconex_done: llm("reconexion", "continuar", "Ya registraste la solicitud de reconexión y diste el folio."),

    // Each leaf funnels to the shared "continuar" hub once its task is done
    // (a leaf can't edge straight back to router AND be routed from it — EL
    // forbids two edges on the same node pair).
    e_datos_done: llm("datos_contrato", "continuar", "Ya atendiste lo que el usuario pidió sobre su cuenta."),
    e_crear_done: llm("crear_reporte_node", "continuar", "Ya registraste el reporte y diste el folio."),
    e_info_done: llm("info_general", "continuar", "Ya diste la información solicitada."),
    e_folio_done: llm("buscar_folio_node", "continuar", "Ya diste el estatus del folio, o indicaste que no existe."),

    e_cont_more: llm("continuar", "router", "El usuario tiene otra solicitud distinta."),
    e_cont_end: llm("continuar", "end_node", "El usuario se despide o no necesita nada más."),

    e_transfer_end: uncond("transferir", "end_node"),
};

const workflow = { nodes, edges };

// ---- apply ----
let AGENT_ID = process.env.PATCH_AGENT;
if (AGENT_ID) {
    console.log("Updating existing TEST agent workflow:", AGENT_ID);
} else {
    const conversation_config = {
        agent: {
            first_message: lcc.agent.first_message,
            language: lcc.agent.language,
            prompt: { prompt: lp.prompt, llm: lp.llm, temperature: lp.temperature, tool_ids: lp.tool_ids, built_in_tools: lp.built_in_tools, tools: [] },
        },
        tts: { voice_id: lcc.tts?.voice_id, model_id: lcc.tts?.model_id || "eleven_turbo_v2_5" },
    };
    const created = await el(`/convai/agents/create`, "POST", { name: "Maria CEA — Workflow Full (TEST)", conversation_config });
    AGENT_ID = created.agent_id || created.id;
    console.log("Created TEST agent:", AGENT_ID);
}

await el(`/convai/agents/${AGENT_ID}`, "PATCH", { workflow });

// ---- verify ----
const after = await el(`/convai/agents/${AGENT_ID}`);
const wf = after.workflow || {};
const nodeIds = Object.keys(wf.nodes || {});
const edgeIds = Object.keys(wf.edges || {});
// sanity: every edge target/source exists; every non-end node reaches an edge.
const missing = [];
for (const [eid, e] of Object.entries(wf.edges || {})) {
    if (!wf.nodes[e.source]) missing.push(`${eid}.source=${e.source}`);
    if (!wf.nodes[e.target]) missing.push(`${eid}.target=${e.target}`);
}
console.log("nodes (" + nodeIds.length + "):", nodeIds.join(", "));
console.log("edges:", edgeIds.length);
console.log("dangling refs:", missing.length ? missing.join(", ") : "none");
console.log("voice:", after.conversation_config.tts?.voice_id, "| llm:", after.conversation_config.agent.prompt.llm);
console.log("AGENT_ID=" + AGENT_ID);
