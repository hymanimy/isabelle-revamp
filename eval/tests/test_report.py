import json
from pathlib import Path

from eval.harness.report import bucket, generate, prepare_partial, report_directory, wilson
from eval.harness.runner import run
from eval.harness.schema import Result


def test_wilson_reference_values():
    assert wilson(0, 0) is None
    lo, hi = wilson(0, 10)
    assert abs(lo) < 1e-12 and abs(hi - .2775328) < 1e-6
    lo, hi = wilson(5, 10)
    assert abs(lo - .2365931) < 1e-6 and abs(hi - .7634069) < 1e-6
    assert [bucket(n) for n in [1, 2, 3, 4, 8, 9]] == ["1", "2–3", "2–3", "4–8", "4–8", "9+"]
    assert report_directory("results/full") == Path("eval/results/full")
    assert report_directory("eval/results/full") == Path("eval/results/full")


def result(model, identity, proved, attempts, failures, lines, cost=0):
    return Result(
        run_id="test", lemma_id=identity, stratum="fresh",
        condition={"model": model, "max_attempts": 8 if model == "tactics" else 4},
        proved=proved, attempts_used=attempts, failure_class=None if proved else "method_failed",
        final_error="", proof_text="by simp", proof_lines=1, methods_used={"simp": 1},
        aux_lemmas="", prompt_tokens=10, completion_tokens=10, usd_cost=cost,
        llm_wall_s=1, kernel_wall_s=2, model_id_returned="exact-model",
        isabelle_version="Isabelle2025-2", git_sha="a"*40, timestamp="test",
        orig_proof_lines=lines, attempt_failures=failures, model_ids_returned=["exact-model"],
        provider="tactics" if model == "tactics" else "openai_compatible").to_dict()


def test_report_attempt_denominator_paired_comparison_and_reproducibility(tmp_path):
    full, baseline = tmp_path / "full", tmp_path / "tactics"
    full.mkdir()
    baseline.mkdir()
    rows = [result("model", "a", True, 2, {"unknown_fact": 1}, 1, .2),
            result("model", "b", False, 4, {"method_failed": 4}, 9, .3)]
    battery = [result("tactics", "a", False, 8, {"method_failed": 8}, 1),
               result("tactics", "b", True, 1, {}, 9)]
    for directory, data in [(full, rows), (baseline, battery)]:
        (directory / "results.jsonl").write_text("".join(json.dumps(r)+"\n" for r in data))
    text = generate(full)
    assert "1/5 (20.0%)" in text  # Failed attempts, not just final failed rows.
    assert "| model | 4 | fresh | 2 | 1 | 1 |" in text
    assert "$0.500000" in text  # All spending, including failed lemma, per one success.
    assert text.index("| tactics |") < text.index("| model |")
    assert text == generate(full)


def test_partial_report_does_not_reserve_future_run_id(tmp_path, monkeypatch):
    def metadata(command, **kwargs):
        return "Isabelle2025-2" if command[0] == "isabelle" else "a"*40
    monkeypatch.setattr("subprocess.check_output", metadata)
    config = {"run_id": "full", "corpus": ["eval/corpus/fresh.jsonl"],
              "lemma_ids": ["fresh/Swarm/base"], "conditions": [], "workers": 1,
              "kernel_timeout_s": 30, "max_usd": 0, "max_hours": 1}
    directory = tmp_path / "full"
    prepare_partial(directory, config, "real_models_unavailable")
    assert not (directory / "manifest.json").exists()
    assert not (directory / "budget.sqlite").exists()
    assert "No completed real-model observations" in generate(directory)
    config["conditions"] = [{"model": "fake", "provider": "fake", "policy": "garbage", "max_attempts": 1}]
    assert run(config, tmp_path)["completed"] == 1
    assert (directory / "manifest.json").exists()
