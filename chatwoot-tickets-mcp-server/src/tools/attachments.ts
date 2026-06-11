import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeApiRequest, handleApiError } from "../api-client.js";

// --- Response types ---

interface Attachment {
  id: number;
  message_id: number;
  file_type: string;
  account_id: number;
  data_url: string;
  thumb_url?: string;
  file_size: number;
  width?: number;
  height?: number;
}

interface AttachmentsResponse {
  success: boolean;
  attachments: Attachment[];
}

// --- Tool Registration ---

export function registerAttachmentTools(server: McpServer): void {
  // Get Conversation Attachments
  server.registerTool(
    "attachments_get_conversation",
    {
      title: "Obtener Adjuntos de Conversación",
      description: `Obtiene los adjuntos (imágenes, archivos) de una conversación de Chatwoot.

Usa el display_id de la conversación. Excluye adjuntos de tipo ubicación.
Útil para obtener los IDs de adjuntos antes de vincularlos a un ticket.

Args:
  - conversation_id (number, requerido): display_id de la conversación

Returns:
  { success: true, attachments: [{ id, message_id, file_type, data_url, thumb_url, file_size, width, height }] }`,
      inputSchema: {
        conversation_id: z.number()
          .int()
          .describe("display_id de la conversación de Chatwoot")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: { conversation_id: number }) => {
      try {
        const result = await makeApiRequest<AttachmentsResponse>(
          `conversations/${params.conversation_id}/attachments`,
          "GET"
        );

        if (result.attachments.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No se encontraron adjuntos en esta conversación." }]
          };
        }

        const lines = [`# Adjuntos de conversación #${params.conversation_id} (${result.attachments.length})`, ""];
        for (const a of result.attachments) {
          lines.push(`- **ID ${a.id}**: ${a.file_type} (${formatFileSize(a.file_size)})${a.width ? ` — ${a.width}x${a.height}` : ""}`);
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

  // Link Attachments to Ticket
  server.registerTool(
    "attachments_link_to_ticket",
    {
      title: "Vincular Adjuntos a Ticket",
      description: `Vincula adjuntos existentes (e.g. de una conversación) a un ticket.

Usa el ID de base de datos del ticket (no el folio). Los duplicados se ignoran silenciosamente.

Args:
  - ticket_id (number, requerido): ID de base de datos del ticket
  - attachment_ids (number[], requerido): IDs de los adjuntos a vincular

Returns:
  { success: true, attachments: [{ id, message_id, file_type, data_url, file_size }] }`,
      inputSchema: {
        ticket_id: z.number()
          .int()
          .describe("ID de base de datos del ticket (no el folio/display_id)"),
        attachment_ids: z.array(z.number().int())
          .min(1, "Se requiere al menos un attachment_id")
          .describe("IDs de adjuntos existentes a vincular")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: { ticket_id: number; attachment_ids: number[] }) => {
      try {
        const result = await makeApiRequest<AttachmentsResponse>(
          `tickets/${params.ticket_id}/attachments`,
          "POST",
          { attachment_ids: params.attachment_ids }
        );

        return {
          content: [{ type: "text" as const, text: `${result.attachments.length} adjunto(s) vinculado(s) al ticket.` }]
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
