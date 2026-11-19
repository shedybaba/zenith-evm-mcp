import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { SolcCompiler } from "solc";
import type { Abi, Hex } from "viem";
import { fetchJson } from "./http.js";

/** Zenith activated Prague at genesis. Osaka opcodes such as CLZ fail with "NotActivated". */
export const ZENITH_EVM_VERSION = "prague";

type Solc = SolcCompiler;

export interface CompileOptions {
  sourcePath?: string;
  source?: string;
  fileName?: string;
  contractName?: string;
  /** Short ("0.8.24") or long ("v0.8.24+commit.e11b9ed9") version. Defaults to the bundled compiler when the pragma allows it. */
  compilerVersion?: string;
  optimize?: boolean;
  runs?: number;
  evmVersion?: string;
}

export interface CompileResult {
  contractName: string;
  sourceName: string;
  /** Fully qualified name for verification: "File.sol:Contract". */
  qualifiedName: string;
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
  compilerVersion: string;
  standardJsonInput: Record<string, unknown>;
  warnings: string[];
}

let bundled: Solc | undefined;
const remoteCache = new Map<string, Solc>();

async function bundledSolc(): Promise<Solc> {
  bundled ??= (await import("solc")).default;
  return bundled;
}

export function longVersion(raw: string): string {
  const v = raw.replace(/\.Emscripten.*$/, "").replace(/^v?/, "v");
  return v;
}

function parseVersion(v: string): [number, number, number] {
  const [a = 0, b = 0, c = 0] = v
    .replace(/^[^\d]*/, "")
    .split(/[.+]/)
    .map(Number);
  return [a, b, c];
}
const cmp = (x: [number, number, number], y: [number, number, number]) =>
  x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/** Minimal check of a solidity pragma (^, ~, >=, >, <=, <, =, exact) against a version. */
export function satisfiesPragma(pragma: string, version: string): boolean {
  const v = parseVersion(version);
  return pragma.split("||").some((range) =>
    range
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((part) => {
        const m = part.match(/^(\^|~|>=|<=|>|<|=)?(\d+\.\d+(?:\.\d+)?)$/);
        if (!m) return true;
        const op = m[1] ?? "=";
        const t = parseVersion(m[2]!);
        const c = cmp(v, t);
        switch (op) {
          case "^":
            return c >= 0 && v[0] === t[0] && (t[0] !== 0 || v[1] === t[1]);
          case "~":
            return c >= 0 && v[0] === t[0] && v[1] === t[1];
          case ">=":
            return c >= 0;
          case ">":
            return c > 0;
          case "<=":
            return c <= 0;
          case "<":
            return c < 0;
          default:
            return c === 0;
        }
      }),
  );
}

async function remoteSolc(version: string): Promise<Solc> {
  let long = version;
  if (!/\+commit\./.test(version)) {
    const list = await fetchJson<{ releases: Record<string, string> }>(
      "https://binaries.soliditylang.org/bin/list.json",
    );
    const short = version.replace(/^v/, "");
    const file = list.releases[short];
    if (!file) throw new Error(`Unknown solc version ${version}`);
    long = file.replace(/^soljson-/, "").replace(/\.js$/, "");
  }
  long = longVersion(long);
  const hit = remoteCache.get(long);
  if (hit) return hit;
  const base = await bundledSolc();
  const loaded = await new Promise<Solc>((res, rej) =>
    base.loadRemoteVersion(long, (err, s) => (err ? rej(err) : res(s))),
  );
  remoteCache.set(long, loaded);
  return loaded;
}

function findUp(start: string, name: string): string | null {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadRemappings(root: string): [string, string][] {
  const file = findUp(root, "remappings.txt");
  if (!file) return [];
  const base = dirname(file);
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const [from, to] = l.split("=") as [string, string];
      return [from.replace(/^.*:/, ""), join(base, to)];
    });
}

/**
 * Compiles a Solidity file (with its imports from the same folder, remappings.txt or node_modules)
 * and returns the artifacts plus the exact standard-JSON input, which is what verification needs.
 */
