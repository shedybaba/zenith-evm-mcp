# Tool reference

Generated from zenith-evm-mcp 0.1.0 by `npm run docs`. Do not edit by hand.

| Tool                                                      | Read-only | What it does                                       |
| --------------------------------------------------------- | --------- | -------------------------------------------------- |
| [`zenith_network_info`](#zenith_network_info)             | yes       | Zenith network info                                |
| [`zenith_health`](#zenith_health)                         | yes       | Zenith network health                              |
| [`zenith_get_account`](#zenith_get_account)               | yes       | Account or contract details                        |
| [`zenith_get_transaction`](#zenith_get_transaction)       | yes       | Trace a transaction (EVM and Canton)               |
| [`zenith_read_contract`](#zenith_read_contract)           | yes       | Call a view function                               |
| [`zenith_get_logs`](#zenith_get_logs)                     | yes       | Get decoded event logs                             |
| [`zenith_decode`](#zenith_decode)                         | yes       | Decode calldata, an event or a revert              |
| [`gateway_tokens`](#gateway_tokens)                       | yes       | Tokens Gateway can move                            |
| [`gateway_inbox`](#gateway_inbox)                         | yes       | Canton party → inbox address                       |
| [`gateway_preflight`](#gateway_preflight)                 | yes       | Check a send to Canton (Before-you-send checklist) |
| [`gateway_deposit_status`](#gateway_deposit_status)       | yes       | Track a Gateway deposit                            |
| [`gateway_mailbox`](#gateway_mailbox)                     | yes       | Mailbox party for Canton → EVM                     |
| [`gateway_convert`](#gateway_convert)                     | yes       | Convert amounts between Zenith EVM and Canton      |
| [`gateway_token_eligibility`](#gateway_token_eligibility) | yes       | Pre-screen an ERC-20 for Gateway registration      |
| [`gateway_activity`](#gateway_activity)                   | yes       | Recent Gateway crossings                           |
| [`zenith_verify_contract`](#zenith_verify_contract)       | **no**    | Verify a contract on the Zenith explorer           |
| [`zenith_project_config`](#zenith_project_config)         | yes       | Tooling config for Zenith                          |
| [`zenith_check_compat`](#zenith_check_compat)             | yes       | Check code for Zenith gotchas                      |
| [`zenith_deploy`](#zenith_deploy)                         | **no**    | Deploy a contract (testnet, opt-in)                |
| [`zenith_send`](#zenith_send)                             | **no**    | Send a transaction (testnet, opt-in)               |

## zenith_network_info

Chain ID, endpoints (RPC, explorer, faucet, Gateway API, docs), latest block and its age, gas price, the Gateway deployment (contract, party, deployment ID, genesis hash) and the public RPC limits. Call this first when working with Zenith EVM.

No arguments.

## zenith_health

One verdict for whether Zenith is working: healthy, idle (no traffic but the block producer is alive; blocks are only made when there are transactions), degraded, or possible-reset (the testnet was reset, so stored inbox addresses and holdings are invalid). Checks the RPC, the explorer's services, the Gateway producer and synchronizer, and the faucet (amount, cooldown, GitHub-account rule).

No arguments.

## zenith_get_account

Balance, nonce, wallet vs contract, and for contracts: verified source, proxy implementation, ERC-20 metadata, and whether the address is a Gateway inbox. Also lists token holdings and recent transactions from the explorer.

| Argument               | Type    | Required | Default | Description                                                |
| ---------------------- | ------- | -------- | ------- | ---------------------------------------------------------- |
| `address`              | string  | yes      |         | EVM address (0x…)                                          |
| `includeTokenHoldings` | boolean | no       | `true`  | Look up ERC-20 balances from the explorer's transfer index |
| `recentTransactions`   | integer | no       | `5`     |                                                            |

## zenith_get_transaction

Status, fee, decoded call and events (verified ABIs, ERC-20 and the Gateway's own events), whether it was a Gateway deposit, and the Canton update that settled it: update ID, command ID, settlement time. If it was never mined, explains why using Gateway's pending-transaction index.

| Argument            | Type    | Required | Default | Description                                                            |
| ------------------- | ------- | -------- | ------- | ---------------------------------------------------------------------- |
| `hash`              | string  | yes      |         | Transaction hash (0x + 64 hex)                                         |
| `includeCantonLink` | boolean | no       | `true`  | Look up the Canton update in the explorer index (a few extra requests) |

## zenith_read_contract

Calls a contract function without sending a transaction. Give either a full signature (e.g. "balanceOf(address) view returns (uint256)") or just the function name if the contract is verified on the explorer (ERC-20 names work for any token). Arguments are converted to the right types.

| Argument      | Type    | Required | Default | Description                                          |
| ------------- | ------- | -------- | ------- | ---------------------------------------------------- |
| `address`     | string  | yes      |         | EVM address (0x…)                                    |
| `function`    | string  | yes      |         | Function name, or a signature with return types      |
| `args`        | any[]   | no       | `[]`    | Arguments in order; integers may be strings          |
| `abi`         | string  | no       |         | Optional JSON ABI to use instead of the verified one |
| `blockNumber` | integer | no       |         |                                                      |

## zenith_get_logs

Event logs for a contract and/or event over any block range, decoded. The public RPC only serves 1,000 blocks per call and has no filters or WebSockets, so the range is walked in chunks from newest to oldest; use nextToBlock to continue. Defaults to the last 1,000 blocks.

| Argument    | Type    | Required | Default | Description                                                                               |
| ----------- | ------- | -------- | ------- | ----------------------------------------------------------------------------------------- |
| `address`   | string  | no       |         | EVM address (0x…)                                                                         |
| `event`     | string  | no       |         | Event signature, e.g. "Transfer(address indexed from, address indexed to, uint256 value)" |
| `fromBlock` | integer | no       |         |                                                                                           |
| `toBlock`   | integer | no       |         |                                                                                           |
| `maxLogs`   | integer | no       | `100`   |                                                                                           |

## zenith_decode

Decodes raw hex using the contract's verified ABI, a signature you give, ERC-20, or the Gateway's events and errors (including the inbox's NotWholeQuanta error).

| Argument    | Type                              | Required | Default | Description                                |
| ----------- | --------------------------------- | -------- | ------- | ------------------------------------------ |
| `kind`      | `calldata` \| `event` \| `revert` | yes      |         |                                            |
| `data`      | string                            | yes      |         | Calldata, event data or revert data        |
| `topics`    | string[]                          | no       |         | Event topics (for kind=event)              |
| `address`   | string                            | no       |         | Contract address, to use its verified ABI  |
| `signature` | string                            | no       |         | Function or event signature to decode with |

## gateway_tokens

Every token registered with Zenith Gateway, with both sides: EVM address, symbol and decimals; Canton instrument, symbol and scale; how each direction works and what the recipient needs (for example a standing acceptance for wrappers of Canton tokens).

No arguments.

## gateway_inbox

Checks a Canton party ID and computes its inbox: the EVM address that delivers to that party on Canton. Rejects shortened IDs, protocol parties (m-, r-, b-) and the Gateway party, says whether the inbox is deployed, and cross-checks the registry API.

| Argument  | Type   | Required | Default | Description                                                |
| --------- | ------ | -------- | ------- | ---------------------------------------------------------- |
| `partyId` | string | yes      |         | Full Canton party ID: hint::1220 followed by 64 hex digits |

## gateway_preflight

Runs every rule in Zenith's "Before you send" checklist for a transfer from Zenith EVM to a Canton party, then dry-runs the exact transaction against the network (eth_estimateGas) to surface its own refusal reason. Returns pass/fail per check with fixes, the amount that arrives on Canton, and the unsigned transaction. Never sends anything. ALWAYS call this before sending to a Canton party.

| Argument     | Type              | Required | Default   | Description                                                                              |
| ------------ | ----------------- | -------- | --------- | ---------------------------------------------------------------------------------------- |
| `partyId`    | string            | yes      |           | Full Canton party ID: hint::1220 followed by 64 hex digits                               |
| `token`      | string            | yes      |           | Token: "ZTH", a symbol (e.g. DevUSD, DORIG), a Canton instrument ID or an ERC-20 address |
| `amount`     | string            | yes      |           | Amount, e.g. "0.5"                                                                       |
| `amountUnit` | `token` \| `base` | no       | `"token"` | token = whole tokens (default); base = EVM base units / wei                              |
| `from`       | string            | no       |           | Sender address; enables the balance check and the live dry run                           |

## gateway_deposit_status

Follows a Zenith EVM → Canton deposit by transaction hash: held by Gateway (with reason and eviction time), evicted (with the nonce to resend at), mined and waiting for the inbox, credited (with the Gateway collection event), or not a deposit. Gives the exact next step from the docs' Common problems table.

| Argument | Type   | Required | Default | Description                                             |
| -------- | ------ | -------- | ------- | ------------------------------------------------------- |
| `hash`   | string | yes      |         | EVM transaction hash                                    |
| `from`   | string | no       |         | Sender address (helps when the transaction was evicted) |

## gateway_mailbox

Derives the mailbox party for an EVM address and token (the Canton party you transfer to, to move that token to that EVM address) and reports its state: absent, requested, active and so on. Explains how to request it.

| Argument     | Type   | Required | Default | Description                                                                              |
| ------------ | ------ | -------- | ------- | ---------------------------------------------------------------------------------------- |
| `evmAddress` | string | yes      |         | Destination EVM address                                                                  |
| `token`      | string | yes      |         | Token: "ZTH", a symbol (e.g. DevUSD, DORIG), a Canton instrument ID or an ERC-20 address |

## gateway_convert

Exact amount conversion for a Gateway token, in either direction, with the crossing rules applied: one EVM base unit is 1e-10 on Canton, 18-decimal tokens show 10^8 times larger on Canton (DORIGe-8), ZTH crosses in multiples of 10^8 wei and wZTH back in whole gwei. Never rounds silently.

| Argument    | Type                    | Required | Default   | Description                                                                              |
| ----------- | ----------------------- | -------- | --------- | ---------------------------------------------------------------------------------------- |
| `token`     | string                  | yes      |           | Token: "ZTH", a symbol (e.g. DevUSD, DORIG), a Canton instrument ID or an ERC-20 address |
| `direction` | `to-canton` \| `to-evm` | yes      |           |                                                                                          |
| `amount`    | string                  | yes      |           |                                                                                          |
| `unit`      | `token` \| `base`       | no       | `"token"` | For to-canton: whole tokens or EVM base units                                            |

## gateway_token_eligibility

Checks an ERC-20 against Zenith's registration criteria: verified source, deployment transaction, not upgradeable, no fee/burn/reflection/rebase/hook/blocklist functions (bytecode selector scan), and a simulated transfer from a real holder (eth_call with a state override) proving it moves exactly the amount. Prepares what Zenith asks for in a request.

| Argument  | Type   | Required | Default | Description                        |
| --------- | ------ | -------- | ------- | ---------------------------------- |
| `address` | string | yes      |         | ERC-20 token address on Zenith EVM |

## gateway_activity

Recent token crossings between Zenith EVM and Canton, decoded from the Gateway contract's own events (Collected, NativeCollected, Minted, Released), with per-token counts by direction.

| Argument       | Type    | Required | Default | Description                                                |
| -------------- | ------- | -------- | ------- | ---------------------------------------------------------- |
| `limit`        | integer | no       | `25`    |                                                            |
| `includeSetup` | boolean | no       | `false` | Also list registration events (wrappers, vaults, metadata) |

## zenith_verify_contract

Verifies a deployed contract through the explorer's Etherscan-compatible API. From a .sol file it compiles locally with the given settings, checks the bytecode matches the deployed code, then submits the exact standard-JSON input and waits for the result. Also accepts a standard-JSON input file (for example from forge verify-contract --show-standard-json-input).

| Argument           | Type    | Required | Default    | Description                                                          |
| ------------------ | ------- | -------- | ---------- | -------------------------------------------------------------------- |
| `address`          | string  | yes      |            |                                                                      |
| `sourcePath`       | string  | no       |            | Path to the .sol file                                                |
| `standardJsonPath` | string  | no       |            |                                                                      |
| `qualifiedName`    | string  | no       |            | "File.sol:Contract", with standardJsonPath                           |
| `constructorArgs`  | string  | no       |            | ABI-encoded constructor arguments (hex), if any                      |
| `contractName`     | string  | no       |            | Contract to use when the file has several                            |
| `compilerVersion`  | string  | no       |            | solc version, e.g. "0.8.30" (default: bundled, if the pragma allows) |
| `optimize`         | boolean | no       | `true`     |                                                                      |
| `runs`             | integer | no       | `200`      |                                                                      |
| `evmVersion`       | string  | no       | `"prague"` | EVM version; Zenith runs "prague"                                    |

## zenith_project_config

Ready-to-paste configuration for Foundry, Hardhat 3, Hardhat 2, viem, wagmi, MetaMask and .env, with the Zenith RPC, chain ID, explorer verification and the right EVM version (prague) already set, plus the notes that matter (no multicall, polling watchers, one-receipt finality).

| Argument | Type                                                                                | Required | Default | Description   |
| -------- | ----------------------------------------------------------------------------------- | -------- | ------- | ------------- |
| `tools`  | `foundry` \| `hardhat3` \| `hardhat2` \| `viem` \| `wagmi` \| `metamask` \| `env`[] | no       | `[]`    | Empty for all |

## zenith_check_compat

Scans Solidity, TypeScript/JavaScript or deployed bytecode for things that behave differently on Zenith: block.number used as a clock (blocks only come with transactions), prevrandao randomness, blob opcodes, Osaka-only opcodes and compiler targets (Zenith runs Prague), dependencies on Multicall3/Permit2/EntryPoint/CreateX (not deployed), WebSockets, filters and subscriptions (not available), waiting for many confirmations (can hang), and unbounded getLogs ranges.

| Argument   | Type                   | Required | Default      | Description                           |
| ---------- | ---------------------- | -------- | ------------ | ------------------------------------- |
| `path`     | string                 | no       |              | File or project folder to scan        |
| `source`   | string                 | no       |              | Source text to scan instead of a path |
| `language` | `solidity` \| `script` | no       | `"solidity"` | Language of `source`                  |
| `address`  | string                 | no       |              | Deployed contract to scan by bytecode |

## zenith_deploy

Deploys a contract to Zenith testnet from a .sol file (compiled for Prague and verified automatically), a Foundry/Hardhat artifact or bytecode. Without confirm it only simulates and shows the cost. Requires a testnet key configured by the user; refuses any other chain and respects the session spend cap.

| Argument          | Type    | Required | Default    | Description                                              |
| ----------------- | ------- | -------- | ---------- | -------------------------------------------------------- |
| `sourcePath`      | string  | no       |            | Path to a .sol file                                      |
| `contractName`    | string  | no       |            |                                                          |
| `artifactPath`    | string  | no       |            | Foundry out/X.sol/X.json or Hardhat artifact             |
| `bytecode`        | string  | no       |            |                                                          |
| `abi`             | string  | no       |            | JSON ABI, with bytecode                                  |
| `constructorArgs` | any[]   | no       | `[]`       |                                                          |
| `compilerVersion` | string  | no       |            |                                                          |
| `optimize`        | boolean | no       | `true`     |                                                          |
| `runs`            | integer | no       | `200`      |                                                          |
| `evmVersion`      | string  | no       | `"prague"` |                                                          |
| `verify`          | boolean | no       | `true`     |                                                          |
| `confirm`         | boolean | no       | `false`    | Set true only after the user approved the simulated plan |

## zenith_send

Sends ZTH, an ERC-20 transfer or a contract call on Zenith testnet. For a transfer to a Canton party, set gatewayPartyId (with token and amount): the full Gateway preflight runs first and blocked sends are refused. Plain sends to a Gateway inbox are refused so the checks cannot be skipped. Without confirm it only simulates.

| Argument         | Type    | Required | Default | Description                                                |
| ---------------- | ------- | -------- | ------- | ---------------------------------------------------------- |
| `to`             | string  | no       |         | Recipient or contract address                              |
| `valueZth`       | string  | no       |         | Native ZTH to send, e.g. "0.1"                             |
| `token`          | string  | no       |         | ERC-20 to transfer (symbol or address)                     |
| `amount`         | string  | no       |         | Token amount (whole tokens)                                |
| `function`       | string  | no       |         | Function signature for a contract call, e.g. "increment()" |
| `args`           | any[]   | no       | `[]`    |                                                            |
| `gatewayPartyId` | string  | no       |         | Send to this Canton party through Gateway                  |
| `confirm`        | boolean | no       | `false` | Set true only after the user approved the simulated plan   |

## Resources

| URI                          | Title                          |
| ---------------------------- | ------------------------------ |
| `zenith://network`           | Zenith network                 |
| `zenith://limits`            | Public RPC and explorer limits |
| `zenith://gateway/tokens`    | Gateway tokens                 |
| `zenith://gateway/checklist` | Gateway: before you send       |
| `zenith://differences`       | Zenith EVM vs Ethereum         |

## Prompts

| Prompt                        | Arguments                    | What it does                                                                                                      |
| ----------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `deploy_and_verify`           | `sourcePath`, `contractName` | Check a Solidity contract for Zenith gotchas, deploy it to testnet, verify it and trace the deployment to Canton. |
| `send_to_canton_safely`       | `partyId`, `token`, `amount` | Run every Gateway check before sending tokens from Zenith EVM to a Canton party.                                  |
| `investigate_missing_deposit` | `txHash`                     | Work out what happened to a transfer between Zenith EVM and Canton.                                               |
| `audit_token_for_gateway`     | `tokenAddress`               | Pre-screen an ERC-20 against Zenith's registration criteria.                                                      |
| `port_ethereum_app`           | `projectPath`                | Review an existing Solidity or dApp project for what changes on Zenith EVM.                                       |
