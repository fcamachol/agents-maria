// ============================================
// Voice channel webhook server (ElevenLabs)
//
// Separate process/port from the text (WhatsApp) server. ElevenLabs posts tool
// calls to /webhook/:toolName with params in the body; we reply { message }.
// Tools share v2.1 `core/*` + the Redis session hub, so voice and WhatsApp see
// the same customer state.
// ============================================

import { config } from "dotenv";
config();

import crypto from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { executeVoiceTool } from "./tools.js";
import { VOICE_CONFIG } from "./config.js";
import { buildGreeting, firstName, GENERIC_GREETING } from "./greeting.js";
import { searchContactByPhoneCore } from "../core/identity.js";
import { shouldWriteName, updateAgoraContactName } from "../core/contact.js";
import { normalizePhone, recordEvent, setContactId } from "../session/index.js";

const app = express();
const PORT = VOICE_CONFIG.webhookPort;

// Keep the raw body so the post-call route can verify ElevenLabs' HMAC signature.
app.use(express.json({
    verify: (req, _res, buf) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; },
}));

app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[voice ${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

function authenticateWebhook(req: Request, res: Response, next: NextFunction) {
    const secret = VOICE_CONFIG.webhookSecret;
    if (!secret) { next(); return; }
    const provided = req.headers["x-elevenlabs-secret"] || req.query.secret;
    if (provided !== secret) {
        console.warn("[voice/auth] Invalid webhook secret");
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    next();
}

app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "healthy", service: "maria-voice", agentId: VOICE_CONFIG.agentId, timestamp: new Date().toISOString() });
});

app.get("/", (_req: Request, res: Response) => {
    res.json({ service: "maria-voice", description: "Voice channel for Maria CEA (shares core + session hub)" });
});

// ElevenLabs per-tool webhook: params arrive directly in the body.
app.post("/webhook/:toolName", authenticateWebhook, async (req: Request, res: Response) => {
    const toolName = String(req.params.toolName);
    const params = (req.body ?? {}) as Record<string, unknown>;
    console.log(`[voice/${toolName}] params:`, JSON.stringify(params));
    try {
        const result = await executeVoiceTool(toolName, params);
        console.log(`[voice/${toolName}] ->`, result.response);
        // Return `message` (the spoken reply). Include action/metadata for agents
        // configured to read them (e.g. SIP transfer); harmless otherwise.
        res.status(200).json({ message: result.response, action: result.action, metadata: result.metadata });
    } catch (error) {
        console.error(`[voice/${toolName}] Error:`, error);
        res.status(200).json({ message: "Disculpa, tuve un problema técnico. ¿Puedes repetirlo?" });
    }
});

// ============================================
// Conversation-initiation webhook (use a known caller's name)
//
// On an inbound call, ElevenLabs POSTs the caller_id here BEFORE the greeting.
// We look up the AGORA contact by phone and return dynamic variables; the agent's
// first_message is "{{greeting}}". Always return the full placeholder set — a
// missing declared variable fails the call. Falls back to the generic greeting
// on any lookup miss/error.
// ============================================
app.post("/el/conversation-init", authenticateWebhook, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const callerRaw = String(body.caller_id ?? body.from_number ?? body.system__caller_id ?? "");
    console.log(`[voice/init] caller_id=${callerRaw}`);

    let known = false;
    let name = "";
    try {
        const phone = normalizePhone(callerRaw);
        if (phone) {
            const contact = await searchContactByPhoneCore(phone);
            const fn = firstName(contact.found ? contact.name : "");
            if (fn) { known = true; name = fn; }
        }
    } catch (error) {
        console.error("[voice/init] lookup error:", error);
    }

    const greeting = known ? buildGreeting(name) : GENERIC_GREETING;
    res.status(200).json({
        type: "conversation_initiation_client_data",
        dynamic_variables: {
            system__caller_id: callerRaw,
            contact_known: known,
            contact_name: name,
            greeting,
        },
    });
});

// ============================================
// Post-call webhook (persist the collected name to AGORA)
//
// ElevenLabs delivers the transcript + data_collection results after the call.
// We verify the HMAC signature, read `nombre_contacto`, and write it to the
// AGORA contact ONLY when the overwrite policy allows (shouldWriteName).
// ============================================
function verifyConvaiSignature(req: Request): boolean {
    const secret = VOICE_CONFIG.convaiWebhookSecret;
    if (!secret) return true; // no secret configured -> skip (dev)
    const header = String(req.headers["elevenlabs-signature"] || "");
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!header || !raw) return false;
    // Header format: "t=<unix_ts>,v0=<hex hmac>"
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=").map((s) => s.trim())));
    const ts = parts["t"];
    const sig = parts["v0"];
    if (!ts || !sig) return false;
    const expected = crypto.createHmac("sha256", secret).update(`${ts}.${raw.toString("utf8")}`).digest("hex");
    try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
        return false;
    }
}

app.post("/el/post-call", async (req: Request, res: Response) => {
    // Always ack fast; EL retries on non-2xx. Do the work, but never 500 to EL.
    try {
        if (!verifyConvaiSignature(req)) {
            console.warn("[voice/post-call] Invalid signature");
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        res.status(200).json({ received: true });

        const body = (req.body ?? {}) as Record<string, unknown>;
        if (body.type !== "post_call_transcription") return;
        const data = (body.data ?? {}) as Record<string, unknown>;

        if (data.agent_id && data.agent_id !== VOICE_CONFIG.agentId) return;

        const dcr = ((data.analysis as Record<string, unknown> | undefined)?.data_collection_results
            ?? {}) as Record<string, { value?: unknown } | undefined>;
        const name = String(dcr.nombre_contacto?.value ?? "").trim();
        if (!name) return;

        const initData = (data.conversation_initiation_client_data ?? {}) as Record<string, unknown>;
        const dynVars = (initData.dynamic_variables ?? {}) as Record<string, unknown>;
        const callerRaw = String(dynVars.system__caller_id ?? "");
        const phone = normalizePhone(callerRaw);
        if (!phone) { console.warn("[voice/post-call] no caller phone, skipping"); return; }

        const contact = await searchContactByPhoneCore(phone);
        if (!contact.found || !contact.id) { console.log("[voice/post-call] contact not found, skipping"); return; }

        if (!shouldWriteName(contact.name, name)) {
            console.log(`[voice/post-call] keep existing name "${contact.name}" (not overwriting with "${name}")`);
            return;
        }

        const result = await updateAgoraContactName(contact.id, name);
        if (result.success) {
            await setContactId(phone, contact.id);
            await recordEvent(phone, {
                channel: "voice",
                type: "contact_name_collected",
                payload: { name, contactId: contact.id },
                ts: Date.now(),
            });
        }
    } catch (error) {
        console.error("[voice/post-call] Error:", error);
        // response already sent (200); nothing else to do.
    }
});

app.use((_req: Request, res: Response) => { res.status(404).json({ error: "Not found" }); });

app.listen(PORT, () => {
    console.log(`[voice] Maria voice channel listening on :${PORT} (agent ${VOICE_CONFIG.agentId})`);
});

export default app;
