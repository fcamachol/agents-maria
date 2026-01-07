// ============================================
// CEA Agent Server - Production Ready v2.0
// ============================================

import express, { Request, Response, NextFunction } from "express";
import { config } from "dotenv";
import { runWorkflow, getAgentHealth } from "./agent.js";
import type { ChatRequest, ChatResponse, ChatwootWebhookPayload, ChatwootContext } from "./types.js";

// Load environment variables
config();

// ============================================
// Configuration
// ============================================

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Chatwoot configuration
const CHATWOOT_API_URL = process.env.CHATWOOT_API_URL || "http://whisper-api_agora:3000";
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || "";

// Validate required env vars
const requiredEnvVars = ["OPENAI_API_KEY"];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`❌ Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

// ============================================
// Express App Setup
// ============================================

const app = express();

// Middleware
app.use(express.json({ limit: "10mb" }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = crypto.randomUUID().substring(0, 8);
    (req as any).requestId = requestId;
    (req as any).startTime = Date.now();
    
    console.log(`→ [${requestId}] ${req.method} ${req.path}`);
    
    // Log response when finished
    res.on("finish", () => {
        const duration = Date.now() - (req as any).startTime;
        console.log(`← [${requestId}] ${res.statusCode} (${duration}ms)`);
    });
    
    next();
});

// CORS headers for web clients
app.use((req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    
    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }
    next();
});

// ============================================
// Health & Status Endpoints
// ============================================

// Basic health check (for load balancers)
app.get("/health", (req: Request, res: Response) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Detailed status (for monitoring)
app.get("/status", (req: Request, res: Response) => {
    const agentHealth = getAgentHealth();
    
    res.json({
        status: "ok",
        version: "2.0.0",
        environment: NODE_ENV,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        memory: {
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        },
        agents: agentHealth
    });
});

// ============================================
// Main Chat Handler
// ============================================

async function handleChat(req: Request, res: Response): Promise<void> {
    const requestId = (req as any).requestId || crypto.randomUUID().substring(0, 8);
    
    try {
        // Extract request data
        let { message, conversationId, metadata } = req.body as ChatRequest;

        // Sanitize message input - handle arrays or stringified arrays
        if (Array.isArray(message)) {
            message = message[0] || "";
        } else if (typeof message === "string" && message.startsWith("[") && message.endsWith("]")) {
            try {
                const parsed = JSON.parse(message);
                if (Array.isArray(parsed)) {
                    message = parsed[0] || "";
                }
            } catch {
                // If JSON parse fails, use as-is
            }
        }

        // Validate request
        if (!message || typeof message !== "string") {
            res.status(400).json({
                error: "Missing or invalid 'message' field",
                response: "",
                conversationId: conversationId || crypto.randomUUID()
            } as ChatResponse);
            return;
        }
        
        if (message.length > 10000) {
            res.status(400).json({
                error: "Message too long (max 10000 characters)",
                response: "",
                conversationId: conversationId || crypto.randomUUID()
            } as ChatResponse);
            return;
        }
        
        console.log(`[${requestId}] Processing: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
        
        // Run the agent workflow
        const result = await runWorkflow({
            input_as_text: message,
            conversationId: conversationId,
            metadata: metadata
        });
        
        // Build response
        const response: ChatResponse = {
            response: result.output_text || "Lo siento, no pude procesar tu mensaje.",
            classification: result.classification,
            conversationId: conversationId || crypto.randomUUID(),
            metadata: {
                toolsUsed: result.toolsUsed,
                processingTimeMs: Date.now() - (req as any).startTime
            }
        };
        
        // Include ticket folio if created
        if (result.ticketFolio) {
            response.ticketFolio = result.ticketFolio;
        }
        
        console.log(`[${requestId}] Classification: ${result.classification}`);
        console.log(`[${requestId}] Response length: ${response.response.length} chars`);
        
        res.json(response);
        
    } catch (error) {
        console.error(`[${requestId}] Error:`, error);
        
        const errorMessage = error instanceof Error ? error.message : "Internal server error";
        
        res.status(500).json({
            error: NODE_ENV === "development" ? errorMessage : "Internal server error",
            response: "Lo siento, hubo un error procesando tu mensaje. Por favor intenta de nuevo.",
            conversationId: (req.body as ChatRequest)?.conversationId || crypto.randomUUID()
        } as ChatResponse);
    }
}

// ============================================
// Chatwoot API Client
// ============================================

async function sendChatwootMessage(
    accountId: number,
    conversationId: number,
    message: string
): Promise<boolean> {
    if (!CHATWOOT_API_TOKEN) {
        console.error("[Chatwoot] API token not configured");
        return false;
    }

    try {
        const url = `${CHATWOOT_API_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "api_access_token": CHATWOOT_API_TOKEN
            },
            body: JSON.stringify({
                content: message,
                message_type: "outgoing",
                private: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Chatwoot] Failed to send message: ${response.status} - ${errorText}`);
            return false;
        }

        console.log(`[Chatwoot] Message sent to conversation ${conversationId}`);
        return true;
    } catch (error) {
        console.error("[Chatwoot] Error sending message:", error);
        return false;
    }
}

