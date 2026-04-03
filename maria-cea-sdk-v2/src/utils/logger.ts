// ============================================
// Structured Logger (pino)
// ============================================

import pino from "pino";
import { cfg } from "../config/index.js";

export const logger = pino({
    level: cfg.LOG_LEVEL,
    transport: cfg.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
        : undefined,
    base: { service: "maria-cea-v2" },
    serializers: {
        err: pino.stdSerializers.err,
    },
});

export function childLogger(component: string) {
    return logger.child({ component });
}
