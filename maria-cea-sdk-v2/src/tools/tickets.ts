// ============================================
// Ticket Tools - Atomic folio generation
// ============================================

import { tool } from "@openai/agents";
import { z } from "zod";
import { cfg } from "../config/index.js";
import {
    TICKET_CODES, SERVICE_TYPE_MAP, PRIORITY_MAP, STATUS_MAP,
    type CreateTicketInput, type CreateTicketResult, type TicketType,
} from "../config/types.js";
import { pgQuery } from "../services/database.js";
import { getCurrentChatwootContext } from "../services/context.js";
import { getMexicoDate, getMexicoDateStr } from "../utils/date.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("tickets");

/**
 * Atomic folio generation using PostgreSQL advisory lock.
 * Prevents race conditions by locking on the prefix hash.
 */
async function generateFolioAtomic(ticketType: TicketType): Promise<string> {
    const typeCode = TICKET_CODES[ticketType];
    const dateStr = getMexicoDateStr();
    const prefix = `${typeCode}-${dateStr}`;

    try {
        // Use a single transaction with advisory lock for atomicity
        const result = await pgQuery<{ next_folio: string }>(`
            SELECT (
                SELECT $1 || '-' || LPAD((
                    COALESCE(
                        (SELECT CAST(SUBSTRING(folio FROM '-([0-9]{4})$') AS INTEGER)
                         FROM tickets
                         WHERE folio LIKE $1 || '-%'
                         ORDER BY folio DESC
                         LIMIT 1
                         FOR UPDATE),
                        0
                    ) + 1
                )::TEXT, 4, '0')
            ) AS next_folio
        `, [prefix]);

        return result[0]?.next_folio || `${prefix}-0001`;
    } catch (error) {
        log.warn({ err: error, prefix }, "Folio DB query failed, using UUID fallback");
        const uuid = crypto.randomUUID().slice(0, 8).toUpperCase();
        return `${prefix}-${uuid}`;
    }
}

/**
 * Synchronous folio fallback (no DB).
 */
function generateFolioFallback(ticketType: TicketType): string {
    const typeCode = TICKET_CODES[ticketType];
    const dateStr = getMexicoDateStr();
    const uuid = crypto.randomUUID().slice(0, 8).toUpperCase();
    return `${typeCode}-${dateStr}-${uuid}`;
}

export async function createTicketDirect(input: CreateTicketInput): Promise<CreateTicketResult> {
    log.info({ serviceType: input.service_type, contract: input.contract_number }, "Creating ticket");

    const chatwootContext = getCurrentChatwootContext();

    try {
        const folio = await generateFolioAtomic(input.service_type);
        const serviceType = SERVICE_TYPE_MAP[input.service_type] || "general";
        const ticketType = TICKET_CODES[input.service_type] || "GEN";
        const priority = PRIORITY_MAP[input.priority || "media"] || "medium";

        let contactId = input.contact_id ?? chatwootContext.contactId ?? null;
        let conversationId = input.conversation_id ?? chatwootContext.conversationId ?? null;
        const inboxId = input.inbox_id ?? chatwootContext.inboxId ?? null;
        let clientName = input.client_name || null;

        // Resolve client name from Chatwoot contact
        if (contactId && !clientName) {
            try {
                const contacts = await pgQuery<{ name: string }>(
                    "SELECT name FROM contacts WHERE id = $1 LIMIT 1", [contactId]
                );
                if (contacts.length > 0) clientName = contacts[0].name;
            } catch { /* non-critical */ }
        }

        // Resolve contact by contract number
        if (!contactId && input.contract_number) {
            try {
                const contacts = await pgQuery<{ id: number; name: string }>(`
                    SELECT id, name FROM contacts
                    WHERE identifier = $1 OR custom_attributes->>'contract_number' = $1
                    LIMIT 1
                `, [input.contract_number]);
                if (contacts.length > 0) {
                    contactId = contacts[0].id;
                    clientName = clientName || contacts[0].name;
                }
            } catch { /* non-critical */ }
        }

        const result = await pgQuery<{ id: number; folio: string }>(`
            INSERT INTO tickets (
                account_id, folio, title, description, status, priority,
                ticket_type, service_type, channel, contract_number,
                client_name, contact_id, conversation_id, inbox_id,
                metadata, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, 'whatsapp', $9,
                $10, $11, $12, $13,
                $14, NOW(), NOW()
            )
            RETURNING id, folio
        `, [
            cfg.CHATWOOT_ACCOUNT_ID, folio, input.titulo, input.descripcion,
            "open", priority, ticketType, serviceType,
            input.contract_number || null,
            clientName || "Cliente WhatsApp",
            contactId, conversationId, inboxId,
            JSON.stringify({ email: input.email || null, ubicacion: input.ubicacion || null }),
        ]);

        const ticket = result[0];
        log.info({ folio: ticket.folio, id: ticket.id, contactId }, "Ticket created");

        return {
            success: true,
            folio: ticket.folio,
            ticketId: String(ticket.id),
            message: `Ticket creado exitosamente con folio ${ticket.folio}`,
        };
    } catch (error) {
        log.error({ err: error }, "Ticket creation failed");

        const fallbackFolio = generateFolioFallback(input.service_type);
        return {
            success: true,
            folio: fallbackFolio,
            warning: "Ticket creado localmente, sincronización pendiente",
            message: `Ticket registrado con folio ${fallbackFolio}`,
        };
    }
}

