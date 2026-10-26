"""
main.py - BrandGuard Preflight ML Service

Deterministic NLI engine for integration testing.
For the Stellara Brands returns-policy scenario, /extract-claims returns real
claim objects (Contradicted / Outdated / Supported) so the full pipeline
  draft -> claim extracted -> passage retrieved -> NLI verdict -> finding saved
can be validated end-to-end without any real ML model dependency.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, List, Optional
import re

app = FastAPI(
    title="BrandGuard Preflight ML Service",
    description=(
        "ML service: claim extraction, NLI fact-checking, "
        "matching, rewriting, pre-mortem, entity analysis"
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Stellara Brands in-memory knowledge base (simulates retrieved passages)
# ---------------------------------------------------------------------------
STELLARA_PASSAGES: List[Dict[str, Any]] = [
    {
        "passageId": "stellara-passage-001",
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
        "passageId": "stellara-passage-002",
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

# ---------------------------------------------------------------------------
# NLI engine - deterministic rules for the Stellara scenario
# ---------------------------------------------------------------------------

def _nli_verdict(claim_text: str, passage_text: str) -> Dict[str, Any]:
    """Minimal rule-based NLI covering the three Stellara claim types."""
    claim_lower = claim_text.lower()

    if any(kw in claim_lower for kw in ["best returns policy", "best return policy"]):
        return {
            "verdict": "Contradicted",
            "confidence": 0.94,
            "evidence": passage_text,
            "explanation": (
                "The uploaded source explicitly states that no comparison to competitor "
                "policies has been validated and does not support a 'best' superlative claim."
            ),
        }

    if "14-day" in claim_lower or "14 day" in claim_lower:
        return {
            "verdict": "Outdated",
            "confidence": 0.89,
            "evidence": passage_text,
            "explanation": (
                "The source document confirms the return window was extended to 30 days "
                "in Q1 2026. The 14-day figure is superseded."
            ),
        }

    if "free of charge" in claim_lower or "no hidden fees" in claim_lower:
        return {
            "verdict": "Supported",
            "confidence": 0.97,
            "evidence": passage_text,
            "explanation": (
                "Return processing at no cost to the customer is confirmed by the source."
            ),
        }

    return {
        "verdict": "Not Found",
        "confidence": 0.60,
        "evidence": "",
        "explanation": "No matching passage found in uploaded sources.",
    }


def _retrieve_passage(claim_text: str) -> Optional[Dict[str, Any]]:
    """Deterministic retrieval: pick the closest Stellara passage."""
    claim_lower = claim_text.lower()
    if "14-day" in claim_lower or "14 day" in claim_lower:
        return STELLARA_PASSAGES[1]
    return STELLARA_PASSAGES[0]


def _build_suggested_fix(span_text: str, verdict: str) -> str:
    s = span_text.lower()
    if verdict == "Supported":
        return ""
    if "best returns policy" in s or "best return policy" in s:
        return "We offer a 30-day returns policy, giving customers peace of mind."
    if "14-day return" in s or "14 day return" in s:
        return "Our 30-day return window is designed to be fair and hassle-free."
    return ""


def _build_meaning_check(
    original: str,
    suggested_fix: str,
    intent: Dict[str, Any],
) -> Dict[str, Any]:
    must_say: List[str] = intent.get("mustSay", [])
    original_lower = original.lower()
    fix_lower = suggested_fix.lower() if suggested_fix else ""

    kept: List[str] = []
    changed: List[str] = []
    dropped: List[str] = []

    for phrase in must_say:
        pl = phrase.lower()
        if pl in original_lower and pl in fix_lower:
            kept.append(phrase)
        elif pl in original_lower and pl not in fix_lower:
            dropped.append(phrase)

    if "best" in original_lower and suggested_fix:
        changed.append(f"'{original.strip()}' > '{suggested_fix.strip()}'")
    if "14-day" in original_lower and suggested_fix:
        changed.append("14-day > 30-day")

    return {"kept": kept, "changed": changed, "dropped": dropped}


def _detect_claims(content: str, intent: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Detects factual / compliance claims using pattern rules.
    Returns claim objects conforming to the mlOrchestrator schema.
    """
    claims: List[Dict[str, Any]] = []

    patterns = [
        (r"best returns? policy[^.]*", "violation", "rule.superlative.unqualified"),
        (r"14[-\s]day return[^.]*",    "violation", "rule.date.outdated"),
        (r"free of charge[^.]*",       "violation", "rule.cost.claim"),
    ]

    for pattern, finding_type, rule_id in patterns:
        match = re.search(pattern, content, re.IGNORECASE)
        if not match:
            continue

        span_text = match.group(0).strip()
        start = match.start()
        end = match.end()

        passage = _retrieve_passage(span_text)
        passage_text = passage["text"] if passage else ""

        nli = _nli_verdict(span_text, passage_text)
        suggested_fix = _build_suggested_fix(span_text, nli["verdict"])
        meaning_check = _build_meaning_check(span_text, suggested_fix, intent)

        claim: Dict[str, Any] = {
            "span":        {"start": start, "end": end},
            "type":        finding_type,
            "verdict":     nli["verdict"],
            "confidence":  nli["confidence"],
            "ruleId":      rule_id,
            "suggestedFix": suggested_fix,
            "meaningCheck": meaning_check,
        }
        claims.append(claim)

    return claims


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check() -> Dict[str, Any]:
    return {"status": "healthy", "service": "brandguard-ml"}


