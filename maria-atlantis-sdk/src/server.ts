// ============================================
// Maria Atlantis SDK - Express Server
// ============================================

import { config } from "dotenv";
config();

import express from "express";
import { runWorkflow, getAgentHealth, isPendingLectura } from "./agent.js";
import {
    sendToChatwoot,
    shouldProcessWebhook,
    extractMessageContent,
    processAttachments,
    buildChatwootContext,
    getChatwootStatus
} from "./chatwoot.js";
import type { WorkflowInput, ChatwootWebhookPayload, ChatwootAttachment } from "./types.js";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || "3000");

// ============================================
// Middleware
// ============================================

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ============================================
// Routes
// ============================================

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        sdk: "claude-agent-sdk"
    });
});

app.get("/status", (req, res) => {
    const health = getAgentHealth();
    const chatwoot = getChatwootStatus();
    res.json({
        ...health,
        chatwoot,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.post("/api/chat", async (req, res) => {
    try {
        const { message, conversationId, metadata } = req.body;

        if (!message || typeof message !== "string") {
            res.status(400).json({ error: "Missing or invalid 'message' field" });
            return;
        }

        const sessionId = conversationId || crypto.randomUUID();

        const input: WorkflowInput = {
            input_as_text: message,
            conversationId: sessionId,
            metadata
        };

        const result = await runWorkflow(input);

        res.json({
            success: true,
            response: result.output_text,
            toolsUsed: result.toolsUsed,
            conversationId: sessionId
        });
    } catch (error) {
        console.error("[/api/chat] Error:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Internal server error"
        });
    }
});

app.post("/webhook", async (req, res) => {
    try {
        const body = req.body;

        let message: string | undefined;
        let conversationId: string | undefined;
        let metadata: Record<string, string> | undefined;

        if (body.message) {
            message = body.message;
            conversationId = body.conversationId || body.phone;
            metadata = { phone: body.phone, name: body.name };
        } else if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
            const waMessage = body.entry[0].changes[0].value.messages[0];
            message = waMessage.text?.body;
            conversationId = waMessage.from;
            metadata = { phone: waMessage.from };
        } else if (body.text) {
            message = body.text;
            conversationId = body.from || body.sender;
        }

        if (!message) {
            res.status(400).json({ error: "No message found in request" });
            return;
        }

        const input: WorkflowInput = {
            input_as_text: message,
            conversationId,
            metadata
        };

        const result = await runWorkflow(input);

        res.json({
            success: true,
            response: result.output_text
        });
    } catch (error) {
        console.error("[/webhook] Error:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Internal server error"
        });
    }
});

// ============================================
// Chatwoot Webhook (per-conversation serial queue + message debounce)
// ============================================

const conversationLocks = new Map<number, Promise<void>>();

// Debounce: buffer rapid messages per conversation
const DEBOUNCE_MS = 3000;

interface BufferedMessage {
    text: string;
    payload: ChatwootWebhookPayload;
    attachments: ChatwootAttachment[];
    hasMedia: boolean;
}

interface MessageBuffer {
    messages: BufferedMessage[];
    timer: NodeJS.Timeout;
    context: ReturnType<typeof buildChatwootContext>;
}

const messageBuffers = new Map<number, MessageBuffer>();

async function flushBuffer(convId: number): Promise<void> {
    const buffer = messageBuffers.get(convId);
    if (!buffer) return;
    messageBuffers.delete(convId);

    const { messages, context } = buffer;
    console.log(`\n========== CHATWOOT FLUSH (${messages.length} message(s)) ==========`);
    console.log(`Conversation: ${convId}`);

    // Re-check conversation status at flush time (human agent may have taken over)
    const lastPayload = messages[messages.length - 1].payload;
    if (lastPayload.conversation?.status === "open") {
        console.log(`[Chatwoot] Conversation became "open" during buffer window, skipping`);
        return;
    }

    const previousLock = conversationLocks.get(convId) || Promise.resolve();

    const currentLock = previousLock.then(async () => {
        try {
            // Process each buffered message: handle media + strip filenames
            const parts: string[] = [];

            for (const msg of messages) {
                let messageText = msg.text;

                // Strip filename from content when file attachments are present
                const hasFileAttachment = msg.attachments.some(a => a.file_type === "file");
                if (hasFileAttachment && messageText) {
                    const fileExtensions = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|rtf|odt|ods)$/i;
                    if (fileExtensions.test(messageText.trim())) {
                        messageText = "";
                    }
                }

                if (msg.hasMedia) {
                    const pendingLectura = isPendingLectura(context.conversationId);
                    const attachmentText = await processAttachments(msg.attachments, pendingLectura);
                    messageText = messageText
                        ? `${messageText}\n\n${attachmentText}`
                        : attachmentText;
                }

                if (messageText.trim()) {
                    parts.push(messageText.trim());
                }
            }

            const combinedText = parts.join("\n");

            if (!combinedText.trim()) {
                console.log(`[Chatwoot] All buffered messages empty, skipping`);
                return;
            }

            console.log(`[Chatwoot] Combined text: "${combinedText.substring(0, 150)}"`);

            const input: WorkflowInput = {
                input_as_text: combinedText,
                conversationId: context.conversationId,
                metadata: {
                    name: context.senderName,
                    phone: context.senderPhone,
                    email: context.senderEmail,
                    custom_attributes: context.customAttributes
                },
                chatwootAccountId: context.accountId,
                chatwootConversationId: context.chatwootConversationId
            };

            console.log(`[Chatwoot] Processing with Maria...`);
            const result = await runWorkflow(input);

            console.log(`[Chatwoot] Sending ${result.output_messages.length} message(s) back...`);
            for (let i = 0; i < result.output_messages.length; i++) {
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
                const sendResult = await sendToChatwoot(
                    context.accountId,
                    context.chatwootConversationId,
                    result.output_messages[i]
                );
                if (sendResult.success) {
                    console.log(`[Chatwoot] Message ${i + 1}/${result.output_messages.length} sent`);
                } else {
                    console.error(`[Chatwoot] Failed to send message ${i + 1}: ${sendResult.error}`);
                }
            }

            console.log(`========== CHATWOOT COMPLETE ==========\n`);

        } catch (error) {
            console.error("[Chatwoot] Processing error:", error);
            try {
                await sendToChatwoot(
                    context.accountId,
                    context.chatwootConversationId,
                    "Lo siento, tuve un problema procesando tu mensaje. Por favor intenta de nuevo en unos momentos."
                );
            } catch (sendError) {
                console.error("[Chatwoot] Failed to send error message:", sendError);
            }
        }
    }).catch(err => {
        console.error(`[Queue] Error for conversation ${convId}:`, err);
    });

    conversationLocks.set(convId, currentLock);

    currentLock.finally(() => {
        if (conversationLocks.get(convId) === currentLock) {
            conversationLocks.delete(convId);
        }
    });
}

