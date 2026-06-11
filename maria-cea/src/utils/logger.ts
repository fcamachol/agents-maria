// ============================================
// Maria CEA - Structured Logging with Pino
// ============================================

import pino from "pino";

const isDevelopment = process.env.NODE_ENV !== "production";

export const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    transport: isDevelopment
        ? {
            target: "pino-pretty",
            options: {
                colorize: true,
                translateTime: "SYS:standard",
                ignore: "pid,hostname"
            }
        }
        : undefined,
    base: {
        service: "maria-cea",
        version: "1.0.0"
    }
});

/**
 * Create a child logger with conversation context
 */
export function createConversationLogger(conversationId: string, metadata?: Record<string, unknown>) {
    return logger.child({
        conversationId,
        ...metadata
    });
}

/**
 * Log performance metrics
 */
export function logPerformance(
    operation: string,
    durationMs: number,
    success: boolean,
    extra?: Record<string, unknown>
) {
    logger.info({
        operation,
        durationMs,
        success,
        ...extra
    }, `Performance: ${operation} took ${durationMs}ms`);
}
