// ============================================
// Core: ticket create / list / lookup / update
// Extracted from tools/tickets.ts.
//
// Writes go through AGORA Agent API. Reads still hit PG directly.
// Voice reuses these directly (mapping its own report `tipo` → AGORA codes
// before calling createTicketCore).
// ============================================

import { pgQuery } from "../services/soap-client.js";
import {
    createTicket as agoraCreateTicket,
    updateTicketByFolio as agoraUpdateTicket,
} from "../services/agora-client.js";
import type {
    CreateTicketInput,
    CreateTicketResult,
    TicketStatus,
    TicketPriority,
} from "../types.js";
import { renderTemplate, getCategoryEmoji, getTicketEmoji } from "../config/response-templates.js";
import type { ToolResultObject } from "./types.js";

// ============================================
// Dedup Guard
// ============================================

const recentTicketCreations = new Map<string, { folio: string; timestamp: number }>();

// ============================================
// Ticket Creation Helper (low-level)
// ============================================

export async function createTicketDirect(input: CreateTicketInput): Promise<CreateTicketResult> {
    console.log(`[create_ticket_direct] Creating ticket:`, input);

    try {
        // Dedup check: reject duplicate creation within 30s for same conversation+category+location
        const convId = input.conversation_id || '';
        const deduplicationKey = `${convId}-${input.category_code}-${input.ubicacion || input.contract_number || ''}`;
        const recent = recentTicketCreations.get(deduplicationKey);
        if (recent && (Date.now() - recent.timestamp) < 30000) {
            console.log(`[create_ticket_direct] DEDUP: Already created ${recent.folio} for key ${deduplicationKey}`);
            return { success: true, folio: recent.folio, ticketId: '', message: `Ticket ya creado: ${recent.folio}` };
        }

        const priority = input.priority || "medium";
        const clientName = input.client_name || 'Cliente WhatsApp';

        const metadata: Record<string, unknown> = {
            email: input.email || null,
            phone: input.phone || null,
            ubicacion: input.ubicacion || null,
            category_code: input.category_code,
            subcategory_code: input.subcategory_code,
            ...(input.latitude && input.longitude ? {
                coordenadas: { lat: input.latitude, lng: input.longitude }
            } : {})
        };

        const response = await agoraCreateTicket({
            title: input.titulo,
            description: input.descripcion,
            priority,
            ticket_type: "GEN",
            service_type: "general",
            channel: input.channel || "whatsapp",
            contract_number: input.contract_number ?? null,
            client_name: clientName,
            // contact_phone makes AGORA find-or-create the contact and link it
            // to the ticket (contact_id); name only applies on create.
            ...(input.contact_phone ? { contact_phone: input.contact_phone, contact_name: clientName } : {}),
            conversation_id: input.conversation_id ?? null,
            metadata,
            category_code: input.category_code,
            subcategory_code: input.subcategory_code,
        });

        if (!response.success) {
            console.error(`[create_ticket_direct] AGORA API error:`, response.error);
            return {
                success: false,
                error: response.error,
                message: "No se pudo crear el ticket en este momento."
            };
        }

        const { folio, ticket_id } = response.data;
        console.log(`[create_ticket_direct] Created ticket with folio: ${folio}`);

        // Record creation for dedup
        recentTicketCreations.set(deduplicationKey, { folio, timestamp: Date.now() });
        setTimeout(() => recentTicketCreations.delete(deduplicationKey), 60000);

        return {
            success: true,
            folio,
            ticketId: String(ticket_id),
            message: `Ticket creado exitosamente con folio ${folio}`
        };
    } catch (error) {
        console.error(`[create_ticket_direct] Error:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Error desconocido",
            message: "No se pudo crear el ticket en este momento."
        };
    }
}

// ============================================
// CREATE TICKET (full result + formatted response)
// ============================================

export async function createTicketCore(input: CreateTicketInput): Promise<ToolResultObject> {
    const result = await createTicketDirect(input);

    if (!result.success) {
        return {
            success: false,
            formatted_response: "No pude crear tu ticket en este momento. ¿Podrías intentar de nuevo en unos minutos?"
        };
    }

    // Generate formatted response using template
    const emoji = getCategoryEmoji(input.category_code) || getTicketEmoji(input.titulo);
    const formattedResponse = renderTemplate("ticket_created", {
        folio: result.folio,
        emoji,
        tipo: input.titulo,
        ubicacion: input.ubicacion || "",
        estatus: "open"
    });

    return {
        ...result,
        formatted_response: formattedResponse
    };
}

// ============================================
// GET CLIENT TICKETS
// ============================================

export async function getClientTicketsCore(opts: {
    contract_number?: string;
    conversationId?: number | string | null;
}): Promise<ToolResultObject> {
    const { contract_number } = opts;
    const queryMode = contract_number ? "contract" : "conversation";
    const queryValue = contract_number || String(opts.conversationId);
    console.log(`[get_client_tickets] Mode: ${queryMode}, value: ${queryValue}`);

    try {
        const whereClause = contract_number
            ? 'contract_number = $1'
            : 'conversation_id = $1';

        const tickets = await pgQuery<{
            folio: string;
            status: string;
            title: string;
            service_type: string;
            created_at: Date;
            description: string;
        }>(`
                    SELECT folio, status, title, service_type, created_at, description
                    FROM tickets
                    WHERE ${whereClause}
                    ORDER BY created_at DESC
                    LIMIT 10
                `, [queryValue]);

        if (!tickets || tickets.length === 0) {
            return {
                success: true,
                tickets: [],
                query_mode: queryMode,
                message: contract_number
                    ? "No se encontraron tickets para este contrato"
                    : "No se encontraron tickets en esta conversación"
            };
        }

        const result = {
            success: true,
            query_mode: queryMode,
            tickets: tickets.map((t) => ({
                folio: t.folio,
                status: t.status,
                titulo: t.title,
                service_type: t.service_type,
                created_at: t.created_at,
                descripcion: t.description?.substring(0, 100)
            })),
            count: tickets.length
        };

        return result;
    } catch (error) {
        console.error(`[get_client_tickets] Error:`, error);
        return {
            success: false,
            error: `No se pudieron consultar los tickets: ${error instanceof Error ? error.message : 'Error desconocido'}`
        };
    }
}

// ============================================
// LOOKUP TICKET BY FOLIO
// ============================================

export async function lookupTicketByFolioCore(folio: string): Promise<ToolResultObject> {
    console.log(`[lookup_ticket_by_folio] Looking up folio: ${folio}`);

    try {
        // 1. Exact match
        let tickets = await pgQuery<{
            folio: string;
            status: string;
            title: string;
            description: string;
            created_at: Date;
            priority: string;
        }>(`
                SELECT folio, status, title, description, created_at, priority
                FROM tickets WHERE folio = $1 LIMIT 1
            `, [folio]);

        // 2. If purely numeric and not found, try with CEA- prefix
        if ((!tickets || tickets.length === 0) && /^\d+$/.test(folio)) {
            tickets = await pgQuery(`
                    SELECT folio, status, title, description, created_at, priority
                    FROM tickets WHERE folio LIKE 'CEA-' || $1 LIMIT 1
                `, [folio]);
        }

        if (!tickets || tickets.length === 0) {
            console.log(`[lookup_ticket_by_folio] Not found: ${folio}`);
            return {
                success: true,
                found: false,
                message: "No se encontró ningún ticket con ese folio en nuestro sistema"
            };
        }

        const t = tickets[0];
        console.log(`[lookup_ticket_by_folio] Found: ${t.folio} (status: ${t.status})`);
        return {
            success: true,
            found: true,
            ticket: {
                folio: t.folio,
                status: t.status,
                titulo: t.title,
                descripcion: t.description?.substring(0, 200),
                created_at: t.created_at,
                priority: t.priority
            }
        };
    } catch (error) {
        console.error(`[lookup_ticket_by_folio] Error:`, error);
        return {
            success: false,
            error: `Error al buscar ticket: ${error instanceof Error ? error.message : 'Error desconocido'}`
        };
    }
}

// ============================================
// UPDATE TICKET
// ============================================

export async function updateTicketCore(args: {
    folio: string;
    status?: TicketStatus;
    priority?: TicketPriority;
}): Promise<ToolResultObject> {
    const { folio, status, priority } = args;
    console.log(`[update_ticket] Updating ticket: ${folio}`);

    // RESTRICTION: Users cannot close/resolve tickets
    if (status === "resolved" || status === "closed" || status === "cancelled") {
        console.log(`[update_ticket] BLOCKED: User attempted to set status to ${status}`);
        return {
            success: false,
            blocked: true,
            formatted_response: "Los tickets solo pueden ser cerrados por un asesor. Te comunico con uno para que te ayude con esto 👤"
        };
    }

    if (!status && !priority) {
        return {
            success: true,
            folio,
            message: `Ticket ${folio} actualizado correctamente`
        };
    }

    const response = await agoraUpdateTicket(folio, {
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
    });

    if (!response.success) {
        console.error(`[update_ticket] AGORA API error:`, response.error);
        return {
            success: false,
            error: response.error
        };
    }

    return {
        success: true,
        folio,
        message: `Ticket ${folio} actualizado correctamente`
    };
}
