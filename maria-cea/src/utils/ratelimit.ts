// ============================================
// Maria CEA - Rate Limiting
// ============================================

import { logger } from "./logger.js";

interface RateLimitEntry {
    count: number;
    resetTime: number;
    windowStart: number;
}

interface RateLimitConfig {
    windowMs: number;
    maxRequests: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30 // 30 requests per minute
};

class RateLimiter {
    private limits: Map<string, RateLimitEntry> = new Map();
    private config: RateLimitConfig;
    private cleanupInterval: ReturnType<typeof setInterval>;

    constructor(config: Partial<RateLimitConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Cleanup expired entries periodically
        this.cleanupInterval = setInterval(() => this.cleanup(), this.config.windowMs);
    }

    /**
     * Check if request is allowed
     */
    isAllowed(key: string): { allowed: boolean; remaining: number; resetTime: number } {
        const now = Date.now();
        const entry = this.limits.get(key);

        if (!entry || now > entry.resetTime) {
            // New window
            this.limits.set(key, {
                count: 1,
                resetTime: now + this.config.windowMs,
                windowStart: now
            });
            return {
                allowed: true,
                remaining: this.config.maxRequests - 1,
                resetTime: now + this.config.windowMs
            };
        }

        if (entry.count >= this.config.maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                resetTime: entry.resetTime
            };
        }

        entry.count++;
        return {
            allowed: true,
            remaining: this.config.maxRequests - entry.count,
            resetTime: entry.resetTime
        };
    }

    /**
     * Check without incrementing (for preview)
     */
    peek(key: string): { allowed: boolean; remaining: number; resetTime: number } {
        const now = Date.now();
        const entry = this.limits.get(key);

        if (!entry || now > entry.resetTime) {
            return {
                allowed: true,
                remaining: this.config.maxRequests,
                resetTime: now + this.config.windowMs
            };
        }

        const remaining = this.config.maxRequests - entry.count;
        return {
            allowed: remaining > 0,
            remaining: Math.max(0, remaining),
            resetTime: entry.resetTime
        };
    }

    /**
     * Reset limit for a key
     */
    reset(key: string): void {
        this.limits.delete(key);
        logger.debug({ key }, "Rate limit reset");
    }

    /**
     * Cleanup expired entries
     */
    private cleanup(): void {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, entry] of this.limits.entries()) {
            if (now > entry.resetTime) {
                this.limits.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger.debug({ cleaned }, "Rate limit entries cleaned");
        }
    }

    /**
     * Get current status
     */
    getStatus(): {
        totalKeys: number;
        windowMs: number;
        maxRequests: number;
    } {
        return {
            totalKeys: this.limits.size,
            windowMs: this.config.windowMs,
            maxRequests: this.config.maxRequests
        };
    }

    /**
     * Stop the cleanup interval (for graceful shutdown)
     */
    stop(): void {
        clearInterval(this.cleanupInterval);
    }
}

// Singleton instances for different use cases
export const conversationRateLimiter = new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_CONVERSATION || "20") // 20 messages per minute per conversation
});

export const apiRateLimiter = new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_API || "100") // 100 API calls per minute per IP
});

export const budgetLimiter = new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: parseInt(process.env.RATE_LIMIT_BUDGET || "50") // ~50 requests per hour (budget control)
});

/**
 * Middleware helper for Express
 */
export function createRateLimitMiddleware(limiter: RateLimiter) {
    return (req: any, res: any, next: any) => {
        const key = req.ip || req.connection?.remoteAddress || "unknown";
        const result = limiter.isAllowed(key);

        res.setHeader("X-RateLimit-Limit", limiter.getStatus().maxRequests);
        res.setHeader("X-RateLimit-Remaining", result.remaining);
        res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetTime / 1000));

        if (!result.allowed) {
            logger.warn({ key }, "Rate limit exceeded");
            return res.status(429).json({
                error: "Too many requests",
                retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
            });
        }

        next();
    };
}

/**
 * Stop all rate limiters (for graceful shutdown)
 */
export function stopAllRateLimiters(): void {
    conversationRateLimiter.stop();
    apiRateLimiter.stop();
    budgetLimiter.stop();
}
