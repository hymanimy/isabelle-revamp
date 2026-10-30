"""One attempt, one directory, one headless kernel invocation."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

from eval.probe_m0 import run
from .scanner import scan


@dataclass(frozen=True)
class KernelError:
    line: int | None
    col: int | None
    message: str


@dataclass(frozen=True)
class KernelResult:
    exit_code: int
    stdout: str
    stderr: str
    errors: list[KernelError]
    wall_s: float
    timed_out: bool


def parse_errors(stdout: str, stderr: str = "") -> list[KernelError]:
    errors: list[KernelError] = []
    position: int | None = None
    for line in (stdout + "\n" + stderr).splitlines():
        if re.match(r"^(Error\b|\*\*\*)", line):
            loc = re.search(r"\bline (\d+)", line)
            if loc:
                position = int(loc[1])
            col = re.search(r"\bcolumn (\d+)", line)
            error = KernelError(position, int(col[1]) if col else None,
                                re.sub(r"^\*\*\*\s?", "", line))
            if error not in errors:
                errors.append(error)
        elif re.search(r"\bFAILED\b|^Unfinished session|^Exception", line):
            errors.append(KernelError(None, None, line))
    return errors


def check(theory_text: str, workdir: str | Path, timeout_s: float) -> KernelResult:
    directory = Path(workdir)
    directory.mkdir(parents=True, exist_ok=True)
    match = re.match(r"theory\s+([A-Za-z_][\w']*)\b", theory_text)
    if not match:
        raise ValueError("Missing safe theory name")
    path = directory / (match[1] + ".thy")
    path.write_text(theory_text, encoding="utf-8")
    outcome = run(["isabelle", "process_theories", "-D", str(directory.resolve()),
                   "-O", "-o", "quick_and_dirty=false", match[1]], timeout_s)
    return KernelResult(outcome["exit_code"], outcome["stdout"], outcome["stderr"],
                        parse_errors(outcome["stdout"], outcome["stderr"]),
                        outcome["wall_s"], outcome["timed_out"])


def proved(result: KernelResult, theory_text: str, statement: str,
           proof_text: str, aux_lemmas: str = "", target: str = "") -> bool:
    return (result.exit_code == 0 and not result.timed_out and not result.errors
            and bool(statement) and statement in theory_text
            and not scan(proof_text, aux_lemmas, target))
