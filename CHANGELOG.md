# Changelog

## 0.1.0

First release.

- MCP server with 20 tools, 5 resources and 5 guided prompts for Zenith EVM testnet.
- Gateway safety: `gateway_preflight` (the docs' Before-you-send checklist plus a live dry run and a check that Gateway knows the recipient party), deposit tracking, mailbox lookup, exact unit conversion, decoded Gateway activity and a token registration pre-screen with a simulated transfer.
- Transaction tracing from the EVM transaction to the Canton update that settled it.
- Developer tools: compatibility scanner (including the Osaka/Prague mismatch), tooling config generator and contract verification.
- Opt-in, guarded testnet write tools: deploy (compiled for Prague, verified automatically) and send.
- `zenith-evm` agent skill with references pinned to their sources.
- Footgun test suite covering every documented Gateway pitfall.
