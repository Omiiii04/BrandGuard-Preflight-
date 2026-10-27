import base64

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

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
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "test-only-ml-internal-token-32-bytes-minimum")
    monkeypatch.setattr(main, "INDEX", PersistentLexicalIndex(tmp_path))

    with pytest.raises(HTTPException) as error:
        main.index_source(_payload(), "wrong-token-value")

    assert error.value.status_code == 401


def test_index_source_persists_uploaded_text_and_claims_retrieve_it(monkeypatch, tmp_path):
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "test-only-ml-internal-token-32-bytes-minimum")
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.setattr(main, "INDEX", PersistentLexicalIndex(tmp_path))

    response = main.index_source(_payload(), "test-only-ml-internal-token-32-bytes-minimum")
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
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "test-only-ml-internal-token-32-bytes-minimum")
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.setattr(main, "INDEX", PersistentLexicalIndex(tmp_path))
    main.index_source(_payload(), "test-only-ml-internal-token-32-bytes-minimum")

    claims = main.extract_claims({
        "content": "Customers may return eligible items within 45 days of delivery.",
        "orgId": "org-a",
    })["claims"]
    finding = next(claim for claim in claims if "45 days" in claim["text"])

    assert finding["verdict"] == "Not Found"
    assert finding["proofPassageId"] is None
    assert finding["evidence"] is None


def test_index_source_rejects_invalid_document(monkeypatch, tmp_path):
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "test-only-ml-internal-token-32-bytes-minimum")
    monkeypatch.setattr(main, "INDEX", PersistentLexicalIndex(tmp_path))
    payload = _payload()
    payload["fileName"] = "broken.pdf"
    payload["mimeType"] = "application/pdf"
    payload["contentBase64"] = base64.b64encode(b"not a pdf").decode("ascii")

    with pytest.raises(HTTPException) as error:
        main.index_source(payload, "test-only-ml-internal-token-32-bytes-minimum")

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "INVALID_DOCUMENT"

def test_internal_token_validator_rejects_missing_and_wrong_tokens(monkeypatch):
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "test-only-ml-internal-token-32-bytes-minimum")

    with pytest.raises(HTTPException) as missing:
        main._validate_internal_token(None)
    assert missing.value.status_code == 401

    with pytest.raises(HTTPException) as wrong:
        main._validate_internal_token("wrong-token-value")
    assert wrong.value.status_code == 401

    assert main._validate_internal_token("test-only-ml-internal-token-32-bytes-minimum") is None


def test_known_development_token_is_rejected(monkeypatch):
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "brandguard-ml-internal-dev-token")

    with pytest.raises(HTTPException) as error:
        main._validate_internal_token("brandguard-ml-internal-dev-token")

    assert error.value.status_code == 503


def test_source_metadata_update_is_persisted_and_scoped(monkeypatch, tmp_path):
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "test-only-ml-internal-token-32-bytes-minimum")
    monkeypatch.setenv("DEMO_MODE", "false")
    index = PersistentLexicalIndex(tmp_path)
    monkeypatch.setattr(main, "INDEX", index)
    main.index_source(_payload(source_id="source-1", org_id="org-a"), "test-only-ml-internal-token-32-bytes-minimum")
    main.index_source(_payload(source_id="source-2", org_id="org-b"), "test-only-ml-internal-token-32-bytes-minimum")

    response = main.update_source_metadata({
        "sourceId": "source-1",
        "orgId": "org-a",
        "status": "superseded",
        "expiryDate": "2026-01-01T00:00:00.000Z",
    })

    assert response["updated"] is True
    assert response["passageCount"] == 1
    org_a = index.passages_for_org("org-a")
    org_b = index.passages_for_org("org-b")
    assert org_a[0]["status"] == "superseded"
    assert org_a[0]["expiryDate"] == "2026-01-01T00:00:00.000Z"
    assert org_b[0]["status"] == "ready"


def test_retrieval_excludes_inactive_lifecycle_states():
    from app.pipeline.retriever import retrieve_passage

    passages = [
        {"passageId": status, "status": status, "text": "return policy within 30 days"}
        for status in ("expired", "deleted", "blocked", "superseded", "processing", "error")
    ]
    assert retrieve_passage("return policy 30 days", passages) is None



def test_http_private_post_endpoints_reject_missing_internal_token(monkeypatch):
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "test-only-ml-internal-token-32-bytes-minimum")
    client = TestClient(main.app)
    cases = [
        ("/index-source", _payload()),
        ("/source-metadata", {"sourceId": "source-1", "orgId": "org-a", "status": "ready"}),
        ("/extract-claims", {"content": "Hello."}),
        ("/match", {"claim": "Hello."}),
        ("/rewrite", {"claim": "Hello."}),
        ("/premortem", {"content": "Hello.", "findings": []}),
        ("/image-check", {"storageRef": "memory://image.png", "orgId": "org-a"}),
        ("/detect-entities", {"content": "Hello.", "orgId": "org-a"}),
    ]

    for endpoint, payload in cases:
        response = client.post(endpoint, json=payload)
        assert response.status_code == 401, f"{endpoint} should require the internal token"


def test_http_private_post_endpoint_accepts_configured_internal_token(monkeypatch):
    token = "test-only-ml-internal-token-32-bytes-minimum"
    monkeypatch.setenv("ML_INTERNAL_TOKEN", token)
    monkeypatch.setenv("DEMO_MODE", "false")
    client = TestClient(main.app)

    response = client.post(
        "/extract-claims",
        json={"content": "Hello."},
        headers={"X-ML-Internal-Token": token},
    )

    assert response.status_code == 200
    assert response.json() == {"claims": []}
