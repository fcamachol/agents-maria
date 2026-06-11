// ============================================
// Maria CEA - Express Server
// ============================================

import { config } from "dotenv";
config();

import express from "express";
import { runWorkflow, getAgentHealth } from "./agent.js";
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
import { logger } from "./utils/logger.js";
import { apiRateLimiter, createRateLimitMiddleware } from "./utils/ratelimit.js";
import { metrics } from "./utils/metrics.js";
import { getCache } from "./utils/cache.js";
import { getMemoryStore } from "./utils/memory.js";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || "3000");

// ============================================
// Middleware
// ============================================

app.use((req, _res, next) => {
    logger.info({ method: req.method, path: req.path }, "Request received");
    next();
});

// Rate limiting on API endpoints
app.use("/api", createRateLimitMiddleware(apiRateLimiter));
app.use("/webhook", createRateLimitMiddleware(apiRateLimiter));

// ============================================
// Routes
// ============================================

/**
 * Health check endpoint
 */
app.get("/health", (_req, res) => {
    const healthStatus = metrics.getHealthStatus();
    res.json({
        status: healthStatus.status,
        checks: healthStatus.checks,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        sdk: "claude-agent-sdk"
    });
});

/**
 * Detailed status endpoint
 */
app.get("/status", (_req, res) => {
    const health = getAgentHealth();
    const chatwoot = getChatwootStatus();
    const cache = getCache();
    const memory = getMemoryStore();
    res.json({
        ...health,
        chatwoot,
        cache: cache.getStats(),
        memory: memory.getStats(),
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

/**
 * Prometheus metrics endpoint
 */
app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send(metrics.getPrometheusMetrics());
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
        logger.error({ error, contrato }, "Error fetching recibo PDF");
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
        logger.error({ error }, "/api/chat processing error");
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
        logger.error({ error }, "/webhook processing error");
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
        logger.info({ reason: validation.reason }, "Chatwoot webhook skipped");
        return;
    }

    logger.info({
        event: payload.event,
        messageId: payload.id,
        sender: payload.sender?.name,
        phone: payload.sender?.phone_number,
        conversationId: payload.conversation?.id,
        content: payload.content?.substring(0, 100)
    }, "Chatwoot webhook received");

    try {
        // Extract context
        const context = buildChatwootContext(payload);
        logger.info({ senderName: context.senderName, senderEmail: context.senderEmail, senderPhone: context.senderPhone }, "Chatwoot sender info");
        const { text, attachments, hasMedia } = extractMessageContent(payload);

        // Build message text
        let messageText = text;

        // Process attachments if any
        if (hasMedia) {
            const attachmentText = await processAttachments(attachments);
            messageText = messageText
                ? `${messageText}\n\n${attachmentText}`
                : attachmentText;
            logger.info({ count: attachments.length }, "Chatwoot attachments processed");
        }

        // Handle empty messages
        if (!messageText.trim()) {
            logger.info("Chatwoot empty message, skipping");
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

        logger.info("Chatwoot processing with Maria...");
        const result = await runWorkflow(input);

        // Send each message separately with a delay to look human
        logger.info({ count: result.output_messages.length }, "Chatwoot sending messages back");
        for (let i = 0; i < result.output_messages.length; i++) {
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            const sendResult = await sendToChatwoot(
                context.accountId,
                context.chatwootConversationId,
                result.output_messages[i] || ""
            );
            if (sendResult.success) {
                logger.info({ messageNum: i + 1, total: result.output_messages.length }, "Chatwoot message sent");
            } else {
                logger.error({ messageNum: i + 1, error: sendResult.error }, "Chatwoot failed to send message");
            }
        }

        logger.info("Chatwoot webhook processing complete");

    } catch (error) {
        logger.error({ error }, "Chatwoot processing error");

        // Try to send error message to user
        try {
            const context = buildChatwootContext(payload);
            await sendToChatwoot(
                context.accountId,
                context.chatwootConversationId,
                "Lo siento, tuve un problema procesando tu mensaje. Por favor intenta de nuevo en unos momentos."
            );
        } catch (sendError) {
            logger.error({ error: sendError }, "Chatwoot failed to send error message");
        }
    }
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
    const chatwootStatus = getChatwootStatus();
    logger.info(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   Maria CEA - Agent Server                                 ║
║   Powered by Claude Agent SDK                              ║
║                                                            ║
║   Server running on port ${PORT}                              ║
║                                                            ║
║   Endpoints:                                               ║
║   • GET  /health          - Health check                   ║
║   • GET  /status          - Detailed status                ║
║   • GET  /metrics         - Prometheus metrics             ║
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
    logger.info({ port: PORT }, "Maria CEA server started");
});

export default app;
