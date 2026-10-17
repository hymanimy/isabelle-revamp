# Isabelle Revamp

Isabelle/HOL in stock VS Code, using the unmodified `isabelle vscode_server`.
M1 provides a plain-text goal probe; M2 adds Isar highlighting and server startup;
M3 adds the **Isabelle Goals** sidebar and live errors.
The complete sqrt-2 proof and MCP server are later milestones.
`examples/Sqrt2.thy` currently contains one intentional `sorry`.

## Try the extension in under five minutes

Requires Isabelle2025-2 with the HOL heap, Node 20+, npm, and stock VS Code 1.104+.

1. From this repository, run `npm ci --prefix extension`.
2. Open the repository root in VS Code: `code .`.
3. Check `.vscode/settings.json`: `isabelleRevamp.executable` points to the
   verified macOS installation under `~/hack/isabelle-env/`. Change this workspace
   setting for another installation, or use `isabelle` if it is on VS Code's PATH.
4. Press **F5**, selecting **Isabelle: Extension Development Host** if asked.
   This compiles the extension and opens a development window with `Sqrt2.thy`.
5. In that window, check the **Isabelle** language indicator and the colored Isar
   keywords. **View → Output → Isabelle** should show
   `Isabelle language server ready (HOL).`

If `code` is missing on macOS, open VS Code normally and use **File → Open Folder**,
or invoke `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`.
For a manual build, run `npm run compile --prefix extension`.

## Check the goals sidebar (M3)

In a fresh F5 development host, run **Isabelle: Show Goals** from the Command
Palette. The view lives in the Explorer sidebar. If reusing an older host, first
compile and run **Developer: Reload Window** there.

1. In `Sqrt2.thy`, move between `theorem`, `proof -`, and `show ?thesis`.
   The view briefly shows `checking…`, then the goal at that command.
2. Replace `sorry` with `by simp`. Expect an inline error and **Proof error** in
   the sidebar. Undo the edit; the original example is intentionally unfinished.
3. To check the solved state before M4, temporarily change the statement to
   `"(2 :: real) = 2"` and use `by simp`. Expect **No subgoals!** and no errors.
   Undo both edits. This is a UI control, not a proof of sqrt-2 irrationality.

Run the automated checks with `bash scripts/check_m3.sh` on this Mac. For another
installation, pass the VS Code **application executable** as its first argument.
The runner uses a separate host profile and test theory under ignored `.dev-host/`.
It checks rapid cursor changes, delayed replies, checking state during a slow
command, diagnostics, and the solved control, without editing the real example.

## Run the goal probe

```sh
python3 scripts/lsp_probe.py --isabelle "$HOME/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle"
```

It prints every server notification and the goal at `show ?thesis`:

```text
proof (prove)
goal (1 subgoal):
 1. sqrt 2 ∉ ℚ
```

The approved client workaround requests HTML and extracts text because Isabelle's
plaintext serializer fails. See [protocol notes](docs/PROTOCOL_NOTES.md),
[pain points](docs/PAINPOINTS.md), and [milestone progress](docs/PROGRESS.md).
The extension's minimal startup adaptation is credited in
[third-party notices](extension/THIRD_PARTY_NOTICES.md).
