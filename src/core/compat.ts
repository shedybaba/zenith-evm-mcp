import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { Hex } from "viem";
import { OPCODES, scanOpcodes } from "./bytecode.js";
import { DOC_LINKS, LIMITS } from "./config.js";

export type FindingSeverity = "error" | "warning" | "info";

export interface Finding {
  rule: string;
  severity: FindingSeverity;
  message: string;
  fix: string;
  file?: string;
  line?: number;
  snippet?: string;
  docs?: string;
}

interface Rule {
  id: string;
  severity: FindingSeverity;
  pattern: RegExp;
  message: string;
  fix: string;
  docs?: string;
}

const MISSING_CONTRACTS =
  "Not deployed on Zenith testnet (checked against the network when this release was validated).";

const SOLIDITY_RULES: Rule[] = [
  {
    id: "prevrandao-randomness",
    severity: "warning",
    pattern: /\bblock\.(prevrandao|difficulty)\b/,
    message: "block.prevrandao is set by Zenith's block building, not by Beacon Chain randomness.",
    fix: "Do not use it for randomness; use an oracle or a commit-reveal scheme.",
    docs: DOC_LINKS.differences,
  },
  {
    id: "blob-opcodes",
    severity: "error",
    pattern: /\bblobhash\s*\(|\bblock\.blobbasefee\b/,
    message: "Blob transactions (EIP-4844) are not supported on Zenith.",
    fix: "Remove blob-dependent logic.",
    docs: DOC_LINKS.differences,
  },
  {
    id: "block-number-timing",
    severity: "warning",
    pattern: /\bblock\.number\b/,
    message:
      "Blocks are produced only when there are transactions, so block.number does not track time (an idle chain makes no blocks).",
    fix: "Use block.timestamp for deadlines, vesting and cooldowns.",
    docs: DOC_LINKS.differences,
  },
  {
    id: "multicall3-address",
    severity: "error",
    pattern: /0xcA11bde05977b3631167028862bE2a173976CA11/i,
    message: `Multicall3 at its canonical address: ${MISSING_CONTRACTS}`,
    fix: "Deploy your own multicall contract or avoid the dependency.",
  },
  {
    id: "permit2-address",
    severity: "error",
    pattern: /0x000000000022D473030F116dDEE9F6B43aC78BA3/i,
    message: `Permit2 at its canonical address: ${MISSING_CONTRACTS}`,
    fix: "Deploy Permit2 yourself or use plain approvals.",
  },
  {
    id: "entrypoint-address",
    severity: "error",
    pattern:
      /0x0000000071727De22E5E9d8BAf0edAc6f37da032|0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789/i,
    message: `ERC-4337 EntryPoint at its canonical address: ${MISSING_CONTRACTS}`,
    fix: "Deploy an EntryPoint yourself before relying on account abstraction.",
  },
  {
    id: "createx-address",
    severity: "error",
    pattern: /0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed/i,
    message: `CreateX at its canonical address: ${MISSING_CONTRACTS}`,
    fix: "Use the CREATE2 deployer at 0x4e59b44847b379578588920ca78fbf26c0b4956c, which is deployed.",
  },
  {
    id: "mainnet-chainid",
    severity: "info",
    pattern: /block\.chainid\s*==\s*1\b/,
    message: "Logic gated on Ethereum mainnet's chain ID.",
    fix: "Zenith testnet's chain ID is 936485.",
  },
];

const SCRIPT_RULES: Rule[] = [
  {
    id: "websocket",
    severity: "error",
    pattern: /\bwebSocket\s*\(|wss:\/\/|WebSocketProvider\b/,
    message: "The public Zenith RPC has no WebSocket endpoint.",
    fix: "Use the HTTP transport and poll.",
    docs: DOC_LINKS.jsonRpc,
  },
  {
    id: "filters-subscriptions",
    severity: "error",
    pattern:
      /eth_newFilter|eth_newBlockFilter|eth_getFilterChanges|eth_subscribe|createEventFilter|createContractEventFilter|createBlockFilter|createPendingTransactionFilter/,
    message: "Filters and subscriptions are not available on the public RPC.",
    fix: "Poll eth_blockNumber and eth_getLogs instead.",
    docs: DOC_LINKS.jsonRpc,
  },
  {
    id: "watchers-need-polling",
    severity: "warning",
    pattern: /\bwatch(ContractEvent|Event|Blocks|BlockNumber|PendingTransactions)\s*\(/,
    message: "viem watchers try filters first, which the public RPC does not offer.",
    fix: "Pass { poll: true, pollingInterval: 2_000 } (or more) to every watcher.",
    docs: DOC_LINKS.jsonRpc,
  },
  {
    id: "extra-confirmations",
    severity: "warning",
    pattern: /confirmations\s*:\s*([2-9]|\d{2,})\b|\.wait\(\s*([2-9]|\d{2,})\s*[,)]/,
    message:
      "Waiting for several confirmations is unnecessary (a receipt is final) and can hang: blocks are only produced when there are transactions.",
    fix: "Wait for one receipt, with a timeout (for example tx.wait(1, 120_000)).",
    docs: DOC_LINKS.differences,
  },
  {
    id: "unbounded-getlogs",
    severity: "warning",
    pattern: /fromBlock\s*:\s*(0n?\b|["']earliest["'])/,
    message: `eth_getLogs covers at most ${LIMITS.rpcMaxLogRange} blocks per call on the public RPC.`,
    fix: `Query in ranges of ${LIMITS.rpcMaxLogRange} blocks, or use the explorer's getLogs API for wide ranges.`,
    docs: DOC_LINKS.jsonRpc,
  },
  {
    id: "multicall-batching",
    severity: "warning",
    pattern: /\bmulticall\s*\(|batch\s*:\s*\{\s*multicall\b|multicall\s*:\s*true/,
    message: "viem/wagmi multicall needs Multicall3, which is not deployed on Zenith testnet.",
    fix: "Disable multicall batching (batch: { multicall: false }) or deploy your own multicall and set chain.contracts.multicall3.",
  },
  {
    id: "local-chain-id",
    severity: "info",
    pattern: /chainId\s*[:=]\s*(1337|31337)\b/,
    message:
      "A local development chain ID. Hardhat treats 1337/31337 as local chains and refuses to verify against them.",
    fix: "Use chain ID 936485 for Zenith testnet.",
  },
];

const CONFIG_RULES: { file: RegExp; rules: Rule[] }[] = [
  {
    file: /foundry\.toml$/,
    rules: [
      {
        id: "evm-version-osaka",
        severity: "error",
        pattern: /evm_version\s*=\s*["'](osaka|fusaka)["']/,
        message:
          'Zenith activated Prague; Osaka opcodes such as CLZ fail on-chain with "NotActivated".',
        fix: 'Set evm_version = "prague".',
      },
    ],
  },
  {
    file: /hardhat\.config\.(t|j|cj|mj)s$/,
    rules: [
      {
        id: "evm-version-osaka",
        severity: "error",
        pattern: /evmVersion\s*:\s*["'](osaka|fusaka)["']/,
        message:
          'Zenith activated Prague; Osaka opcodes such as CLZ fail on-chain with "NotActivated".',
        fix: 'Set evmVersion: "prague".',
      },
    ],
  },
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "lib",
  "out",
  "cache",
  "artifacts",
  "dist",
  "build",
  "coverage",
  "typechain",
  "typechain-types",
  ".next",
]);
const SCRIPT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const MAX_FILES = 800;

function lineMatches(text: string, rules: Rule[], file?: string): Finding[] {
  const out: Finding[] = [];
  const lines = text.split(/\r?\n/);
  let inBlockComment = false;
  lines.forEach((raw, i) => {
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const start = line.indexOf("/*");
    if (start >= 0 && line.indexOf("*/", start) < 0) {
      inBlockComment = true;
      line = line.slice(0, start);
    }
    const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
    for (const r of rules) {
      if (r.pattern.test(code)) {
        out.push({
          rule: r.id,
          severity: r.severity,
          message: r.message,
          fix: r.fix,
          docs: r.docs,
          file,
          line: i + 1,
          snippet: raw.trim().slice(0, 160),
        });
      }
    }
  });
  return out;
}

/** Checks Solidity source for Zenith-specific gotchas. */
export function scanSolidity(source: string, file?: string): Finding[] {
  const findings = lineMatches(source, SOLIDITY_RULES, file);
  const pragma = source.match(/pragma\s+solidity\s+([^;]+);/)?.[1];
  if (pragma && /\^0\.8\.(3[1-9]|[4-9]\d)|>=\s*0\.8\.(3[1-9])/.test(pragma)) {
    findings.push({
      rule: "default-evm-version",
      severity: "warning",
      file,
      message:
        'solc 0.8.31 and later compile for Osaka by default; Zenith runs Prague, and Osaka opcodes fail with "NotActivated".',
      fix: 'Set the compiler\'s evmVersion to "prague" (foundry.toml: evm_version = "prague").',
    });
  }
  return findings;
}

/** Checks front-end or script code (TypeScript/JavaScript) for RPC usage the public Zenith RPC does not support. */
export function scanScript(source: string, file?: string): Finding[] {
  return lineMatches(source, SCRIPT_RULES, file);
}

/** Checks deployed or compiled bytecode. */
export function scanBytecode(code: Hex): Finding[] {
  const ops = scanOpcodes(code);
  const out: Finding[] = [];
  if (ops.has(0x1e))
    out.push({
      rule: "osaka-opcode",
      severity: "error",
      message: "Bytecode contains CLZ (0x1e), an Osaka opcode that is not active on Zenith.",
      fix: 'Recompile with evmVersion "prague".',
    });
  if (ops.has(OPCODES.BLOBHASH) || ops.has(OPCODES.BLOBBASEFEE))
    out.push({
      rule: "blob-opcodes",
      severity: "error",
      message: "Bytecode uses blob opcodes; blob transactions are not supported.",
      fix: "Remove blob-dependent logic.",
    });
  if (ops.has(OPCODES.PREVRANDAO))
    out.push({
      rule: "prevrandao-randomness",
      severity: "warning",
      message: "Bytecode reads PREVRANDAO, which is not Beacon Chain randomness on Zenith.",
      fix: "Do not use it for randomness.",
    });
  if (ops.has(OPCODES.NUMBER))
    out.push({
      rule: "block-number-timing",
      severity: "info",
      message:
        "Bytecode reads block.number; blocks are produced on demand, so it does not track time.",
      fix: "Prefer block.timestamp for time-based logic.",
    });
  return out;
}

function walk(dir: string, files: string[]) {
  for (const name of readdirSync(dir)) {
    if (files.length >= MAX_FILES) return;
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (st.size < 1_000_000) files.push(full);
  }
}

/** Scans a file or a project folder: Solidity, scripts and tool configs. */
export function scanPath(path: string) {
  const root = path;
  const files: string[] = [];
  if (statSync(path).isDirectory()) walk(path, files);
  else files.push(path);

  const findings: Finding[] = [];
  let scanned = 0;
  for (const f of files) {
    const ext = extname(f);
    const rel = relative(statSync(root).isDirectory() ? root : join(root, ".."), f) || basename(f);
    const config = CONFIG_RULES.find((c) => c.file.test(f));
    if (ext === ".sol") findings.push(...scanSolidity(readFileSync(f, "utf8"), rel));
    else if (config) findings.push(...lineMatches(readFileSync(f, "utf8"), config.rules, rel));
    else if (SCRIPT_EXT.has(ext)) findings.push(...scanScript(readFileSync(f, "utf8"), rel));
    else continue;
    scanned++;
  }
  // A Solidity project without an explicit EVM version compiles for the compiler's default.
  const foundry = files.find((f) => basename(f) === "foundry.toml");
  if (foundry && !/evm_version/.test(readFileSync(foundry, "utf8"))) {
    findings.push({
      rule: "evm-version-unset",
      severity: "warning",
      file: relative(statSync(root).isDirectory() ? root : join(root, ".."), foundry),
      message:
        "foundry.toml does not set evm_version; recent solc releases default to Osaka, which Zenith does not run.",
      fix: 'Add evm_version = "prague" under [profile.default].',
    });
  }
  return { scannedFiles: scanned, truncated: files.length >= MAX_FILES, findings };
}

export function summarize(findings: Finding[]) {
  const count = (s: FindingSeverity) => findings.filter((f) => f.severity === s).length;
  return { errors: count("error"), warnings: count("warning"), info: count("info") };
}
