import { readFileSync } from "node:fs";
import {
  createWalletClient,
  custom,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getAddress,
  isAddress,
  parseEther,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";
import { ERC20_ABI, looksLikeGatewayInbox } from "./abi.js";
import { coerceArgs } from "./args.js";
import { scanBytecode } from "./compat.js";
import type { ZenithContext } from "./context.js";
import { abiFromSignature } from "./decode.js";
import { gatewayPreflight } from "./preflight.js";
import { zenithChain } from "./rpc.js";
import { compileSolidity, type CompileOptions, type CompileResult } from "./solidity.js";
import { loadGatewayTokens, matchGatewayToken } from "./tokens.js";
import { traceTransaction } from "./transaction.js";
import { parseDecimal } from "./units.js";
import { verifyContract } from "./verify.js";
import { loadSigner, type Signer } from "./wallet.js";

export class WriteGuardError extends Error {}

function requireSigner(ctx: ZenithContext): Signer {
  const signer = loadSigner(ctx);
  if (!signer) {
    throw new WriteGuardError(
      "Write tools are disabled. Set ZENITH_PRIVATE_KEY (or ZENITH_KEY_FILE) to a testnet-only key in the MCP server's environment. Never use a key that holds real funds.",
    );
  }
  return signer;
}

/** Refuses to sign anywhere but Zenith testnet, whatever RPC URL is configured. */
async function requireZenithTestnet(ctx: ZenithContext) {
  const chainId = await ctx.client.getChainId();
  if (chainId !== ctx.network.chainId) {
    throw new WriteGuardError(
      `Refusing to sign: the RPC reports chain ${chainId}, not Zenith testnet (${ctx.network.chainId}).`,
    );
  }
}

function checkSpendCap(ctx: ZenithContext, signer: Signer, wei: bigint) {
  if (ctx.session.spentWei + wei > signer.spendCapWei) {
    throw new WriteGuardError(
      `This would exceed the session spend cap of ${signer.spendCapZth} ZTH (already spent ${formatEther(ctx.session.spentWei)} ZTH). Raise ZENITH_SPEND_CAP_ZTH if intended.`,
    );
  }
}

function wallet(ctx: ZenithContext, signer: Signer) {
  return createWalletClient({
    account: signer.account,
    chain: zenithChain(ctx.network),
    transport: custom({
      request: ({ method, params }) =>
        ctx.rpc.request(method, (params as unknown[] | undefined) ?? []),
    }),
  });
}

async function sendAndTrace(
  ctx: ZenithContext,
  signer: Signer,
  tx: { to?: Address; data?: Hex; value?: bigint; gas: bigint },
  feeWei: bigint,
) {
  const hash = await wallet(ctx, signer).sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
    gas: tx.gas,
  });
  ctx.session.spentWei += (tx.value ?? 0n) + feeWei;
  const receipt = await ctx.client
    .waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 1_000 })
    .catch(() => null);
  if (!receipt) {
    return {
      hash,
      receiptStatus: "no-receipt-yet",
      note: "No receipt within 2 minutes. If this was a Gateway deposit, call gateway_deposit_status.",
    };
  }
  const trace = await traceTransaction(ctx, hash).catch(() => null);
  return {
    hash,
    receiptStatus: receipt.status,
    block: receipt.blockNumber,
    contractAddress: receipt.contractAddress ?? null,
    trace,
  };
}

export interface DeployInput extends CompileOptions {
  artifactPath?: string;
  bytecode?: string;
  abi?: string;
  constructorArgs?: unknown[];
  confirm?: boolean;
  verify?: boolean;
}

