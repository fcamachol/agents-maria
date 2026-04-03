// ============================================
// Rate Limiting Middleware
// ============================================

import rateLimit from "express-rate-limit";
import { cfg } from "../config/index.js";

export const chatRateLimiter = rateLimit({
    windowMs: cfg.RATE_LIMIT_WINDOW_MS,
    max: cfg.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes, intenta de nuevo en un momento" },
    keyGenerator: (req) => {
        // Rate limit by conversationId if available, otherwise by IP
        return req.body?.conversationId || req.ip || "unknown";
    },
});
