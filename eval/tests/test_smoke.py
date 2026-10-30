import pytest

from eval.harness.budget import available_usd
from eval.harness.smoke import make_smoke, project, run_full_with_restarts, shrink


def full_config():
    return {"run_id": "full", "corpus": ["eval/corpus/lib.jsonl", "eval/corpus/fresh.jsonl"],
            "conditions": [{"model": m, "provider": "openai_compatible", "max_attempts": k}
                           for m in ["first", "second"] for k in [1, 4]],
            "cost_usd_per_m": {m: {"prompt": 100, "completion": 100} for m in ["first", "second"]},
            "workers": 2, "kernel_timeout_s": 120, "max_usd": 5, "max_hours": 8}


COUNTS = {"lib": 250, "fresh": 40}
SAMPLES = {m: {"prompt": 100, "completion": 50, "llm_s": 1} for m in ["first", "second"]}


def test_smoke_is_ten_deterministic_lemmas_and_every_model():
    full = full_config()
    smoke = make_smoke(full)
    assert smoke == make_smoke(full)
    assert len(smoke["lemma_ids"]) == 10
    assert sum(i.startswith("lib/") for i in smoke["lemma_ids"]) == 5
    assert sum(i.startswith("fresh/") for i in smoke["lemma_ids"]) == 5
    assert [(c["model"], c["max_attempts"]) for c in smoke["conditions"]] == [("first", 1), ("second", 1)]
    assert len(full["conditions"]) == 4  # No mutation of the fixed input.


def test_smoke_bookkeeping_does_not_change_its_resume_fingerprint():
    full = full_config()
    before = make_smoke(full)
    full["prior_run_costs"] = {"smoke": .4}
    full["prior_usd_cost"] = .4
    assert make_smoke(full) == before


def test_shrink_order_and_fixed_budget():
    full = full_config()
    selected, estimate, dropped = shrink(full, COUNTS, SAMPLES, 7)
    assert dropped == ["Dropped all max_attempts=4 conditions", "Dropped model in config order: first"]
    assert [(c["model"], c["max_attempts"]) for c in selected["conditions"]] == [("second", 1)]
    assert estimate["projected_total_usd"] == pytest.approx(4.35)
    assert selected["max_usd"] == 5 and selected["max_hours"] == 8


def test_subsample_before_dropping_last_model_and_count_smoke_spend():
    full = full_config()
    full["conditions"] = full["conditions"][:1]
    full["max_usd"] = 4
    full["prior_usd_cost"] = 1
    selected, estimate, dropped = shrink(full, COUNTS, SAMPLES, 7)
    assert selected["lib_limit"] == 150 and len(selected["conditions"]) == 1
    assert estimate["projected_total_usd"] == pytest.approx(3.85)
    assert dropped == ["Subsampled lib to 150 sorted lemma ids"]
    assert available_usd(full) == 3
    full["max_usd"] = 1
    selected, estimate, dropped = shrink(full, COUNTS, SAMPLES, 7)
    assert not selected["conditions"]
    assert "final model" in dropped[-1]


def test_wall_time_gate_and_empty_schedule():
    full = full_config()
    full["max_usd"] = 10000
    full["max_hours"] = .3
    selected, estimate, dropped = shrink(full, COUNTS, SAMPLES, 7)
    assert selected["lib_limit"] == 150 and estimate["projected_hours"] <= .3
    assert dropped[0].startswith("Dropped all max_attempts=4")
    empty = {**full, "conditions": []}
    assert project(empty, COUNTS, {}, 7)["projected_hours"] == 0


def test_initial_run_plus_three_restarts(monkeypatch):
    calls = []
    def transient(config):
        calls.append(1)
        if len(calls) < 4:
            raise RuntimeError("test interruption")
        return {"status": "complete"}
    monkeypatch.setattr("eval.harness.smoke.run", transient)
    assert run_full_with_restarts({})["status"] == "complete"
    assert len(calls) == 4
