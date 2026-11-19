# Testnet resets

Validated: 2026-11-19. Source: https://docs.zenith.network/zenith-testnet (Canton test network information).

## Signals

- The synchronizer ID published in the docs changes (every reset changes it).
- Gateway `GET /v1/chain` returns a different `deploymentId` (and possibly `genesisHash`).
- EVM addresses are back at nonce 0; holdings are gone.
- The chain ID and the EVM genesis block can stay the same, so do not rely on them alone.

## What becomes invalid

- **Inbox addresses.** They are derived from the Gateway deployment. Tokens sent to an inbox computed for an earlier deployment are lost: recompute every stored inbox with `inboxOf`.
- Holdings on both sides, mailbox parties, standing acceptances, registrars.
- Wallet activity and nonce caches: clear them.
- For Canton participants: connect under a new synchronizer alias, upload and vet the DARs again, recreate parties, acceptances and mailboxes.

## What survives

EVM keys and party name hints.

`zenith_health` and `gateway_preflight` compare the current deployment with the one this release was validated against and with the first one seen in the session, and say so when they differ.
