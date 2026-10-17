# Feedback after first hands-on test (2026-10-17)

It's already clean and works well. These are the gaps compared with jEdit and Lean's VS Code setup.

Isabelle2025-2 ships the source of its official VS Code extension in
`src/Tools/VSCode/extension/src/`, about 2,200 lines of TypeScript. Several items below can be ported from
it rather than written from scratch. The `vscode_server` already supports most of them.

## Quick wins

| # | Change | Notes |
|---|--------|-------|
| 1 | **Lock library files** (HOL, HOL-Analysis, ML) when reached by Ctrl-click | VS Code's built-in `files.readonlyInclude` setting can match the Isabelle install path and `~/.isabelle/` |
| 2 | **Nicer syntax colours** (the current pink and blue) | Comes from the theme applied to our syntax grammar. Adjust the grammar's scopes or `editor.tokenColorCustomizations` |
| 3 | **Check hover** on `value` results, types and constants | The server's hover handler includes command output and types, but this is untested in our extension |
| 4 | **Open the goals view on the right** automatically when a `.thy` file opens | It currently sits in the Explorer |
| 5 | **Restart command or button** for the language server | |

## Symbols and rendering (do 6 first; 7, 8 and 11 depend on it)

| # | Change | Notes |
|---|--------|-------|
| 6 | **Show Unicode symbols** (`\<noteq>` → ≠) and add an input method (`\noteq` → ≠) | Server options `vscode_unicode_symbols_output` and `_edits`, the official `symbol.ts`, and `PIDE/abbrevs_request`. ⚠️ **Decision needed:** keep the ASCII form on disk and only display Unicode (compatible with jEdit and the AFP; recommended), or save Unicode to disk like Lean |
| 7 | **Real superscripts** (`m⇧2` → m²) | Editor: port the official `script_decorations.ts`. Sidebar: comes with 8 |
| 8 | **Colour the goal state** | The server sends coloured HTML; `outputText.ts` strips it to plain text. Render it safely by sanitising it or mapping its classes to our own CSS |
| 9 | **Underline lines that have output**, like jEdit's dotted underline or Lean's info squiggle | The server already sends this decoration |
| 10 | **Outline and breadcrumbs**: theorems and lemmas as document symbols | Also gives Ctrl+Shift+O to jump between them |
| 11 | **Cartouches `‹…›` instead of `"…"`** | Needs 6, otherwise `\<open>…\<close>` is hard to read. Add an auto-close pair and a `<<` shortcut; optionally convert `Sqrt2.thy` |

## Goals sidebar (taking ideas from Lean's InfoView)

| # | Change | Notes |
|---|--------|-------|
| 12 | **Messages section**: output from `value`, `thm`, `try0` etc. beside the goal | Currently only "Goal at cursor" is shown. Prerequisite for 17 |
| 13 | **Clear "done" state** ("No goals" or "Proof complete") | |
| 14 | **Header and structure**: `file:line:col`, collapsible goal, facts and messages sections, coloured `this:` facts | |
| 15 | **Pin and pause buttons** | Keeps a goal visible while editing elsewhere |
| 16 | **Copy-to-editor button** on messages | e.g. inserting "Try this: by simp" |

## Larger features

| # | Change | Notes |
|---|--------|-------|
| 17 | **Inline `try0` / `sledgehammer`** with results on hover or in a panel, and click-to-insert, as in jEdit | The server supports Sledgehammer (`vscode_sledgehammer.scala`, `PIDE/sledgehammer_*`), and the official extension has `sledgehammer_panel.ts`. Needs 12 and a code action for inserting the result |
| 18 | **Margin tick on fully proved theorems** (Lean's blue ✓✓), plus a marker for unfinished ones | Error and `sorry` detection already exists for the whole file. Make it per theorem and draw a gutter icon |

## Isabelle equivalents to Lean commands

- **Hover for results:** the server includes `value` output in hover results (see 3).
