# The demo — 90 seconds, four beats

The demo is a story with one surprising beat. Everything on screen serves beat 3.

| Beat | Time | On screen | Line |
| --- | --- | --- | --- |
| 1 The problem | 0:00–0:15 | Sqrt2.thy in Isabelle/jEdit | "Every Isabelle user has used this editor for twenty years. Nobody under thirty wants to." |
| 2 The makeover | 0:15–0:30 | Same file in stock VS Code: ∑ ℚ rendered, goals follow cursor, Cmd-click into HOL | "Same prover, same kernel, not one line of Isabelle changed. We only built the window." |
| 3 The money shot | 0:30–1:15 | Judge picks a theorem from the card. One English sentence in Ask Isabelle. Proof Graph fills bottom-up and folds to one green node. Nobody speaks. | "That is a proof a mathematician can read. Lean can't give you that." |
| 4 The reveal | 1:15–1:30 | PAINPOINTS.md scrolls | "We hit every one of these so a mathematician doesn't have to." |

## Beat 3 screen layout (fixed for the demo)

- Editor: centre, the theory file, Unicode rendering on.
- Proof Graph: bottom panel beside Ask by default (M12 amendment). Use **Open in editor column** for the full-height stage moment.
- Isabelle Goals: hidden by default when the graph opens; hover tiles for their statements and live goal text.
- Ask Isabelle + Claude transcript: **bottom panel** (where Terminal/Output live), not the sidebar. One line of input, streaming transcript beneath it.
- Status bar: `Theory · N/M proved · T s · kernel ✓` on the right.

## Theorem card for judges

1. √2 is irrational
2. √p is irrational for every prime p
3. There are infinitely many primes
4. 1 + 3 + … + (2n−1) = n²

Each has a skeleton with `sorry` leaves under examples/card/, a committed reference proof, and has been run through Ask Isabelle at least five times before the demo.

## The red flash

Ask "prove that the square root of 4 is irrational". Expected: Claude states the claim is false, writes nothing, or writes a step the kernel rejects; the Proof Graph shows a red node within seconds. The agent can propose anything; only the kernel says proved.

## Rules

- Silence during beat 3. Alex reads two lines of the Isar aloud after the root goes green.
- Replay button re-runs the recorded cascade in ~10 s if the live run stalls. Backup video recorded; run live anyway.
- The trust line, said once before beat 3: "The agent can propose anything. Only the kernel says proved."
