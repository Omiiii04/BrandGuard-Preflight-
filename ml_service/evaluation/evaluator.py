"""Small, reproducible evaluator for the deterministic fallback pipeline."""

import json
from pathlib import Path
from typing import Any, Iterable

from app.main import STELLARA_PASSAGES
from app.pipeline.claims import extract_claims


def evaluate(cases: Iterable[dict[str, Any]]) -> dict[str, Any]:
    cases = list(cases)
    true_positive = false_positive = false_negative = cited = 0
    confidence_errors = []
    for case in cases:
        expected = {
            (item["ruleId"], item["verdict"])
            for item in case.get("expected", [])
        }
        claims = extract_claims(case["content"], STELLARA_PASSAGES, case.get("intent", {}))
        predicted = {(claim.get("ruleId"), claim.get("verdict")) for claim in claims}
        true_positive += len(expected & predicted)
        false_positive += len(predicted - expected)
        false_negative += len(expected - predicted)
        cited += sum(bool(claim.get("proofPassageId")) for claim in claims)
        for claim in claims:
            confidence = float(claim.get("confidence", 0))
            confidence_errors.append((confidence - (1 if (claim.get("ruleId"), claim.get("verdict")) in expected else 0)) ** 2)

    total_predicted = true_positive + false_positive
    total_expected = true_positive + false_negative
    return {
        "cases": len(cases),
        "truePositives": true_positive,
        "falsePositives": false_positive,
        "falseNegatives": false_negative,
        "precision": true_positive / total_predicted if total_predicted else 0.0,
        "recall": true_positive / total_expected if total_expected else 0.0,
        "citationRate": cited / total_predicted if total_predicted else 0.0,
        "brierScore": sum(confidence_errors) / len(confidence_errors) if confidence_errors else 0.0,
    }


def run_dataset(path: str | Path) -> dict[str, Any]:
    cases = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(cases, list):
        raise ValueError("evaluation dataset must be a JSON array")
    return evaluate(cases)


if __name__ == "__main__":
    dataset = Path(__file__).with_name("test_set.json")
    print(json.dumps(run_dataset(dataset), indent=2))
