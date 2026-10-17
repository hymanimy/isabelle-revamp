# The demo folder

This folder is the thing you open on stage. It holds the theories and the
workspace settings, nothing else — no extension source, no tests, no scripts.
The storyboard is [docs/STORYBOARD.md](../docs/STORYBOARD.md); the beats and
screenshot checks are [docs/DEMO.md](../docs/DEMO.md).

Do not open this folder in a normal VS Code window. Prepare and launch it with
the isolated Demo profile:

```sh
bash scripts/demo-env.sh          # from the repository root
```

It installs the current VSIX into a dedicated **Demo** profile under
`demo/.demo/`, with no other extension, and prints the one command that opens
this folder. Use that exact command. Close the Demo window before re-running
setup; the script refuses to touch a live profile.

## The theories

| File | Theorem | State |
| --- | --- | --- |
| `Sqrt2.thy` | √2 is irrational | complete, 0 admissions — beats 1 and 2 |
| `Swarm.thy` | 1 + 3 + … + (2n−1) = n² | skeleton, 6 admissions — the cascade |
| `Cascade.thy` | a rational square root of a natural number is an integer | skeleton, 38 admissions — the deep graph |
| `Demo.thy` | two consecutive odd numbers sum to a multiple of four | skeleton, 3 admissions — the warm-up |
| `Sqrt4.thy` | √4 is irrational (**false**) | 1 admission — the red flash |

Reference proofs are **not** in this folder; they stay in the repository under
`examples/`. To reset an edited theory after a rehearsal, restore it from git:

```sh
git -C <repository> checkout demo/
```

Card theorem 3 on the judges' card, "there are infinitely many primes", has no
fixture anywhere in the repository. `Cascade.thy` is the engine behind card
theorem 2 (√p irrational for prime p), not that statement itself.

## Settings

The settings in `.vscode/settings.json` are the ones VS Code honours per
workspace: pretty symbols on, demo layout on activation, font size 16, no
startup editor, the Isar colour palette, hidden `.demo` and reference files,
and read-only Isabelle library paths. The read-only paths and the colour
palette are this machine's; on another machine the extension adds its own
library paths to this file on first activation.

These are **user-level** settings, so they live in the generated Demo profile
rather than here, and `bash scripts/demo-env.sh` writes them:

- `security.workspace.trust.enabled: false` — no trust prompt on stage.
- `update.mode: none`, `extensions.autoUpdate`/`autoCheckUpdates: false`,
  `extensions.ignoreRecommendations: true` — no update or extension banners.
- `workbench.tips.enabled: false`, `workbench.enableExperiments: false`,
  `workbench.welcomePage.walkthroughs.openOnInstall: false` — no welcome pages.
- `chat.disableAIFeatures: true` — the built-in Chat stays out of the frame.
- `telemetry.telemetryLevel: off`.
- `isabelleRevamp.executable` — this machine's Isabelle, discovered by the
  script, deliberately never committed.

## Pre-flight

Before walking on stage:

- [ ] **DND on** in macOS; silence phone and calendar notifications.
- [ ] Open the printed **Demo** command on this folder; no banners or popups.
- [ ] **Chat closed**; source visible, Ask and Proof Graph at the bottom.
- [ ] **Only the card you are proving is open.** Ask stops on `status()`, which
      aggregates every open theory tab, so a second unfinished theory (easy
      with `Cascade.thy` and `Demo.thy` in this folder) makes Claude finish the
      card and still report itself stuck. Close the other theory tabs.
- [ ] `Sqrt2.thy` checks, and the active card is restored to its intended
      skeleton (`git checkout demo/` if a rehearsal left edits).
- [ ] Claude is signed in; Ask can reach the demo's MCP bridge
      (`demo/.demo/port`), and **Clear** the Ask transcript between rehearsals.
- [ ] **Replay tested** on the current rehearsal timeline.
- [ ] **Backup video ready** and reachable without searching for a file.
