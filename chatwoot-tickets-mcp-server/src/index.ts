#!/usr/bin/env node
/**
 * MCP Server for Chatwoot Agent Tickets API.
 *
 * Provides tools to create, list, update tickets, search customers,
 * and manage attachments via the Chatwoot Agent API.
 *
 * Required environment variables:
 *   CHATWOOT_BASE_URL  - Base URL of Chatwoot instance (e.g. https://app.chatwoot.com)
 *   AGENT_API_TOKEN    - Agent API token for authentication
 *   AGENT_ACCOUNT_ID   - Chatwoot account ID
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { validateConfig } from "./api-client.js";
import { registerTicketTools } from "./tools/tickets.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerAttachmentTools } from "./tools/attachments.js";

const server = new McpServer({
  name: "chatwoot-tickets-mcp-server",
  version: "1.0.0"
});

registerTicketTools(server);
registerCustomerTools(server);
registerAttachmentTools(server);

async function main(): Promise<void> {
  validateConfig();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("chatwoot-tickets-mcp-server running via stdio");
}

main().catch((error: unknown) => {
  console.error("Server error:", error);
  process.exit(1);
});