app.post(["/agora", "/chatwoot"], async (req, res) => {
    const payload = req.body as ChatwootWebhookPayload;

    res.status(200).json({ received: true });

    const validation = shouldProcessWebhook(payload);
    if (!validation.shouldProcess) {
        console.log(`[Chatwoot] Skipping: ${validation.reason}`);
        return;
    }

    const convId = payload.conversation?.id;
    if (!convId) {
        console.warn("[Chatwoot] No conversation ID, skipping");
        return;
    }

    console.log(`[Chatwoot] Received message for conv ${convId}: "${payload.content?.substring(0, 80) || "(empty)"}"`);

    const { text, attachments, hasMedia } = extractMessageContent(payload);

    const existing = messageBuffers.get(convId);
    if (existing) {
        clearTimeout(existing.timer);
        existing.messages.push({ text, payload, attachments, hasMedia });
        existing.timer = setTimeout(() => flushBuffer(convId), DEBOUNCE_MS);
        console.log(`[Chatwoot] Buffered message ${existing.messages.length} for conv ${convId}`);
    } else {
        const context = buildChatwootContext(payload);
        messageBuffers.set(convId, {
            messages: [{ text, payload, attachments, hasMedia }],
            timer: setTimeout(() => flushBuffer(convId), DEBOUNCE_MS),
            context
        });
        console.log(`[Chatwoot] Buffered first message for conv ${convId}`);
    }
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
    const chatwootStatus = getChatwootStatus();
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   Maria Atlantis SDK - Agent Server                         ║
║   Powered by Claude Agent SDK                              ║
║                                                            ║
║   Server running on port ${PORT}                              ║
║                                                            ║
║   Endpoints:                                               ║
║   • GET  /health          - Health check                   ║
║   • GET  /status          - Detailed status                ║
║   • POST /api/chat        - Main chat endpoint             ║
║   • POST /webhook         - n8n/WhatsApp webhook           ║
║   • POST /agora           - AGORA direct webhook           ║
║   • POST /chatwoot        - alias of /agora (legacy)       ║
║                                                            ║
║   Chatwoot: ${chatwootStatus.configured ? "Configured" : "Not configured"}                                 ║
║                                                            ║
║   Categories: INF, FAC, TRA, REP, SRV (direct DB codes)   ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
});

export default app;