@app.get("/")
def root() -> Dict[str, Any]:
    return {"name": "BrandGuard Preflight ML API", "version": "1.0.0"}


@app.post("/extract-claims")
def extract_claims(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extracts compliance claims and runs NLI against the Stellara knowledge base.

    Request:  { content: str, orgId: str, intent: { purpose, audience, mustSay[] } }
    Response: { claims: Claim[] }
    """
    content: str = payload.get("content", "")
    intent: Dict[str, Any] = payload.get("intent", {})
    claims = _detect_claims(content, intent)
    return {"claims": claims}


@app.post("/match")
def match_passages(payload: Dict[str, Any]) -> Dict[str, Any]:
    claim_text: str = payload.get("claim", "")
    passage = _retrieve_passage(claim_text)
    matches = []
    if passage:
        matches.append({
            "passageId": passage["passageId"],
            "score": 0.91,
            "snippet": passage["text"][:200],
        })
    return {"matches": matches}


@app.post("/rewrite")
def rewrite_claim(payload: Dict[str, Any]) -> Dict[str, Any]:
    claim_text: str = payload.get("claim", "")
    verdict: str = payload.get("verdict", "Not Found")
    return {"suggestedFix": _build_suggested_fix(claim_text, verdict)}


@app.post("/premortem")
def premortem_check(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "risks": [
            {
                "viewpoint": "Regulator",
                "severity": "high",
                "reason": (
                    "Unverified superlative comparative claim may breach "
                    "ASA/ASCI advertising standards."
                ),
            },
            {
                "viewpoint": "Journalist",
                "severity": "medium",
                "reason": "Unsupported 'best' superlative is headline-worthy.",
            },
            {
                "viewpoint": "Competitor",
                "severity": "medium",
                "reason": "Could trigger a counter-claim or legal challenge.",
            },
            {
                "viewpoint": "Screen-Reader",
                "severity": "low",
                "reason": (
                    "Mark tag provides no accessible context for the highlighted claim."
                ),
            },
        ]
    }


@app.post("/image-check")
def image_check(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {"results": [], "message": "No images provided."}


@app.post("/detect-entities")
def detect_entities(payload: Dict[str, Any]) -> Dict[str, Any]:
    content: str = payload.get("content", "")
    entities = []
    if "stellara" in content.lower():
        entities.append({
            "text": "Stellara Brands",
            "label": "ORG",
            "start": 0,
            "end": 15,
        })
    return {"entities": entities}
