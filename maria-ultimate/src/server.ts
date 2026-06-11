// ============================================
// Maria Ultimate - Express Server
// ============================================

import { config } from "dotenv";
config();

import express from "express";
import { runWorkflow, getAgentHealth, isPendingLectura, reloadSkills } from "./agent.js";
import {
    sendToChatwoot,
    shouldProcessWebhook,
    extractMessageContent,
    processAttachments,
    buildChatwootContext,
    getChatwootStatus
} from "./chatwoot.js";
import { verifyReciboToken, fetchReciboPdf } from "./tools.js";
import type { WorkflowInput, ChatwootWebhookPayload } from "./types.js";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || "3000");
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

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

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
        sdk: "claude-agent-sdk",
        architecture: "maria-ultimate"
    });
});

/**
 * Detailed status endpoint
 */
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

/**
 * Hot-reload skills endpoint
 */
app.post("/admin/reload-skills", (req, res) => {
    if (!ADMIN_API_KEY) {
        res.status(403).json({ error: "ADMIN_API_KEY not configured" });
        return;
    }

    const providedKey = req.body?.apiKey || req.headers["x-api-key"];
    if (providedKey !== ADMIN_API_KEY) {
        res.status(403).json({ error: "Invalid API key" });
        return;
    }

    const code = req.body?.code;
    reloadSkills(code);

    const health = getAgentHealth();
    res.json({
        success: true,
        reloaded: code || "all",
        skills: health.skills
    });
});

/**
 * Recibo PDF download endpoint
 */
app.get("/recibo/:contrato", async (req, res) => {
    const { contrato } = req.params;
    const { token, expires, factura } = req.query;

    if (!token || !expires || typeof token !== "string" || typeof expires !== "string") {
        res.status(403).json({ error: "Missing or invalid token" });
        return;
    }

    if (!verifyReciboToken(contrato, token, expires)) {
        res.status(403).json({ error: "Invalid or expired token" });
        return;
    }

    try {
        const numFactura = typeof factura === "string" ? factura : undefined;
        const pdfBuffer = await fetchReciboPdf(contrato, numFactura);

        if (!pdfBuffer) {
            res.status(404).json({ error: "No se pudo obtener el recibo. Intenta de nuevo más tarde." });
            return;
        }

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="recibo-${contrato}.pdf"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        res.send(pdfBuffer);
    } catch (error) {
        console.error(`[/recibo/${contrato}] Error:`, error);
        res.status(500).json({ error: "Error interno al generar el recibo" });
    }
});

/**
 * Main chat endpoint
 */
app.post("/api/chat", async (req, res) => {
    try {
        const { message, conversationId, metadata } = req.body;

        if (!message || typeof message !== "string") {
            res.status(400).json({
                error: "Missing or invalid 'message' field"
            });
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
            category: result.category,
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

/**
 * Webhook endpoint for n8n/WhatsApp integration
 */
app.post("/webhook", async (req, res) => {
    try {
        const body = req.body;

        let message: string | undefined;
        let conversationId: string | undefined;
        let metadata: Record<string, string> | undefined;

        if (body.message) {
            message = body.message;
            conversationId = body.conversationId || body.phone;
            metadata = {
                phone: body.phone,
                name: body.name
            };
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
            response: result.output_text,
            category: result.category
        });
    } catch (error) {
        console.error("[/webhook] Error:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Internal server error"
        });
    }
});

/**
 * Chatwoot/Agora webhook endpoint
 * Per-conversation serial queue
 */
const conversationLocks = new Map<number, Promise<void>>();

app.post("/chatwoot", async (req, res) => {
    const payload = req.body as ChatwootWebhookPayload;

    // Return 200 immediately to avoid Chatwoot timeout
    res.status(200).json({ received: true });

    // Validate webhook
    const validation = shouldProcessWebhook(payload);
    if (!validation.shouldProcess) {
        console.log(`[Chatwoot] Skipping: ${validation.reason}`);
        return;
    }

    const convId = payload.conversation?.id;

    console.log(`\n========== CHATWOOT WEBHOOK ==========`);
    console.log(`Event: ${payload.event}`);
    console.log(`Message ID: ${payload.id}`);
    console.log(`From: ${payload.sender?.name} (${payload.sender?.phone_number || "no phone"})`);
    console.log(`Conversation: ${convId}`);
    console.log(`Content: "${payload.content?.substring(0, 100) || "(empty)"}"`);

    // Per-conversation serial queue
    const previousLock = conversationLocks.get(convId) || Promise.resolve();

    const currentLock = previousLock.then(async () => {
        try {
            const context = buildChatwootContext(payload);
            console.log(`[Chatwoot] Sender info: name=${context.senderName}, email=${context.senderEmail}, phone=${context.senderPhone}`);
            const { text, attachments, hasMedia } = extractMessageContent(payload);

            let messageText = text;

            // Strip filename from content when file attachments are present
            const hasFileAttachment = attachments.some(a => a.file_type === "file");
            if (hasFileAttachment && messageText) {
                const fileExtensions = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|rtf|odt|ods)$/i;
                if (fileExtensions.test(messageText.trim())) {
                    messageText = "";
                }
            }

            // Process attachments if any
            if (hasMedia) {
                const pendingLectura = isPendingLectura(context.conversationId);
                const attachmentText = await processAttachments(attachments, pendingLectura);
                messageText = messageText
                    ? `${messageText}\n\n${attachmentText}`
                    : attachmentText;
                console.log(`[Chatwoot] Attachments: ${attachments.length}`);
            }

            // Handle empty messages
            if (!messageText.trim()) {
                console.log(`[Chatwoot] Empty message, skipping`);
                return;
            }

            // Process with Maria workflow
            const input: WorkflowInput = {
                input_as_text: messageText,
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

            // Send each message separately with a delay
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
                const context = buildChatwootContext(payload);
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
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
    const chatwootStatus = getChatwootStatus();
    const health = getAgentHealth();
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   Maria Ultimate - CEA Agent Server                        ║
║   Powered by Claude Agent SDK + Markdown Skills            ║
║                                                            ║
║   Server running on port ${String(PORT).padEnd(4)}                              ║
║                                                            ║
║   Endpoints:                                               ║
║   • GET  /health              - Health check               ║
║   • GET  /status              - Detailed status            ║
║   • GET  /recibo/:contrato    - Recibo PDF download        ║
║   • POST /api/chat            - Main chat endpoint         ║
║   • POST /webhook             - n8n/WhatsApp webhook       ║
║   • POST /chatwoot            - Chatwoot/Agora webhook     ║
║   • POST /admin/reload-skills - Hot-reload skills          ║
║                                                            ║
║   Chatwoot: ${(chatwootStatus.configured ? "Configured" : "Not configured").padEnd(15)}                        ║
║                                                            ║
║   Skills loaded:                                           ║${health.skills.map(s => `
║   • ${s.padEnd(53)}║`).join('')}
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
});

export default app;
