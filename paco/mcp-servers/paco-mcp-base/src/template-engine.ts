/**
 * Template Engine
 *
 * Replaces {{args.fieldName}} and {{env.VAR_NAME}} placeholders in strings.
 * Supports nested object access (e.g., {{args.data.name}}).
 * If a variable is not found, it is replaced with an empty string.
 */

/**
 * Resolve a dot-notation path from an object.
 * e.g., getNestedValue({ data: { name: "foo" } }, "data.name") => "foo"
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  const parts = path.split(".");
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * Render a single template string, replacing all {{args.*}} and {{env.*}} placeholders.
 */
export function renderTemplate(
  template: string,
  args: Record<string, any>,
  env: Record<string, string>,
): string {
  return template.replace(/\{\{(args|env)\.([^}]+)\}\}/g, (_match, source: string, path: string) => {
    if (source === "args") {
      const value = getNestedValue(args, path);
      if (value === undefined || value === null) {
        return "";
      }
      if (typeof value === "object") {
        return JSON.stringify(value);
      }
      return String(value);
    }
    if (source === "env") {
      return env[path] ?? "";
    }
    return "";
  });
}

/**
 * Recursively render templates in all string values within an object, array, or primitive.
 */
export function renderObject(
  obj: any,
  args: Record<string, any>,
  env: Record<string, string>,
): any {
  if (typeof obj === "string") {
    return renderTemplate(obj, args, env);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => renderObject(item, args, env));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = renderObject(value, args, env);
    }
    return result;
  }
  // numbers, booleans, null, undefined -- pass through
  return obj;
}
