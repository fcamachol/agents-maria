import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeApiRequest, handleApiError } from "../api-client.js";

// --- Schemas ---

const CreateTicketSchema = z.object({
  title: z.string()
    .min(1, "El título es obligatorio")
    .describe("Título del ticket"),
  description: z.string()
    .optional()
    .describe("Descripción detallada del problema o solicitud"),
  priority: z.enum(["low", "medium", "high", "urgent"])
    .default("medium")
    .describe("Prioridad: low, medium, high, urgent"),
  ticket_type: z.enum(["ACL", "ACT", "CON", "DIG", "FUG", "LEC", "PAG", "REV", "URG", "GEN"])
    .default("GEN")
    .describe("Tipo de ticket: ACL (aclaración), ACT (activación), CON (contrato), DIG (digital), FUG (fuga), LEC (lectura), PAG (pago), REV (revisión), URG (urgente), GEN (general)"),
  service_type: z.string()
    .default("general")
    .describe("Tipo de servicio (e.g. leak_report, meter_reading, general)"),
  contract_number: z.string()
    .optional()
    .describe("Número de contrato del cliente"),
  conversation_id: z.number()
    .int()
    .optional()
    .describe("ID de la conversación de Chatwoot a vincular"),
  assignee_id: z.number()
    .int()
    .optional()
    .describe("ID del usuario asignado al ticket"),
  ticket_category_id: z.number()
    .int()
    .optional()
    .describe("ID de la categoría del ticket"),
  ticket_subcategory_id: z.number()
    .int()
    .optional()
    .describe("ID de la subcategoría del ticket"),
  contact_name: z.string()
    .optional()
    .describe("Nombre del contacto (se crea automáticamente si no existe)"),
  contact_phone: z.string()
    .optional()
    .describe("Teléfono del contacto (e.g. +525512345678). Se crea/busca contacto automáticamente"),
  contact_email: z.string()
    .email("Formato de email inválido")
    .optional()
    .describe("Email del contacto"),
  attachment_ids: z.array(z.number().int())
    .default([])
    .describe("IDs de adjuntos existentes para vincular al ticket")
}).strict();

type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

const ListTicketsSchema = z.object({
  contract_number: z.string()
    .optional()
    .describe("Filtrar por número de contrato"),
  phone_number: z.string()
    .optional()
    .describe("Filtrar por número de teléfono del contacto")
}).strict().refine(
  (data) => data.contract_number || data.phone_number,
  { message: "Se requiere contract_number o phone_number" }
);

type ListTicketsInput = z.infer<typeof ListTicketsSchema>;

const UpdateTicketSchema = z.object({
  ticket_id: z.number()
    .int()
    .describe("ID de base de datos del ticket (no el display_id/folio)"),
  status: z.string()
    .optional()
    .describe("Nuevo estado del ticket (e.g. open, in_progress, resolved, closed)"),
  priority: z.enum(["low", "medium", "high", "urgent"])
    .optional()
    .describe("Nueva prioridad"),
  assignee_id: z.number()
    .int()
    .optional()
    .describe("ID del nuevo usuario asignado"),
  description: z.string()
    .optional()
    .describe("Nueva descripción del ticket")
}).strict();

type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;

// --- Response types ---

interface CreateTicketResponse {
  success: boolean;
  folio: string;
  ticket_id: number;
  attachments: Attachment[];
  message: string;
}

interface Attachment {
  id: number;
  message_id: number;
  file_type: string;
  account_id: number;
  data_url: string;
  thumb_url?: string;
  file_size: number;
}

interface TicketContact {
  id: number;
  name: string;
  phone_number: string;
  email: string;
}

interface Ticket {
  id: number;
  folio: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  ticket_type: string;
  service_type: string;
  contract_number: string;
  created_at: string;
  updated_at: string;
  contact: TicketContact;
}

interface ListTicketsResponse {
  success: boolean;
  tickets: Ticket[];
}

interface UpdateTicketResponse {
  success: boolean;
  ticket: {
    id: number;
    folio: string;
    status: string;
    updated_at: string;
  };
  message: string;
}

// --- Tool Registration ---

