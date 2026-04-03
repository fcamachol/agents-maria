// ============================================
// HTTP Utilities - Retry with Exponential Backoff
// ============================================

import { ProxyAgent, fetch as undiciFetch } from "undici";
import { cfg } from "../config/index.js";
import { childLogger } from "./logger.js";

const log = childLogger("http");

/**
 * Fetch with exponential backoff retry and optional proxy support.
 * Backoff: baseDelay * 2^(attempt-1) → 1s, 2s, 4s
 */
export async function fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = cfg.MAX_RETRIES,
    baseDelayMs = cfg.RETRY_BASE_DELAY_MS
): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            let response: Response;

            if (cfg.CEA_PROXY_URL && url.includes("ceaqueretaro.gob.mx")) {
                log.debug({ proxy: cfg.CEA_PROXY_URL, url }, "Using proxy");
                const proxyAgent = new ProxyAgent(cfg.CEA_PROXY_URL);

                // @ts-expect-error undici types compatible at runtime
                response = await undiciFetch(url, {
                    method: options.method || "GET",
                    headers: options.headers,
                    body: options.body as string,
                    dispatcher: proxyAgent,
                    signal: AbortSignal.timeout(cfg.REQUEST_TIMEOUT_MS),
                });
            } else {
                response = await fetch(url, {
                    ...options,
                    signal: AbortSignal.timeout(cfg.REQUEST_TIMEOUT_MS),
                });
            }

            if (!response.ok && attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                log.warn({ status: response.status, attempt, delay }, "Retrying request");
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }

            return response;
        } catch (error) {
            lastError = error as Error;
            if (attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                log.warn({ err: lastError.message, attempt, delay }, "Request error, retrying");
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }

    throw lastError || new Error("Request failed after retries");
}
