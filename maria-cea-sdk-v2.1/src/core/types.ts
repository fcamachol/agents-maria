// ============================================
// Core layer - shared types & helpers
//
// The `core/` layer holds the channel-agnostic orchestration that used to
// live inside the SDK `tool()` wrappers. Each core function returns the EXACT
// plain object that the tool wrapper previously passed to `JSON.stringify`,
// so wrapping it with `toToolResult` reproduces byte-identical tool output.
//
// Voice (maria-voz) imports these core functions directly and reads the
// structured `data` field instead of the markdown `formatted_response`.
// ============================================

/**
 * The plain result object produced by a core function. This is whatever the
 * original tool handler used to `JSON.stringify`. Kept intentionally loose so
 * every existing shape (success/data/formatted_response/error/…) round-trips
 * unchanged.
 */
export interface ToolResultObject {
    success?: boolean;
    formatted_response?: string;
    data?: unknown;
    error?: string;
    [key: string]: unknown;
}

/**
 * Wrap a core result object into the MCP tool content envelope. This is the
 * single boundary where structured data becomes the stringified tool output —
 * matching the previous inline `{ content: [{ type: "text", text: JSON.stringify(x) }] }`.
 */
export function toToolResult(obj: ToolResultObject) {
    return { content: [{ type: "text" as const, text: JSON.stringify(obj) }] };
}
