/**
 * Paco MCP Base Server
 *
 * Generic MCP server that fetches tool definitions from the Paco backend
 * at startup and executes them dynamically using the handler registry.
 *
 * Follows the same Express + SSE pattern as cea-tools.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { ProxyConfigManager } from "../../shared/proxy-config.js";
import { loadManifest, type ToolManifest, type ToolDefinition } from "./config-loader.js";
import { executeHandler } from "./handler-registry.js";
import { closePools } from "./handlers/sql.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MCP_SERVER_NAME = process.env.MCP_SERVER_NAME || "paco-mcp-base";
const PACO_BACKEND_URL =
  process.env.PACO_BACKEND_URL || "http://paco-backend:8000";
const PORT = parseInt(process.env.PORT || "3000", 10);

// ---------------------------------------------------------------------------
// Output Transform
// ---------------------------------------------------------------------------

/**
 * Simple output transform:
 * - If starts with "$.", treat as JSONPath dot notation (e.g., "$.data.result")
 * - If starts with "//", treat as XML tag extraction (regex-based)
 * - Otherwise return raw response
 */
function applyOutputTransform(raw: string, transform: string): string {
  if (transform.startsWith("$.")) {
    // JSONPath dot-notation extraction
    try {
      const json = JSON.parse(raw);
      const path = transform.substring(2).split(".");
      let current: any = json;
      for (const key of path) {
        if (current == null || typeof current !== "object") {
          return raw;
        }
        current = current[key];
      }
      if (current === undefined || current === null) {
        return raw;
      }
      return typeof current === "string" ? current : JSON.stringify(current);
    } catch {
      return raw;
    }
  }

  if (transform.startsWith("//")) {
    // XML tag extraction
    const tag = transform.substring(2).trim();
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
    const match = raw.match(regex);
    return match ? match[1].trim() : raw;
  }

  // No recognized transform, return raw
  return raw;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // --- Load manifest (with graceful degradation) ---
  let manifest: ToolManifest = {
    server_name: MCP_SERVER_NAME,
    tools: [],
    env: {},
  };

  try {
    manifest = await loadManifest(MCP_SERVER_NAME, PACO_BACKEND_URL);
  } catch (error) {
    console.warn(
      `[Server] Could not load manifest at startup. Starting with empty tools. Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Build a tool lookup map
  let toolMap = new Map<string, ToolDefinition>();
  for (const tool of manifest.tools) {
    toolMap.set(tool.name, tool);
  }

  // --- Initialize proxy config ---
  const proxyManager = new ProxyConfigManager(MCP_SERVER_NAME);
  await proxyManager.initialize();

  // Merge manifest env with process.env (manifest env takes precedence for tool execution,
  // but process.env values override manifest for security-sensitive vars)
  function getToolEnv(): Record<string, string> {
    const env: Record<string, string> = { ...manifest.env };
    // Process env vars override manifest env (allows runtime secrets injection)
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return env;
  }

  // --- Create MCP Server ---
  const server = new Server(
    { name: MCP_SERVER_NAME, version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // --- List Tools Handler ---
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: manifest.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      })),
    };
  });

  // --- Call Tool Handler ---
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const toolDef = toolMap.get(name);
      if (!toolDef) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Unknown tool: "${name}". Available tools: ${[...toolMap.keys()].join(", ")}`,
              }),
            },
          ],
          isError: true,
        };
      }

      // Resolve proxy dispatcher for this tool
      const shouldBypassProxy =
        toolDef.handler_type === "sql" || toolDef.handler_type === "code";
      const dispatcher = shouldBypassProxy
        ? null
        : (() => {
            // For HTTP-based handlers, check proxy config
            const urlField =
              toolDef.handler_config.url || toolDef.handler_config.endpoint || "";
            if (typeof urlField === "string" && proxyManager.shouldBypass(name, urlField)) {
              return null;
            }
            return proxyManager.getDispatcherForTool(name);
          })();

      // Execute handler
      const rawResult = await executeHandler(
        toolDef.handler_type,
        toolDef.handler_config,
        (args ?? {}) as Record<string, any>,
        getToolEnv(),
        name,
        dispatcher,
        toolDef.retry_config,
        toolDef.timeout_ms,
      );

      // Apply output transform if configured
      const result = toolDef.output_transform
        ? applyOutputTransform(rawResult, toolDef.output_transform)
        : rawResult;

      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[Server] Tool "${name}" failed: ${errorMessage}`);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: errorMessage }),
          },
        ],
        isError: true,
      };
    }
  });

  // --- Express App ---
  const app = express();
  const transports = new Map<string, SSEServerTransport>();

  // SSE endpoint
  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    res.on("close", () => transports.delete(transport.sessionId));
    await server.connect(transport);
  });

  // Message endpoint
  app.post("/messages", express.json(), async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).json({ error: "No active SSE connection for this session" });
    }
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      name: MCP_SERVER_NAME,
      version: "1.0.0",
      tools_loaded: manifest.tools.length,
      tool_names: manifest.tools.map((t) => t.name),
    });
  });

  // Reload tools from backend
  app.post("/reload-tools", async (_req, res) => {
    try {
      manifest = await loadManifest(MCP_SERVER_NAME, PACO_BACKEND_URL);
      toolMap = new Map<string, ToolDefinition>();
      for (const tool of manifest.tools) {
        toolMap.set(tool.name, tool);
      }
      res.json({
        status: "ok",
        message: "Tools reloaded",
        tools_loaded: manifest.tools.length,
        tool_names: manifest.tools.map((t) => t.name),
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Reload proxy config
  app.post("/reload-config", async (_req, res) => {
    try {
      await proxyManager.reload();
      res.json({ status: "ok", message: "Config reloaded" });
    } catch (error) {
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Proxy status (for debugging)
  app.get("/proxy-status", (_req, res) => {
    res.json(proxyManager.getStatus());
  });

  // --- Start Listening ---
  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[Server] ${MCP_SERVER_NAME} MCP server running on http://0.0.0.0:${PORT}`,
    );
    console.log(
      `[Server] Tools loaded: ${manifest.tools.length} [${manifest.tools.map((t) => t.name).join(", ")}]`,
    );
  });

  // --- Graceful Shutdown ---
  const shutdown = async () => {
    console.log("[Server] Shutting down...");
    await closePools();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[Server] Fatal error:", err);
  process.exit(1);
});
