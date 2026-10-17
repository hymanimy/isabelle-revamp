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