export async function compileSolidity(opts: CompileOptions): Promise<CompileResult> {
  const source =
    opts.source ?? (opts.sourcePath ? readFileSync(opts.sourcePath, "utf8") : undefined);
  if (!source) throw new Error("Give sourcePath or source.");
  const sourceName =
    opts.fileName ?? (opts.sourcePath ? basename(opts.sourcePath) : "Contract.sol");
  const root = opts.sourcePath ? dirname(resolve(opts.sourcePath)) : process.cwd();
  const remappings = loadRemappings(root);
  const sources: Record<string, { content: string }> = { [sourceName]: { content: source } };

  const findImports = (path: string) => {
    const candidates: string[] = [join(root, path)];
    for (const [from, to] of remappings)
      if (path.startsWith(from)) candidates.push(join(to, path.slice(from.length)));
    const nm = findUp(root, "node_modules");
    if (nm) candidates.push(join(nm, path));
    for (const c of candidates) {
      if (existsSync(c)) {
        const content = readFileSync(c, "utf8");
        sources[path] = { content };
        return { contents: content };
      }
    }
    return { error: `File not found: ${path}` };
  };

  const pragma = source.match(/pragma\s+solidity\s+([^;]+);/)?.[1]?.trim();
  let compiler = await bundledSolc();
  if (opts.compilerVersion) compiler = await remoteSolc(opts.compilerVersion);
  else if (pragma && !satisfiesPragma(pragma, compiler.version())) {
    const list = await fetchJson<{ releases: Record<string, string> }>(
      "https://binaries.soliditylang.org/bin/list.json",
    );
    const best = Object.keys(list.releases)
      .filter((v) => satisfiesPragma(pragma, v))
      .sort((a, b) => cmp(parseVersion(b), parseVersion(a)))[0];
    if (!best) throw new Error(`No solc release satisfies "pragma solidity ${pragma}"`);
    compiler = await remoteSolc(best);
  }

  const settings = {
    optimizer: { enabled: opts.optimize ?? true, runs: opts.runs ?? 200 },
    evmVersion: opts.evmVersion ?? ZENITH_EVM_VERSION,
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] },
    },
  };
  const output = JSON.parse(
    compiler.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { [sourceName]: { content: source } },
        settings,
      }),
      { import: findImports },
    ),
  ) as {
    errors?: { severity: string; formattedMessage: string }[];
    contracts?: Record<
      string,
      Record<
        string,
        { abi: Abi; evm: { bytecode: { object: string }; deployedBytecode: { object: string } } }
      >
    >;
  };
  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length)
    throw new Error(`Compilation failed:\n${errors.map((e) => e.formattedMessage).join("\n")}`);

  const inMain = output.contracts?.[sourceName] ?? {};
  const deployable = Object.entries(inMain).filter(([, c]) => c.evm.bytecode.object.length > 0);
  const pick = opts.contractName
    ? deployable.find(([n]) => n === opts.contractName)
    : deployable.length === 1
      ? deployable[0]
      : deployable.at(-1);
  if (!pick) {
    throw new Error(
      opts.contractName
        ? `No deployable contract "${opts.contractName}" in ${sourceName}. Found: ${deployable.map(([n]) => n).join(", ") || "none"}.`
        : `No deployable contract in ${sourceName}.`,
    );
  }
  const [contractName, artifact] = pick;
  return {
    contractName,
    sourceName,
    qualifiedName: `${sourceName}:${contractName}`,
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`,
    compilerVersion: longVersion(compiler.version()),
    standardJsonInput: { language: "Solidity", sources, settings },
    warnings: (output.errors ?? [])
      .filter((e) => e.severity !== "error")
      .map((e) => e.formattedMessage.split("\n")[0]!),
  };
}

/** Runtime bytecode without the trailing CBOR metadata, for comparing a local build with deployed code. */
export function stripMetadata(code: Hex): string {
  const hex = code.slice(2);
  if (hex.length < 4) return hex;
  const len = parseInt(hex.slice(-4), 16) * 2 + 4;
  return len < hex.length ? hex.slice(0, -len) : hex;
}
