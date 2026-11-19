# Contributing

## Setup

```bash
npm install
npm run check
```

`npm run check` runs the type checker, ESLint, Prettier and the offline tests. CI runs the same on Node 20, 22 and 24.

## Tests

- `test/unit`: pure logic and the MCP surface, offline.
- `test/footguns`: one named test per documented Zenith pitfall, each pointing at the docs section it comes from. **A new warning in the Zenith docs should get a test here.**
- `test/live`: read-only checks against the public testnet (`npm run test:live`), plus an opt-in write flow (`npm run test:live:write`) that needs a funded testnet key. Live tests run one file at a time to stay inside the public rate limits.

## Layout

- `src/core`: network clients and Zenith rules, with no MCP dependency. Keep network calls and rule evaluation separate so rules stay testable offline.
- `src/tools`: MCP tool definitions. Every input has a zod schema and a description; every result has a one-line summary and structured JSON.
- `skills/zenith-evm`: the agent skill. Each reference keeps its "Validated" date and sources; mark facts confirmed on the network as _(observed)_.
- `contracts/TransferProbe.sol`: the probe used by the eligibility check. Rebuild with `node scripts/build-probe.mjs`.

After changing tools, run `npm run docs` to regenerate `docs/tools.md`.

## Style

Plain, specific wording in tool descriptions and errors: say what happened and what to do next.
