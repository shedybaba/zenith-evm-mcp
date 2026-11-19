import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { gatewayActivity } from "../core/activity.js";
import { DOC_LINKS } from "../core/config.js";
import type { ZenithContext } from "../core/context.js";
import { convertAmount } from "../core/convert.js";
import { depositStatus } from "../core/deposit.js";
import { tokenEligibility } from "../core/eligibility.js";
import { resolveInbox } from "../core/inbox.js";
import { gatewayPreflight } from "../core/preflight.js";
import { loadGatewayTokens, matchGatewayToken } from "../core/tokens.js";
import { fail, guard, ok, READ_ONLY } from "./util.js";

const party = z.string().describe("Full Canton party ID: hint::1220 followed by 64 hex digits");
const token = z
  .string()
  .describe(
    'Token: "ZTH", a symbol (e.g. DevUSD, DORIG), a Canton instrument ID or an ERC-20 address',
  );

const MAILBOX_STATES: Record<string, string> = {
  absent:
    "No mailbox yet. Request it once (it needs a Canton party as requester); Zenith approves it and it is active about 2 minutes later.",
  requested: "Requested and waiting for Zenith's approval. A waiting request expires after 1 day.",
  approved: "Approved; being set up. Keep checking.",
  hosted: "Being set up. Keep checking.",
  imported: "Being set up. Keep checking.",
  active: "Active: a CIP-56 transfer to this party on Canton arrives at the EVM address.",
};

