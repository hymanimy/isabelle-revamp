"""Conservative source extraction; admit only kernel-validated statement/proof pairs.

This is a small lexer, not an Isabelle parser. Unsupported declarations are
discarded. Batch validation accepts a group only after both commands exit zero.
Original proofs are used here solely to build the held-out corpus, never prompts.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import random
import re
import shutil
import subprocess
from typing import Iterator

from eval.probe_m0 import run

WORD = re.compile(r"[A-Za-z_][\w'.]*|\.\.|.")


@dataclass(frozen=True)
class Token:
    value: str
    start: int
    end: int


def lex(source: str) -> list[Token]:
    """Keep quoted terms/cartouches opaque, and skip nested comments."""
    result = []
    i = 0
    while i < len(source):
        start = i
        if source[i].isspace():
            i += 1
            continue
        if source.startswith("(*", i):
            depth = 1
            i += 2
            while depth and i < len(source):
                if source.startswith("(*", i):
                    depth += 1
                    i += 2
                elif source.startswith("*)", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            if depth:
                raise ValueError("Unclosed comment")
            continue
        if source[i] == '"':
            i += 1
            while i < len(source):
                if source[i] == '"':
                    i += 1
                    break
                i += 2 if source[i] == "\\" and i + 1 < len(source) and source[i+1] in '\\"' else 1
        elif source.startswith(r"\<open>", i) or source[i] == "‹":
            depth = 0
            while i < len(source):
                if source.startswith(r"\<open>", i) or source[i] == "‹":
                    depth += 1
                    i += 7 if source[i] == "\\" else 1
                elif source.startswith(r"\<close>", i) or source[i] == "›":
                    depth -= 1
                    i += 8 if source[i] == "\\" else 1
                    if depth == 0:
                        break
                else:
                    i += 1
            if depth:
                raise ValueError("Unclosed cartouche")
        else:
            match = WORD.match(source, i)
            assert match
            i += len(match[0])
        result.append(Token(source[start:i], start, i))
    return result


OUTER = set("""lemma theorem corollary proposition lemmas theorems definition
abbreviation notation no_notation type_notation no_type_notation translations
no_translations syntax no_syntax datatype codatatype typedef type_synonym
fun function primrec primcorec inductive coinductive inductive_set
context locale class instantiation instance interpretation sublocale
declare hide_fact hide_const hide_type text text_raw chapter section subsection
subsubsection paragraph ML ML_file ML_val ML_prf setup local_setup method_setup
attribute_setup simproc_setup bundle unbundle include including end begin
code_printing code_identifier code_reflect export_code value values thm term
notepad named_theorems termination derive free_constructors lift_definition
quotient_type datatype_compat print_theorems schematic_goal
""".split())
PROOF_START = {"by", "proof", "using", "unfolding", "apply", "sorry", "oops", ".", ".."}


def proof_end(tokens: list[Token], start: int) -> int:
    """Index just beyond a proof, excluding the following outer command."""
    depth = 0
    for j in range(start, len(tokens)):
        word = tokens[j].value
        if word == "proof":
            depth += 1
        elif word == "qed":
            depth -= 1
        elif depth == 0 and j > start and word in OUTER:
            return j
        elif depth == 0 and j > start and word in {"have", "show", "thus", "hence", "from", "then", "next", "qed"}:
            return j
    return len(tokens)


def row(identity: str, stratum: str, source: str, line: int,
        statement: str, proof: str, imports: list[str]) -> dict:
    return {"id": identity, "stratum": stratum, "source_file": source,
            "source_line": line, "imports": imports, "statement": statement,
            "held_out_proof": proof, "orig_proof_lines": len(proof.splitlines()),
            "orig_proof_chars": len(proof), "tactic_baseline_proved": None}


def extract(path: Path, relative: str, stratum: str = "lib") -> Iterator[dict]:
    source = path.read_text()
    tokens = lex(source)
    depth, i = 0, 0
    while i < len(tokens):
        token = tokens[i]
        if token.value == "begin":
            depth += 1
        elif token.value == "end":
            depth -= 1
        elif token.value in {"lemma", "theorem", "corollary"}:
            j = i + 1
            while j < len(tokens) and tokens[j].value not in PROOF_START | (OUTER - {"begin"}):
                j += 1
            if j == len(tokens) or tokens[j].value not in PROOF_START:
                i += 1
                continue
            stop = proof_end(tokens, j)
            statement = source[token.start:tokens[j].start].strip()
            proof = source[tokens[j].start:tokens[stop-1].end].strip()
            match = re.match(r"(lemma|theorem|corollary)\s+([\w']+)\s*(\[[^\]]*\]\s*)?:", statement)
            if depth == 1 and match and tokens[j].value not in {"apply", "sorry", "oops"}:
                name = match[2]
                statement = match[1] + " " + name + ":" + statement[match.end():]
                unsafe = re.search(r"\b(sorry|oops|axiomatization|ML|setup|sledgehammer|nitpick)\b", proof)
                if not unsafe and len(proof) <= 8000:
                    yield row(f"{stratum}/{Path(relative).with_suffix('')}/{name}", stratum,
                              relative, source.count("\n", 0, token.start)+1,
                              statement, proof, ["Main"])
            i = stop
            continue
        i += 1


def fresh_steps() -> list[dict]:
    """Promote existing named steps with their actual referenced context as assumptions.

    No new mathematical claims or fabricated Leo-written source are introduced.
    Local let abbreviations are expanded in both statement and original proof.
    """
    result = []
    sources = [Path("examples/Swarm_solution.thy"), Path("examples/Cascade_solution.thy"),
               Path("examples/card/Sqrt4_solution.thy")]
    for path in sources:
        source = path.read_text()
        expanded = source
        substitutions = {}
        for name, value in re.findall(r'let\s+(\?\w+)\s*=\s*"([^"\n]*)"', source):
            for old, replacement in substitutions.items():
                value = value.replace(old, replacement)
            substitutions[name] = "(" + value + ")"
            expanded = expanded.replace(name, substitutions[name])
        tokens = lex(expanded)
        facts = {m[1]: m[2] for m in re.finditer(r'\b(?:have|assumes|and)\s+(\w+)\s*:\s*("[^"\n]*")', expanded)}
        fixes = "fixes n a b :: nat" if path.stem == "Cascade_solution" else "fixes n :: nat" if path.stem == "Swarm_solution" else ""
        for i, token in enumerate(tokens):
            if token.value != "have" or i+3 >= len(tokens) or tokens[i+2].value != ":":
                continue
            name, term = tokens[i+1].value, tokens[i+3].value
            if not term.startswith('"'):
                continue
            j = i+4
            stop = proof_end(tokens, j)
            proof = expanded[tokens[j].start:tokens[stop-1].end].strip()
            local_names = set(re.findall(r"\b(?:have|assume|obtain)\s+(\w+)\s*:", proof))
            proof_words = {t.value for t in lex(proof) if not t.value.startswith('"')}
            deps = [key for key in facts if key in proof_words and key not in local_names and key != name]
            assumptions = "\n  assumes " + "\n    and ".join(key+": "+facts[key] for key in deps) if deps else ""
            statement = f"lemma {name}:\n  {fixes}{assumptions}\n  shows {term}" if fixes or deps else f"lemma {name}: {term}"
            original_line = next((k+1 for k, line in enumerate(source.splitlines()) if re.search(r"\bhave\s+"+re.escape(name)+r"\s*:", line)), 1)
            result.append(row(f"fresh/{path.stem.removesuffix('_solution')}/{name}", "fresh",
                              str(path), original_line, statement, proof, ["Complex_Main"]))
    # Sqrt2 is currently a primes demo, with no solution file. Validate only
    # its existing complete declarations; do not fill in the admitted ones.
    result.extend(extract(Path("examples/Sqrt2.thy"), "examples/Sqrt2.thy", "fresh"))
    supplied = Path("eval/corpus/fresh_statements.thy")
    if supplied.exists():
        result.extend(extract(supplied, str(supplied), "fresh"))
    return result


def key_for(candidate: dict, version: str) -> str:
    payload = [candidate["statement"], candidate["imports"], candidate["held_out_proof"], version]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def validate_batch(candidates: list[dict], mode: str, root: Path, receipts: list[dict]) -> list[dict]:
    """Accept only zero-exit, error-free batches; retry survivors after errors."""
    if not candidates:
        return []
    # A divergent original proof must not discard a whole source round.
    # Each small group still needs an error-free, exit-zero validation.
    if mode == "proof" and len(candidates) > 5:
        return [row for start in range(0, len(candidates), 5)
                for row in validate_batch(candidates[start:start+5], mode, root, receipts)]
    directory = root / mode
    directory.mkdir(parents=True, exist_ok=True)
    by_name = {}
    for candidate in candidates:
        name = "E_" + hashlib.sha1((candidate["id"] + mode).encode()).hexdigest()[:10]
        proof = "sorry" if mode == "statement" else candidate["held_out_proof"]
        theory = f"theory {name}\nimports {' '.join(candidate['imports'])}\nbegin\n{candidate['statement']}\n{proof}\nend\n"
        assert candidate["statement"] in theory
        (directory / (name + ".thy")).write_text(theory)
        by_name[name] = candidate
    outcome = run(["isabelle", "process_theories", "-D", str(directory), "-O", "-o",
                   "quick_and_dirty=" + ("true" if mode == "statement" else "false"), *by_name], timeout=30)
    receipts.append(outcome)
    with (root.parent / "all_commands.jsonl").open("a") as log:
        log.write(json.dumps(outcome)+"\n")
    # A timeout never validates any member. Discard the uncertain batch instead
    # of repeatedly spending the timeout while bisecting one difficult proof.
    if outcome["timed_out"]:
        return []
    output = outcome["stdout"] + outcome["stderr"]
    errors = bool(re.search(r"(?m)^(?:\*\*\*|Error\b|.* FAILED\b)", output))
    if outcome["exit_code"] == 0 and not errors:
        return candidates
    bad_names = set(re.findall(r'(?m)^(?:Error|\*\*\*)[^\n]*[/"](E_[0-9a-f]+)\.thy', output))
    survivors = [c for name, c in by_name.items() if name not in bad_names]
    if bad_names:
        return validate_batch(survivors, mode, root, receipts)
    if len(candidates) == 1:
        return []
    half = len(candidates)//2
    return (validate_batch(candidates[:half], mode, root, receipts)
            + validate_batch(candidates[half:], mode, root, receipts))


def validate(candidates: list[dict], version: str, cache: dict, root: Path) -> list[dict]:
    pending = [c for c in candidates if key_for(c, version) not in cache]
    receipts: list[dict] = []
    if pending:
        statements = validate_batch(pending, "statement", root, receipts)
        accepted = {c["id"] for c in validate_batch(statements, "proof", root, receipts)}
        for c in pending:
            cache[key_for(c, version)] = c["id"] in accepted
        cache_path = root.parent / "validation_cache.json"
        cache_path.write_text(json.dumps(cache, indent=2)+"\n")
        log = root.parent / "validation_transcripts.jsonl"
        with log.open("a") as file:
            for receipt in receipts:
                file.write(json.dumps(receipt)+"\n")
    return [c for c in candidates if cache[key_for(c, version)]]


def validate_imports(candidates: list[dict], version: str, cache: dict, root: Path) -> list[dict]:
    accepted = validate(candidates, version, cache, root)
    accepted_ids = {c["id"] for c in accepted}
    fallback = [{**c, "imports": ["Complex_Main"]} for c in candidates
                if c["id"] not in accepted_ids and c["imports"] == ["Main"]]
    accepted.extend(validate(fallback, version, cache, root))
    return accepted


def statistics(rows: list[dict]) -> dict:
    def bucket(n: int) -> str:
        return "1" if n == 1 else "2-3" if n <= 3 else "4-8" if n <= 8 else "9+"
    return {"count": len(rows), "imports": dict(Counter(
        ",".join(c["imports"]) for c in rows)), "orig_proof_lines": dict(Counter(
            bucket(c["orig_proof_lines"]) for c in rows)),
            "sources": dict(Counter(c["source_file"] for c in rows))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=int, default=250)
    parser.add_argument("--rebuild", action="store_true",
                        help="Resample instead of validating the committed corpus snapshot")
    args = parser.parse_args()
    version = subprocess.check_output(["isabelle", "version"], text=True).strip()
    home = Path(subprocess.check_output(["isabelle", "getenv", "-b", "ISABELLE_HOME"], text=True).strip())
    hol = home / "src/HOL"
    root = Path("eval/results/corpus/work")
    root.mkdir(parents=True, exist_ok=True)
    cache_path = root.parent / "validation_cache.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    snapshots = [Path(f"eval/corpus/{name}.jsonl") for name in ("lib", "fresh")]
    if not args.rebuild and all(path.exists() for path in snapshots):
        saved = [[json.loads(line) for line in path.read_text().splitlines()] for path in snapshots]
        supplied = Path("eval/corpus/fresh_statements.thy")
        new_source = supplied.exists() and not any(
            r["source_file"] == str(supplied) for r in saved[1])
        if len(saved[0]) == args.target and 25 <= len(saved[1]) <= 40 and not new_source:
            for name, rows in zip(("lib", "fresh"), saved):
                assert len({r["id"] for r in rows}) == len(rows)
                assert len(validate(rows, version, cache, root)) == len(rows), (
                    f"Committed {name} snapshot failed validation; do not silently replace it")
                print(name, json.dumps(statistics(rows), sort_keys=True), flush=True)
            assert max(Counter(r["source_file"] for r in saved[0]).values()) / len(saved[0]) <= .15
            (root.parent / "statistics.json").write_text(json.dumps({
                "isabelle_version": version, "lib": statistics(saved[0]),
                "fresh": statistics(saved[1])}, indent=2)+"\n")
            shutil.rmtree(root)
            print("M1 validation passed (retained committed corpus snapshot)", flush=True)
            return
    if args.rebuild:
        # Old group timeouts are not permanent negative judgments on candidates.
        cache = {key: accepted for key, accepted in cache.items() if accepted}
    groups: dict[str, list[dict]] = defaultdict(list)
    for path in sorted(hol.glob("*.thy")) + sorted((hol / "Library").glob("*.thy")):
        for candidate in extract(path, str(path.relative_to(hol))):
            groups[candidate["source_file"]].append(candidate)
    # Main deliberately hides notation from some of its implementation theories.
    # Use its public mathematical theories first; still walk the full source tree
    # and retain the remaining candidates as deterministic fallback sources.
    preferred = set("""List Nat Set Finite_Set Fun Relation Product_Type Option Map
        Groups Orderings Int Power Transitive_Closure Wellfounded Hilbert_Choice
        Groups_Big GCD Binomial Parity Divides""".split())
    preferred_keys = [name for name in sorted(groups) if Path(name).stem in preferred]
    rng = random.Random(20251020)
    for candidates in groups.values():
        rng.shuffle(candidates)
    lib = []
    counts: Counter = Counter()
    # Round robin prevents early source domination; final cap uses target size.
    while len(lib) < args.target and any(groups.values()):
        batch = []
        eligible = [name for name in preferred_keys if groups[name]
                    and counts[name] < math.floor(args.target * .15)]
        for name in eligible or sorted(groups):
            if groups[name] and counts[name] < math.floor(args.target * .15):
                batch.append(groups[name].pop())
        if not batch:
            break
        for candidate in validate_imports(batch, version, cache, root):
            if len(lib) < args.target and counts[candidate["source_file"]] < math.floor(args.target * .15):
                lib.append(candidate)
                counts[candidate["source_file"]] += 1
        print(f"lib validated: {len(lib)}/{args.target}", flush=True)
        Path("eval/corpus/lib.jsonl").write_text("".join(
            json.dumps(c, ensure_ascii=False)+"\n" for c in lib))
    fresh = validate_imports(fresh_steps(), version, cache, root)
    # Keep all valid steps up to the specified upper bound, in source order.
    by_source: dict[str, list[dict]] = defaultdict(list)
    for candidate in fresh:
        by_source[candidate["source_file"]].append(candidate)
    fresh = []
    while len(fresh) < 40 and any(by_source.values()):
        for candidates in by_source.values():
            if candidates and len(fresh) < 40:
                fresh.append(candidates.pop(0))
    for name, rows in [("lib", lib), ("fresh", fresh)]:
        Path(f"eval/corpus/{name}.jsonl").write_text("".join(json.dumps(c, ensure_ascii=False)+"\n" for c in rows))
        print(name, json.dumps(statistics(rows), sort_keys=True), flush=True)
    summary = {"isabelle_version": version, "lib": statistics(lib), "fresh": statistics(fresh)}
    (root.parent / "statistics.json").write_text(json.dumps(summary, indent=2)+"\n")
    shutil.rmtree(root)
    assert len(lib) >= args.target, f"Insufficient lib corpus: {len(lib)}"
    assert 25 <= len(fresh) <= 40, f"Insufficient fresh corpus: {len(fresh)}"
    assert max(counts.values()) / len(lib) <= .15
    print("M1 validation passed", flush=True)


if __name__ == "__main__":
    main()
