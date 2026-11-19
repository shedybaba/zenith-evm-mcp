/**
 * Every warning in the Zenith testnet docs that can lose tokens or strand a transfer, as a named test.
 * Section names refer to https://docs.zenith.network/zenith-testnet.
 */
import { describe, expect, it } from "vitest";
import { evaluatePreflight, explainRefusal } from "../../src/core/preflight.js";
import { checkPartyId } from "../../src/core/party.js";
import { cantonToErc20Base, cantonToZthWei, erc20BaseToCanton } from "../../src/core/units.js";
import { depositStatus } from "../../src/core/deposit.js";
import { getLogs } from "../../src/core/logs.js";
import { healthCheck } from "../../src/core/health.js";
import { DEVUSD, fakeContext, goodFacts, NS, PARTY_CTX, SENDER } from "../fakes.js";
import chain from "../fixtures/gateway-chain.json" with { type: "json" };

const check = (facts: ReturnType<typeof goodFacts>, id: string) =>
  evaluatePreflight(facts).checks.find((c) => c.id === id);

describe("baseline", () => {
  it("a correct send is READY and returns the transaction to sign", () => {
    const r = evaluatePreflight(goodFacts());
    expect(r.verdict).toBe("ready");
    expect(r.transaction).not.toBeNull();
    expect(r.arrivesOnCanton).toEqual({ amount: "0.5", symbol: "wZTH" });
  });
});

describe("Before you send: use full party IDs", () => {
  it("blocks a hint without its ::namespace (its inbox belongs to no party; tokens are lost)", () => {
    const party = checkPartyId("alice", PARTY_CTX);
    const r = evaluatePreflight(goodFacts({ party, inbox: null }));
    expect(r.verdict).toBe("blocked");
    expect(r.checks.find((c) => c.id === "party_id_complete")?.status).toBe("fail");
    expect(r.transaction).toBeNull();
  });

  it("blocks an ID copied from a console's shortened display", () => {
    const party = checkPartyId("alice::1220b64a…eff2", PARTY_CTX);
    expect(check(goodFacts({ party, inbox: null }), "party_id_complete")?.status).toBe("fail");
  });
});

describe("Before you send: never send to protocol parties or the Gateway party", () => {
  it.each(["m-", "r-", "b-"])("blocks a %s protocol party (Gateway never credits it)", (prefix) => {
    const party = checkPartyId(`${prefix}abc::${chain.namespace}`, PARTY_CTX);
    expect(check(goodFacts({ party, inbox: null }), "not_protocol_party")?.status).toBe("fail");
  });

  it("blocks the Gateway party itself", () => {
    const party = checkPartyId(chain.gatewayParty, PARTY_CTX);
    expect(check(goodFacts({ party, inbox: null }), "not_protocol_party")?.status).toBe("fail");
  });
});

describe("Common problems: receipt, but nothing arrived (mistyped or unknown party)", () => {
  it("blocks a well-formed party that Gateway does not know, even though the network would accept the send", () => {
    const facts = goodFacts();
    facts.inbox = {
      ...facts.inbox!,
      deployed: false,
      known: false,
      notes: ["Gateway does not know this party."],
    };
    const r = evaluatePreflight(facts);
    expect(facts.dryRun?.ok).toBe(true);
    expect(r.checks.find((c) => c.id === "recipient_known")?.status).toBe("fail");
    expect(r.verdict).toBe("blocked");
  });

  it("allows a known party whose inbox is not deployed yet (the first deposit deploys it)", () => {
    const facts = goodFacts();
    facts.inbox = { ...facts.inbox!, deployed: false, known: true };
    expect(evaluatePreflight(facts).verdict).toBe("ready");
  });
});

describe("Before you send: check the token is registered", () => {
  it("blocks an ERC-20 that is not in /v1/registries", () => {
    const r = evaluatePreflight(
      goodFacts({
        token: null,
        unregisteredAddress: true,
        input: { ...goodFacts().input, token: "0x41f21e381a70e404854d1f95788208bbc6a8cd72" },
      }),
    );
    expect(r.checks.find((c) => c.id === "token_registered")?.status).toBe("fail");
    expect(r.transaction).toBeNull();
  });
});

