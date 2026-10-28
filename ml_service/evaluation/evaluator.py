"""Small, reproducible evaluator for the deterministic fallback pipeline."""

import json
from pathlib import Path
from typing import Any, Iterable

from app.main import STELLARA_PASSAGES
from app.pipeline.claims import extract_claims


def evaluate(cases: Iterable[dict[str, Any]], confidence_threshold: float | None = None) -> dict[str, Any]:
    cases = list(cases)
    true_positive = false_positive = false_negative = cited = 0
    confidence_errors = []
    for case in cases:
        expected = {
            (item["ruleId"], item["verdict"])
            for item in case.get("expected", [])
        }
        claims = extract_claims(case["content"], STELLARA_PASSAGES, case.get("intent", {}))
        if confidence_threshold is not None:
            claims = [claim for claim in claims if float(claim.get("confidence", 0.0)) >= confidence_threshold]
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


def tune_confidence_thresholds(cases: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Sweep confidence cutoffs and choose the highest-F1 point (precision tie-break)."""
    cases = list(cases)
    points = []
    for step in range(50, 100):
        threshold = step / 100
        metrics = evaluate(cases, confidence_threshold=threshold)
        precision, recall = metrics["precision"], metrics["recall"]
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        points.append({
            "threshold": threshold, "precision": precision, "recall": recall,
            "f1": f1, "truePositives": metrics["truePositives"],
            "falsePositives": metrics["falsePositives"],
            "falseNegatives": metrics["falseNegatives"],
        })
    best = max(points, key=lambda point: (point["f1"], point["precision"], point["threshold"]))
    return {"best": best, "candidatesEvaluated": len(points), "curve": points}


def run_dataset(path: str | Path) -> dict[str, Any]:
    cases = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(cases, list):
        raise ValueError("evaluation dataset must be a JSON array")
    if any(not isinstance(case, dict) or not isinstance(case.get("content"), str) for case in cases):
        raise ValueError("every evaluation case must be an object with a string content field")
    return {**evaluate(cases), "thresholdTuning": tune_confidence_thresholds(cases)}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Evaluate BrandGuard ML fixtures and tune confidence thresholds.")
    parser.add_argument("--dataset", type=Path, default=Path(__file__).with_name("test_set.json"))
    parser.add_argument("--report", type=Path, help="Optional JSON output path")
    args = parser.parse_args()
    result = run_dataset(args.dataset)
    rendered = json.dumps(result, indent=2)
    print(rendered)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered + "\n", encoding="utf-8")
