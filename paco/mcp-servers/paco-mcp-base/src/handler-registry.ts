/**
 * Handler Registry
 *
 * Maps handler_type strings to executor functions and orchestrates
 * handler execution with retry logic and timeout.
 */

import type { Dispatcher } from "undici";
import { httpRestHandler, type HttpRestConfig } from "./handlers/http-rest.js";
import { httpSoapHandler, type HttpSoapConfig } from "./handlers/http-soap.js";
import { sqlHandler, type SqlConfig } from "./handlers/sql.js";
import { graphqlHandler, type GraphqlConfig } from "./handlers/graphql.js";
import { codeHandler, type CodeConfig } from "./handlers/code.js";

export interface RetryConfig {
  max_retries: number;
  delay_ms: number;
  backoff_factor: number;
}

export type HandlerExecutor = (
  config: any,
  args: Record<string, any>,
  env: Record<string, string>,
  toolName: string,
  dispatcher: Dispatcher | null,
  timeoutMs?: number,
) => Promise<string>;

const handlerMap: Record<string, HandlerExecutor> = {
  http_rest: httpRestHandler as HandlerExecutor,
  http_soap: httpSoapHandler as HandlerExecutor,
  sql: sqlHandler as HandlerExecutor,
  graphql: graphqlHandler as HandlerExecutor,
  code: codeHandler as HandlerExecutor,
};

/**
 * Execute a handler by type, with optional retry logic and timeout.
 */
export async function executeHandler(
  handlerType: string,
  config: any,
  args: Record<string, any>,
  env: Record<string, string>,
  toolName: string,
  dispatcher: Dispatcher | null,
  retryConfig?: RetryConfig,
  timeoutMs?: number,
): Promise<string> {
  const handler = handlerMap[handlerType];
  if (!handler) {
    throw new Error(
      `Unknown handler type: "${handlerType}". Available types: ${Object.keys(handlerMap).join(", ")}`,
    );
  }

  const maxRetries = retryConfig?.max_retries ?? 0;
  const delayMs = retryConfig?.delay_ms ?? 1000;
  const backoffFactor = retryConfig?.backoff_factor ?? 2;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await handler(config, args, env, toolName, dispatcher, timeoutMs);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[HandlerRegistry] ${toolName} attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}`,
      );

      if (attempt < maxRetries) {
        const delay = delayMs * Math.pow(backoffFactor, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error("Handler execution failed");
}
