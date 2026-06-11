#!/usr/bin/env node
// ============================================
// Surgically refresh the `crear_reporte` webhook tool: add the `sub_tipo` param
// (fuga sub-location) and the wider `tipo` description (sin_agua_general,
// reconexion) — WITHOUT touching the prompt, the other tools, or the existing
// webhook URL (a ROTATING cloudflared host, so we PATCH in place and never
// rebuild it from a guessed VOICE_SERVER_URL).
//
// Idempotent: re-running just re-asserts the schema.
//
// Usage:
//   PATCH_AGENT=agent_0201... node deploy/elevenlabs/patch-reporte-tool.mjs
//   (AGENT_ID is an alias for PATCH_AGENT; defaults to the workflow TEST agent.
//    The API key is auto-loaded from ~/.claude.json via _el.mjs.)
// ============================================

import { el } from "./_el.mjs";
import { TOOLS } from "./tools-def.mjs";

const AGENT_ID = process.env.PATCH_AGENT || process.env.AGENT_ID || "agent_0201ktm6ft1jehqrdt1qpg8dbmz8";
const TOOL_NAME = "crear_reporte";

const cfgOf = (tool) => tool.tool_config || tool;

async function main() {
    // 1. Find the tool_id for crear_reporte via the agent's tool_ids.
    const agent = await el(`/convai/agents/${AGENT_ID}`, "GET");
    const toolIds = agent.conversation_config?.agent?.prompt?.tool_ids || [];
    let target = null;
    for (const id of toolIds) {
        const t = await el(`/convai/tools/${id}`, "GET");
        if (cfgOf(t).name === TOOL_NAME) { target = { id, tool: t }; break; }
    }
    if (!target) throw new Error(`Agent ${AGENT_ID} has no '${TOOL_NAME}' tool among ${toolIds.length} tools`);

    // 2. Start from the EXISTING tool_config (preserves url / timeouts / system
    //    fields) and change only description + request_body_schema.
    const cfg = JSON.parse(JSON.stringify(cfgOf(target.tool)));
    const def = TOOLS.find((t) => t.name === TOOL_NAME);
    cfg.description = def.description;
    const schema = cfg.api_schema.request_body_schema;
    schema.properties = schema.properties || {};
    schema.properties.sub_tipo = { type: "string", description: "Sub-ubicación de la fuga: banqueta, arroyo de la calle o calle (opcional)" };

    // Re-assert descripcion (detailed wording) and make it required, matching the
    // sdk-v2 text agent so voice tickets carry a real description, not the title.
    const d = def.props.descripcion;
    schema.properties.descripcion = { type: "string", description: d.description };
    schema.required = Array.from(new Set([...(schema.required || []), "tipo", "descripcion"]));

    // nombre: the name the caller gave in-call, so the ticket's client_name is
    // the real person instead of the "Cliente Llamada" placeholder.
    schema.properties.nombre = { type: "string", description: def.props.nombre.description };

    console.log(`Tool ${TOOL_NAME} = ${target.id}`);
    console.log(`URL preserved: ${cfg.api_schema.url}`);

    // 3. PATCH the tool in place.
    await el(`/convai/tools/${target.id}`, "PATCH", { tool_config: cfg });

    // 4. Verify.
    const after = cfgOf(await el(`/convai/tools/${target.id}`, "GET"));
    const props = Object.keys(after.api_schema.request_body_schema.properties || {});
    const req = after.api_schema.request_body_schema.required || [];
    console.log("AFTER props:", props.join(", "));
    console.log("AFTER required:", req.join(", "));
    console.log("AFTER description:", after.description);
    console.log(props.includes("sub_tipo") ? "OK: sub_tipo present" : "FAIL: sub_tipo missing");
    console.log(req.includes("descripcion") ? "OK: descripcion required" : "FAIL: descripcion not required");
}

main().catch((e) => { console.error("Patch FAILED:", e.message); process.exit(1); });
