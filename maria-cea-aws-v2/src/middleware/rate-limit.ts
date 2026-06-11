// ============================================
// In-Memory Rate Limiting Middleware
// No external dependencies
// ============================================

import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

function createRateLimiter(windowMs: number, max: number) {
    const store = new Map<string, RateLimitEntry>();

    // Cleanup expired entries every minute
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of store.entries()) {
            if (now > entry.resetAt) {
                store.delete(key);
            }
        }
    }, 60000);

    return (req: Request, res: Response, next: NextFunction): void => {
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const entry = store.get(key);

        if (!entry || now > entry.resetAt) {
            store.set(key, { count: 1, resetAt: now + windowMs });
            next();
            return;
        }

        entry.count++;
        if (entry.count > max) {
            res.status(429).json({ error: "Rate limit exceeded. Try again later." });
            return;
        }

        next();
    };
}

/** 20 requests per minute for chat endpoint */
export const chatLimiter = createRateLimiter(60000, 20);

/** 60 requests per minute for webhook endpoint */
export const webhookLimiter = createRateLimiter(60000, 60);

/** 100 requests per minute for Chatwoot webhook */
export const chatwootLimiter = createRateLimiter(60000, 100);
