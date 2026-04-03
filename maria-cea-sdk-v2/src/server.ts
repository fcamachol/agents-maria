// ============================================
// CEA Agent Server - v2 Redesign
// ============================================

import express, { type Request, type Response, type NextFunction } from "express";
import { cfg } from "./config/index.js";
import { ChatRequestSchema, type ChatResponse } from "./config/types.js";
import { runWorkflow, getAgentHealth } from "./agents/workflow.js";
import { checkDatabaseHealth, shutdownDatabase } from "./services/database.js";
import { conversationStore } from "./services/conversation-store.js";
import { authMiddleware } from "./middleware/auth.js";
import { chatRateLimiter } from "./middleware/rate-limit.js";
import { logger } from "./utils/logger.js";

const app = express();

// ============================================
// Middleware
// ============================================

app.use(express.json({ limit: cfg.MAX_PAYLOAD_SIZE }));

// CORS — whitelist only configured origins
app.use((_req: Request, res: Response, next: NextFunction) => {
    const allowedOrigins = cfg.ALLOWED_ORIGINS ? cfg.ALLOWED_ORIGINS.split(",").map((o) => o.trim()) : [];
    const origin = _req.headers.origin || "";

    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin || "*");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (_req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
});

// Request logging with structured output
app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = crypto.randomUUID().substring(0, 8);
    (req as Record<string, unknown>).requestId = requestId;
    (req as Record<string, unknown>).startTime = Date.now();

    logger.info({ requestId, method: req.method, path: req.path }, "Request");

    res.on("finish", () => {
        const duration = Date.now() - ((req as Record<string, unknown>).startTime as number);
        logger.info({ requestId, status: res.statusCode, duration }, "Response");
    });

    next();
});

// ============================================
// Routes
// ============================================

// Health check — probes database
app.get("/health", async (_req: Request, res: Response) => {
    const dbHealthy = await checkDatabaseHealth();
    const status = dbHealthy ? "healthy" : "degraded";
    const code = dbHealthy ? 200 : 503;

    res.status(code).json({
        status,
        timestamp: new Date().toISOString(),
        database: dbHealthy ? "connected" : "unreachable",
    });
});

// Detailed status
app.get("/status", (_req: Request, res: Response) => {
    const health = getAgentHealth();
    res.json({
        ...health,
        version: "2.0.0",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: cfg.NODE_ENV,
    });
});

// Main chat endpoint — authenticated + rate-limited
app.post("/api/chat", authMiddleware, chatRateLimiter, async (req: Request, res: Response) => {
    const requestId = (req as Record<string, unknown>).requestId as string;

    // Validate input with Zod
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        logger.warn({ requestId, errors }, "Invalid request");
        res.status(400).json({ error: "Invalid request", details: errors });
        return;
    }

    const { message, conversationId, contactId, metadata } = parsed.data;
    const startTime = Date.now();

    try {
        const result = await runWorkflow({
            input_as_text: message,
            conversationId,
            contactId,
            requestId,
            metadata,
        });

        const response: ChatResponse = {
            response: result.output_text || "No pude generar una respuesta",
            classification: result.classification,
            conversationId: conversationId || crypto.randomUUID(),
            ticketFolio: result.toolsUsed?.includes("create_ticket") ? undefined : undefined,
            metadata: {
                toolsUsed: result.toolsUsed,
                processingTimeMs: Date.now() - startTime,
                requestId,
            },
        };

        if (result.error) {
            response.error = cfg.NODE_ENV === "development" ? result.error : "Error processing request";
        }

        res.json(response);
    } catch (error) {
        logger.error({ requestId, err: error }, "Chat endpoint error");
        res.status(500).json({
            error: "Error interno del servidor",
            response: "Lo siento, ocurrió un error. Intenta de nuevo.",
            conversationId: conversationId || "error",
        });
    }
});

// Webhook compatibility (n8n)
app.post("/webhook", authMiddleware, chatRateLimiter, async (req: Request, res: Response) => {
    const { message, conversationId, contactId, metadata } = req.body;

    if (!message) {
        res.status(400).json({ error: "Missing message" });
        return;
    }

    try {
        const result = await runWorkflow({
            input_as_text: String(message),
            conversationId: conversationId ? String(conversationId) : undefined,
            contactId: contactId ? Number(contactId) : undefined,
            metadata,
        });

        res.json({ response: result.output_text, classification: result.classification });
    } catch (error) {
        logger.error({ err: error }, "Webhook error");
        res.status(500).json({ error: "Internal error" });
    }
});

// ============================================
// Server Lifecycle
// ============================================

const server = app.listen(cfg.PORT, () => {
    logger.info({
        port: cfg.PORT,
        env: cfg.NODE_ENV,
        model: cfg.SPECIALIST_MODEL,
        auth: cfg.API_KEY ? "enabled" : "disabled",
        rateLimit: `${cfg.RATE_LIMIT_MAX}/${cfg.RATE_LIMIT_WINDOW_MS}ms`,
    }, "Maria CEA Agent v2 started");
});

// Graceful shutdown — drain in-flight requests
let shuttingDown = false;

async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Shutting down gracefully");

    server.close(async () => {
        conversationStore.shutdown();
        await shutdownDatabase();
        logger.info("Shutdown complete");
        process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
        logger.error("Forced shutdown after timeout");
        process.exit(1);
    }, 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
