"""BrandGuard's offline-capable FastAPI ML boundary."""

import base64
import hashlib
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .pipeline.claims import (
    extract_claims as extract_claims_pipeline,
    meaning_check,
    retrieve_passage,
    suggested_fix,
)
from .pipeline.image_checks import analyze_image
from .pipeline.indexer import PersistentLexicalIndex
from .pipeline.judge import judge_claim
from .pipeline.parser import DocumentParseError, parse_document


app = FastAPI(
    title="BrandGuard Preflight ML Service",
    description="Offline-capable claim extraction, judging, rewriting, and analysis.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


STELLARA_PASSAGES: List[Dict[str, Any]] = [
    {
        "passageId": "507f1f77bcf86cd799439011",
        "fileName": "Stellara_Returns_Policy_v4.pdf",
        "page": 3,
        "version": "4.0",
        "expiryDate": "2027-06-30",
        "ownerName": "Compliance and Legal",
        "text": (
            "Customers may return eligible items within 30 days of the delivery date. "
            "No comparison to competitor return policies has been independently validated. "
            "The policy does not guarantee superiority over any other retailer."
        ),
    },
    {
        "passageId": "507f1f77bcf86cd799439012",
        "fileName": "Stellara_Returns_Policy_v4.pdf",
        "page": 5,
        "version": "4.0",
        "expiryDate": "2027-06-30",
        "ownerName": "Compliance and Legal",
        "text": (
            "As of Q1 2026 the standard return window is 30 days. "
            "Prior policy documents referencing a 14-day window are superseded."
        ),
    },
]

INDEX = PersistentLexicalIndex(os.getenv("INDEX_DIR", "indexes"))


def _demo_enabled() -> bool:
    return os.getenv("DEMO_MODE", "false").lower() == "true"


def _passages_for_request(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    explicit = payload.get("passages")
    if isinstance(explicit, list):
        return explicit
    org_id = str(payload.get("orgId")) if payload.get("orgId") else ""
    if org_id:
        indexed = INDEX.passages_for_org(org_id)
        if indexed or not _demo_enabled():
            return indexed
    return STELLARA_PASSAGES if _demo_enabled() else []


def _require_fields(payload: Dict[str, Any], *fields: str) -> None:
    if not isinstance(payload, dict) or any(field not in payload for field in fields):
        raise HTTPException(status_code=422, detail=f"Required fields: {', '.join(fields)}")


def _retrieve_passage(claim_text: str, passages: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
    return retrieve_passage(claim_text, passages or [])


def _nli_verdict(claim_text: str, passage_text: str) -> Dict[str, Any]:
    """Compatibility helper retained for callers of the original stub."""
    passage = {"passageId": None, "text": passage_text, "expiryDate": "2099-12-31"}
    return judge_claim(claim_text, passage)


def _build_suggested_fix(span_text: str, verdict: str) -> str:
    return suggested_fix(span_text, verdict)


def _build_meaning_check(original: str, fix: str, intent: Dict[str, Any]) -> Dict[str, List[str]]:
    return meaning_check(original, fix, intent)


def _detect_claims(content: str, intent: Dict[str, Any]) -> List[Dict[str, Any]]:
    return extract_claims_pipeline(content, _passages_for_request({"intent": intent}), intent)


def _public_passage(passage: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "passageId": str(passage.get("passageId", "")),
        "text": str(passage.get("text", "")),
        "sourceId": str(passage.get("sourceId", passage.get("passageId", ""))),
        "page": int(passage.get("page", 0) or 0),
        "score": float(passage.get("score", 0.91) or 0.91),
        "expiryDate": passage.get("expiryDate"),
    }


@app.get("/health")
def health_check() -> Dict[str, Any]:
    return {"status": "healthy", "service": "brandguard-ml"}


@app.get("/")
def root() -> Dict[str, Any]:
    return {"name": "BrandGuard Preflight ML API", "version": "1.0.0"}


@app.post("/index-source")
def index_source(payload: Dict[str, Any], internal_token: Optional[str] = Header(default=None, alias="X-ML-Internal-Token")) -> Dict[str, Any]:
    expected_token = os.getenv("ML_INTERNAL_TOKEN", "")
    if not expected_token:
        raise HTTPException(status_code=503, detail="ML_INTERNAL_TOKEN is not configured")
    if internal_token != expected_token:
        raise HTTPException(status_code=401, detail="Invalid internal service token")
    _require_fields(payload, "sourceId", "orgId", "fileName", "contentBase64")
    try:
        content = base64.b64decode(payload["contentBase64"], validate=True)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail={"code": "INVALID_CONTENT", "message": "contentBase64 is invalid"})
    try:
        document = parse_document(content, str(payload["fileName"]), payload.get("mimeType"))
        passages = INDEX.ingest(document, {
            "sourceId": str(payload["sourceId"]),
            "orgId": str(payload["orgId"]),
            "fileName": str(payload["fileName"]),
            "version": str(payload.get("version") or "1.0"),
            "expiryDate": payload.get("expiryDate"),
            "ownerName": str(payload.get("ownerName") or ""),
            "status": str(payload.get("status") or "ready"),
        })
    except DocumentParseError as error:
        raise HTTPException(status_code=422, detail={"code": error.code, "message": str(error)}) from error
    except (OSError, RuntimeError) as error:
        raise HTTPException(status_code=500, detail={"code": "INDEX_FAILED", "message": str(error)}) from error
    return {
        "indexed": True,
        "status": "indexed",
        "sourceId": str(payload["sourceId"]),
        "orgId": str(payload["orgId"]),
        "passageCount": len(passages),
        "contentHash": hashlib.sha256(content).hexdigest(),
    }


@app.post("/extract-claims")
def extract_claims(payload: Dict[str, Any]) -> Dict[str, Any]:
    _require_fields(payload, "content")
    if not isinstance(payload["content"], str):
        raise HTTPException(status_code=422, detail="content must be a string")
    content = str(payload.get("content", ""))
    intent = payload.get("intent") if isinstance(payload.get("intent"), dict) else {}
    passages = _passages_for_request(payload)
    guidelines = payload.get("guidelines") if isinstance(payload.get("guidelines"), dict) else {}
    image_context = payload.get("imageContext") if isinstance(payload.get("imageContext"), dict) else None
    rules_only = bool(payload.get("rulesOnly") or payload.get("rules_only"))
    claims = extract_claims_pipeline(
        content,
        passages,
        intent,
        str(payload.get("orgId")) if payload.get("orgId") else None,
        guidelines.get("bannedTerms", []),
        image_context,
    )
    if rules_only:
        claims = [c for c in claims if c.get("ruleId")]
    return {"claims": claims}


@app.post("/match")
def match_passages(payload: Dict[str, Any]) -> Dict[str, Any]:
    passages = _passages_for_request(payload)
    source_claims = payload.get("claims")
    if not isinstance(source_claims, list):
        text = str(payload.get("claim", ""))
        source_claims = [{"text": text, "span": {"start": 0, "end": len(text)}}] if text else []
    matches = []
    for claim in source_claims[: int(payload.get("topK", 3) or 3)]:
        claim_text = claim.get("text", "") if isinstance(claim, dict) else str(claim)
        passage = retrieve_passage(claim_text, passages, str(payload.get("orgId")) if payload.get("orgId") else None)
        evidence = [_public_passage(passage)] if passage else []
        judged = judge_claim(claim_text, passage)
        matches.append({"claim": claim, "passages": evidence, "verdict": judged["verdict"], "confidence": judged["confidence"]})
    return {"matches": matches}


RULE_REWORDINGS: Dict[str, str] = {
    "rule.superlative.unqualified": (
        'Claims must avoid unverified superlatives ("best", "market leader"). '
        'State verified benchmark numbers or certified laboratory test data instead.'
    ),
    "rule.date.outdated": (
        'Specify standard 30-day return window from physical delivery timestamp, '
        'referencing current Customer Terms v4.0.'
    ),
    "rule.cost.claim": (
        'Free return phrasing is allowed only for domestic orders with original packaging intact.'
    ),
    "rule.contradiction": (
        'Ensure product availability and returns eligibility match current published support guidelines.'
    ),
    "rule.unsupported": (
        'Every factual claim must cite an approved active source document with matching passage proof.'
    ),
    "rule.meaning.changed": (
        'Preserve mandatory approved brand terminology without altering core meaning.'
    ),
}


@app.post("/rewrite")
def rewrite_claim(payload: Dict[str, Any]) -> Dict[str, Any]:
    rule_id = payload.get("rule") or payload.get("ruleId")
    if not rule_id and isinstance(payload.get("claim"), dict):
        rule_id = payload["claim"].get("ruleId") or payload["claim"].get("rule")

    suggested_rewording = RULE_REWORDINGS.get(str(rule_id)) if rule_id else None

    claim = payload.get("claim", {})
    claim_text = claim.get("text", "") if isinstance(claim, dict) else str(claim)
    verdict = claim.get("verdict", "Not Found") if isinstance(claim, dict) else str(payload.get("verdict", "Not Found"))
    fix = suggested_fix(claim_text, verdict)

    if not suggested_rewording and fix:
        suggested_rewording = fix
    elif not fix and suggested_rewording:
        fix = suggested_rewording

    return {
        "suggestedFix": fix or "",
        "suggestedRewording": suggested_rewording or fix or "",
        "meaningCheck": meaning_check(payload.get("originalText", claim_text), fix or "", payload.get("intent")),
    }


@app.post("/premortem")
def premortem_check(payload: Dict[str, Any]) -> Dict[str, Any]:
    _require_fields(payload, "content", "findings")
    if not isinstance(payload["content"], str) or not isinstance(payload["findings"], list):
        raise HTTPException(status_code=422, detail="content must be a string and findings must be an array")
    content = str(payload.get("content", ""))
    findings = payload.get("findings") if isinstance(payload.get("findings"), list) else []
    risk_line = ""
    for finding in findings:
        if not isinstance(finding, dict):
            continue
        span = finding.get("span")
        if isinstance(span, dict) and 0 <= span.get("start", -1) <= span.get("end", -1) <= len(content):
            candidate = content[span["start"] : span["end"]]
            if candidate.strip():
                risk_line = candidate
                break
        candidate = finding.get("draftSpan")
        if isinstance(candidate, str) and candidate in content:
            risk_line = candidate
            break
    if not risk_line:
        candidate_claims = extract_claims_pipeline(content, _passages_for_request(payload), payload.get("intent"))
        risk_line = next((claim["text"] for claim in candidate_claims if claim["verdict"] != "Supported"), "")
    if not risk_line and content:
        risk_line = re.split(r"[.!?\n]", content, maxsplit=1)[0].strip()

    high = bool(re.search(r"\b(best|only|fastest|leading|number one|#1)\b", risk_line, re.I))
    severity = "high" if high else "medium"
    reasons = {
        "regulatory": "An unsupported claim may breach advertising standards.",
        "brand": "The line may conflict with approved brand evidence.",
        "customer": "The line may create an expectation the source does not support.",
        "competitor": "The line may invite a comparative challenge.",
    }
    risks = [
        {"viewpoint": viewpoint, "riskLine": risk_line, "severity": severity, "reason": reason}
        for viewpoint, reason in reasons.items()
    ]
    return {"risks": risks, "highestRiskLine": risk_line}


@app.post("/image-check")
def image_check(payload: Dict[str, Any]) -> Dict[str, Any]:
    _require_fields(payload, "storageRef", "orgId")
    results = analyze_image(payload)
    return {"results": results, "message": "No image metadata provided." if not results else None}


@app.post("/detect-entities")
def detect_entities(payload: Dict[str, Any]) -> Dict[str, Any]:
    _require_fields(payload, "content", "orgId")
    content = str(payload.get("content", ""))
    watchlist = payload.get("watchlist") if isinstance(payload.get("watchlist"), list) else []
    entities = []
    for term in watchlist:
        if not isinstance(term, str) or not term.strip():
            continue
        for match in re.finditer(re.escape(term), content, re.IGNORECASE):
            entities.append(
                {
                    "text": match.group(0),
                    "type": "embargoed",
                    "isWatchlisted": True,
                    "span": {"start": match.start(), "end": match.end()},
                }
            )
    entities.sort(key=lambda entity: (entity["span"]["start"], entity["span"]["end"]))
    return {"entities": entities, "watchlistHits": len(entities)}
