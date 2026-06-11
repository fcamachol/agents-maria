// ============================================
// Maria CEA SDK v2 — AGORA Agent API Client
// Thin typed wrapper around AGORA's /agent/tickets
// endpoints (PR #178). Reuses the same host + secret
// as the existing chatwoot client; only the auth
// header form differs (Bearer vs api_access_token).
// ============================================

import type { TicketPriority, TicketStatus } from "../types.js";

// ============================================
// Configuration
// ============================================
//
// Host + account come from the chatwoot env (same AGORA instance).
// The token is a SEPARATE secret — AGORA's /agent/tickets endpoint
// explicitly rejects the chatwoot bot token (api_access_token);
// it requires a dedicated AGENT_API_TOKEN issued by the AGORA team.
//
const AGORA_BASE_URL = process.env.CHATWOOT_BASE_URL || "";
const AGORA_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || "1";
const AGORA_AGENT_API_TOKEN = process.env.AGORA_AGENT_API_TOKEN || "";

let _tokenWarningLogged = false;

function ensureConfigured(): string | null {
    if (!AGORA_BASE_URL || !AGORA_AGENT_API_TOKEN) {
        if (!_tokenWarningLogged) {
            console.warn("[AGORA] Missing CHATWOOT_BASE_URL or AGORA_AGENT_API_TOKEN — agent ticket API calls will fail");
            _tokenWarningLogged = true;
        }
        return "AGORA agent API is not configured";
    }
    return null;
}

// ============================================
// Generic Envelope
// ============================================

export type AgoraResponse<T> =
    | { success: true; data: T; error?: never }
    | { success: false; data?: never; error: string; status?: number };

// ============================================
// Request / Response Shapes
// ============================================

export interface CreateTicketBody {
    title: string;
    description: string;
    priority: TicketPriority;
    ticket_type: string;
    service_type: string;
    channel: string;
    contract_number?: string | null;
    client_name?: string | null;
    /** Triggers AGORA's contact find-or-create: links the ticket to the contact with this phone. */
    contact_phone?: string | null;
    /** Name used only if AGORA creates a new contact (existing names are never overwritten). */
    contact_name?: string | null;
    conversation_id?: number | null;
    metadata?: Record<string, unknown>;
    category_code?: string;
    subcategory_code?: string;
}

export interface CreateTicketResponse {
    success: boolean;
    folio: string;
    ticket_id: number;
    attachments?: unknown[];
    message?: string;
}

export interface UpdateTicketBody {
    status?: TicketStatus;
    priority?: TicketPriority;
    description?: string;
    assignee_id?: number;
}

// ============================================
// Shared Fetch Helper
// ============================================

async function agoraFetch<T>(
    path: string,
    init: RequestInit & { method: "POST" | "PATCH" | "GET" }
): Promise<AgoraResponse<T>> {
    const configError = ensureConfigured();
    if (configError) {
        return { success: false, error: configError };
    }

    const url = `${AGORA_BASE_URL}/api/v1/accounts/${AGORA_ACCOUNT_ID}/agent/tickets${path}`;

    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${AGORA_AGENT_API_TOKEN}`,
        ...(init.headers ?? {}),
    };

    const attempt = async (): Promise<AgoraResponse<T>> => {
        try {
            const response = await fetch(url, {
                ...init,
                headers,
                signal: AbortSignal.timeout(15_000),
            });

            if (!response.ok) {
                const text = await response.text().catch(() => "");
                console.error(`[AGORA] ${init.method} ${path} → HTTP ${response.status}: ${text.slice(0, 500)}`);
                return { success: false, error: `HTTP ${response.status}: ${text}`, status: response.status };
            }

            const data = (await response.json()) as T;
            return { success: true, data };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[AGORA] ${init.method} ${path} → ${message}`);
            return { success: false, error: message };
        }
    };

    const first = await attempt();
    if (!first.success && first.status && first.status >= 500) {
        console.warn(`[AGORA] ${init.method} ${path} → 5xx, retrying once`);
        return attempt();
    }
    return first;
}

// ============================================
// Exported API Functions
// ============================================

/** POST /api/v1/accounts/:account_id/agent/tickets */
export async function createTicket(
    body: CreateTicketBody
): Promise<AgoraResponse<CreateTicketResponse>> {
    return agoraFetch<CreateTicketResponse>("", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

/** PATCH /api/v1/accounts/:account_id/agent/tickets/:folio */
export async function updateTicketByFolio(
    folio: string,
    body: UpdateTicketBody
): Promise<AgoraResponse<Record<string, unknown>>> {
    return agoraFetch<Record<string, unknown>>(`/${encodeURIComponent(folio)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    });
}
