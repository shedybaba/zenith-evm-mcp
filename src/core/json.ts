/** Converts a value into plain JSON: bigints become decimal strings, Maps/Sets become objects/arrays. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value instanceof Map)
    return Object.fromEntries([...value].map(([k, v]) => [String(k), toJsonSafe(v)]));
  if (value instanceof Set) return [...value].map(toJsonSafe);
  if (value instanceof Error) return { name: value.name, message: value.message };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = toJsonSafe(v);
  }
  return out;
}

export function stringify(value: unknown): string {
  return JSON.stringify(toJsonSafe(value), null, 2);
}
