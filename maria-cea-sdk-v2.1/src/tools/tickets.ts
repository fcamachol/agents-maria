// ============================================
// Ticket Tools - Create, List, Update, Lookup
//
// Thin SDK `tool()` wrappers over `../core/tickets.ts`. Context tools inject
// conversation/account info from `ctx`; orchestration lives in core.
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { toToolResult } from "../core/types.js";
import {
    createTicketCore,
    getClientTicketsCore,
    lookupTicketByFolioCore,
    updateTicketCore,
} from "../core/tickets.js";
import type {
    RequestContext,
    CategoryCode,
    CreateTicketInput,
    TicketPriority,
} from "../types.js";

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

            const result = await createTicketCore(ticketInput);

            // Clear pendingLectura flag after successful FAC-LEC ticket
            if (result.success !== false && input.subcategory_code === "FAC-LEC" && ctx.onLecturaTicketCreated) {
                ctx.onLecturaTicketCreated();
            }

            return toToolResult(result);
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
            contract_number: z.string().optional().describe("Número de contrato CEA (opcional - si no se da, busca por conversación)")
        },
        async ({ contract_number }) => toToolResult(
            await getClientTicketsCore({ contract_number, conversationId: ctx.chatwootConversationId })
        )
    );
}

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
    async ({ folio }) => toToolResult(await lookupTicketByFolioCore(folio))
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
    async ({ folio, status, priority }) => toToolResult(await updateTicketCore({ folio, status, priority }))
);
