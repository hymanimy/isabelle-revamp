from eval.harness.schema import Task
from eval.harness.tactics import TACTICS, run_tactics


def test_battery_order_timeout_and_early_stop(tmp_path, monkeypatch):
    calls = []
    def assess(task, proof, aux, run_id, ordinal, root, timeout, keep):
        calls.append((proof, timeout))
        success = proof == "by blast"
        return {"proved": success, "proof_text": proof, "aux_lemmas": "",
                "failure_class": None if success else "method_failed",
                "error": "" if success else "Failed to finish proof", "kernel_wall_s": 1}
    monkeypatch.setattr("eval.harness.tactics.assess", assess)
    task = Task("test/example", "fresh", ["Main"], 'lemma t: "True"', 1)
    condition = {"model": "tactics", "provider": "tactics", "max_attempts": 8}
    config = {"run_id": "tactics", "max_hours": 8}
    metadata = {"git_sha": "a"*40, "isabelle_version": "test-version"}
    row = run_tactics(task, condition, config, metadata, 0, tmp_path)
    assert calls == [(s, 30) for s in ["by simp", "by auto", "by blast"]]
    assert row["proved"] and row["attempts_used"] == 3
    assert row["usd_cost"] == 0 and row["model_id_returned"] is None
    assert row["attempt_failures"] == {"method_failed": 2}
    assert TACTICS[-1] == "by (simp add: algebra_simps)" and len(TACTICS) == 8
    assert not any("metis" in s or "induction" in s for s in TACTICS)
    run_tactics(task, condition, config, metadata, 0, tmp_path)
    assert len(calls) == 3
