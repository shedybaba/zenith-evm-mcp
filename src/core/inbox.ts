import { getAddress, type Address } from "viem";
import { GATEWAY_ABI, looksLikeGatewayInbox } from "./abi.js";
import type { ZenithContext } from "./context.js";
import { checkPartyId, type PartyCheck } from "./party.js";
import { RpcError } from "./rpc.js";

export interface InboxResolution {
  party: PartyCheck;
  inbox: Address | null;
  deployed: boolean | null;
  /**
   * Whether Gateway knows the party behind this inbox. The registry API deliberately cannot tell an unknown
   * party from a known one until its inbox is deployed; the RPC's deposit guard can.
   */
  known: boolean | null;
  knownEvidence: string | null;
  /** What /v1/inboxes reports. It only reveals an address once the inbox is deployed. */
  api: { address: Address | null; deployed: boolean } | null;
  apiMatches: boolean | null;
  notes: string[];
}

const PROBE_SENDER = "0x000000000000000000000000000000000000bEEF" as const;

/**
 * Asks the RPC to estimate a 1 wei transfer to the address from a dummy sender funded through a state
 * override. Nothing is signed or sent. The RPC refuses it ("is a gateway inbox") only when the address
 * is the inbox of a party Gateway knows, deployed or not.
 */
export async function probeKnownInbox(
  ctx: ZenithContext,
  address: Address,
): Promise<{ known: boolean | null; evidence: string }> {
  try {
    await ctx.rpc.request("eth_estimateGas", [
      { from: PROBE_SENDER, to: address, value: "0x1" },
      "latest",
      { [PROBE_SENDER]: { balance: "0xde0b6b3a7640000" } },
    ]);
    return {
      known: false,
      evidence:
        "The network treats this address as a plain address, not as the inbox of a party Gateway knows.",
    };
  } catch (err) {
    if (err instanceof RpcError && err.code === -32003 && /gateway inbox/i.test(err.message)) {
      return {
        known: true,
        evidence: "The network recognises this address as the inbox of a party Gateway knows.",
      };
    }
    return { known: null, evidence: `Could not tell: ${(err as Error).message}` };
  }
}

/** Computes a party's inbox with the Gateway contract, checks it is deployed and known, and cross-checks the registry API. */
export async function resolveInbox(ctx: ZenithContext, partyId: string): Promise<InboxResolution> {
  const chain = await ctx.gateway.chain();
  const party = checkPartyId(partyId, {
    gatewayParty: chain.gatewayParty,
    protocolNamespace: chain.namespace,
  });
  if (!party.valid)
    return {
      party,
      inbox: null,
      deployed: null,
      known: null,
      knownEvidence: null,
      api: null,
      apiMatches: null,
      notes: [],
    };

  const [inbox, api] = await Promise.all([
    ctx.client.readContract({
      address: ctx.network.gatewayAddress,
      abi: GATEWAY_ABI,
      functionName: "inboxOf",
      args: [party.party],
    }),
    ctx.gateway.inbox(party.party).catch(() => null),
  ]);
  const code = await ctx.client.getCode({ address: inbox });
  const deployed = Boolean(code && code !== "0x");
  const apiAddress = api?.address ? getAddress(api.address) : null;
  const apiMatches = apiAddress ? apiAddress === getAddress(inbox) : null;

  const probe = deployed
    ? { known: true, evidence: "The inbox is deployed." }
    : await probeKnownInbox(ctx, getAddress(inbox));

  const notes: string[] = [];
  if (deployed && !looksLikeGatewayInbox(code))
    notes.push("The address has code that does not look like a Gateway inbox.");
  if (apiMatches === false)
    notes.push(
      "The registry API reports a different inbox address than the Gateway contract. Do not send.",
    );
  if (!deployed && probe.known) {
    notes.push(
      "Not deployed yet, but Gateway knows this party: an ERC-20 deposit deploys the inbox and is credited in the same block; native ZTH waits at the inbox until Gateway deploys it (seconds to minutes).",
    );
  }
  if (!deployed && probe.known === false) {
    notes.push(
      "Gateway does not know this party. If the ID is mistyped, anything sent here is never delivered. If the party was created moments ago, wait a minute and check again; value sent before Gateway learns the party waits at the inbox.",
    );
  }
  return {
    party,
    inbox: getAddress(inbox),
    deployed,
    known: probe.known,
    knownEvidence: probe.evidence,
    api: api ? { address: apiAddress, deployed: api.deployed } : null,
    apiMatches,
    notes,
  };
}
