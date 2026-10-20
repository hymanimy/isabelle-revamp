"""Public task boundary and validated result records."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from .classify import FAILURES


@dataclass(frozen=True)
class Task:
    id: str
    stratum: str
    imports: list[str]
    statement: str
    orig_proof_lines: int

    @classmethod
    def from_row(cls, row: dict) -> Task:
        # Deliberate allowlist: private corpus fields cannot enter the agent.
        return cls(**{name: row[name] for name in cls.__dataclass_fields__})


@dataclass
class Result:
    run_id: str
    lemma_id: str
    stratum: str
    condition: dict
    proved: bool
    attempts_used: int
    failure_class: str | None
    final_error: str
    proof_text: str
    proof_lines: int
    methods_used: dict[str, int]
    aux_lemmas: str
    prompt_tokens: int
    completion_tokens: int
    usd_cost: float
    llm_wall_s: float
    kernel_wall_s: float
    model_id_returned: str | None
    isabelle_version: str
    git_sha: str
    timestamp: str
    # Needed to reproduce attempt-level rates and difficulty curves from rows.
    orig_proof_lines: int
    attempt_failures: dict[str, int]
    model_ids_returned: list[str]
    cost_is_upper_bound: bool = False
    provider: str = ""
    gpu_hours: float | None = None

    def validate(self) -> None:
        assert type(self.proved) is bool
        assert self.failure_class is None if self.proved else self.failure_class in FAILURES
        assert 1 <= self.attempts_used <= self.condition["max_attempts"]
        assert len(self.final_error) <= 500
        assert self.proof_lines == len(self.proof_text.splitlines())
        for number in (self.usd_cost, self.llm_wall_s, self.kernel_wall_s):
            assert math.isfinite(number) and number >= 0
        assert self.prompt_tokens >= 0 and self.completion_tokens >= 0
        assert set(self.attempt_failures) <= set(FAILURES)
        assert sum(self.attempt_failures.values()) == self.attempts_used - int(self.proved)
        assert self.isabelle_version and len(self.git_sha) == 40

    def to_dict(self) -> dict:
        self.validate()
        return asdict(self)


def key(row: dict) -> tuple[str, str, str, int]:
    return (row["run_id"], row["lemma_id"], row["condition"]["model"],
            row["condition"]["max_attempts"])
