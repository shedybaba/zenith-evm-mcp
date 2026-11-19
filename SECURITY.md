# Security

## Scope

zenith-evm-mcp targets the Zenith EVM **testnet**. Gateway on testnet is operated by Zenith; never move anything of real value through it.

## Keys

- Write tools are off unless you set `ZENITH_PRIVATE_KEY` or `ZENITH_KEY_FILE`. Use a key created only for Zenith testnet, never one that holds real funds on any network.
- Prefer `ZENITH_KEY_FILE` pointing at a file outside any repository with permissions `600`. The server reads the key into memory only, never logs it, and never returns it in tool output.
- The server refuses to sign unless the RPC reports chain 936485, even if `ZENITH_RPC_URL` is changed.
- `ZENITH_SPEND_CAP_ZTH` (default 1) limits the value plus gas that write tools may spend in one session.
- Every write simulates first and needs a second call with `confirm: true`. Configure your MCP client to ask you before tools marked as non-read-only run.

## Network access

The server only talks to the Zenith RPC, the Zenith explorer API, the Zenith Gateway API and, when compiling a Solidity version that is not bundled, binaries.soliditylang.org. It sends no telemetry.

## Reporting a vulnerability

Please report security issues privately through GitHub's "Report a vulnerability" (Security → Advisories) on this repository rather than in a public issue.
