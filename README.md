# Isabelle Revamp

**Isabelle/HOL in stock VS Code, with an AI agent that writes proofs the kernel checks.**

Built in one day at the *Reinvent the Wheel* hackathon, 17 October 2026.

Lean is the only proof assistant with first-class editor and AI tooling. Isabelle has a
different type theory, a twenty-year library (the Archive of Formal Proofs) and the most
readable proof language there is, Isar; what it lacks is a modern front end. This project
adds one, without changing a line of Isabelle.

- **Editor:** `.thy` files in ordinary VS Code: highlighting, Unicode rendering of `∑ ∉ ℚ`,
  goal state that follows the cursor, errors inline, Ctrl-click into the HOL library.
- **Proof Graph:** every named step of a proof as a node in a dependency graph, grey while
  open, amber while checking, green when the kernel accepts it. Replay a proof you just watched.
- **Agent:** an [MCP](https://modelcontextprotocol.io) server exposing the live proof state
  (`goals_at`, `errors`, `sorry_positions`, `proof_graph`, …) so Claude Code or Codex can
  write a proof step by step and see exactly what you see. The agent proposes; **only the
  kernel says proved.**

The one rule: Isabelle's kernel, HOL and Isar syntax are untouched. Everything here is a client
of Isabelle's own `isabelle vscode_server`.

## Install the VS Code extension

Download `isabelle-revamp-0.1.0.vsix` from the
[latest release](https://github.com/hymanimy/isabelle-revamp/releases/latest), then either

```sh
code --install-extension isabelle-revamp-0.1.0.vsix
```

or in VS Code: **Extensions → ⋯ → Install from VSIX…**. Open any `.thy` file. If Isabelle
isn't found you get one notification with **Locate…** (pick `bin/isabelle`) or **Download**.
Run **Isabelle Revamp: Setup check** from the command palette to see what's wired up.

That gives you the editor, goals and proof graph. No Node, Python or clone needed.

## Add the agent

1. Install [Claude Code](https://docs.claude.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`), sign in once.
2. Python 3.11+ on PATH.
3. Register the MCP server (printed by **Setup check**, or see [mcp/README.md](mcp/README.md)):
   ```sh
   claude mcp add --transport stdio --scope local isabelle -- python3 '<extension path>/mcp/launch.py'
   ```
4. Open a `.thy` with a `sorry` in it, open a terminal in VS Code, run `claude`, type **prove this**.

The `demo/` folder is pre-configured: `cd demo && claude` picks up `.mcp.json` and the
proof-style rules in [`demo/CLAUDE.md`](demo/CLAUDE.md) automatically.

## Dependencies

| Needed for | Dependency | Notes |
| --- | --- | --- |
| Everything | [Isabelle2025-2](https://isabelle.in.tum.de/) with the HOL heap | macOS bundle ships HOL prebuilt; on Linux run `isabelle build -b HOL` once (10–20 min) |
| Everything | VS Code 1.104+ | stock build; no VSCodium needed |
| Agent | Claude Code 2.1+ or Codex CLI | either; one agent per editor window |
| Agent | Python 3.11+ | the MCP bridge; its own deps install into a private venv on first run |
| Development | Node 22+, npm | to build the extension and run the checks |

Tested on macOS (Apple Silicon) and Linux. Windows is untested.

## Run the demo

```sh
git clone https://github.com/hymanimy/isabelle-revamp.git && cd isabelle-revamp && git checkout leo
bash scripts/demo-env.sh      # isolated "Demo" VS Code profile, prints the launch command
```

Run the printed command (Linux: replace the macOS `code` path with `code`). Then
**Isabelle: Demo Layout**, open `demo/Swarm.thy`, `claude` in the terminal, **prove this**.
The four-beat storyboard is [docs/STORYBOARD.md](docs/STORYBOARD.md); the click-by-click
script and pre-flight checklist are [docs/DEMO.md](docs/DEMO.md).

Independent check of any proof, no extension involved:
```sh
isabelle process_theories -D demo -O Swarm     # exit 0, no sorry
```

## How it works

```
 Claude Code / Codex ──MCP (stdio)──▶ mcp/server.py
                                          │  local socket, token-authenticated
                                          ▼
                              VS Code extension (TypeScript)
                              goals · graph · edits · decorations
                                          │  LSP + PIDE/caret_update, PIDE/dynamic_output
                                          ▼
                              isabelle vscode_server  (unmodified)
                                          │
                                   Isabelle/HOL kernel
```

The extension owns the one Isabelle process. The MCP server is a thin bridge to it, so the
human and the agent are looking at the same prover. Protocol details discovered empirically
are in [docs/PROTOCOL_NOTES.md](docs/PROTOCOL_NOTES.md).

## Development

```sh
npm ci --prefix extension
# open this folder in VS Code, Run → Start Debugging (F5)
npm run package --prefix extension      # builds dist/isabelle-revamp-0.1.0.vsix
bash scripts/check_m14.sh               # full regression chain
```

Layout: `extension/` (VS Code extension), `mcp/` (MCP server), `examples/` (theories and
reference solutions), `demo/` (what you open on stage), `scripts/` (checks), `docs/`.

## Docs

- [docs/PAINPOINTS.md](docs/PAINPOINTS.md) — every way installing and using Isabelle went
  wrong today, with the fix each one needs. The reason this project exists.
- [docs/STORYBOARD.md](docs/STORYBOARD.md) — the demo.
- [docs/PROGRESS.md](docs/PROGRESS.md) — milestone-by-milestone build log, M1–M15.
- [docs/README_milestones.md](docs/README_milestones.md) — the previous, feature-by-feature README.

## Credits and lineage

Isabelle and its VS Code language server are by the Isabelle team (BSD; see
[THIRD_PARTY_NOTICES](extension/THIRD_PARTY_NOTICES.md)). The MCP tool design follows AWS's
[I/Q](https://github.com/awslabs/AutoCorrode/blob/main/iq/README.md) for Isabelle/jEdit;
the dependency-graph idea follows Anthropic's
[Prove2Me](https://www.anthropic.com/news/formalizing-fermats-last-theorem) harness.
Team: Alex Hyman, Leo Aarons-Ditson. Built with Codex and Claude Code. MIT licence.
