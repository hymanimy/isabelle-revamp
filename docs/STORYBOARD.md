# The demo — 90 seconds, four beats

The demo is a story with one surprising beat. Everything on screen serves beat 3.

| Beat | Time | On screen | Line |
| --- | --- | --- | --- |
| 1 The problem | 0:00–0:15 | Sqrt2.thy in Isabelle/jEdit | "Every Isabelle user has used this editor for twenty years. Nobody under thirty wants to." |
| 2 The makeover | 0:15–0:30 | Same file in stock VS Code: ∑ ℚ rendered, goals follow cursor, Cmd-click into HOL | "Same prover, same kernel, not one line of Isabelle changed. We only built the window." |
| 3 The money shot | 0:30–1:15 | Judge picks a theorem from the card. One English sentence in Claude Code in the Terminal. Named Proof Graph nodes turn green and remain visible. Nobody speaks. | "That is a proof a mathematician can read. Lean can't give you that." |
| 4 The reveal | 1:15–1:30 | PAINPOINTS.md scrolls | "We hit every one of these so a mathematician doesn't have to." |

## Beat 3 screen layout (fixed for the demo)

Run **Isabelle: Demo Layout** before walking on stage. Its fixed arrangement is:

```text
┌──────────────────────┬───────────────────┐
│ .thy editor          │ Isabelle Goals    │
│                      ├───────────────────┤
│                      │ Proof Graph       │
├──────────────────────┴───────────────────┤
│ Terminal — Claude Code CLI              │
└──────────────────────────────────────────┘
```

- Editor left: about 62% width, Unicode display on; source stays ASCII.
- Right editor column: about 38% width, Goals above Graph in a 40:60 split.
- Terminal: bottom, full width, about 28% height. Start Claude Code here.
- Primary/secondary sidebars and activity bar: hidden. Ask view: unregistered
  while `isabelleRevamp.showAsk=false` (Demo Layout sets this).
- Goals header: `Theory · N/M proved · kernel ✓`; its live text follows the cursor.
- Graph: every named step visible, full name and line number; no folding in
  Demo Layout. Fit on layout; Replay starts at ×2, with ×1/×2/×4/×8 available.
- Status bar: proof counts and frozen kernel-checked elapsed time on the right.

## Theorem card for judges

1. √2 is irrational
2. √p is irrational for every prime p
3. There are infinitely many primes
4. 1 + 3 + … + (2n−1) = n²

Each has a skeleton with `sorry` leaves under examples/card/, a committed reference proof, and has been run through Ask Isabelle at least five times before the demo.

## The red flash

Open `examples/card/Sqrt4.thy` and ask "prove that the square root of 4 is irrational".
Claude leaves `sqrt4_irrational` and its `sorry` untouched, then adds a structured,
independent `sqrt4_irrational_refuted` lemma proving the counterexample. Within
30 seconds, the accepted lemma is green and its name links it to the red
`sqrt4_irrational` tile labelled "refuted". The status bar says
`refuted · kernel ✓`; the original theorem remains unfinished. An English
refusal alone does not pass this beat. A genuinely rejected proof step still
turns red through the normal diagnostic path.

## Rules

- Silence during beat 3. Alex reads two lines of the Isar aloud after the root goes green.
- Replay button re-runs the recorded cascade in ~10 s if the live run stalls. Backup video recorded; run live anyway.
- The trust line, said once before beat 3: "The agent can propose anything. Only the kernel says proved."
