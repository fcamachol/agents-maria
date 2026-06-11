// ============================================
// Shared ElevenLabs REST helper. Reads the API key from the ElevenLabs MCP
// server config in ~/.claude.json so scripts don't need it passed in env.
// ============================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function loadKey() {
    const file = path.join(os.homedir(), ".claude.json");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    let found = null;
    (function walk(d) {
        if (found || !d || typeof d !== "object") return;
        if (d.mcpServers && typeof d.mcpServers === "object") {
            for (const [name, cfg] of Object.entries(d.mcpServers)) {
                const env = (cfg || {}).env || {};
                if (env.ELEVENLABS_API_KEY && JSON.stringify({ name, cfg }).toLowerCase().includes("eleven")) {
                    found = env.ELEVENLABS_API_KEY;
                    return;
                }
            }
        }
        for (const v of Object.values(d)) walk(v);
    })(data);
    return found;
}

export const API = "https://api.elevenlabs.io/v1";
export const API_KEY = loadKey();
export const LIVE_AGENT_ID = process.env.AGENT_ID || "agent_7301kg0z72effkvtqghs2hx58bpt";

if (!API_KEY) { console.error("Could not load ELEVENLABS_API_KEY from ~/.claude.json"); process.exit(1); }

export async function el(p, method = "GET", body) {
    const res = await fetch(`${API}${p}`, {
        method,
        headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${t}`);
    return t ? JSON.parse(t) : {};
}
