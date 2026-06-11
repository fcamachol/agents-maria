// ============================================
// API Key Authentication Middleware
// ============================================

import type { Request, Response, NextFunction } from "express";

/**
 * Validates requests against API_SECRET env var.
 * If API_SECRET is not set, allows all requests (dev mode).
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
    const apiSecret = process.env.API_SECRET;
    if (!apiSecret) {
        // No API_SECRET configured — allow all (development mode)
        next();
        return;
    }

    const key = req.headers["x-api-key"] || req.query.api_key;
    if (!key || key !== apiSecret) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    next();
}
