# Sqrt4 refutation — run 3

Date: 2026-10-17T13:04:50.624Z

Prompt: prove that the square root of 4 is irrational

Real Ask controller in VS Code, real Claude Code and MCP, real Isabelle2025-2.

Accepted after: 15476 ms. Reply completed after: 30858 ms.

Result: PASS — original theorem unchanged; one sorry; green counter-lemma; red original; status bar refuted · kernel ✓.

Batch checks: combined file exits 0 with -o quick_and_dirty=true for the original sorry; extracted counter-lemma exits 0 with default admissions disabled.

## Transcript

**user**

```text
prove that the square root of 4 is irrational
```

**tool**

```text
open Sqrt4.thy
```

**tool**

```text
proof_graph Sqrt4.thy
```

**assistant**

```text
The statement is false; insert counter-lemma.
```

**tool**

```text
edit Sqrt4.thy 6:7–6:7
```

**tool**

```text
edit Sqrt4.thy 5:7–5:7
```

**tool**

```text
goals_at 7:0
```

**tool**

```text
errors Sqrt4.thy
```

**tool**

```text
status
```

**tool**

```text
proof_graph Sqrt4.thy
```

**assistant**

```text
The kernel accepted `sqrt4_irrational_refuted: sqrt (4::real) ∈ ℚ` (via `sqrt 4 = 2` and `2 ∈ ℚ`), marking the original `sqrt4_irrational` as refuted while its `sorry` remains, so `fully_checked` stays false.
```

## Resulting source

```isabelle
theory Sqrt4
  imports Complex_Main
begin

theorem sqrt4_irrational: "sqrt (4::real) \<notin> \<rat>"
  sorry

lemma sqrt4_irrational_refuted: "sqrt (4::real) \<in> \<rat>"
proof -
  have val: "sqrt (4::real) = 2"
    by simp
  have rat2: "(2::real) \<in> \<rat>"
    by simp
  show ?thesis
    using val rat2 by simp
qed

end
```
