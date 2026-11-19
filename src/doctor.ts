import type { ZenithContext } from "./core/context.js";
import { healthCheck } from "./core/health.js";
import { VERSION } from "./version.js";

type Line = { ok: boolean | null; label: string; detail: string };

const mark = (ok: boolean | null) => (ok === null ? "  -  " : ok ? " OK  " : "FAIL ");

/** Self-check for `zenith-evm-mcp --doctor`. Prints to stderr-safe stdout and returns overall success. */
export async function runDoctor(ctx: ZenithContext): Promise<boolean> {
  const lines: Line[] = [];
  const add = (ok: boolean | null, label: string, detail: string) =>
    lines.push({ ok, label, detail });

  try {
    const chainId = await ctx.client.getChainId();
    add(chainId === ctx.network.chainId, "RPC chain ID", `${chainId} at ${ctx.network.rpcUrl}`);
  } catch (err) {
    add(false, "RPC", (err as Error).message);
  }

  try {
    const h = await healthCheck(ctx);
    for (const [name, c] of Object.entries(h.components)) add(c.ok, name, c.detail);
    add(h.verdict === "healthy" || h.verdict === "idle", "Verdict", `${h.verdict}: ${h.summary}`);
    add(
      null,
      "Faucet",
      "rule" in h.faucet
        ? `${h.faucet.amountPerClaim ?? "?"} per ${h.faucet.cooldown}. ${h.faucet.rule}`
        : "unavailable",
    );
  } catch (err) {
    add(false, "Health", (err as Error).message);
  }

  try {
    const { loadSigner } = await import("./core/wallet.js");
    const signer = loadSigner(ctx);
    add(
      null,
      "Write tools",
      signer
        ? `enabled for ${signer.address} (spend cap ${signer.spendCapZth} ZTH per session)`
        : "disabled (no ZENITH_PRIVATE_KEY or ZENITH_KEY_FILE)",
    );
  } catch (err) {
    add(false, "Write tools", (err as Error).message);
  }

  console.log(`zenith-evm-mcp ${VERSION} doctor\n`);
  for (const l of lines) console.log(`[${mark(l.ok)}] ${l.label.padEnd(12)} ${l.detail}`);
  const ok = lines.every((l) => l.ok !== false);
  console.log(`\n${ok ? "Everything looks good." : "Some checks failed."}`);
  return ok;
}
