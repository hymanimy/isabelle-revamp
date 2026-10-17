# Proving in this folder

Every theory here is checked by a live Isabelle kernel through the `isabelle`
MCP server. The kernel's verdict is the only evidence that counts.

## The only way to touch a theory

Work **only** through the MCP tools: `open`, `edit`, `goals_at`, `errors`,
`status`, `processing_status`, `sorry_positions`, `proof_graph`. Never read or
write a `.thy` file with the shell, and never use Read/Write/Edit on one — the
extension owns the buffer and rejects edits made against a stale version.

Each edit follows the same loop:

1. `open` the file. Do this **immediately before every edit**, every time.
2. `edit` **one** `sorry` into a real proof. One admission per edit, no more.
3. `processing_status` until the kernel settles, then `errors` and `status`.
4. If the edit failed, `open` again before retrying. Never retry blind.

Stop when `status` reports `fully_checked`. Empty `errors` is not completion:
there may still be admissions, so check `sorry_positions` too.

## Proof style

Structured Isar, written to be read aloud:

- Named `have` steps, each with a one-line `by` justification.
- A flat chain of `have`s in preference to nested `proof … qed` blocks. Open a
  subproof only when the step genuinely needs its own `fix`/`assume`.
- No `auto` that hides the mathematics where `simp` or `rule` will do.

## Automation

`try0` is allowed, and is the way to find a justification you do not know:

1. `edit` the step's method to `try0`.
2. Read the suggestion with `goals_at` on that line.
3. `edit` again, replacing `try0` with the suggested one-liner.

Never run **sledgehammer** or **nitpick** — they can hang the prover mid-demo.
No new imports beyond `Main` / `Complex_Main`.

## When a statement is false

Do not argue about it in prose. Add a top-level `<name>_refuted` proving the
negation, and leave the original `sorry` in place. The graph turns the original
red once the counter-lemma is accepted.

## Replies

Two lines, maximum. The kernel's verdict is the report.