/** Deploys a contract from a .sol file, a Foundry/Hardhat artifact or raw bytecode. Simulates first; sends only with confirm. */
export async function deployContract(ctx: ZenithContext, input: DeployInput) {
  const signer = requireSigner(ctx);
  await requireZenithTestnet(ctx);

  let abi: Abi;
  let bytecode: Hex;
  let compiled: CompileResult | null = null;
  if (input.sourcePath || input.source) {
    compiled = await compileSolidity(input);
    abi = compiled.abi;
    bytecode = compiled.bytecode;
  } else if (input.artifactPath) {
    const artifact = JSON.parse(readFileSync(input.artifactPath, "utf8")) as {
      abi: Abi;
      bytecode: string | { object: string };
    };
    abi = artifact.abi;
    const raw =
      typeof artifact.bytecode === "string" ? artifact.bytecode : artifact.bytecode.object;
    bytecode = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  } else if (input.bytecode) {
    abi = input.abi ? (JSON.parse(input.abi) as Abi) : [];
    bytecode = (input.bytecode.startsWith("0x") ? input.bytecode : `0x${input.bytecode}`) as Hex;
  } else {
    throw new Error("Give sourcePath (a .sol file), artifactPath or bytecode.");
  }

  const ctor = abi.find((i) => i.type === "constructor") as
    { inputs: AbiFunction["inputs"] } | undefined;
  const args = ctor ? coerceArgs(ctor.inputs, input.constructorArgs ?? []) : [];
  const data = encodeDeployData({ abi, bytecode, args });
  const [gas, gasPrice, balance] = await Promise.all([
    ctx.client.estimateGas({ account: signer.address, data }),
    ctx.client.getGasPrice(),
    ctx.client.getBalance({ address: signer.address }),
  ]);
  const gasLimit = (gas * 12n) / 10n;
  const fee = gasLimit * gasPrice;
  const findings = scanBytecode(compiled?.deployedBytecode ?? bytecode);

  const plan = {
    from: signer.address,
    contract: compiled?.qualifiedName ?? input.artifactPath ?? "bytecode",
    compiler: compiled
      ? {
          version: compiled.compilerVersion,
          evmVersion: (compiled.standardJsonInput.settings as { evmVersion: string }).evmVersion,
        }
      : null,
    constructorArgs: args,
    estimatedGas: gas,
    maxFeeZth: formatEther(fee),
    balanceZth: formatEther(balance),
    bytecodeFindings: findings,
    willVerify: Boolean(compiled) && input.verify !== false,
  };
  if (findings.some((f) => f.severity === "error")) {
    return {
      status: "refused",
      reason: "The bytecode uses features Zenith does not support.",
      plan,
    };
  }
  if (balance < fee)
    return {
      status: "refused",
      reason: `Not enough ZTH for gas: need about ${formatEther(fee)}, have ${formatEther(balance)}. Use the faucet.`,
      plan,
    };
  if (!input.confirm)
    return {
      status: "simulated",
      note: "Nothing was sent. Call again with confirm=true to deploy.",
      plan,
    };

  checkSpendCap(ctx, signer, fee);
  const sent = await sendAndTrace(ctx, signer, { data, gas: gasLimit }, fee);
  let verification: unknown = null;
  if (compiled && input.verify !== false && "contractAddress" in sent && sent.contractAddress) {
    const encodedArgs = ctor && args.length ? encodeAbiParameters(ctor.inputs, args) : undefined;
    verification = await verifyContract(ctx, {
      sourcePath: input.sourcePath,
      source: input.source,
      fileName: input.fileName,
      contractName: compiled.contractName,
      compilerVersion: input.compilerVersion,
      optimize: input.optimize,
      runs: input.runs,
      evmVersion: input.evmVersion,
      address: sent.contractAddress,
      constructorArgs: encodedArgs,
    }).catch((err: Error) => ({
      status: "failed",
      message: err.message,
    }));
  }
  return { status: "deployed", plan, ...sent, verification };
}

export interface SendInput {
  to?: string;
  valueZth?: string;
  token?: string;
  amount?: string;
  function?: string;
  args?: unknown[];
  gatewayPartyId?: string;
  confirm?: boolean;
}

/**
 * Sends ZTH, an ERC-20 transfer or a contract call. Sends to a Canton party (gatewayPartyId) always run the
 * full Gateway preflight first, and plain sends to a Gateway inbox are refused so the checks cannot be skipped.
 */