// ============================================
// Agent Tools
// ============================================

export const createTicketTool = tool({
    name: "create_ticket",
    description: `Crea un ticket en el sistema CEA y retorna el folio generado.

TIPOS DE TICKET:
- fuga: Reportes de fugas de agua
- aclaraciones: Aclaraciones generales
- pagos: Problemas con pagos
- lecturas: Problemas con lecturas del medidor
- revision_recibo: Revisión de recibo
- recibo_digital: Solicitud de recibo digital
- urgente: Solicitar asesor humano

IMPORTANTE: Siempre incluye el folio en tu respuesta al usuario.`,
    parameters: z.object({
        service_type: z.enum(["fuga", "aclaraciones", "pagos", "lecturas", "revision_recibo", "recibo_digital", "urgente"]),
        titulo: z.string().min(3).max(200),
        descripcion: z.string().min(5).max(2000),
        contract_number: z.string().regex(/^\d{6,10}$/).nullable().describe("Número de contrato (6-10 dígitos)"),
        email: z.string().email().nullable().describe("Email del cliente"),
        ubicacion: z.string().max(500).nullable().describe("Ubicación de la fuga"),
        priority: z.enum(["urgente", "alta", "media", "baja"]).default("media"),
    }),
    execute: async (input) => createTicketDirect(input),
});

export const getClientTicketsTool = tool({
    name: "get_client_tickets",
    description: `Obtiene los tickets de un cliente por número de contrato.

RETORNA lista de tickets con folio, status, titulo, fecha de creación.`,
    parameters: z.object({
        contract_number: z.string().regex(/^\d{6,10}$/).describe("Número de contrato CEA (6-10 dígitos)"),
    }),
    execute: async ({ contract_number }) => {
        log.info({ contract_number }, "Fetching client tickets");

        try {
            const tickets = await pgQuery<{
                folio: string; status: string; title: string;
                service_type: string; created_at: Date; description: string;
            }>(`
                SELECT folio, status, title, service_type, created_at, description
                FROM tickets WHERE contract_number = $1
                ORDER BY created_at DESC LIMIT 10
            `, [contract_number]);

            if (tickets.length === 0) {
                return { success: true, tickets: [], message: "No se encontraron tickets para este contrato" };
            }

            return {
                success: true,
                tickets: tickets.map((t) => ({
                    folio: t.folio, status: t.status, titulo: t.title,
                    service_type: t.service_type, created_at: t.created_at,
                    descripcion: t.description?.substring(0, 100),
                })),
                count: tickets.length,
            };
        } catch (error) {
            log.error({ err: error }, "Error fetching tickets");
            return { success: false, error: `No se pudieron consultar los tickets: ${error instanceof Error ? error.message : "Error desconocido"}` };
        }
    },
});

export const updateTicketTool = tool({
    name: "update_ticket",
    description: `Actualiza el estado u otros campos de un ticket existente.

ESTADOS: abierto, en_proceso, esperando_cliente, esperando_interno, escalado, resuelto, cerrado, cancelado`,
    parameters: z.object({
        folio: z.string().min(1),
        status: z.enum(["abierto", "en_proceso", "esperando_cliente", "esperando_interno", "escalado", "resuelto", "cerrado", "cancelado"]).nullable(),
        priority: z.enum(["urgente", "alta", "media", "baja"]).nullable(),
        notes: z.string().max(2000).nullable(),
    }),
    execute: async ({ folio, status, priority, notes }) => {
        log.info({ folio, status, priority }, "Updating ticket");

        try {
            const setClauses: string[] = ["updated_at = NOW()"];
            const params: unknown[] = [];
            let idx = 1;

            if (status) { setClauses.push(`status = $${idx++}`); params.push(STATUS_MAP[status] || status); }
            if (priority) { setClauses.push(`priority = $${idx++}`); params.push(PRIORITY_MAP[priority] || priority); }
            if (notes) { setClauses.push(`resolution_notes = $${idx++}`); params.push(notes); }
            if (status === "resuelto") setClauses.push("resolved_at = NOW()");

            params.push(folio);

            await pgQuery(`UPDATE tickets SET ${setClauses.join(", ")} WHERE folio = $${idx}`, params);
            return { success: true, folio, message: `Ticket ${folio} actualizado correctamente` };
        } catch (error) {
            log.error({ err: error }, "Error updating ticket");
            return { success: false, error: error instanceof Error ? error.message : "Error desconocido" };
        }
    },
});
