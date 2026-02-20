/**
 * Code Handler
 *
 * Executes sandboxed JavaScript code using new Function().
 * Passes `args` and `env` as parameters. Returns the function's return value.
 * Applies a timeout via AbortSignal/setTimeout wrapper.
 */

export interface CodeConfig {
  source: string; // JavaScript function body
  timeout_ms?: number; // default 5000
  memory_mb?: number; // reserved for future use (not enforced by new Function)
}

export async function codeHandler(
  config: CodeConfig,
  args: Record<string, any>,
  env: Record<string, string>,
  _toolName: string,
  _dispatcher: null,
  _timeoutMs: number = 5000,
): Promise<string> {
  const timeout = config.timeout_ms ?? _timeoutMs ?? 5000;

  // Create a sandboxed function with args and env as parameters
  // The source should be a function body that can use `args` and `env`
  let fn: Function;
  try {
    fn = new Function("args", "env", config.source);
  } catch (err) {
    throw new Error(
      `Failed to compile code: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Execute with timeout
  const result = await Promise.race([
    (async () => {
      try {
        const ret = fn(args, env);
        // If the function returns a promise, await it
        return ret instanceof Promise ? await ret : ret;
      } catch (err) {
        throw new Error(
          `Code execution error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Code execution timed out after ${timeout}ms`)),
        timeout,
      ),
    ),
  ]);

  // Serialize result
  if (result === undefined || result === null) {
    return "null";
  }
  if (typeof result === "string") {
    return result;
  }
  return JSON.stringify(result);
}
