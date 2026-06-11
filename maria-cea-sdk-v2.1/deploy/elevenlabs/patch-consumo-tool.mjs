#!/usr/bin/env node
// ============================================
// Surgically add the `meses` window param (+ richer description) to the LIVE
// `consultar_consumo` webhook tool — WITHOUT touching the prompt, the other
// tools, or the existing webhook URL (which is a ROTATING cloudflared host, so
// we must preserve it, never rebuild it from a guessed VOICE_SERVER_URL).
//
// Idempotent: re-running just re-asserts the schema.
//
// Usage:
//   ELEVENLABS_API_KEY=... node deploy/elevenlabs/patch-consumo-tool.mjs
//   (optional) AGENT_ID=...  defaults to the live Maria CEA agent
// ============================================

import { TOOLS } from "./tools-def.mjs";

const API = "https://api.elevenlabs.io/v1";
const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.AGENT_ID || "agent_7301kg0z72effkvtqghs2hx58bpt";
const TOOL_NAME = "consultar_consumo";

if (!API_KEY) { console.error("Missing ELEVENLABS_API_KEY"); process.exit(1); }

async function el(p, method, body) {
    const res = await fetch(`${API}${p}`, {
        method,
        headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text}`);
    return text ? JSON.parse(text) : {};
}

const cfgOf = (tool) => tool.tool_config || tool;

async function main() {
    // 1. Find the live tool_id for consultar_consumo via the agent's tool_ids.
    const agent = await el(`/convai/agents/${AGENT_ID}`, "GET");
    const toolIds = agent.conversation_config?.agent?.prompt?.tool_ids || [];
    let target = null;
    for (const id of toolIds) {
        const t = await el(`/convai/tools/${id}`, "GET");
        if (cfgOf(t).name === TOOL_NAME) { target = { id, tool: t }; break; }
    }
    if (!target) throw new Error(`Live agent ${AGENT_ID} has no '${TOOL_NAME}' tool among ${toolIds.length} tools`);

    // 2. Start from the EXISTING tool_config (preserves url / timeouts / system
    //    fields) and change only description + request_body_schema.
    const cfg = JSON.parse(JSON.stringify(cfgOf(target.tool)));
    const def = TOOLS.find((t) => t.name === TOOL_NAME);
    cfg.description = def.description;
    const schema = cfg.api_schema.request_body_schema;
    schema.properties = schema.properties || {};
    schema.properties.meses = { type: "integer", description: "Cuántos meses recientes resumir (p. ej. 12; por defecto 12)" };
    if (!schema.properties.year) schema.properties.year = { type: "integer", description: "Año específico a consultar (opcional)" };

    console.log(`Live tool ${TOOL_NAME} = ${target.id}`);
    console.log(`URL preserved: ${cfg.api_schema.url}`);

    // 3. PATCH the tool in place.
    await el(`/convai/tools/${target.id}`, "PATCH", { tool_config: cfg });

    // 4. Verify.
    const after = cfgOf(await el(`/convai/tools/${target.id}`, "GET"));
    const props = Object.keys(after.api_schema.request_body_schema.properties || {});
    console.log("AFTER props:", props.join(", "));
    console.log(props.includes("meses") ? "OK: meses present on live tool" : "FAIL: meses missing");
}

main().catch((e) => { console.error("Patch FAILED:", e.message); process.exit(1); });
