// ============================================
// Create the consultar_pagos webhook tool and add it to the TEST agent's
// tool_ids. Derives the (rotating) tunnel base URL from an existing tool so the
// new tool hits the same v2.1 server. Idempotent. Live agent untouched.
//
//   node deploy/elevenlabs/add-pagos-tool.mjs
// ============================================
import { el } from "./_el.mjs";
import { TOOLS, buildToolConfig } from "./tools-def.mjs";

const TEST_ID = process.env.AGENT_ID || "agent_0201ktm6ft1jehqrdt1qpg8dbmz8";
const NAME = "consultar_pagos";

const agent = await el(`/convai/agents/${TEST_ID}`);
const prompt = agent.conversation_config.agent.prompt;
const ids = prompt.tool_ids || [];

let baseUrl = null, existing = null;
for (const id of ids) {
    const c = (await el(`/convai/tools/${id}`)).tool_config || {};
    if (c.name === NAME) existing = id;
    if (c.api_schema?.url) baseUrl = c.api_schema.url.replace(/\/webhook\/.*$/, "");
}
if (!baseUrl) throw new Error("Could not derive base webhook URL from existing tools");
console.log("base url:", baseUrl, "| already present:", existing || "no");

let toolId = existing;
if (!toolId) {
    const def = TOOLS.find((t) => t.name === NAME);
    if (!def) throw new Error(`${NAME} not in tools-def.mjs`);
    const created = await el(`/convai/tools`, "POST", buildToolConfig(def, baseUrl));
    toolId = created.id || created.tool_id;
    console.log("created tool:", toolId);
}

if (!ids.includes(toolId)) {
    const newPrompt = { ...prompt, tool_ids: [...ids, toolId], tools: [] };
    await el(`/convai/agents/${TEST_ID}`, "PATCH", { conversation_config: { agent: { prompt: newPrompt } } });
    console.log("added to agent tool_ids");
}

const after = await el(`/convai/agents/${TEST_ID}`);
console.log("tool_ids now:", (after.conversation_config.agent.prompt.tool_ids || []).length);
console.log("PAGOS_TOOL_ID=" + toolId);
