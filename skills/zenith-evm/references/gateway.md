# Gateway

Validated: 2026-11-19. Sources: https://docs.zenith.network/zenith-testnet (Zenith Gateway overview, Interacting with Gateway, Gateway sample workflows, Using Gateway from your application, Gateway troubleshooting); `GET /v1/chain`, `/v1/registries`; items marked _(observed)_ were confirmed against the public testnet.

Gateway moves registered tokens between Zenith EVM and Canton. Each crossing is atomic: the Canton change and the EVM block commit in one Canton transaction, or not at all. A token never exists on both sides at once; Gateway holds the original while its counterpart exists. Testnet release: token transfers only; no Daml ↔ EVM calls, no real Canton Coin, no self-service registration. No Gateway fee.

## Directions

| Move                                                              | How                                                                   | Recipient needs                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ERC-20 original → Canton                                          | `transfer(inbox, amount)`                                             | nothing                                                                      |
| Native ZTH → Canton (arrives as wZTH)                             | value transfer to the inbox, multiple of 10^8 wei                     | nothing                                                                      |
| Gateway ERC-20 of a Canton token (DevUSD/DevCC wrappers) → Canton | `transfer(inbox, amount)`                                             | a standing acceptance at the token's registry, else the RPC refuses (-32003) |
| Canton token → EVM                                                | CIP-56 transfer to the **mailbox party** of (EVM address, instrument) | mailbox must be `active`                                                     |
| wZTH → native ZTH                                                 | CIP-56 transfer to the wZTH mailbox, whole gwei                       | arrives as an EIP-4895 block withdrawal (no transaction in wallets)          |

`inbox = Gateway.inboxOf(fullPartyId)`: deterministic from the party ID, chain ID, Gateway address and inbox code hash. It is stable for a deployment; recompute after a reset. Mailboxes: `GET /v1/derive/mailbox?evmAddress=&instrumentAdmin=&instrumentId=`; request with `POST /v1/provisioning-requests` (`kind: "mailbox"`, a Canton `requester` party); Zenith approves; active ~2 min later; waiting requests expire after 1 day; HTTP 429 means queue full (honour Retry-After). Offers need `executeBefore` > 180 s away (`offers.minExecuteBeforeSeconds`); Gateway takes an offer only while > 120 s remain.

## Amounts

- One EVM base unit of a Gateway ERC-20 = 1e-10 on Canton. Canton amounts are Numeric(10); an 11th decimal is refused (`COMMAND_PREPROCESSING_FAILED`), never rounded.
- Gateway-issued tokens have 10 decimals. A token with d decimals: 1 token = 10^(d−10) on Canton; its Canton symbol carries the scale (`DORIGe-8` for 18 decimals, `USDXe4` for 6). 3.0 E (18 dec) = 300000000.0 on Canton.
- ZTH → Canton: multiples of 10^8 wei. wZTH → EVM: whole gwei (≤ 9 decimals), else `not-whole-quanta`.

## Before you send (all must hold)

1. Token listed in `GET /v1/registries` (ERC-20 originals: `kind: wrapped-erc20`, `token`; dev tokens: `kind: dev`; issuers' CIP-56: `externalRegistries`; wZTH: `/v1/chain` `native`).
2. Full party ID `hint::1220<64 hex>`, copied, never retyped or taken from a shortened display.
3. Not a protocol party (`m-`, `r-`, `b-`) and not the Gateway party (`/v1/chain` `gatewayParty`): never credited, lost.
4. Gateway knows the party. _(observed)_ `GET /v1/inboxes/{party}` cannot tell until the inbox is deployed, but the RPC's deposit guard can: `eth_estimateGas` of a 1 wei value transfer to the inbox (dummy sender funded by a state override) is refused with "is a gateway inbox" only for a known party. A mistyped party's inbox is a plain address; the network accepts the send and the value is never delivered.
5. Direct transfer from an EOA. The RPC checks only the transaction's own call; inside a router/multicall an undeliverable or unregistered transfer is not refused and can strand value.
6. Units as above; non-zero amount.
7. Dry-run the exact transaction (`eth_estimateGas` from the sender). -32003 messages name the reason: no standing acceptance, unregistered token, not a multiple of 10^8 wei.
8. After sending, wait for the receipt with a timeout (~2 min).

## After you send

- A deliverable deposit to a known party's inbox is mined in the block that credits it: receipt ⇒ credited.
- Undeliverable for now (for example the recipient's participant is offline): **held**, not mined; later transactions from the same address wait behind it. `GET /v1/pending/evm/{txHash}` → `state` (`held`, `evicted`, `inbox-not-deployed`, `unknown`), `reason`, `nextAttempt`, `evictAt`. Do not resend while held. After ~9–10 min it is **evicted** with the later transactions: nothing moved; resend at the same nonce, then the rest in order.
- ZTH to a not-yet-deployed inbox is mined and waits (`inbox-not-deployed`); Gateway deploys the inbox and delivers within seconds to minutes. Do not resend.
- Credit evidence on EVM: Gateway events.

## Gateway events _(observed: the contract is unverified; signatures matched by topic hash)_

```
event Collected(address indexed token, address indexed inbox, uint256 amount)        // EVM → Canton, ERC-20
event NativeCollected(address indexed inbox, uint256 amount)                         // EVM → Canton, ZTH
event Minted(address indexed wrapper, address indexed to, uint256 amount)            // Canton → EVM, wrapper
event Released(address indexed token, address indexed to, uint256 amount)            // Canton → EVM, original
event MetadataSet(address indexed wrapper, string name, string symbol)
event WrapperRegistered(bytes32 indexed instrumentKey, address indexed wrapper)
event OriginalRegistered(address indexed token, address indexed vault)
```

Every inbox's runtime code contains the selectors `sweepToken(address)` (`0x1be19560`) and the error `NotWholeQuanta(uint256)` (`0x479e0aeb`); a deployed inbox reverts ZTH that is not a multiple of 10^8 wei.

## Registering a token (Zenith decides; default answer on public testnet is no)

ERC-20: send the address, verified standard-JSON source and deployment transaction to partners@zenith.network. Must be a plain ERC-20: `transfer` moves exactly the amount; no fee, burn, reflection, rebase, hook or blocklist; not upgradeable (no proxy, no admin over code or balances). After approval, file `POST /v1/provisioning-requests` with `kind: "registrar"` and the token address. CIP-56: admin party, instrument ID, wrapper name/symbol, registry base URL, DAR, holder-allowlist rules; no transfer fee, V1 two-step transfers, standing acceptance supported, registry reachable. The ERC-20 wrapper has 10 decimals.
