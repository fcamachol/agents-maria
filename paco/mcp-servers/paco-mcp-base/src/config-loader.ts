/**
 * Config Loader
 *
 * Fetches the tool manifest from the Paco backend.
 * The manifest contains server name, tool definitions, and environment variables.
 */

import type { RetryConfig } from "./handler-registry.js";

export interface ToolManifest {
  server_name: string;
  tools: ToolDefinition[];
  env: Record<string, string>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  handler_type: string;
  handler_config: Record<string, any>;
  output_transform?: string;
  retry_config?: RetryConfig;
  timeout_ms?: number;
}

/**
 * Load the tool manifest from the Paco backend.
 *
 * GET {backendUrl}/api/tools/servers/by-name/{serverName}/manifest
 */
export async function loadManifest(
  serverName: string,
  backendUrl: string,
): Promise<ToolManifest> {
  const url = `${backendUrl}/api/tools/servers/by-name/${encodeURIComponent(serverName)}/manifest`;

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new Error(
      `Failed to connect to Paco backend at ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Paco backend returned HTTP ${response.status} for manifest: ${body.substring(0, 300)}`,
    );
  }

  const manifest: ToolManifest = await response.json();

  // Validate basic shape
  if (!manifest.server_name || !Array.isArray(manifest.tools)) {
    throw new Error(
      "Invalid manifest format: expected { server_name, tools[], env? }",
    );
  }

  // Ensure env is always an object
  if (!manifest.env) {
    manifest.env = {};
  }

  console.log(
    `[ConfigLoader] Loaded manifest for "${manifest.server_name}" with ${manifest.tools.length} tools`,
  );

  return manifest;
}
