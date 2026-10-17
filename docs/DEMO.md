# Sqrt 2 in five steps

First follow the repository README's setup (installed Isabelle, `npm ci --prefix
extension`, and open the repository in stock VS Code). The committed theory is
complete; the temporary edits below let you demonstrate live checking.

1. Press **F5 → Isabelle: Extension Development Host**. In the new window, open
   **Command Palette → Isabelle: Show Goals**, then click the theorem statement
   in **examples/Sqrt2.thy**. The sidebar header shows **Sqrt2**, then
   **fully checked**, with the goal `sqrt 2 ∉ ℚ` below it.
2. At the bottom of the proof, select the final `by simp` immediately before the
   outer `qed` and type `sorry`. The sidebar changes from **checking…** to
   **unfinished (sorry)**. This admits the last step; it is not a proof error or
   a complete proof, even if the current command reports `No subgoals!`.
3. Click successively inside `have scaled`, `have numerator_even`,
   `have denominator_squared`, and `have common_factor`. Watch the goals change:
   clear the denominator, prove the numerator is even, derive the denominator's
   square equation, and find the common factor. Every `have` has its own goal.
   Squares display as `²`; sidebar colours and the goal font follow VS Code.
4. Replace that final `sorry` with `by (rule TrueI)`. The tactic cannot prove
   `False`: an inline diagnostic appears and the sidebar shows **Proof error**.
5. Replace it with `by simp`, then click inside that final `by` command. The
   error clears and the sidebar shows **No subgoals!** with no unfinished label.
   Save the file; it should again match the committed proof.

To verify the saved theory independently, run
`isabelle process_theories -D examples -O Sqrt2` from the repository root.
It must exit 0, and the file must contain no `sorry` or `oops`.

The proof imports only `Complex_Main`. It assumes a rational representation in
lowest terms, squares the equation, proves both natural numbers even, and
contradicts coprimality. The reduced-fraction setup uses
`Rats_abs_nat_div_natE` from `HOL/Real.thy`; the distribution's
`HOL/Examples/Sqrt.thy` was a reference for that setup. The example does not
import its irrationality theorem, call Sledgehammer, or use Nitpick.

## Swarm

1. In the development host, open **examples/Swarm.thy**, then run
   **Isabelle: Show Swarm**. After Isabelle publishes its annotations, the board
   shows six grey cards and **0/6 proved**. The theorem is the familiar identity
   `1 + 3 + … + (2n − 1) = n²`. The skeleton intentionally contains six admissions.
2. Click **base** to inspect its goal in **Isabelle Goals**. For a quick manual
   preview, replace its `sorry` with `by simp`: the card turns green. Replacing
   that proof with `by (rule TrueI)` makes it red; restore `sorry` for the full
   agent demo. Amber means checking or awaiting current completion evidence.
3. From the repository root, start **Claude Code** with the registered Isabelle
   MCP server and paste [SWARM_PROMPT.md](SWARM_PROMPT.md). Keep the Swarm board
   visible. The agent fills one step at a time; its name appears on the edited
   card for ten seconds. That document also gives optional two-agent assignments.
4. Watch **N/6 proved** rise while the elapsed timer runs from the first edit.
   Click any card to follow its current goal. Red cards indicate a local error;
   grey cards still contain admissions. Status changes use a 300 ms transition.
5. At **6/6 proved**, wait for **kernel-checked ✓**, then save. This badge reuses
   the same whole-file completion check as MCP `status()`. A local green card
   alone can still depend on earlier admitted steps.

`examples/Swarm_solution.thy` is the committed, independently checked reference.
Workspace `files.exclude` and `search.exclude` hide it from the demo window;
Git still tracks it. To reset a repeat demo, use Undo or restore the six `sorry`
proof bodies from the committed skeleton after preserving anything you need.

`bash scripts/check_m7.sh` checks the reference proof and runs the live board/MCP
acceptance tests in a disposable host. It leaves both committed example files
unchanged. The test uses two named MCP clients, without running a language model.

## Ask Isabelle

First install/register the MCP server using [mcp/README.md](../mcp/README.md).
Claude Code must be installed, signed in, and on the PATH inherited by VS Code.
Run `claude mcp get isabelle` from this repository to check registration. Compile
and reload an older development host before the demo.

1. Open **examples/Demo.thy**, the three-step skeleton proving that two
   consecutive odd numbers sum to a multiple of four. Click its first `sorry`.
   Open **Isabelle: Show Swarm**: the three cards start grey. Close other
   unfinished theory tabs so aggregate `status()` can become fully checked.
2. Run **Isabelle: Ask** from the Command Palette. It opens Goals and focuses
   the box at the top. Type **prove this** and press **Enter**. **Shift+Enter**
   inserts a newline. Keep Goals and Swarm expanded in the Explorer sidebar.
3. Watch streamed text and one-line tool calls. Claude reads and edits through
   the same seven MCP tools; edited cards show **Claude** for ten seconds and
   turn green as Isabelle checks them. Wait for **3/3 proved · kernel-checked ✓**
   and the completion reply. The proof is saved through MCP. **Stop** terminates
   the request and its MCP child; edits already submitted remain in the editor.
4. Replace the justification below `have expand` with **by (rule TrueI)**. Wait
   for a red card and an inline diagnostic, then ask **why does this fail?**.
   The answer should name **Failed to apply initial proof method** and explain
   that `TrueI` proves `True`, while this goal is an arithmetic equality. The
   explanation leaves the file unchanged and appends to the transcript.
5. Undo the bad tactic, or ask Claude to fix it; wait for whole-theory completion
   again. New messages append within this extension session. Reloading the
   window clears the transcript. A run disables the box until it finishes or is
   stopped; after ten minutes it stops automatically and says so.

If the CLI or registration is missing, the panel gives one line with the exact
`claude mcp add` command. Run it from the repository root after installing Claude
Code/the MCP Python dependencies. It does not register anything automatically.
Ask uses Claude Code's configured account/model, with no direct HTTP model API.
Tool-call coordinates in the transcript are zero-based, like MCP.

`bash scripts/check_m8.sh` checks spawn/streaming/Stop/timeout/help, the actual
webview script, and all M3–M7 regressions without a model request. To exercise the
two real Claude requests above using the installed signed-in CLI, run
`M8_LIVE=1 bash scripts/check_m8.sh`. This temporarily edits `examples/Demo.thy`
and restores its captured skeleton afterward; use it when the example has no
unsaved work. Receipts and the generated checked proof go under `.dev-host/`.

## Pretty symbols

`Isabelle: Toggle Pretty Symbols` switches display-only Unicode on/off (default
on). Move the caret into a symbol or select it with Find to see its ASCII source.
Search for `Sum` still finds `\<Sum>`. Type `\Sum` inside a formula and accept the
server suggestion with Tab; the inserted source is `\<Sum>`. Powers such as
`^2` and `^n` are displayed as superscripts without changing column numbers.
