# Isabelle Revamp

Live Isabelle/HOL proofs in stock VS Code, with **Isabelle Goals** and
mathematical symbol display. The original ASCII theory stays on disk by default.

## Install and open a proof

1. Install Isabelle2025-2 with its HOL heap and VS Code 1.104 or newer.
2. In Extensions, choose **… → Install from VSIX…** and select
   `isabelle-revamp-0.1.0.vsix`.
3. Open a folder containing your `.thy` files, then open a theory. Goals opens
   automatically. **Isabelle: Show Theories** lists each open theory and the
   theories it imports, with the prover's progress on each.
4. If Isabelle is not found, choose **Locate…** and select its `bin/isabelle`.
   **Isabelle Revamp: Setup check** prints checks and fixes in Output → Isabelle.

No Node, npm, Python or repository checkout is needed.
The extension finds Isabelle using its executable setting, PATH, then common
macOS/home installation locations. To build a missing HOL heap, run
`isabelle build -b HOL` once.

## MCP server (optional)

The extension bundles an MCP server that gives an agent such as Claude Code the
same goals, errors and edits you see, in the same Isabelle session. Run
**Isabelle: Register MCP Server with Claude Code** once, then start `claude` in
your theory folder. The server runs on VS Code's own Node.js and never moves
your cursor or scrolls your editor.

The extension uses the unmodified Isabelle language server. It never runs
Sledgehammer automatically. Source:
[hymanimy/isabelle-revamp](https://github.com/hymanimy/isabelle-revamp).

MIT licensed; see THIRD_PARTY_NOTICES.md for bundled code and Isabelle notices.
