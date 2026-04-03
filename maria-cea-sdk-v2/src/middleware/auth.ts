// ============================================
// Authentication Middleware
// ============================================

import type { Request, Response, NextFunction } from "express";
import { cfg } from "../config/index.js";

/**
 * API key authentication middleware.
 * If API_KEY is set in env, requires Authorization: Bearer <key> header.
 * If API_KEY is not set, passes through (development mode).
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!cfg.API_KEY) {
        next();
        return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid Authorization header" });
        return;
    }

    const token = authHeader.slice(7);
    if (token !== cfg.API_KEY) {
        res.status(403).json({ error: "Invalid API key" });
        return;
    }

    next();
}
