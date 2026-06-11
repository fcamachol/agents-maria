#!/usr/bin/env node
// ============================================
// REVERT the live "Maria CEA" agent to the snapshot taken before the update.
// Restores the original prompt object (prompt text, tool_ids, tools, llm,
// built_in_tools, etc.) exactly as captured in backup/agent-live-snapshot.json.
//
// Usage:
//   ELEVENLABS_API_KEY=... node deploy/elevenlabs/revert-live-agent.mjs
// ============================================

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API = "https://api.elevenlabs.io/v1";
const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.AGENT_ID || "agent_7301kg0z72effkvtqghs2hx58bpt";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(__dirname, "backup", "agent-live-snapshot.json");

if (!API_KEY) { console.error("Missing ELEVENLABS_API_KEY"); process.exit(1); }
if (!fs.existsSync(SNAP)) { console.error(`Missing snapshot: ${SNAP}`); process.exit(1); }

async function el(p, method, body) {
    const res = await fetch(`${API}${p}`, {
        method, headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text}`);
    return text ? JSON.parse(text) : {};
}

async function main() {
    const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
    const origPrompt = snap.conversation_config.agent.prompt;
    await el(`/convai/agents/${AGENT_ID}`, "PATCH", { conversation_config: { agent: { prompt: origPrompt } } });
    const after = await el(`/convai/agents/${AGENT_ID}`, "GET");
    const ap = after.conversation_config.agent.prompt;
    console.log("Reverted. tool_ids count:", (ap.tool_ids || []).length, "| llm:", ap.llm);
}

main().catch((e) => { console.error("Revert FAILED:", e.message); process.exit(1); });