export function registerTicketTools(server: McpServer): void {
  // 1. Create Ticket
  server.registerTool(
    "tickets_create",
    {
      title: "Crear Ticket",
      description: `Crea un nuevo ticket en el sistema de gestión.

El contacto se crea automáticamente si se proporciona contact_phone o contact_email y no existe uno previo.

Args:
  - title (string, requerido): Título del ticket
  - description (string): Descripción detallada
  - priority (string): low, medium, high, urgent (default: medium)
  - ticket_type (string): ACL, ACT, CON, DIG, FUG, LEC, PAG, REV, URG, GEN (default: GEN)
  - service_type (string): Tipo de servicio (default: general)
  - contract_number (string): Número de contrato
  - conversation_id (number): ID de conversación Chatwoot
  - assignee_id (number): ID del usuario asignado
  - contact_name (string): Nombre del contacto
  - contact_phone (string): Teléfono del contacto
  - contact_email (string): Email del contacto
  - attachment_ids (number[]): IDs de adjuntos existentes

Returns:
  { success: true, folio: "TK-2026-000042", ticket_id: 42, attachments: [...], message: "Ticket creado exitosamente" }`,
      inputSchema: CreateTicketSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: CreateTicketInput) => {
      try {
        const result = await makeApiRequest<CreateTicketResponse>(
          "tickets",
          "POST",
          params as unknown as Record<string, unknown>
        );

        const text = `Ticket creado exitosamente.\nFolio: ${result.folio}\nID: ${result.ticket_id}${result.attachments.length > 0 ? `\nAdjuntos vinculados: ${result.attachments.length}` : ""}`;

        return {
          content: [{ type: "text" as const, text }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: handleApiError(error) }]
        };
      }
    }
  );

  // 2. List Client Tickets
  server.registerTool(
    "tickets_list",
    {
      title: "Listar Tickets del Cliente",
      description: `Obtiene los últimos 10 tickets de un cliente filtrados por contrato o teléfono.

Se requiere al menos uno de los dos filtros.

Args:
  - contract_number (string): Filtrar por número de contrato
  - phone_number (string): Filtrar por número de teléfono

Returns:
  { success: true, tickets: [{ id, folio, title, status, priority, ticket_type, contract_number, created_at, contact: { name, phone_number } }] }`,
      inputSchema: {
        contract_number: z.string().optional().describe("Filtrar por número de contrato"),
        phone_number: z.string().optional().describe("Filtrar por número de teléfono del contacto")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: { contract_number?: string; phone_number?: string }) => {
      if (!params.contract_number && !params.phone_number) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Error: Se requiere contract_number o phone_number." }]
        };
      }

      try {
        const result = await makeApiRequest<ListTicketsResponse>(
          "tickets",
          "GET",
          undefined,
          params as Record<string, unknown>
        );

        if (result.tickets.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No se encontraron tickets para este cliente." }]
          };
        }

        const lines = [`# Tickets del cliente (${result.tickets.length})`, ""];
        for (const t of result.tickets) {
          lines.push(`## ${t.folio} — ${t.title}`);
          lines.push(`- **Estado**: ${t.status} | **Prioridad**: ${t.priority} | **Tipo**: ${t.ticket_type}`);
          lines.push(`- **Contrato**: ${t.contract_number || "N/A"}`);
          lines.push(`- **Contacto**: ${t.contact?.name || "N/A"} (${t.contact?.phone_number || "N/A"})`);
          lines.push(`- **Creado**: ${t.created_at}`);
          lines.push("");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: handleApiError(error) }]
        };
      }
    }
  );

  // 3. Update Ticket
  server.registerTool(
    "tickets_update",
    {
      title: "Actualizar Ticket",
      description: `Actualiza un ticket existente por su ID de base de datos (no el folio/display_id).

Args:
  - ticket_id (number, requerido): ID de base de datos del ticket
  - status (string): Nuevo estado (e.g. open, in_progress, resolved, closed)
  - priority (string): Nueva prioridad (low, medium, high, urgent)
  - assignee_id (number): ID del nuevo usuario asignado
  - description (string): Nueva descripción

Returns:
  { success: true, ticket: { id, folio, status, updated_at }, message: "Ticket actualizado exitosamente" }`,
      inputSchema: UpdateTicketSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: UpdateTicketInput) => {
      try {
        const { ticket_id, ...updateData } = params;
        const result = await makeApiRequest<UpdateTicketResponse>(
          `tickets/${ticket_id}`,
          "PATCH",
          updateData as Record<string, unknown>
        );

        return {
          content: [{ type: "text" as const, text: `Ticket ${result.ticket.folio} actualizado. Estado: ${result.ticket.status}` }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: handleApiError(error) }]
        };
      }
    }
  );
}