export async function sendTransaction(ctx: ZenithContext, input: SendInput) {
  const signer = requireSigner(ctx);
  await requireZenithTestnet(ctx);

  let to: Address;
  let value = 0n;
  let data: Hex = "0x";
  let description: string;
  let preflight: unknown = null;

  if (input.gatewayPartyId) {
    if (!input.token || !input.amount) throw new Error("A Gateway send needs token and amount.");
    const r = await gatewayPreflight(ctx, {
      partyId: input.gatewayPartyId,
      token: input.token,
      amount: input.amount,
      from: signer.address,
    });
    preflight = r;
    if (r.verdict === "blocked" || !r.transaction)
      return { status: "refused", reason: r.summary, preflight: r };
    ({ to, value, data } = r.transaction);
    description = `Gateway deposit of ${input.amount} ${input.token} to ${input.gatewayPartyId} (arrives as ${r.arrivesOnCanton?.amount} ${r.arrivesOnCanton?.symbol})`;
  } else {
    if (!input.to || !isAddress(input.to, { strict: false }))
      throw new Error("Give a valid `to` address (or gatewayPartyId for a send to Canton).");
    if (input.token) {
      if (!input.amount) throw new Error("A token transfer needs an amount.");
      const tokens = await loadGatewayTokens(ctx).catch(() => []);
      const known = matchGatewayToken(tokens, input.token);
      const tokenAddr =
        known?.evm.address ??
        (isAddress(input.token, { strict: false }) ? getAddress(input.token) : null);
      if (!tokenAddr) throw new Error(`Unknown token "${input.token}". Give its ERC-20 address.`);
      const decimals =
        known?.evm.decimals ??
        Number(
          await ctx.client.readContract({
            address: tokenAddr,
            abi: ERC20_ABI,
            functionName: "decimals",
          }),
        );
      const recipient = getAddress(input.to);
      to = tokenAddr;
      data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [recipient, parseDecimal(input.amount, decimals)],
      });
      description = `Transfer ${input.amount} ${known?.evm.symbol ?? input.token} to ${recipient}`;
      const code = await ctx.client.getCode({ address: recipient });
      if (looksLikeGatewayInbox(code)) {
        return {
          status: "refused",
          reason:
            "The recipient is a Gateway inbox. Use gatewayPartyId with the recipient's Canton party ID so every Gateway check runs.",
        };
      }
    } else {
      to = getAddress(input.to);
      if (input.function) {
        const abi = abiFromSignature(input.function, "function");
        const fn = abi[0] as AbiFunction;
        data = encodeFunctionData({
          abi,
          functionName: fn.name,
          args: coerceArgs(fn.inputs, input.args ?? []),
        });
        description = `Call ${fn.name} on ${to}`;
      } else {
        description = `Send ${input.valueZth ?? "0"} ZTH to ${to}`;
      }
      const code = await ctx.client.getCode({ address: to });
      if (looksLikeGatewayInbox(code)) {
        return {
          status: "refused",
          reason:
            "The destination is a Gateway inbox. Use gatewayPartyId with the recipient's Canton party ID so every Gateway check runs.",
        };
      }
    }
    value = input.valueZth ? parseEther(input.valueZth) : 0n;
  }

  const [gas, gasPrice, balance] = await Promise.all([
    ctx.client.estimateGas({ account: signer.address, to, data, value }),
    ctx.client.getGasPrice(),
    ctx.client.getBalance({ address: signer.address }),
  ]);
  const gasLimit = (gas * 12n) / 10n;
  const fee = gasLimit * gasPrice;
  const plan = {
    from: signer.address,
    description,
    to,
    valueZth: formatEther(value),
    data,
    estimatedGas: gas,
    maxFeeZth: formatEther(fee),
    balanceZth: formatEther(balance),
  };
  if (balance < value + fee)
    return { status: "refused", reason: "Not enough ZTH for value plus gas.", plan, preflight };
  if (!input.confirm)
    return {
      status: "simulated",
      note: "Nothing was sent. Call again with confirm=true to send.",
      plan,
      preflight,
    };

  checkSpendCap(ctx, signer, value + fee);
  return {
    status: "sent",
    plan,
    preflight,
    ...(await sendAndTrace(ctx, signer, { to, data, value, gas: gasLimit }, fee)),
  };
}