describe("Before you send: mind the ZTH units", () => {
  it("blocks ZTH that is not a multiple of 10^8 wei and offers the rounded value", () => {
    const c = check(goodFacts({ amountBase: 123_456_789_123n }), "zth_quantum");
    expect(c?.status).toBe("fail");
    expect(c?.fix).toMatch(/0\.0000001234/);
  });

  it("refuses wZTH back to Zenith EVM unless it is a whole number of gwei (not-whole-quanta)", () => {
    expect(() => cantonToZthWei("0.0000000001")).toThrow(/gwei/);
  });

  it("refuses a Canton amount with more than 10 decimal places (COMMAND_PREPROCESSING_FAILED)", () => {
    expect(() => cantonToErc20Base("1.00000000001")).toThrow(/10 decimal/);
  });

  it("blocks a zero amount (only a non-zero amount is a deposit)", () => {
    expect(check(goodFacts({ amountBase: 0n }), "amount_valid")?.status).toBe("fail");
  });
});

describe("Amounts and decimals: an 18-decimal token shows 10^8 times larger on Canton", () => {
  it("3.0 E arrives as 300000000.0, the same value", () => {
    expect(erc20BaseToCanton(3n * 10n ** 18n).numeric).toBe("300000000.0000000000");
  });
});

describe("Workflow 2/b: wrappers of Canton tokens need a standing acceptance", () => {
  const refusal =
    "transaction rejected: the recipient 0x2e60… is a gateway inbox whose Canton party has no standing acceptance for DevUSD; the deposit would never be delivered.";

  it("surfaces the network's -32003 refusal and the fix", () => {
    const r = evaluatePreflight(
      goodFacts({
        token: DEVUSD,
        sender: {
          address: SENDER,
          isContract: false,
          nativeBalance: 10n ** 18n,
          tokenBalance: 10n ** 12n,
        },
        dryRun: { ok: false, code: -32003, message: refusal },
      }),
    );
    expect(r.verdict).toBe("blocked");
    expect(r.checks.find((c) => c.id === "recipient_acceptance")?.status).toBe("fail");
    expect(r.checks.find((c) => c.id === "network_dry_run")?.fix).toMatch(/standing acceptance/);
  });

  it("maps each refusal reason to its fix", () => {
    expect(explainRefusal(refusal).reason).toMatch(/standing acceptance/);
    expect(
      explainRefusal("takes native value only in whole multiples of 100000000 wei (10^8)").reason,
    ).toMatch(/10\^8/);
  });
});

describe("Using Gateway from your application: send directly, not through a contract", () => {
  it("warns when the sender is a contract (the RPC only checks the transaction's own call)", () => {
    const facts = goodFacts({
      sender: { address: SENDER, isContract: true, nativeBalance: 10n ** 18n, tokenBalance: null },
    });
    expect(check(facts, "direct_transfer")?.status).toBe("warn");
  });
});

describe("Canton test network information: a reset invalidates stored inboxes", () => {
  it("warns after a testnet reset", () => {
    const base = goodFacts();
    const reset = {
      ...base.reset!,
      status: "reset-since-release" as const,
      changes: ["Gateway deployment ID differs"],
      advice: "Look up every stored inbox address again.",
    };
    expect(check(goodFacts({ reset }), "no_reset")?.status).toBe("warn");
  });
});

describe("Sender balance", () => {
  it("blocks when the sender cannot cover the value and gas", () => {
    const facts = goodFacts({
      sender: { address: SENDER, isContract: false, nativeBalance: 10n ** 15n, tokenBalance: null },
    });
    expect(check(facts, "sender_balance")?.status).toBe("fail");
  });
});

