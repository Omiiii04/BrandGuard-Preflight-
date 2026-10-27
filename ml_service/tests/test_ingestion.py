import base64

import pytest
from fastapi import HTTPException

import app.main as main
from app.pipeline.indexer import PersistentLexicalIndex


def _payload(source_id="source-1", org_id="org-a"):
    content = b"Customers may return eligible items within 30 days of delivery."
    return {
        "sourceId": source_id,
        "orgId": org_id,
        "fileName": "policy.md",
        "mimeType": "text/markdown",
        "version": "1.0",
        "status": "ready",
        "contentBase64": base64.b64encode(content).decode("ascii"),
    }


def test_index_source_requires_internal_token(monkeypatch, tmp_path):
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "secret")
    monkeypatch.setattr(main, "INDEX", PersistentLexicalIndex(tmp_path))

    with pytest.raises(HTTPException) as error:
        main.index_source(_payload(), "wrong")

    assert error.value.status_code == 401


def test_index_source_persists_uploaded_text_and_claims_retrieve_it(monkeypatch, tmp_path):
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "secret")
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.setattr(main, "INDEX", PersistentLexicalIndex(tmp_path))

    response = main.index_source(_payload(), "secret")
    claims = main.extract_claims({
        "content": "Customers may return eligible items within 30 days of delivery.",
        "orgId": "org-a",
    })["claims"]

    assert response["indexed"] is True
    assert response["passageCount"] == 1
    finding = next(claim for claim in claims if "30 days" in claim["text"])
    assert finding["evidence"]["passage"] == "Customers may return eligible items within 30 days of delivery."
    assert finding["evidence"]["sourceId"] == "source-1"
    assert finding["evidence"]["passageId"] != "source-1"


def test_normal_mode_does_not_fall_back_to_stellara_fixture(monkeypatch, tmp_path):
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.setattr(main, "INDEX", PersistentLexicalIndex(tmp_path))

    claims = main.extract_claims({
        "content": "Customers may return eligible items within 30 days of delivery.",
        "orgId": "org-without-sources",
    })["claims"]

    finding = next(claim for claim in claims if "30 days" in claim["text"])
    assert finding["verdict"] == "Not Found"
    assert finding["proofPassageId"] is None
    assert finding["evidence"] is None


def test_irrelevant_retrieved_passage_does_not_create_proof_reference(monkeypatch, tmp_path):
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "secret")
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.setattr(main, "INDEX", PersistentLexicalIndex(tmp_path))
    main.index_source(_payload(), "secret")

    claims = main.extract_claims({
        "content": "Customers may return eligible items within 45 days of delivery.",
        "orgId": "org-a",
    })["claims"]
    finding = next(claim for claim in claims if "45 days" in claim["text"])

    assert finding["verdict"] == "Not Found"
    assert finding["proofPassageId"] is None
    assert finding["evidence"] is None


def test_index_source_rejects_invalid_document(monkeypatch, tmp_path):
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "secret")
    monkeypatch.setattr(main, "INDEX", PersistentLexicalIndex(tmp_path))
    payload = _payload()
    payload["fileName"] = "broken.pdf"
    payload["mimeType"] = "application/pdf"
    payload["contentBase64"] = base64.b64encode(b"not a pdf").decode("ascii")

    with pytest.raises(HTTPException) as error:
        main.index_source(payload, "secret")

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "INVALID_DOCUMENT"

