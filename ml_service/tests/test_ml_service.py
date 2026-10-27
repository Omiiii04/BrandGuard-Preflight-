import math
import importlib.util
import pytest
from fastapi import HTTPException

from app.main import detect_entities, extract_claims, image_check, premortem_check


def test_typed_response_schema_module_exists():
    assert importlib.util.find_spec("app.schemas.responses") is not None


def test_extract_claims_rejects_missing_content():
    with pytest.raises(HTTPException) as error:
        extract_claims({})

    assert error.value.status_code == 422


def test_extracts_exact_superlative_span_and_flags_it():
    content = "Our promise: best returns in India for every customer."

    claims = extract_claims({"content": content, "intent": {}})["claims"]

    claim = next(item for item in claims if item["verdict"] == "Contradicted")
    assert content[claim["span"]["start"] : claim["span"]["end"]] == "best returns in India"
    assert claim["ruleId"] == "rule.superlative.unqualified"
    assert claim["suggestedFix"]


def test_supported_current_return_claim_is_not_flagged():
    content = "Customers may return eligible items within 30 days of delivery."

    claims = extract_claims({"content": content, "intent": {}})["claims"]

    claim = next(item for item in claims if "30 days" in content[item["span"]["start"] : item["span"]["end"]])
    assert claim["verdict"] == "Supported"
    assert claim["confidence"] > 0.9


def test_unknown_quantitative_claim_is_not_found_without_evidence():
    content = "Customers may return eligible items within 45 days of delivery."

    claims = extract_claims({"content": content, "intent": {}})["claims"]

    claim = next(item for item in claims if "45 days" in content[item["span"]["start"] : item["span"]["end"]])
    assert claim["verdict"] == "Not Found"
    assert claim["proofPassageId"] is None


def test_superseded_return_window_is_outdated():
    claims = extract_claims(
        {"content": "Customers may return eligible items within 14 days of delivery.", "intent": {}}
    )["claims"]
    assert claims, "the duration claim should be extracted"
    result = claims[0]

    assert result["verdict"] == "Outdated"
    assert math.isclose(result["confidence"], 0.89)


def test_watchlist_entities_are_case_insensitive_and_keep_overlapping_spans():
    content = "The PROJECT NOVA launch is confidential; Nova is embargoed."

    response = detect_entities(
        {"content": content, "orgId": "org-1", "watchlist": ["Project Nova", "Nova"]}
    )

    spans = {(item["text"], item["span"]["start"], item["span"]["end"]) for item in response["entities"]}
    assert ("PROJECT NOVA", 4, 16) in spans
    assert ("NOVA", 12, 16) in spans
    assert response["watchlistHits"] == 3
    assert all(item["isWatchlisted"] for item in response["entities"])


def test_premortem_highest_risk_line_is_verbatim_from_draft():
    content = "Our promise is best returns in India."

    response = premortem_check({"content": content, "findings": []})

    assert response["highestRiskLine"] in content
    assert {risk["viewpoint"] for risk in response["risks"]} == {
        "regulatory",
        "brand",
        "customer",
        "competitor",
    }
    assert all(risk["riskLine"] in content for risk in response["risks"])


def test_image_checks_report_palette_contrast_and_alt_text():
    response = image_check(
        {
            "storageRef": "memory://hero.png",
            "orgId": "org-1",
            "pixels": [[255, 255, 255], [250, 250, 250]],
            "brandPalette": [[255, 255, 255]],
            "textForeground": [0, 0, 0],
            "textBackground": [255, 255, 255],
            "altText": "Stellara return policy banner",
        }
    )

    results = {item["checkType"]: item for item in response["results"]}
    assert results["palette"]["passed"] is True
    assert results["contrast"]["passed"] is True
    assert results["alt-text"]["passed"] is True


def test_stellara_demo_returns_three_distinct_claims_with_offsets_and_evidence():
    content = (
        "We offer best returns in India for customers. "
        "Eligible items may be returned within 14 days of delivery. "
        "Save 20% today."
    )

    claims = extract_claims({"content": content, "intent": {}})["claims"]

    assert len(claims) == 3
    assert [content[item["span"]["start"] : item["span"]["end"]] for item in claims] == [
        "best returns in India",
        "within 14 days of delivery",
        "20%",
    ]
    assert [item["verdict"] for item in claims] == ["Contradicted", "Outdated", "Not Found"]
    assert all(item["proofPassageId"] for item in claims[:2])
    assert claims[2]["proofPassageId"] is None
    assert claims[0]["evidence"]["passage"]
    assert claims[0]["evidence"]["fileName"] == "Stellara_Returns_Policy_v4.pdf"
    assert claims[2]["evidence"] is None


def test_retrieval_filters_passages_by_organization():
    claims = extract_claims(
        {
            "content": "Eligible items may be returned within 30 days of delivery.",
            "orgId": "org-b",
            "passages": [
                {
                    "passageId": "507f1f77bcf86cd799439099",
                    "orgId": "org-a",
                    "expiryDate": "2027-06-30",
                    "text": "Eligible items may be returned within 30 days of delivery.",
                }
            ],
        }
    )["claims"]

    assert claims[0]["verdict"] == "Not Found"
    assert claims[0]["proofPassageId"] is None


def test_expired_evidence_overrides_an_entailment_match():
    claims = extract_claims(
        {
            "content": "Eligible items may be returned within 30 days of delivery.",
            "passages": [
                {
                    "passageId": "507f1f77bcf86cd799439098",
                    "expiryDate": "2020-01-01",
                    "text": "Eligible items may be returned within 30 days of delivery.",
                }
            ],
        }
    )["claims"]

    assert claims[0]["verdict"] == "Outdated"


def test_premortem_discards_finding_span_not_present_in_content():
    response = premortem_check(
        {
            "content": "A calm, factual statement.",
            "findings": [{"span": {"start": 0, "end": 999}}],
        }
    )

    assert response["highestRiskLine"] == "A calm, factual statement"
    assert all(risk["riskLine"] in response["highestRiskLine"] for risk in response["risks"])


def test_evaluation_runner_module_exists():
    evaluation = importlib.util.find_spec("evaluation")
    evaluator = importlib.util.find_spec("evaluation.evaluator") if evaluation else None
    assert evaluator is not None


def test_evaluation_runner_reports_measured_metrics():
    from evaluation.evaluator import run_dataset

    metrics = run_dataset("evaluation/test_set.json")

    assert metrics["cases"] == 5
    assert metrics["truePositives"] == 5
    assert metrics["falsePositives"] == 0
    assert metrics["falseNegatives"] == 0
    assert metrics["precision"] == 1.0
    assert metrics["recall"] == 1.0
