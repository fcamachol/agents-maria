// ============================================
// Maria CEA SDK - Recibo Token Service
// Extracted from tools.ts — handles HMAC token
// generation and verification for secure PDF links
// ============================================

import crypto from "crypto";

const RECIBO_TOKEN_SECRET = process.env.RECIBO_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
export const SERVER_BASE_URL = process.env.SERVER_BASE_URL || "https://info-cea.cea-info.workers.dev";

export function generateReciboToken(contrato: string, expiresAt: number): string {
    const payload = `${contrato}:${expiresAt}`;
    return crypto.createHmac("sha256", RECIBO_TOKEN_SECRET).update(payload).digest("hex");
}

export function verifyReciboToken(contrato: string, token: string, expires: string): boolean {
    const expiresAt = parseInt(expires);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return false;
    const expected = generateReciboToken(contrato, expiresAt);
    if (token.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
