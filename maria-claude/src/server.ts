// ============================================
// Maria Claude - Express Server
// ============================================

import { config } from "dotenv";
config();

import express from "express";
import { runWorkflow, getAgentHealth, isLecturaContext } from "./agent.js";
import { setLecturaAttachmentId } from "./lectura-store.js";
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
        version: "1.0.0",
        sdk: "claude-agent-sdk"
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
 * Recibo PDF download endpoint
 * Serves the receipt PDF fetched on-demand from the SOAP API
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

        // Generate or use existing conversationId
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

        // Extract message from various webhook formats
        let message: string | undefined;
        let conversationId: string | undefined;
        let metadata: Record<string, string> | undefined;

        // n8n format
        if (body.message) {
            message = body.message;
            conversationId = body.conversationId || body.phone;
            metadata = {
                phone: body.phone,
                name: body.name
            };
        }
        // WhatsApp Cloud API format
        else if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
            const waMessage = body.entry[0].changes[0].value.messages[0];
            message = waMessage.text?.body;
            conversationId = waMessage.from;
            metadata = { phone: waMessage.from };
        }
        // Generic format
        else if (body.text) {
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
 * Direct integration without n8n
 */
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

    console.log(`\n========== CHATWOOT WEBHOOK ==========`);
    console.log(`Event: ${payload.event}`);
    console.log(`Message ID: ${payload.id}`);
    console.log(`From: ${payload.sender?.name} (${payload.sender?.phone_number || "no phone"})`);
    console.log(`Conversation: ${payload.conversation?.id}`);
    console.log(`Content: "${payload.content?.substring(0, 100) || "(empty)"}"`);

    try {
        // Extract context
        const context = buildChatwootContext(payload);
        console.log(`[Chatwoot] Sender info: name=${context.senderName}, email=${context.senderEmail}, phone=${context.senderPhone}`);
        const { text, attachments, hasMedia } = extractMessageContent(payload);

        // Build message text
        let messageText = text;

        // Process attachments if any
        if (hasMedia) {
            const pendingLectura = isLecturaContext(context.conversationId, text);
            const attachmentText = await processAttachments(attachments, pendingLectura);
            messageText = messageText
                ? `${messageText}\n\n${attachmentText}`
                : attachmentText;
            console.log(`[Chatwoot] Attachments: ${attachments.length}`);

            // Capture Chatwoot attachment ID for linking to lectura ticket
            if (pendingLectura) {
                const imageAttachment = attachments.find(a => a.file_type === 'image');
                if (imageAttachment) {
                    setLecturaAttachmentId(context.conversationId, imageAttachment.id);
                }
            }
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
            // Pass Chatwoot context for handoff
            chatwootAccountId: context.accountId,
            chatwootConversationId: context.chatwootConversationId
        };

        console.log(`[Chatwoot] Processing with Maria...`);
        const result = await runWorkflow(input);

        // Send each message separately with a delay to look human
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

        // Try to send error message to user
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
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
    const chatwootStatus = getChatwootStatus();
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   Maria Claude - CEA Agent Server                          ║
║   Powered by Claude Agent SDK                              ║
║                                                            ║
║   Server running on port ${PORT}                              ║
║                                                            ║
║   Endpoints:                                               ║
║   • GET  /health          - Health check                   ║
║   • GET  /status          - Detailed status                ║
║   • GET  /recibo/:contrato - Recibo PDF download           ║
║   • POST /api/chat        - Main chat endpoint             ║
║   • POST /webhook         - n8n/WhatsApp webhook           ║
║   • POST /chatwoot        - Chatwoot/Agora direct webhook  ║
║                                                            ║
║   Chatwoot: ${chatwootStatus.configured ? "Configured" : "Not configured"}                                 ║
║                                                            ║
║   Skills loaded:                                           ║
║   • CON - Consultas                                        ║
║   • FAC - Facturacion                                      ║
║   • CTR - Contratos                                        ║
║   • CVN - Convenios                                        ║
║   • REP - Reportes de Servicio                             ║
║   • SRV - Servicios Tecnicos                               ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
});

export default app;
