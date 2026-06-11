// ============================================
// Ticket Tools - Create, List, Update
// Writes go through AGORA Agent API (PR #178).
// Reads still hit PG directly until a read API exists.
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { pgQuery } from "../services/soap-client.js";
import {
    createTicket as agoraCreateTicket,
    updateTicketByFolio as agoraUpdateTicket,
} from "../services/agora-client.js";
import type {
    RequestContext,
    CategoryCode,
    CreateTicketInput,
    CreateTicketResult,
    TicketPriority,
} from "../types.js";
import { renderTemplate, getCategoryEmoji, getTicketEmoji } from "../config/response-templates.js";

// ============================================
// Dedup Guard
// ============================================

const recentTicketCreations = new Map<string, { folio: string; timestamp: number }>();

// ============================================
// Ticket Creation Helper
// ============================================

async function createTicketDirect(input: CreateTicketInput): Promise<CreateTicketResult> {
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
            channel: "whatsapp",
            contract_number: input.contract_number ?? null,
            client_name: clientName,
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
// CREATE TICKET (context tool - needs conversation info)
// ============================================

export function createCreateTicketTool(ctx: RequestContext) {
    return tool(
        "create_ticket",
        `Crea un ticket en el sistema AGORA CEA y retorna el folio generado.

CATEGORÍAS (AGORA - códigos directos de BD):
- INF: Información (consultas generales, consumos, horarios, requisitos)
- FAC: Facturación (recibos, aclaraciones, ajustes, pagos, convenios)
- TRA: Trámites (contratos nuevos, cambios titular, fracturas, adendas)
- REP: Reportes de servicio (fugas, drenaje, calidad del agua)
- SRV: Servicios técnicos (medidores, instalaciones, revisiones)

⚠️ CUÁNDO PEDIR CONTRATO:
- REP (fugas en vía pública, drenaje en calle): NO pidas contrato, solo ubicación
- REP (fuga de medidor, problema dentro de propiedad): SÍ pide contrato
- FAC, TRA, SRV: SÍ requieren contrato
- INF: Depende de la consulta

IMPORTANTE: Siempre incluye el folio en tu respuesta al usuario.`,
        {
            category_code: z.enum(["INF", "FAC", "TRA", "REP", "SRV"])
                .describe("Código de categoría AGORA (directo de BD)"),
            subcategory_code: z.string().optional()
                .describe("Código de subcategoría (ej: FAC-DIG, REP-FG-001)"),
            titulo: z.string().describe("Título breve del ticket"),
            descripcion: z.string().describe("Descripción detallada del problema"),
            contract_number: z.string().optional().describe("Número de contrato - NO requerido para fugas/drenaje en vía pública"),
            client_name: z.string().optional().describe("Nombre del cliente (del perfil de WhatsApp o proporcionado)"),
            phone: z.string().optional().describe("Teléfono del cliente (del perfil de WhatsApp)"),
            email: z.string().optional().describe("Email del cliente (si aplica)"),
            ubicacion: z.string().optional().describe("Ubicación - REQUERIDO para reportes REP en vía pública"),
            latitude: z.number().optional().describe("Latitud de la ubicación"),
            longitude: z.number().optional().describe("Longitud de la ubicación"),
            priority: z.enum(["low", "medium", "high", "urgent"]).default("medium")
                .describe("Prioridad del ticket")
        },
        async (input) => {
            console.log(`[create_ticket] Context: conv=${ctx.chatwootConversationId}, acct=${ctx.chatwootAccountId}`);

            const ticketInput: CreateTicketInput = {
                category_code: input.category_code as CategoryCode,
                subcategory_code: input.subcategory_code,
                titulo: input.titulo,
                descripcion: input.descripcion,
                contract_number: input.contract_number,
                client_name: input.client_name,
                phone: input.phone,
                email: input.email,
                conversation_id: ctx.chatwootConversationId || undefined,
                ubicacion: input.ubicacion,
                latitude: input.latitude,
                longitude: input.longitude,
                priority: input.priority as TicketPriority
            };

            const result = await createTicketDirect(ticketInput);

            if (!result.success) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    formatted_response: "No pude crear tu ticket en este momento. ¿Podrías intentar de nuevo en unos minutos?"
                }) }] };
            }

            // Clear pendingLectura flag after successful FAC-LEC ticket
            if (input.subcategory_code === "FAC-LEC" && ctx.onLecturaTicketCreated) {
                ctx.onLecturaTicketCreated();
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

            return { content: [{ type: "text" as const, text: JSON.stringify({
                ...result,
                formatted_response: formattedResponse
            }) }] };
        }
    );
}

// ============================================
// GET CLIENT TICKETS
// ============================================

