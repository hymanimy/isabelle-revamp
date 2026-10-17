# Isabelle Revamp

Live Isabelle/HOL proofs in stock VS Code, with **Isabelle Goals**, a **Swarm**
proof board, mathematical symbol display and optional **Ask Isabelle** through
Claude Code. The original ASCII theory stays on disk by default.

## Install and open a proof

1. Install Isabelle2025-2 with its HOL heap and VS Code 1.104 or newer.
2. In Extensions, choose **… → Install from VSIX…** and select
   `isabelle-revamp-0.1.0.vsix`.
3. Open a folder containing your `.thy` files, then open a theory. Goals opens
   automatically. **Isabelle: Demo Layout** puts the source on the left, Goals
   above the named Proof Graph on the right, and Terminal across the bottom.
   It hides the sidebars and Ask view; run Claude Code in Terminal.
4. If Isabelle is not found, choose **Locate…** and select its `bin/isabelle`.
   **Isabelle Revamp: Setup check** prints checks and fixes in Output → Isabelle.

No Node, npm, Python or repository checkout is needed for proof checking.
The extension finds Isabelle using its executable setting, PATH, then common
macOS/home installation locations. To build a missing HOL heap, run
`isabelle build -b HOL` once.

Named graph tiles show their source line. Click to navigate, hover for the goal,
and follow matching editor gutter dots. Named nested steps have their own tiles;
unnamed commands contribute to the enclosing named step. Fit and Replay work without changing the theory. The right
status bar follows the graph; **Isabelle: Show Swarm** retains the compact board.

## Ask Isabelle (optional)

Install and sign in to Claude Code, and install Python 3.11+. Run
**Isabelle: Ask** (`isabelleRevamp.showAsk` must be enabled; Demo Layout
turns it off). If MCP is not registered, copy the one-line registration
command shown in the panel into a terminal in your theory folder. It points
to this extension's bundled `mcp/launch.py`, not a source checkout.

On first use, that launcher installs the pinned FastMCP dependencies into a
private `mcp/.venv` beside the bundled server (network access is needed once).
It changes no global Python packages. Then ask “prove this” or “why does this
fail?”. Claude uses the same checked editor/MCP path as the Swarm board.
Stop cancels the request; submitted edits remain in the editor.

The extension uses the unmodified Isabelle language server. It never runs
Sledgehammer automatically. Source, examples and demo instructions:
[hymanimy/isabelle-revamp](https://github.com/hymanimy/isabelle-revamp).

MIT licensed; see THIRD_PARTY_NOTICES.md for bundled code and Isabelle notices.
