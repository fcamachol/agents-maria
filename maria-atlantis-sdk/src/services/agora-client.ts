// ============================================
// Maria Atlantis SDK - AGORA Ticket REST Client
// Thin typed wrapper around AGORA's ticket API.
// AGORA is a Chatwoot-based platform with custom
// ticket endpoints at agoracore.whoopflow.com.
// ============================================

// ============================================
// Configuration
// ============================================

export const AGORA_API_BASE =
    process.env.AGORA_API_BASE ?? "https://agoracore.whoopflow.com";

export const AGORA_ACCOUNT_ID =
    process.env.AGORA_ACCOUNT_ID ?? "1";

const AGORA_API_TOKEN = process.env.AGORA_API_TOKEN ?? "";

let _tokenWarningLogged = false;

function getToken(): string {
    if (!AGORA_API_TOKEN && !_tokenWarningLogged) {
        console.warn("[AGORA] AGORA_API_TOKEN is not set — ticket API calls will fail");
        _tokenWarningLogged = true;
    }
    return AGORA_API_TOKEN;
}

// ============================================
// Generic Envelope
// ============================================

export type AgoraResponse<T> =
    | { success: true; data: T; error?: never }
    | { success: false; data?: never; error: string };

// ============================================
// Response Shape Interfaces
// ============================================

export interface CreateTicketResult {
    folio: string;
    ticketId: number;
    status: string;
}

export interface TicketObject {
    id: number;
    folio: string;
    titulo: string;
    descripcion: string;
    service_type: string;
    contract_number: string;
    priority: string;
    estado: string;
    conversation_id?: number;
    client_name?: string;
    phone?: string;
    email?: string;
    ubicacion?: string;
    latitude?: number;
    longitude?: number;
    category_code?: string;
    subcategory_code?: string;
    notas?: string;
    created_at: string;
    updated_at: string;
}

// ============================================
// Request Body Interfaces
// ============================================

export interface CreateTicketBody {
    titulo: string;
    descripcion: string;
    service_type: string;
    contract_number: string;
    priority: string;
    conversation_id?: number;
    client_name?: string;
    phone?: string;
    email?: string;
    ubicacion?: string;
    latitude?: number;
    longitude?: number;
    category_code?: string;
    subcategory_code?: string;
}

export interface UpdateTicketBody {
    estado?: string;
    prioridad?: string;
    notas?: string;
}

// ============================================
// Shared Fetch Helper
// ============================================

async function agoraFetch<T>(
    path: string,
    init?: RequestInit
): Promise<AgoraResponse<T>> {
    const token = getToken();

    if (!token) {
        return {
            success: false,
            error: "AGORA_API_TOKEN is not configured",
        };
    }

    const url = `${AGORA_API_BASE}/api/v1/accounts/${AGORA_ACCOUNT_ID}/agent/tickets${path}`;

    try {
        const response = await fetch(url, {
            ...init,
            headers: {
                "Content-Type": "application/json",
                "api_access_token": token,
                ...(init?.headers ?? {}),
            },
            signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            const message = `HTTP ${response.status}: ${text}`;
            console.error(`[AGORA] ${init?.method ?? "GET"} ${path} → ${message}`);
            return { success: false, error: message };
        }

        const data = (await response.json()) as T;
        return { success: true, data };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[AGORA] ${init?.method ?? "GET"} ${path} → ${message}`);
        return { success: false, error: message };
    }
}

// ============================================
// Exported API Functions
// ============================================

/** POST /api/v1/accounts/{id}/agent/tickets */
export async function createTicket(
    body: CreateTicketBody
): Promise<AgoraResponse<CreateTicketResult>> {
    return agoraFetch<CreateTicketResult>("", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

/** GET /api/v1/accounts/{id}/agent/tickets?contrato=X */
export async function getTicketsByContrato(
    contrato: string
): Promise<AgoraResponse<TicketObject[]>> {
    const params = new URLSearchParams({ contrato });
    return agoraFetch<TicketObject[]>(`?${params}`);
}

/** GET /api/v1/accounts/{id}/agent/tickets?conversation_id=X */
export async function getTicketsByConversation(
    conversationId: number | string
): Promise<AgoraResponse<TicketObject[]>> {
    const params = new URLSearchParams({
        conversation_id: String(conversationId),
    });
    return agoraFetch<TicketObject[]>(`?${params}`);
}

/** GET /api/v1/accounts/{id}/agent/tickets/folio/:folio */
export async function getTicketByFolio(
    folio: string
): Promise<AgoraResponse<TicketObject>> {
    return agoraFetch<TicketObject>(`/folio/${encodeURIComponent(folio)}`);
}

/** PUT /api/v1/accounts/{id}/agent/tickets/:id */
export async function updateTicket(
    id: number | string,
    body: UpdateTicketBody
): Promise<AgoraResponse<TicketObject>> {
    return agoraFetch<TicketObject>(`/${encodeURIComponent(String(id))}`, {
        method: "PUT",
        body: JSON.stringify(body),
    });
}