export function registerGatewayTools(server: McpServer, ctx: ZenithContext) {
  server.registerTool(
    "gateway_tokens",
    {
      title: "Tokens Gateway can move",
      description:
        "Every token registered with Zenith Gateway, with both sides: EVM address, symbol and decimals; Canton instrument, symbol and scale; how each direction works and what the recipient needs (for example a standing acceptance for wrappers of Canton tokens).",
      annotations: READ_ONLY,
    },
    () =>
      guard(async () => {
        const tokens = await loadGatewayTokens(ctx);
        return ok(
          `${tokens.length} registered token(s): ${tokens.map((t) => `${t.key} → ${t.canton.symbol}`).join(", ")}.`,
          { tokens },
        );
      }),
  );

  server.registerTool(
    "gateway_inbox",
    {
      title: "Canton party → inbox address",
      description:
        "Checks a Canton party ID and computes its inbox: the EVM address that delivers to that party on Canton. Rejects shortened IDs, protocol parties (m-, r-, b-) and the Gateway party, says whether the inbox is deployed, and cross-checks the registry API.",
      inputSchema: { partyId: party },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const r = await resolveInbox(ctx, args.partyId);
        if (!r.party.valid)
          return fail(
            `Invalid recipient: ${r.party.issues
              .filter((i) => i.severity === "error")
              .map((i) => i.message)
              .join(" ")}`,
            r,
          );
        return ok(
          `Inbox of ${r.party.party.slice(0, 24)}…: ${r.inbox} (${r.deployed ? "deployed" : "not deployed yet"}).`,
          r,
        );
      }),
  );

  server.registerTool(
    "gateway_preflight",
    {
      title: "Check a send to Canton (Before-you-send checklist)",
      description:
        'Runs every rule in Zenith\'s "Before you send" checklist for a transfer from Zenith EVM to a Canton party, then dry-runs the exact transaction against the network (eth_estimateGas) to surface its own refusal reason. Returns pass/fail per check with fixes, the amount that arrives on Canton, and the unsigned transaction. Never sends anything. ALWAYS call this before sending to a Canton party.',
      inputSchema: {
        partyId: party,
        token,
        amount: z.string().describe('Amount, e.g. "0.5"'),
        amountUnit: z
          .enum(["token", "base"])
          .default("token")
          .describe("token = whole tokens (default); base = EVM base units / wei"),
        from: z
          .string()
          .optional()
          .describe("Sender address; enables the balance check and the live dry run"),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const r = await gatewayPreflight(ctx, args);
        const lines = r.checks
          .map((c) => `${{ pass: "✓", fail: "✗", warn: "!", skip: "·" }[c.status]} ${c.title}`)
          .join("\n");
        return ok(`${r.summary}\n${lines}`, r);
      }),
  );

  server.registerTool(
    "gateway_deposit_status",
    {
      title: "Track a Gateway deposit",
      description:
        "Follows a Zenith EVM → Canton deposit by transaction hash: held by Gateway (with reason and eviction time), evicted (with the nonce to resend at), mined and waiting for the inbox, credited (with the Gateway collection event), or not a deposit. Gives the exact next step from the docs' Common problems table.",
      inputSchema: {
        hash: z.string().describe("EVM transaction hash"),
        from: z
          .string()
          .optional()
          .describe("Sender address (helps when the transaction was evicted)"),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const r = await depositStatus(ctx, args.hash, { from: args.from });
        return ok(
          `${r.stage.toUpperCase()}: ${r.explanation}${r.nextSteps.length ? `\nNext: ${r.nextSteps.join(" ")}` : ""}`,
          r,
        );
      }),
  );

  server.registerTool(
    "gateway_mailbox",
    {
      title: "Mailbox party for Canton → EVM",
      description:
        "Derives the mailbox party for an EVM address and token (the Canton party you transfer to, to move that token to that EVM address) and reports its state: absent, requested, active and so on. Explains how to request it.",
      inputSchema: { evmAddress: z.string().describe("Destination EVM address"), token },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        if (!isAddress(args.evmAddress, { strict: false }))
          return fail(`"${args.evmAddress}" is not an EVM address.`);
        const evm = getAddress(args.evmAddress);
        const t = matchGatewayToken(await loadGatewayTokens(ctx), args.token);
        if (!t)
          return fail(
            `"${args.token}" is not a registered Gateway token. Use gateway_tokens to list them.`,
          );
        const instrument = { admin: t.canton.admin, id: t.canton.instrumentId };
        const [derived, state] = await Promise.all([
          ctx.gateway.deriveMailbox(evm, instrument),
          ctx.gateway.mailboxState(evm, instrument),
        ]);
        const result = {
          evmAddress: evm,
          token: t.key,
          instrument,
          mailboxParty: derived.party ?? state.party ?? null,
          eligible: derived.eligible,
          state: state.state,
          meaning: MAILBOX_STATES[state.state] ?? "Unknown state.",
          request:
            state.state === "absent"
              ? {
                  method: "POST",
                  url: `${ctx.network.gatewayApiUrl}/v1/provisioning-requests`,
                  body: {
                    requester: "<your full Canton party ID>",
                    kind: "mailbox",
                    evmAddress: evm,
                    instrumentAdmin: instrument.admin,
                    instrumentId: instrument.id,
                  },
                }
              : null,
          rules:
            "Transfer only once the mailbox is active, with executeBefore at least 180 seconds away (a day is usual). Use the mailbox of this exact token.",
          docs: DOC_LINKS.workflows,
        };
        return ok(`Mailbox for ${t.key} → ${evm}: ${state.state}. ${result.meaning}`, result);
      }),
  );

  server.registerTool(
    "gateway_convert",
    {
      title: "Convert amounts between Zenith EVM and Canton",
      description:
        "Exact amount conversion for a Gateway token, in either direction, with the crossing rules applied: one EVM base unit is 1e-10 on Canton, 18-decimal tokens show 10^8 times larger on Canton (DORIGe-8), ZTH crosses in multiples of 10^8 wei and wZTH back in whole gwei. Never rounds silently.",
      inputSchema: {
        token,
        direction: z.enum(["to-canton", "to-evm"]),
        amount: z.string(),
        unit: z
          .enum(["token", "base"])
          .default("token")
          .describe("For to-canton: whole tokens or EVM base units"),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const t = matchGatewayToken(await loadGatewayTokens(ctx), args.token);
        if (!t) return fail(`"${args.token}" is not a registered Gateway token.`);
        const r = convertAmount(t, args);
        const ev = "evm" in r && r.evm ? `${r.evm.amount} ${r.evm.symbol}` : "?";
        const ca = "canton" in r && r.canton ? `${r.canton.amount} ${r.canton.symbol}` : "?";
        return ok(
          r.crossesExactly
            ? args.direction === "to-canton"
              ? `${ev} → ${ca} on Canton.`
              : `${ca} → ${ev} on Zenith EVM.`
            : `Cannot cross as given: ${r.note}`,
          r,
        );
      }),
  );

  server.registerTool(
    "gateway_token_eligibility",
    {
      title: "Pre-screen an ERC-20 for Gateway registration",
      description:
        "Checks an ERC-20 against Zenith's registration criteria: verified source, deployment transaction, not upgradeable, no fee/burn/reflection/rebase/hook/blocklist functions (bytecode selector scan), and a simulated transfer from a real holder (eth_call with a state override) proving it moves exactly the amount. Prepares what Zenith asks for in a request.",
      inputSchema: { address: z.string().describe("ERC-20 token address on Zenith EVM") },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const r = await tokenEligibility(ctx, args.address);
        const lines = r.checks
          .map((c) => `${{ pass: "✓", fail: "✗", warn: "!", skip: "·" }[c.status]} ${c.title}`)
          .join("\n");
        return ok(`${r.verdict.toUpperCase()}: ${r.summary}\n${lines}`, r);
      }),
  );

  server.registerTool(
    "gateway_activity",
    {
      title: "Recent Gateway crossings",
      description:
        "Recent token crossings between Zenith EVM and Canton, decoded from the Gateway contract's own events (Collected, NativeCollected, Minted, Released), with per-token counts by direction.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(25),
        includeSetup: z
          .boolean()
          .default(false)
          .describe("Also list registration events (wrappers, vaults, metadata)"),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      guard(async () => {
        const r = await gatewayActivity(ctx, args);
        return ok(`${r.totalCrossings} crossing(s) recorded; showing ${r.recent.length}.`, r);
      }),
  );
}