export function createGetClientTicketsTool(ctx: RequestContext) {
    return tool(
        "get_client_tickets",
        `Obtiene los tickets de un cliente. Dos modos:

1. SIN contract_number: Busca tickets de esta conversación (no requiere verificación de identidad)
2. CON contract_number: Busca tickets por contrato (requiere verificación previa)

Cuando el usuario pide "mis tickets" sin especificar contrato, usa modo 1 primero.
Después de mostrar resultados, pregunta: "¿Quieres ver tickets relacionados a un contrato?"

RETORNA lista de tickets con:
- folio: Número de ticket
- status: Estado (open, in_progress, resolved, etc.)
- titulo: Título del ticket
- created_at: Fecha de creación`,
        {
            contract_number: z.string().optional().describe("Número de contrato CEA (opcional - si no se da, busca por conversación)")
        },
        async ({ contract_number }) => {
            const queryMode = contract_number ? "contract" : "conversation";
            const queryValue = contract_number || String(ctx.chatwootConversationId);
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
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify({
                                success: true,
                                tickets: [],
                                query_mode: queryMode,
                                message: contract_number
                                    ? "No se encontraron tickets para este contrato"
                                    : "No se encontraron tickets en esta conversación"
                            })
                        }]
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

                return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
            } catch (error) {
                console.error(`[get_client_tickets] Error:`, error);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            error: `No se pudieron consultar los tickets: ${error instanceof Error ? error.message : 'Error desconocido'}`
                        })
                    }]
                };
            }
        }
    );
}

// ============================================
// UPDATE TICKET
// ============================================

// ============================================
// LOOKUP TICKET BY FOLIO
// ============================================

export const lookupTicketByFolioTool = tool(
    "lookup_ticket_by_folio",
    `Busca un ticket específico por su número de folio o ticket.

USA ESTA HERRAMIENTA CUANDO:
- El usuario da un número de ticket/reporte/folio específico
- Ej: "quiero checar mi reporte 12345", "mi ticket ABC-999", "estatus del folio CEA-456"

SI NO SE ENCUENTRA:
- Dile al usuario: "No pude encontrar ese número de ticket en nuestro sistema. Déjame canalizarte con un asesor para que te ayude mejor."
- Luego usa handoff_to_human con razón "Ticket no encontrado en sistema: {folio}"`,
    {
        folio: z.string().describe("Número de folio/ticket que dio el usuario (tal cual lo proporcionó)")
    },
    async ({ folio }) => {
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
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: true,
                            found: false,
                            message: "No se encontró ningún ticket con ese folio en nuestro sistema"
                        })
                    }]
                };
            }

            const t = tickets[0];
            console.log(`[lookup_ticket_by_folio] Found: ${t.folio} (status: ${t.status})`);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
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
                    })
                }]
            };
        } catch (error) {
            console.error(`[lookup_ticket_by_folio] Error:`, error);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: `Error al buscar ticket: ${error instanceof Error ? error.message : 'Error desconocido'}`
                    })
                }]
            };
        }
    }
);

// ============================================
// UPDATE TICKET
// ============================================

export const updateTicketTool = tool(
    "update_ticket",
    `Actualiza el estado u otros campos de un ticket existente.

⚠️ RESTRICCIÓN IMPORTANTE:
- Los usuarios NO pueden cerrar tickets
- Si el usuario pide cerrar un ticket, usa handoff_to_human en su lugar
- Solo los agentes humanos pueden marcar tickets como "resolved" o "closed"

ESTADOS PERMITIDOS para María:
- in_progress, waiting_client, waiting_internal, escalated`,
    {
        folio: z.string().describe("Folio del ticket a actualizar"),
        status: z.enum(["open", "in_progress", "waiting_client", "waiting_internal", "escalated", "resolved", "closed", "cancelled"]).optional()
            .describe("Nuevo estado del ticket"),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional()
            .describe("Nueva prioridad del ticket")
    },
    async ({ folio, status, priority }) => {
        console.log(`[update_ticket] Updating ticket: ${folio}`);

        // RESTRICTION: Users cannot close/resolve tickets
        if (status === "resolved" || status === "closed" || status === "cancelled") {
            console.log(`[update_ticket] BLOCKED: User attempted to set status to ${status}`);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        blocked: true,
                        formatted_response: "Los tickets solo pueden ser cerrados por un asesor. Te comunico con uno para que te ayude con esto 👤"
                    })
                }]
            };
        }

        if (!status && !priority) {
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        folio,
                        message: `Ticket ${folio} actualizado correctamente`
                    })
                }]
            };
        }

        const response = await agoraUpdateTicket(folio, {
            ...(status ? { status } : {}),
            ...(priority ? { priority } : {}),
        });

        if (!response.success) {
            console.error(`[update_ticket] AGORA API error:`, response.error);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: response.error
                    })
                }]
            };
        }

        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    success: true,
                    folio,
                    message: `Ticket ${folio} actualizado correctamente`
                })
            }]
        };
    }
);
