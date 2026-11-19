import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parseEther, type Address } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { ZenithContext } from "./context.js";

export interface Signer {
  address: Address;
  account: PrivateKeyAccount;
  spendCapZth: string;
  spendCapWei: bigint;
}

const KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;

function readKeyFile(path: string): string | undefined {
  const resolved = path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path;
  const text = readFileSync(resolved, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const value = line.includes("=")
      ? line
          .slice(line.indexOf("=") + 1)
          .trim()
          .replace(/^["']|["']$/g, "")
      : line;
    if (line.includes("=") && !/^(export\s+)?ZENITH_PRIVATE_KEY\s*=/.test(line)) continue;
    if (KEY_RE.test(value)) return value;
  }
  return undefined;
}

/**
 * Loads the testnet signer for write tools. Write tools stay disabled unless the user
 * explicitly sets ZENITH_PRIVATE_KEY or ZENITH_KEY_FILE.
 */
export function loadSigner(ctx: ZenithContext): Signer | null {
  let key = ctx.env.ZENITH_PRIVATE_KEY?.trim();
  if (!key && ctx.env.ZENITH_KEY_FILE) key = readKeyFile(ctx.env.ZENITH_KEY_FILE);
  if (!key) return null;
  if (!KEY_RE.test(key)) throw new Error("The configured key is not a 32-byte hex private key.");
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
  const spendCapZth = ctx.env.ZENITH_SPEND_CAP_ZTH?.trim() || "1";
  return { address: account.address, account, spendCapZth, spendCapWei: parseEther(spendCapZth) };
}