// ============================================
// Chatwoot Webhook Handler
// ============================================

async function handleChatwootWebhook(req: Request, res: Response): Promise<void> {
    const requestId = (req as any).requestId || crypto.randomUUID().substring(0, 8);

    try {
        const payload = req.body as ChatwootWebhookPayload;

        // Only process incoming messages (from customers)
        if (payload.message_type !== "incoming") {
            console.log(`[${requestId}] Ignoring ${payload.message_type} message`);
            res.status(200).json({ status: "ignored", reason: "not incoming message" });
            return;
        }

        // Only process message_created events
        if (payload.event !== "message_created") {
            console.log(`[${requestId}] Ignoring event: ${payload.event}`);
            res.status(200).json({ status: "ignored", reason: "not message_created event" });
            return;
        }

        // Ignore private messages
        if (payload.private) {
            console.log(`[${requestId}] Ignoring private message`);
            res.status(200).json({ status: "ignored", reason: "private message" });
            return;
        }

        const message = payload.content;
        if (!message || typeof message !== "string" || message.trim() === "") {
            console.log(`[${requestId}] Ignoring empty message`);
            res.status(200).json({ status: "ignored", reason: "empty message" });
            return;
        }

        // Extract Chatwoot context
        const chatwootContext: ChatwootContext = {
            contact_id: payload.conversation.contact_inbox.contact_id,
            conversation_id: payload.conversation.id,
            inbox_id: payload.inbox.id,
            sender_name: payload.sender.name || "Cliente",
            phone_number: payload.sender.phone_number,
            account_id: payload.account.id
        };

        console.log(`[${requestId}] Processing Chatwoot message from ${chatwootContext.sender_name} (contact: ${chatwootContext.contact_id})`);
        console.log(`[${requestId}] Message: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);

        // Respond immediately to Chatwoot (webhook acknowledgement)
        res.status(200).json({ status: "processing" });

        // Run the agent workflow with Chatwoot context
        const result = await runWorkflow({
            input_as_text: message,
            conversationId: String(chatwootContext.conversation_id),
            chatwootContext: chatwootContext
        });

        const responseText = result.output_text || "Lo siento, no pude procesar tu mensaje.";

        // Send the response back to Chatwoot
        const sent = await sendChatwootMessage(
            chatwootContext.account_id,
            chatwootContext.conversation_id,
            responseText
        );

        if (sent) {
            console.log(`[${requestId}] Response sent to Chatwoot`);
        } else {
            console.error(`[${requestId}] Failed to send response to Chatwoot`);
        }

    } catch (error) {
        console.error(`[${requestId}] Chatwoot webhook error:`, error);

        // Still return 200 to prevent Chatwoot from retrying
        if (!res.headersSent) {
            res.status(200).json({ status: "error", message: "Internal processing error" });
        }
    }
}

// ============================================
// API Routes
// ============================================

// Chatwoot direct webhook (new - bypasses n8n)
app.post("/webhook/chatwoot", handleChatwootWebhook);

// Main chat endpoint
app.post("/api/chat", handleChat);

// Webhook alias (for n8n integration)
app.post("/webhook", handleChat);

// Legacy endpoint support
app.post("/chat", handleChat);

// ============================================
// Error Handling
// ============================================

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({
        error: "Not found",
        message: `Route ${req.method} ${req.path} not found`,
        availableEndpoints: [
            "GET /health - Health check",
            "GET /status - Detailed status",
            "POST /api/chat - Main chat endpoint",
            "POST /webhook - Webhook endpoint (n8n)",
            "POST /webhook/chatwoot - Direct Chatwoot webhook"
        ]
    });
});

// Global error handler
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled error:", error);
    
    res.status(500).json({
        error: NODE_ENV === "development" ? error.message : "Internal server error",
        response: "Lo siento, ocurrió un error inesperado.",
        conversationId: crypto.randomUUID()
    });
});

// ============================================
// Server Startup
// ============================================

const server = app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║                CEA Agent Server v2.1                   ║
╠════════════════════════════════════════════════════════╣
║  Running on port ${PORT}                                  ║
║  Health: http://localhost:${PORT}/health                  ║
║  Status: http://localhost:${PORT}/status                  ║
║  Chat:   http://localhost:${PORT}/api/chat                ║
║  Webhook (n8n): http://localhost:${PORT}/webhook          ║
║  Webhook (Chatwoot): http://localhost:${PORT}/webhook/chatwoot
╠════════════════════════════════════════════════════════╣
║  Environment: ${NODE_ENV.padEnd(39)}║
║  Chatwoot API: ${CHATWOOT_API_TOKEN ? "configured" : "NOT configured"}
╚════════════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on("SIGTERM", () => {
    console.log("\n🛑 SIGTERM received, shutting down gracefully...");
    server.close(() => {
        console.log("✅ Server closed");
        process.exit(0);
    });
});

process.on("SIGINT", () => {
    console.log("\n🛑 SIGINT received, shutting down gracefully...");
    server.close(() => {
        console.log("✅ Server closed");
        process.exit(0);
    });
});

export default app;