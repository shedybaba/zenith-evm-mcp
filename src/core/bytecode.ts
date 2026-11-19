import { toFunctionSelector, type Hex } from "viem";

export const OPCODES = {
  NUMBER: 0x43,
  PREVRANDAO: 0x44,
  BLOBHASH: 0x49,
  BLOBBASEFEE: 0x4a,
  DELEGATECALL: 0xf4,
  SELFDESTRUCT: 0xff,
} as const;

/** Opcodes present in runtime bytecode, skipping PUSH data so data bytes are not mistaken for opcodes. */
export function scanOpcodes(code: Hex): Set<number> {
  const bytes = Buffer.from(code.slice(2), "hex");
  const seen = new Set<number>();
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i]!;
    seen.add(op);
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  return seen;
}

/** True when the dispatcher pushes this 4-byte selector (PUSH4 <selector>), as solc and vyper do. */
export function hasSelector(code: Hex, signature: string): boolean {
  return code.toLowerCase().includes(`63${toFunctionSelector(signature).slice(2)}`);
}

export function matchSelectors(code: Hex, signatures: readonly string[]): string[] {
  return signatures.filter((s) => hasSelector(code, s));
}
