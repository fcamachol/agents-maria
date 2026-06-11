#!/usr/bin/env node
// ============================================
// Update the LIVE "Maria CEA" ElevenLabs agent to the v2.1 voice tools + prompt.
//
// SAFETY:
//  - Requires backup/agent-live-snapshot.json (rollback). Aborts if missing.
//  - Preserves the ORIGINAL prompt object (GPT-5 LLM, temperature, built_in_tools
//    incl. transfer_to_number SIP transfer, etc.) — changes ONLY prompt.prompt,
//    prompt.tool_ids (the 13 new tools), and clears the denormalized prompt.tools.
//  - Revert any time with: node deploy/elevenlabs/revert-live-agent.mjs
//
// Usage:
//   ELEVENLABS_API_KEY=... VOICE_SERVER_URL=http://34.122.65.54:3017 \
//     node deploy/elevenlabs/update-live-agent.mjs
// ============================================

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { VOICE_SYSTEM_PROMPT } from "../../dist/voice/system-prompt.js";
import { TOOLS, buildToolConfig } from "./tools-def.mjs";

const API = "https://api.elevenlabs.io/v1";
const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_SERVER_URL = (process.env.VOICE_SERVER_URL || "http://34.122.65.54:3017").replace(/\/+$/, "");
const AGENT_ID = process.env.AGENT_ID || "agent_7301kg0z72effkvtqghs2hx58bpt";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(__dirname, "backup", "agent-live-snapshot.json");

if (!API_KEY) { console.error("Missing ELEVENLABS_API_KEY"); process.exit(1); }
if (!fs.existsSync(SNAP)) { console.error(`Missing rollback snapshot: ${SNAP}. Run the snapshot first.`); process.exit(1); }

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

async function main() {
    const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
    const origPrompt = snap.conversation_config.agent.prompt;
    console.log(`Target: ${AGENT_ID}`);
    console.log(`Preserving: llm=${origPrompt.llm}, temp=${origPrompt.temperature}, transfer_to_number=${!!(origPrompt.built_in_tools||{}).transfer_to_number}`);
    console.log(`Voice server: ${VOICE_SERVER_URL}\n`);

    // 1. Create the 13 webhook tools.
    const toolIds = [];
    for (const t of TOOLS) {
        const created = await el("/convai/tools", "POST", buildToolConfig(t, VOICE_SERVER_URL));
        const id = created.id || created.tool_id;
        toolIds.push(id);
        console.log(`  + tool ${t.name} -> ${id}`);
    }

    // 2. Build the new prompt object = original prompt with only 3 changes.
    const newPrompt = {
        ...origPrompt,
        prompt: VOICE_SYSTEM_PROMPT,
        tool_ids: toolIds,
        tools: [], // clear denormalized inline list; tool_ids + built_in_tools are authoritative
    };

    // 3. PATCH the agent (deep-merge or replace-at-prompt — full prompt object is safe either way).
    const body = { conversation_config: { agent: { prompt: newPrompt } } };
    await el(`/convai/agents/${AGENT_ID}`, "PATCH", body);

    // 4. Verify.
    const after = await el(`/convai/agents/${AGENT_ID}`, "GET");
    const ap = after.conversation_config.agent.prompt;
    console.log("\n=== AFTER UPDATE ===");
    console.log("tool_ids count:", (ap.tool_ids || []).length, "(expected 13)");
    console.log("llm preserved:", ap.llm);
    console.log("transfer_to_number preserved:", !!(ap.built_in_tools || {}).transfer_to_number);
    console.log("prompt starts:", (ap.prompt || "").slice(0, 60).replace(/\n/g, " "));
    console.log("\nDone. Test via the dashboard 'Test AI agent' widget or a call.");
    console.log("Revert anytime: node deploy/elevenlabs/revert-live-agent.mjs");
}

main().catch((e) => { console.error("\nUpdate FAILED:", e.message); console.error("Live agent NOT changed if this failed before PATCH. If after, run revert-live-agent.mjs."); process.exit(1); });
