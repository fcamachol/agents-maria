// ============================================
// Ticket Tools - Create, List, Update
// Uses AGORA REST client (no direct DB access)
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
    createTicket as agoraCreateTicket,
    getTicketsByContrato,
    getTicketsByConversation,
    getTicketByFolio,
    updateTicket as agoraUpdateTicket,
    type CreateTicketBody,
} from "../services/agora-client.js";
import type { RequestContext } from "../types.js";
import { getCategoryEmoji, getTicketEmoji, renderTemplate } from "../config/response-templates.js";

// ============================================
// CREATE TICKET (context tool - needs conversation info)
// ============================================

export function createCreateTicketTool(ctx: RequestContext) {
    return tool(
        "create_ticket",
        `Crea un ticket en el sistema AGORA Hydropolis y retorna el folio generado.

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

            const body: CreateTicketBody = {
                titulo: input.titulo,
                descripcion: input.descripcion,
                service_type: input.subcategory_code || input.category_code,
                contract_number: input.contract_number || "",
                priority: input.priority,
                conversation_id: ctx.chatwootConversationId || undefined,
                client_name: input.client_name,
                phone: input.phone,
                email: input.email,
                ubicacion: input.ubicacion,
                latitude: input.latitude,
                longitude: input.longitude,
                category_code: input.category_code,
                subcategory_code: input.subcategory_code,
            };

            const result = await agoraCreateTicket(body);

            if (!result.success) {
                console.error(`[create_ticket] AGORA error: ${result.error}`);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            formatted_response: "No pude crear tu ticket en este momento. ¿Podrías intentar de nuevo en unos minutos?"
                        })
                    }]
                };
            }

            const { folio, ticketId, status } = result.data;
            console.log(`[create_ticket] Created ticket folio=${folio}, id=${ticketId}`);

            // Clear pendingLectura flag after successful FAC-LEC ticket
            if (input.subcategory_code === "FAC-LEC" && ctx.onLecturaTicketCreated) {
                ctx.onLecturaTicketCreated();
            }

            // Generate formatted response using template
            const emoji = getCategoryEmoji(input.category_code) || getTicketEmoji(input.titulo);
            const formattedResponse = renderTemplate("ticket_created", {
                folio,
                emoji,
                tipo: input.titulo,
                ubicacion: input.ubicacion || "",
                estatus: status || "open"
            });

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        folio,
                        ticketId: String(ticketId),
                        message: `Ticket creado exitosamente con folio ${folio}`,
                        formatted_response: formattedResponse
                    })
                }]
            };
        }
    );
}

// ============================================
// GET CLIENT TICKETS (context tool)
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
            contract_number: z.string().optional().describe("Número de contrato Hydropolis (opcional - si no se da, busca por conversación)")
        },
        async ({ contract_number }) => {
            const queryMode = contract_number ? "contract" : "conversation";
            const queryValue = contract_number || String(ctx.chatwootConversationId);
            console.log(`[get_client_tickets] Mode: ${queryMode}, value: ${queryValue}`);

            const result = contract_number
                ? await getTicketsByContrato(contract_number)
                : await getTicketsByConversation(ctx.chatwootConversationId);

            if (!result.success) {
                console.error(`[get_client_tickets] AGORA error: ${result.error}`);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            error: `No se pudieron consultar los tickets: ${result.error}`
                        })
                    }]
                };
            }

            const tickets = result.data;

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

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        query_mode: queryMode,
                        tickets: tickets.map((t) => ({
                            folio: t.folio,
                            status: t.estado,
                            titulo: t.titulo,
                            service_type: t.service_type,
                            created_at: t.created_at,
                            descripcion: t.descripcion?.substring(0, 100)
                        })),
                        count: tickets.length
                    })
                }]
            };
        }
    );
}

// ============================================
// LOOKUP TICKET BY FOLIO (static tool)
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

        const result = await getTicketByFolio(folio);

        if (!result.success) {
            console.log(`[lookup_ticket_by_folio] Not found or error for folio ${folio}: ${result.error}`);
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

        const t = result.data;
        console.log(`[lookup_ticket_by_folio] Found: ${t.folio} (estado: ${t.estado})`);
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    success: true,
                    found: true,
                    ticket: {
                        folio: t.folio,
                        status: t.estado,
                        titulo: t.titulo,
                        descripcion: t.descripcion?.substring(0, 200),
                        created_at: t.created_at,
                        priority: t.priority
                    }
                })
            }]
        };
    }
);

// ============================================
// UPDATE TICKET (static tool)
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
            .describe("Nueva prioridad del ticket"),
        notes: z.string().optional().describe("Notas adicionales")
    },
    async ({ folio, status, priority, notes }) => {
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

        const result = await agoraUpdateTicket(folio, {
            estado: status,
            prioridad: priority,
            notas: notes,
        });

        if (!result.success) {
            console.error(`[update_ticket] AGORA error: ${result.error}`);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: result.error
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
