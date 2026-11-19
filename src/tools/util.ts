import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { stringify, toJsonSafe } from "../core/json.js";

export const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

/** A tool result with a one-line summary for people and the full data as structured JSON. */
export function ok(summary: string, data: unknown): CallToolResult {
  const structured = toJsonSafe(data);
  return {
    content: [{ type: "text", text: `${summary}\n\n${stringify(data)}` }],
    structuredContent:
      structured && typeof structured === "object" && !Array.isArray(structured)
        ? (structured as Record<string, unknown>)
        : { result: structured },
  };
}

export function fail(message: string, data?: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      { type: "text", text: data === undefined ? message : `${message}\n\n${stringify(data)}` },
    ],
  };
}

/** Runs a tool body and turns thrown errors into readable tool errors. */
export async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    const e = err as Error & { shortMessage?: string; details?: string };
    return fail(
      e.shortMessage ?? e.message ?? String(err),
      e.details ? { details: e.details } : undefined,
    );
  }
}
