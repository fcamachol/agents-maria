import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeApiRequest, handleApiError } from "../api-client.js";

// --- Response types ---

interface Customer {
  id: number;
  name: string;
  phone_number: string;
  email: string;
  additional_attributes: Record<string, unknown>;
  created_at: string;
}

interface SearchCustomerResponse {
  success: boolean;
  customer: Customer;
}

// --- Tool Registration ---

export function registerCustomerTools(server: McpServer): void {
  server.registerTool(
    "customers_search",
    {
      title: "Buscar Cliente",
      description: `Busca un cliente por número de contrato o número de teléfono.

La búsqueda por contract_number encuentra contactos a través de tickets asociados.
La búsqueda por phone_number encuentra directamente en contactos.

Args:
  - contract_number (string): Buscar por número de contrato
  - phone_number (string): Buscar por número de teléfono

Returns:
  { success: true, customer: { id, name, phone_number, email, additional_attributes, created_at } }

Si no se encuentra: { success: false, message: "Cliente no encontrado" } (404)`,
      inputSchema: {
        contract_number: z.string().optional().describe("Buscar por número de contrato (encuentra via tickets)"),
        phone_number: z.string().optional().describe("Buscar por número de teléfono (encuentra directamente)")
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
        const result = await makeApiRequest<SearchCustomerResponse>(
          "customers/search",
          "GET",
          undefined,
          params as Record<string, unknown>
        );

        const c = result.customer;
        const text = [
          `# Cliente encontrado`,
          `- **Nombre**: ${c.name}`,
          `- **Teléfono**: ${c.phone_number || "N/A"}`,
          `- **Email**: ${c.email || "N/A"}`,
          `- **ID**: ${c.id}`,
          `- **Creado**: ${c.created_at}`
        ].join("\n");

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
}
