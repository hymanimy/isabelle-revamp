# Changelog

## 0.2.0 (2026-10-20)

- **Checking like Isabelle/jEdit.** Isabelle checks the text near the cursor
  (`isabelleRevamp.checkingPerspective`, 0 for the whole file). Running commands
  are highlighted purple, unchecked text pink and failed text red.
- **Isabelle Theories view**, like jEdit's Theories panel: each open theory and
  the theories it imports, with the prover's progress on each.
- **Goals** shows messages from commands without a proof state, such as `value`
  and `try0`, and a running command's output as it arrives, so sledgehammer's
  proofs appear one by one. Apply a proof that `try0`, `try` or `sledgehammer`
  found by clicking it.
- **Faster results:** output arrives after 0.2 s of quiet instead of 0.5 s
  (`isabelleRevamp.outputDelay`).
- "Legacy feature!" messages are warnings, not errors.
- New settings `isabelleRevamp.logic` and `isabelleRevamp.sessionDirs`.
- Library theories reached by Ctrl-click open read-only, without writing to
  workspace settings.
- **MCP server** for agents such as Claude Code, now bundled: it runs on VS
  Code's own Node.js, with no Python needed. Register it with **Isabelle:
  Register MCP Server with Claude Code**. It works with several VS Code windows,
  never moves your cursor or switches your tab, and has new `hover` and
  `definition` tools.
- Faster symbol display and completion on large theories.

## 0.1.0 (2026-10-18)

First release, from the *Reinvent the Wheel* hackathon: Isabelle/HOL in VS Code
with goals, Unicode symbols, symbol input and an MCP server.
