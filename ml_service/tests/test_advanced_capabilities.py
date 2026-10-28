import base64
import json

import cv2
import fitz
import numpy as np

from app.pipeline import llm
from app.pipeline.entities import detect_entities
from app.pipeline.image_checks import analyze_image
from app.pipeline.parser import parse_document
from app.pipeline.retriever import retrieve_passage
from evaluation.evaluator import run_dataset


def test_60_draft_dataset_has_reproducible_threshold_sweep():
    metrics = run_dataset("evaluation/drafts_60.json")
    assert metrics["cases"] == 60
    assert metrics["thresholdTuning"]["candidatesEvaluated"] == 50
    assert 0.50 <= metrics["thresholdTuning"]["best"]["threshold"] <= 0.99
    assert "precision" in metrics["thresholdTuning"]["best"]
    assert "recall" in metrics["thresholdTuning"]["best"]
    assert "f1" in metrics["thresholdTuning"]["best"]


def test_watchlist_detection_returns_exact_character_offsets():
    text = "Contact Acme Labs before publishing."
    response = detect_entities(text, ["acme labs"])
    hit = next(item for item in response["entities"] if item["isWatchlisted"])
    assert hit["text"] == "Acme Labs"
    assert text[hit["span"]["start"]:hit["span"]["end"]] == "Acme Labs"
    assert response["watchlistHits"] == 1


def test_llm_features_do_not_call_provider_without_explicit_configuration(monkeypatch):
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    assert llm.generate_rewrite("Best returns", "Contradicted") is None
    assert llm.generate_premortem("Best returns", [], "Best returns") is None


def test_llm_rewrite_rejects_removing_required_must_say(monkeypatch):
    monkeypatch.setattr(llm, "_chat_json", lambda *_args, **_kwargs: {
        "rewrittenText": "A simple return policy.", "rationale": "shortened"
    })
    rewrite = llm.generate_rewrite(
        "Our certified 30-day return policy is the best.",
        "Contradicted",
        original_text="Our certified 30-day return policy is the best.",
        intent={"mustSay": ["certified 30-day return policy"]},
    )
    assert rewrite is None


def test_llm_premortem_requires_all_four_distinct_viewpoints(monkeypatch):
    monkeypatch.setattr(llm, "_chat_json", lambda *_args, **_kwargs: {
        "highestRiskLine": "Best returns",
        "risks": [
            {"viewpoint": "regulatory", "riskLine": "Best returns", "severity": "high", "reason": "Unsupported"},
            {"viewpoint": "brand", "riskLine": "Best returns", "severity": "medium", "reason": "Brand tone"},
            {"viewpoint": "customer", "riskLine": "Best returns", "severity": "medium", "reason": "Expectation"},
            {"viewpoint": "customer", "riskLine": "Best returns", "severity": "low", "reason": "Duplicate viewpoint"},
        ],
    })
    assert llm.generate_premortem("Best returns", [], "Best returns") is None


def test_actual_image_bytes_are_decoded_and_analysed():
    image = np.zeros((240, 400, 3), dtype=np.uint8)
    image[:, 200:] = 255
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    response = analyze_image({"storageRef": "memory://image", "imageBase64": base64.b64encode(encoded.tobytes()).decode("ascii")})
    kinds = {item["checkType"] for item in response}
    assert {"image-integrity", "image-dimensions", "image-sharpness", "image-colour-profile", "alt-text"} <= kinds


def test_invalid_image_bytes_return_a_structured_failure():
    response = analyze_image({"storageRef": "memory://image", "imageBase64": "not-base64!"})
    assert response
    assert response[0]["checkType"] == "image-integrity"
    assert response[0]["passed"] is False


def test_scanned_pdf_page_uses_ocr_fallback(monkeypatch):
    document = fitz.open()
    document.new_page()
    data = document.tobytes()
    document.close()
    calls = []
    from app.pipeline import parser
    monkeypatch.setattr(parser, "_ocr_page", lambda page, number: calls.append(number) or "Scanned policy says returns within 30 days.")
    parsed = parse_document(data, "scan.pdf", "application/pdf")
    assert calls == [1]
    assert "Scanned policy says returns within 30 days." in parsed["text"]


def test_faiss_semantic_retrieval_is_opt_in_and_keeps_lexical_fallback(monkeypatch):
    from app.pipeline.semantic import rank_semantically
    monkeypatch.setenv("SEMANTIC_RETRIEVAL_ENABLED", "false")
    passage = {"passageId": "p1", "text": "Returns are accepted within 30 days."}
    assert rank_semantically("return window", [passage]) is None
    assert retrieve_passage("returns 30 days", [passage])["passageId"] == "p1"


def test_rewrite_and_premortem_do_not_call_llm_without_explicit_org_permission(monkeypatch):
    from app import main

    def unexpected_call(*args, **kwargs):
        raise AssertionError("LLM must be gated by allowExternalModel")

    monkeypatch.setattr(main, "generate_rewrite", unexpected_call)
    monkeypatch.setattr(main, "generate_premortem", unexpected_call)

    rewrite = main.rewrite_claim({
        "claim": {"text": "The best returns in India.", "verdict": "Contradicted"},
        "originalText": "The best returns in India.",
    })
    premortem = main.premortem_check({"content": "The best returns in India.", "findings": []})
    assert rewrite["generationMethod"] == "deterministic"
    assert len(premortem["risks"]) == 4