describe("Common problems: no receipt and later transactions stuck (held deposit)", () => {
  it("says not to resend while Gateway holds the deposit", async () => {
    const ctx = fakeContext({
      gateway: {
        pendingEvm: async () => ({
          id: "0x",
          kind: "evm",
          state: "held",
          reason: "recipient-quarantined",
          since: null,
          nextAttempt: "2026-11-19T10:00:00Z",
          evictAt: "2026-11-19T10:09:00Z",
        }),
      },
      client: {
        getTransaction: async () => Promise.reject(new Error("not found")),
        getTransactionReceipt: async () => Promise.reject(new Error("not found")),
      },
    });
    const r = await depositStatus(ctx, `0x${"ab".repeat(32)}`);
    expect(r.stage).toBe("held");
    expect(r.nextSteps.join(" ")).toMatch(/Do not send it again/);
  });

  it("after eviction, gives the nonce to resend at", async () => {
    const ctx = fakeContext({
      gateway: {
        pendingEvm: async () => ({
          id: "0x",
          kind: "evm",
          state: "evicted",
          reason: null,
          since: null,
          nextAttempt: null,
          evictAt: null,
        }),
      },
      client: {
        getTransaction: async () => Promise.reject(new Error("not found")),
        getTransactionReceipt: async () => Promise.reject(new Error("not found")),
        getTransactionCount: async () => 7,
      },
    });
    const r = await depositStatus(ctx, `0x${"ab".repeat(32)}`, { from: SENDER });
    expect(r.stage).toBe("evicted");
    expect(r.nextSteps.join(" ")).toMatch(/nonce 7/);
  });
});

describe("JSON-RPC limits: eth_getLogs covers at most 1000 blocks", () => {
  it("never asks the RPC for more than 1000 blocks at once", async () => {
    const ranges: [number, number][] = [];
    const ctx = fakeContext({
      client: { getBlockNumber: async () => 5_500n },
      rpc: {
        request: async (_m: string, [f]: [{ fromBlock: string; toBlock: string }]) => {
          ranges.push([Number(f.fromBlock), Number(f.toBlock)]);
          return [];
        },
      },
    });
    await getLogs(ctx, {
      address: "0x00000000000000000000000000000000000a7e00",
      fromBlock: 0,
      toBlock: 5_500,
    });
    expect(ranges.length).toBe(6);
    expect(ranges.every(([a, b]) => b - a + 1 <= 1000)).toBe(true);
    expect(ranges[0]).toEqual([4_501, 5_500]);
  });
});

describe("JSON-RPC: blocks are produced on demand, an unchanged block number is not a stall", () => {
  it("reports IDLE, not degraded, when there is no traffic but the producer is alive", async () => {
    const ctx = fakeContext({
      client: {
        getBlock: async () => ({
          number: 100n,
          timestamp: BigInt(Math.floor(Date.now() / 1000) - 600),
        }),
      },
      explorer: {
        health: async () => ({
          status: "ok",
          timestamp: "",
          services: {
            database: { status: "online" },
            evm: { status: "online" },
            canton: { status: "online" },
          },
        }),
        faucet: async () => ({
          enabled: true,
          zthAmount: "1",
          zthFixed: true,
          cooldownMinutes: 1440,
          cooldownLabel: "24h",
          minIntervalSeconds: 5,
          githubCreatedBefore: null,
          githubMaxPerWindow: 1,
        }),
      },
      gateway: {
        health: async () => ({
          ok: true,
          ready: true,
          core: "up",
          ledger: "up",
          producer: "up",
          synchronizer: "connected",
          producerProgressSecondsAgo: 2,
          checkedSecondsAgo: 1,
          head: { number: 100, timestamp: 0 },
        }),
        chain: async () => chain,
      },
    });
    const h = await healthCheck(ctx);
    expect(h.verdict).toBe("idle");
  });
});

describe("party IDs keep their exact namespace", () => {
  it("keeps the namespace untouched after trimming", () => {
    expect(checkPartyId(` alice::${NS} `, PARTY_CTX).party).toBe(`alice::${NS}`);
  });
});
