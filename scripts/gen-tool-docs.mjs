// Generates docs/tools.md from the server's own tool, resource and prompt definitions.
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createContext } from "../dist/core/context.js";
import { createServer } from "../dist/server.js";
import { VERSION } from "../dist/version.js";

const server = createServer(createContext({}));
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "docs", version: VERSION });
await Promise.all([server.connect(b), client.connect(a)]);

const { tools } = await client.listTools();
const { resources } = await client.listResources();
const { prompts } = await client.listPrompts();

const describeType = (s) => {
  if (!s) return "any";
  if (s.enum) return s.enum.map((v) => `\`${v}\``).join(" \\| ");
  if (s.type === "array") return `${describeType(s.items)}[]`;
  return s.type ?? "any";
};
const esc = (t = "") => t.replace(/\|/g, "\\|").replace(/\n/g, " ");

let md = `# Tool reference\n\nGenerated from zenith-evm-mcp ${VERSION} by \`npm run docs\`. Do not edit by hand.\n\n`;
md += `| Tool | Read-only | What it does |\n|---|---|---|\n`;
for (const t of tools)
  md += `| [\`${t.name}\`](#${t.name}) | ${t.annotations?.readOnlyHint ? "yes" : "**no**"} | ${esc(t.title ?? "")} |\n`;

for (const t of tools) {
  md += `\n## ${t.name}\n\n${t.description}\n\n`;
  const props = Object.entries(t.inputSchema.properties ?? {});
  if (!props.length) {
    md += "No arguments.\n";
    continue;
  }
  const required = new Set(t.inputSchema.required ?? []);
  md += "| Argument | Type | Required | Default | Description |\n|---|---|---|---|---|\n";
  for (const [name, s] of props) {
    md += `| \`${name}\` | ${describeType(s)} | ${required.has(name) ? "yes" : "no"} | ${s.default !== undefined ? `\`${JSON.stringify(s.default)}\`` : ""} | ${esc(s.description)} |\n`;
  }
}

md += `\n## Resources\n\n| URI | Title |\n|---|---|\n`;
for (const r of resources) md += `| \`${r.uri}\` | ${esc(r.title ?? r.name)} |\n`;
md += `\n## Prompts\n\n| Prompt | Arguments | What it does |\n|---|---|---|\n`;
for (const p of prompts)
  md += `| \`${p.name}\` | ${(p.arguments ?? []).map((x) => `\`${x.name}\``).join(", ")} | ${esc(p.description)} |\n`;

writeFileSync("docs/tools.md", md);
await client.close();
console.log(
  `Wrote docs/tools.md (${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts)`,
);
