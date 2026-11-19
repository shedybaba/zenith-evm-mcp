import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "../helpers.js";

describe("MCP server surface", () => {
  let session: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    session = await connect();
  });
  afterAll(() => session.close());

  it("registers the read tools with input schemas and read-only hints", async () => {
    const { tools } = await session.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "zenith_network_info",
        "zenith_health",
        "zenith_get_account",
        "zenith_get_transaction",
        "zenith_read_contract",
        "zenith_get_logs",
        "zenith_decode",
      ]),
    );
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
    }
    const account = tools.find((t) => t.name === "zenith_get_account")!;
    expect(account.annotations?.readOnlyHint).toBe(true);
    expect(account.inputSchema.required).toContain("address");
  });

  it("exposes resources and prompts", async () => {
    const { resources } = await session.client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(
      expect.arrayContaining([
        "zenith://network",
        "zenith://limits",
        "zenith://gateway/tokens",
        "zenith://gateway/checklist",
        "zenith://differences",
      ]),
    );
    const checklist = await session.client.readResource({ uri: "zenith://gateway/checklist" });
    expect(JSON.stringify(checklist.contents[0])).toMatch(/full party ID/);
    const { prompts } = await session.client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        "deploy_and_verify",
        "send_to_canton_safely",
        "investigate_missing_deposit",
        "audit_token_for_gateway",
        "port_ethereum_app",
      ]),
    );
  });

  it("returns a readable error for invalid input instead of crashing", async () => {
    const r = await session.call("zenith_get_transaction", { hash: "0x1234" });
    expect(r.isError).toBe(true);
  });
});
