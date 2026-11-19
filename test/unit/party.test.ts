import { describe, expect, it } from "vitest";
import { checkPartyId } from "../../src/core/party.js";
import chain from "../fixtures/gateway-chain.json" with { type: "json" };

const NS = "1220b64aeea8abe20728a6f60d66d6a57212ca9ba2f8d3b7a45bf8dd4de6932eeff2";
const ctx = { gatewayParty: chain.gatewayParty, protocolNamespace: chain.namespace };
const codes = (id: string) => checkPartyId(id, ctx).issues.map((i) => i.code);

describe("checkPartyId", () => {
  it("accepts a full party ID", () => {
    const r = checkPartyId(`alice::${NS}`, ctx);
    expect(r.valid).toBe(true);
    expect(r.hint).toBe("alice");
    expect(r.namespace).toBe(NS);
  });

  it("trims whitespace but warns about it", () => {
    const r = checkPartyId(`  alice::${NS}\n`, ctx);
    expect(r.valid).toBe(true);
    expect(r.party).toBe(`alice::${NS}`);
    expect(codes(` alice::${NS}`)).toContain("SURROUNDING_WHITESPACE");
  });

  it("blocks a hint without its namespace", () => {
    expect(checkPartyId("alice", ctx).valid).toBe(false);
    expect(codes("alice")).toContain("MISSING_NAMESPACE");
  });

  it("blocks a console-shortened ID", () => {
    expect(codes(`alice::1220b64a...eff2`)).toContain("DISPLAY_SHORTENED");
    expect(codes(`alice::1220b64a…eff2`)).toContain("DISPLAY_SHORTENED");
  });

  it("blocks a malformed or upper-case namespace", () => {
    expect(codes(`alice::1220abc`)).toContain("BAD_NAMESPACE");
    expect(codes(`alice::${NS.toUpperCase()}`)).toContain("NAMESPACE_CASE");
  });

  it.each(["m-8e9d2cfe", "r-635d45b5", "b-4550553d"])("blocks protocol party %s", (hint) => {
    const r = checkPartyId(`${hint}::${chain.namespace}`, ctx);
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("PROTOCOL_PARTY");
  });

  it("blocks the Gateway party itself", () => {
    expect(codes(chain.gatewayParty)).toContain("GATEWAY_PARTY");
    expect(checkPartyId(chain.gatewayParty, ctx).valid).toBe(false);
  });

  it("blocks an empty hint and repeated separators", () => {
    expect(codes(`::${NS}`)).toContain("EMPTY_HINT");
    expect(codes(`a::b::${NS}`)).toContain("EXTRA_SEPARATOR");
  });
});
