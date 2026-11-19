import type { AbiParameter } from "viem";

/**
 * Converts loosely typed arguments (as an agent sends them, often strings) into the
 * values viem expects for each ABI parameter type.
 */
export function coerceArg(param: AbiParameter, value: unknown): unknown {
  const type = param.type;
  if (type.endsWith("]")) {
    const inner = { ...param, type: type.slice(0, type.lastIndexOf("[")) } as AbiParameter;
    const list =
      typeof value === "string" ? (JSON.parse(value) as unknown[]) : (value as unknown[]);
    if (!Array.isArray(list)) throw new Error(`Argument "${param.name ?? type}" must be an array`);
    return list.map((v) => coerceArg(inner, v));
  }
  if (type === "tuple") {
    const components = (param as { components?: readonly AbiParameter[] }).components ?? [];
    const obj = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    if (Array.isArray(obj)) return components.map((c, i) => coerceArg(c, obj[i]));
    const rec = obj as Record<string, unknown>;
    return Object.fromEntries(
      components.map((c, i) => [c.name ?? String(i), coerceArg(c, rec[c.name ?? String(i)])]),
    );
  }
  if (/^u?int\d*$/.test(type)) {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(value);
    if (typeof value === "string") return BigInt(value.trim());
    throw new Error(`Argument "${param.name ?? type}" must be an integer`);
  }
  if (type === "bool") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    throw new Error(`Argument "${param.name ?? type}" must be true or false`);
  }
  return value;
}

export function coerceArgs(params: readonly AbiParameter[], values: unknown[] = []): unknown[] {
  if (values.length !== params.length) {
    throw new Error(
      `Expected ${params.length} argument(s) (${params.map((p) => `${p.type} ${p.name ?? ""}`.trim()).join(", ")}), got ${values.length}`,
    );
  }
  return params.map((p, i) => coerceArg(p, values[i]));
}
