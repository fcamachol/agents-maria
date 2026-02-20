/**
 * HTTP REST Handler
 *
 * Executes REST API calls with template-rendered URLs, headers, body, and query params.
 * Supports optional proxy via ProxyConfigManager from shared.
 */

import { fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";
import { renderTemplate, renderObject } from "../template-engine.js";

export interface HttpRestConfig {
  method: string; // GET, POST, PUT, DELETE, PATCH
  url: string; // template string with {{args.*}} and {{env.*}}
  headers?: Record<string, string>; // template strings
  body_template?: string; // JSON template string
  query_params?: Record<string, string>; // template strings
}

export async function httpRestHandler(
  config: HttpRestConfig,
  args: Record<string, any>,
  env: Record<string, string>,
  toolName: string,
  dispatcher: Dispatcher | null,
  timeoutMs: number = 30000,
): Promise<string> {
  // Render URL
  let url = renderTemplate(config.url, args, env);

  // Render and append query params
  if (config.query_params) {
    const rendered = renderObject(config.query_params, args, env) as Record<string, string>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(rendered)) {
      if (value !== "") {
        params.append(key, value);
      }
    }
    const qs = params.toString();
    if (qs) {
      url += (url.includes("?") ? "&" : "?") + qs;
    }
  }

  // Render headers
  const headers: Record<string, string> = config.headers
    ? (renderObject(config.headers, args, env) as Record<string, string>)
    : {};

  // Render body
  let body: string | undefined;
  if (config.body_template) {
    body = renderTemplate(config.body_template, args, env);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const method = config.method.toUpperCase();

  let response: Response;
  if (dispatcher) {
    response = (await undiciFetch(url, {
      method,
      headers,
      body,
      dispatcher,
      // @ts-ignore - AbortSignal.timeout is valid
      signal: AbortSignal.timeout(timeoutMs),
    })) as unknown as Response;
  } else {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}: ${text.substring(0, 500)}`,
    );
  }

  return text;
}
