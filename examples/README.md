# Client setup

Replace `github:shedybaba/zenith-evm-mcp` with `zenith-evm-mcp` once the package is on npm.

| App              | File                                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| Claude Desktop   | [`claude-desktop.json`](claude-desktop.json) → `claude_desktop_config.json` |
| Claude Code      | `claude mcp add zenith -- npx -y github:shedybaba/zenith-evm-mcp`           |
| Cursor           | [`cursor.json`](cursor.json) → `.cursor/mcp.json`                           |
| VS Code          | [`vscode.json`](vscode.json) → `.vscode/mcp.json`                           |
| Windsurf         | [`cursor.json`](cursor.json) → `~/.codeium/windsurf/mcp_config.json`        |
| With write tools | [`with-write-tools.json`](with-write-tools.json)                            |

[`contracts/Counter.sol`](contracts/Counter.sol) is the quickstart contract used by the `deploy_and_verify` prompt.
