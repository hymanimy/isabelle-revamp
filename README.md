# Isabelle Revamp

**Isabelle/HOL in stock VS Code.**

The goal is a VS Code extension that can do everything Isabelle/jEdit can feasibly do, plus
the editor conveniences Lean users expect from its VS Code extension. Isabelle's kernel, HOL
and Isar syntax are untouched: everything here is a client of Isabelle's own
`isabelle vscode_server`.

- `.thy` files in ordinary VS Code: highlighting, Unicode rendering of `∑ ∉ ℚ`, ASCII
  symbol input and completion.
- Goal state that follows the cursor, errors inline, Ctrl-click into the HOL library.
- Like jEdit, Isabelle checks the text near the cursor; the **Isabelle Theories** view shows the
  progress of every open theory and the theories it imports.
- An optional [MCP](https://modelcontextprotocol.io) server exposing the live proof state
  (`goals_at`, `errors`, `hover`, `definition`, …) so an agent such as Claude Code sees exactly
  what you see.

Started at the *Reinvent the Wheel* hackathon, 17 October 2026. The hackathon version,
including its demo, is preserved on the `leo` branch.

## Install

Download `isabelle-revamp-0.2.0.vsix` from the
[latest release](https://github.com/hymanimy/isabelle-revamp/releases/latest), then either

```sh
code --install-extension isabelle-revamp-0.2.0.vsix
```

or in VS Code: **Extensions → ⋯ → Install from VSIX…**. Open any `.thy` file. If Isabelle
isn't found you get one notification with **Locate…** (pick `bin/isabelle`) or **Download**.
Run **Isabelle Revamp: Setup check** from the command palette to see what's wired up.

## Dependencies

| Needed for | Dependency | Notes |
| --- | --- | --- |
| Everything | [Isabelle2025-2](https://isabelle.in.tum.de/) | the macOS and Linux downloads include HOL prebuilt; another logic, such as HOL-Analysis, needs `isabelle build -b <logic>` once |
| Everything | VS Code 1.104+ | stock build; no VSCodium needed |
| Development | Node 22+, npm | to build the extension and run the checks |

Tested on macOS (Apple Silicon) and Linux. Windows is untested.

## MCP server (optional)

Run **Isabelle: Register MCP Server with Claude Code** once. Then start `claude` in your theory
folder, for example in VS Code's terminal, and ask it to prove something: it reads goals, edits
the theory, and checks the result in the same Isabelle session you see. It can also ask what a
name is (`hover`) and where it is defined (`definition`). There is nothing else to install; the
server runs on VS Code's own Node.js. See [docs/MCP.md](docs/MCP.md) for the tools, and for how
it compares with other Isabelle MCP servers.

## How it works

```
 MCP client ──stdio──▶ out/mcpServer.js
                           │  local socket, token-authenticated
                           ▼
               VS Code extension (TypeScript)
               goals · symbols · decorations · edits
                           │  LSP + PIDE/caret_update, PIDE/dynamic_output
                           ▼
               isabelle vscode_server  (unmodified)
                           │
                    Isabelle/HOL kernel
```

The extension owns the one Isabelle process; the MCP server is a thin bridge to it. Protocol
details discovered empirically are in [docs/PROTOCOL_NOTES.md](docs/PROTOCOL_NOTES.md).

## Development

```sh
npm ci --prefix extension
# open this folder in VS Code, Run → Start Debugging (F5)
npm test --prefix extension                # unit tests: no VS Code window, no Isabelle
npm run test:integration --prefix extension  # drives a real VS Code window against Isabelle
npm run package --prefix extension         # builds dist/isabelle-revamp-0.2.0.vsix
```

The integration tests open a VS Code window and need a display. They find VS Code and Isabelle
at their usual install locations; set `VSCODE_EXECUTABLE` or `ISABELLE_EXECUTABLE` otherwise.
Run selected suites with `npm run test:integration --prefix extension -- goals,proof`, and check
an installed VSIX with `-- installed`.

Layout: `extension/` (VS Code extension and its MCP server, with tests in `extension/test/`),
`examples/` (example theories), `scripts/` (packaging check, LSP probe), `docs/`.

## Docs

- [docs/FEEDBACK.md](docs/FEEDBACK.md): gaps compared with jEdit and Lean's VS Code setup.
- [docs/PAINPOINTS.md](docs/PAINPOINTS.md): every way installing and using Isabelle went
  wrong, with the fix each one needs.
- [docs/PROTOCOL_NOTES.md](docs/PROTOCOL_NOTES.md): how the Isabelle language server
  actually behaves.

## Credits

Isabelle and its VS Code language server are by the Isabelle team (BSD; see
[THIRD_PARTY_NOTICES](extension/THIRD_PARTY_NOTICES.md)). The MCP tool design follows AWS's
[I/Q](https://github.com/awslabs/AutoCorrode/blob/main/iq/README.md) for Isabelle/jEdit.
Team: Alex Hyman, Leo Aarons-Ditson. MIT licence.
