# Sqrt 2 in five steps

First follow the repository README's setup (installed Isabelle, `npm ci --prefix
extension`, and open the repository in stock VS Code). The committed theory is
complete; the temporary edits below let you demonstrate live checking.

1. Press **F5 → Isabelle: Extension Development Host**. In the new window, open
   **Command Palette → Isabelle: Show Goals**, then click the theorem statement
   in **examples/Sqrt2.thy**. The sidebar shows the goal `sqrt 2 ∉ ℚ`.
2. At the bottom of the proof, select the final `by simp` immediately before the
   outer `qed` and type `sorry`. The sidebar changes from **checking…** to
   **unfinished (sorry)**. This admits the last step; it is not a proof error or
   a complete proof, even if the current command reports `No subgoals!`.
3. Click successively inside `have scaled`, `have numerator_even`,
   `have denominator_squared`, and `have common_factor`. Watch the goals change:
   clear the denominator, prove the numerator is even, derive the denominator's
   square equation, and find the common factor. Every `have` has its own goal.
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
