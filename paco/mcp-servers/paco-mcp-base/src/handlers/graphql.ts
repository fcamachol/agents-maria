/**
 * GraphQL Handler
 *
 * Executes GraphQL queries against a specified endpoint.
 * Renders variable templates and headers before sending.
 */

import { fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";
import { renderTemplate, renderObject } from "../template-engine.js";

export interface GraphqlConfig {
  url: string;
  query: string; // GraphQL query string
  variables?: Record<string, any>; // template values
  headers?: Record<string, string>;
}

export async function graphqlHandler(
  config: GraphqlConfig,
  args: Record<string, any>,
  env: Record<string, string>,
  toolName: string,
  dispatcher: Dispatcher | null,
  timeoutMs: number = 30000,
): Promise<string> {
  const url = renderTemplate(config.url, args, env);

  // Render variables (template substitution in variable values)
  const variables = config.variables
    ? renderObject(config.variables, args, env)
    : undefined;

  // Render headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.headers
      ? (renderObject(config.headers, args, env) as Record<string, string>)
      : {}),
  };

  // GraphQL query is sent as-is (not template-rendered, variables handle dynamic parts)
  const body = JSON.stringify({
    query: config.query,
    variables,
  });

  let response: Response;
  if (dispatcher) {
    response = (await undiciFetch(url, {
      method: "POST",
      headers,
      body,
      dispatcher,
      // @ts-ignore
      signal: AbortSignal.timeout(timeoutMs),
    })) as unknown as Response;
  } else {
    response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `GraphQL HTTP ${response.status}: ${text.substring(0, 500)}`,
    );
  }

  // Parse and check for GraphQL-level errors
  try {
    const json = JSON.parse(text);
    if (json.errors && json.errors.length > 0) {
      return JSON.stringify({ errors: json.errors, data: json.data ?? null });
    }
    if (json.data !== undefined) {
      return JSON.stringify(json.data);
    }
  } catch {
    // If not valid JSON, return as-is
  }

  return text;
}
