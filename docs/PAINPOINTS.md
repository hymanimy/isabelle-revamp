# Pain points: getting Isabelle working from zero

Logged live during setup on 17 Oct 2026, macOS (Apple Silicon). The point of this
hackathon is that a mathematician or physicist should not have to hit any of these.
Each entry: what happened, what a non-engineer would have experienced, what the fix
should be.

## 1. The official download link is dead for CLI users

- **What happened.** `curl -LO https://isabelle.in.tum.de/dist/Isabelle2025-2_macos.tar.gz`
  followed a redirect to `dist.isabelle.cit.tum.de` on port 80, which never answered.
  curl saved a 372-byte redirect page under the tarball's name, then hung 75 s and gave
  `(28) Couldn't connect to server`.
- **Experience.** The headline download button on the project homepage does not work.
  The error names a server you've never heard of. The failure isn't obvious: a file
  with the right name exists, it's just 372 bytes of HTML.
- **Fix needed.** One download URL that works, over HTTPS, with a checksum published
  next to it. A mirror list is not a fix; a user shouldn't have to know mirrors exist.
- **Workaround used.** Cambridge mirror:
  `curl -L -C - -o Isabelle2025-2_macos.tar.gz https://www.cl.cam.ac.uk/research/hvg/Isabelle/dist/Isabelle2025-2_macos.tar.gz`

## 2. A failed step cascades into noise

- **What happened.** Three commands were pasted together. When the download failed, `tar`
  and `xattr` ran anyway and printed seven more errors, including `xattr: No such file:
  Gatekeeper` because it tried to treat a trailing comment as filenames.
- **Experience.** One real problem, eight error lines. Impossible to tell which one matters.
- **Fix needed.** Not Isabelle's fault, but a real install script should stop at the
  first failure and say one sentence about it. Our extension's setup command should do
  exactly that.

## 3. The distribution is 1.65 GB, but that's the right trade

- **What happened.** Download at ~3 MB/s: 8 min 14 s. `isabelle build -b HOL` then took
  2 seconds, because the macOS bundle ships the HOL heap prebuilt.
- **Experience.** Nine minutes with nothing to look at, then everything works. Correction
  to the first version of this entry: there is no 20-minute build; the size is partly
  because the heaps are included. That is the same choice Lean's Mathlib cache makes.
- **Fix needed.** Say so on the download page ("includes prebuilt HOL, ready to use"),
  and show progress during unpack. Nothing structural.

## 4. There is no obvious way to check a file from the command line

- **What happened.** Every tutorial says `isabelle process -T Smoke`. In 2025-2 that
  prints `Unknown Isabelle tool: "process"`. The replacement is `process_theories`.
  Finding the right invocation took five attempts:
  `-d .` (wants a ROOT file), bare `Smoke` (looks in a temp dir), `./Smoke.thy`
  (malformed import), `-?` (zsh eats it), then `process_theories -D . -O Smoke`.
- **Experience.** A tool with 25 subcommands, none named "check", and the one you
  need has a flag whose lowercase twin means something else. A mathematician stops here.
- **Fix needed.** `isabelle check FILE.thy` that does the obvious thing. Our extension's
  "check this file" command and the MCP `submit_proof` tool are that, in effect.

## 5. You have to know a backend exists at all

- **What happened.** Leo's own question mid-install: "why do I need Isabelle installed?"
- **Experience.** The user wanted an editor that checks proofs; the fact that a 1.65 GB
  interpreter is a separate thing is an implementation detail they shouldn't meet.
- **Fix needed.** A "Set up Isabelle" button in the extension on first open, the way the
  Lean extension installs `elan`. Or, as discussed, a hosted check endpoint so a first
  try needs no install at all.
