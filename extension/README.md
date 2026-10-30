# Isabelle Revamp

Live Isabelle/HOL proofs in stock VS Code, with **Isabelle Goals** and
mathematical symbol display. The original ASCII theory stays on disk by default.

This is an unofficial extension, not made by the Isabelle team. It is a client
of the language server that ships with Isabelle (`isabelle vscode_server`).

## Install and open a proof

1. Install Isabelle2025-2 with its HOL heap and VS Code 1.104 or newer. Other
   Isabelle releases start with a warning that some features may not work;
   support for Isabelle2026 will follow its release.
2. In the Extensions view, search for **Isabelle Revamp** and install it.
   Alternatively, download the `.vsix` from
   [GitHub releases](https://github.com/hymanimy/isabelle-revamp/releases) and
   choose **… → Install from VSIX…**.
3. Open a folder containing your `.thy` files, then open a theory. Goals opens
   automatically. **Isabelle: Show Theories** lists each open theory and the
   theories it imports, with the prover's progress on each. The Outline view,
   breadcrumbs and **Go to Symbol in Editor** (Ctrl+Shift+O) list the theory's
   sections, lemmas, definitions and types. **Isabelle: Sledgehammer** (the ⚡
   button on Goals, or the editor's context menu) runs sledgehammer at the
   cursor without editing the theory; on a `sorry` it runs on the statement
   before it. Its proofs appear in Goals as they arrive: click one to put it
   in place of the `sorry`. When `try0`,
   `try` or `sledgehammer` finds a proof, apply it from the hover over the
   command or by clicking it in Goals; a `sorry` right after it goes too.
   Once Isabelle has checked a lemma, definition or type, a mark appears
   beside it: a tick when it is done, an amber ring when it contains `sorry`
   or `oops`, a cross when it has an error (setting `isabelleRevamp.lemmaStatus`).
   As in Isabelle/jEdit, running commands are highlighted purple, unchecked
   text pink and failed text red; the colours are theme colours
   (`isabelle.runningBackground` and others) you can change in
   `workbench.colorCustomizations`.
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

Agents get a `sledgehammer` tool too. Isabelle runs one sledgehammer at a time,
so yours and the agent's share it: you are asked before replacing an agent's
run, and an agent cannot replace yours. The extension uses the unmodified
Isabelle language server and never runs Sledgehammer automatically. Source:
[hymanimy/isabelle-revamp](https://github.com/hymanimy/isabelle-revamp).

MIT licensed; see THIRD_PARTY_NOTICES.md for bundled code and Isabelle notices.
