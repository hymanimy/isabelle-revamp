# Swarm agent prompt

Open `examples/Swarm.thy` and **Isabelle: Show Swarm** in the extension host first.
Register the MCP server as described in [mcp/README.md](../mcp/README.md).
Start Claude Code from the repository root and paste this prompt:

```text
Complete the six named proof steps in examples/Swarm.thy using the Isabelle MCP
tools. The theorem says that the sum of the first n odd numbers is n².

Work on this file only. Keep the theorem statement, six named have statements,
and final thus/qed structure. Fill one sorry at a time; do not replace the whole
file. Use readable Isar and ordinary methods such as simp, rule, and induction.
No Sledgehammer, Nitpick, additional imports, axioms, or replacement admissions.

Use open to read the current editor buffer. Query sorry_positions, then
goals_at at the have statement you intend to solve. Call open again immediately
before each edit and compute its zero-based UTF-16 range from that fresh text.
Use edit to replace only that step's sorry. Do not edit via the shell.

After each edit, poll processing_status and errors until the change is checked.
If the edit is rejected because the buffer changed, read open again and recompute
the range; another agent may have inserted lines. Do not blindly replay an edit.
If a tactic fails, fix that step before moving on. The audience should see one
card turn green at a time. Keep the active editor on Swarm.thy; do not open the
reference solution in the editor during the demo.

Work in order: base, next_sum, next_square, induction_step, all_n, result.
Finish only when sorry_positions is empty, errors is complete and empty, and
status reports fully_checked. Report the six completed steps briefly.
```

For two agents, start Claude Code and Codex with the same MCP server registration
(each launches its own stdio server process). Give both the prompt above, replacing
the final paragraph with their assignment:

- **Claude:** work only on `base`, `next_sum`, and `induction_step`.
- **Codex:** work only on `next_square`, `all_n`, and `result`.

Tell each agent to stop when its assigned steps have checked without errors.
Then check the final `status()` after both finish. Local green cards may depend
on earlier admitted facts; **kernel-checked ✓** appears only after the whole
theory passes with no admissions. A third bridge connection is refused.

Client names come from MCP initialization metadata. Recognised Claude/Codex names
display as **Claude**/**Codex** for ten seconds after an edit. These badges show
recent editing activity; they do not claim an agent is still running a tool.
