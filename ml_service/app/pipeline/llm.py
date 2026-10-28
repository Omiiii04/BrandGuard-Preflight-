"""Guarded OpenAI-compatible LLM calls for rewrites and premortems."""
from __future__ import annotations
import json
import logging
import os
import re
from typing import Any
import requests

_LOG = logging.getLogger(__name__)
_MAX_CONTENT_CHARS = 40_000
_REQUIRED_VIEWPOINTS = {"regulatory", "brand", "customer", "competitor"}

def _chat_json(system_prompt: str, user_payload: dict[str, Any]) -> dict[str, Any] | None:
    base = os.getenv("LLM_BASE_URL", "").strip().rstrip("/")
    model = os.getenv("LLM_MODEL", "").strip()
    if not base or not model:
        return None
    if base.endswith("/chat/completions"):
        endpoint = base
    elif base.endswith("/v1"):
        endpoint = base + "/chat/completions"
    else:
        endpoint = base + "/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    api_key = os.getenv("LLM_API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    try:
        response = requests.post(
            endpoint, headers=headers,
            json={
                "model": model,
                "temperature": float(os.getenv("LLM_TEMPERATURE", "0.1")),
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
                ],
            },
            timeout=max(1.0, min(float(os.getenv("LLM_TIMEOUT_SECONDS", "12")), 45.0)),
        )
        response.raise_for_status()
        body = response.json()
        text = body["choices"][0]["message"]["content"]
        if isinstance(text, list):
            text = "".join(item.get("text", "") for item in text if isinstance(item, dict))
        text = str(text).strip()
        marker = chr(96) * 3
        if text.startswith(marker):
            text = text[len(marker):]
            if text[:4].lower() == "json":
                text = text[4:]
            text = text.removesuffix(marker).strip()
        value = json.loads(text)
        return value if isinstance(value, dict) else None
    except (requests.RequestException, ValueError, KeyError, TypeError, IndexError) as error:
        _LOG.warning("LLM suggestion unavailable; using deterministic fallback (%s)", type(error).__name__)
        return None

def _meaning_preserved(original: str, rewrite: str, intent: dict[str, Any] | None) -> bool:
    if not rewrite.strip() or len(rewrite) > 2000:
        return False
    must_say = (intent or {}).get("mustSay", [])
    if not isinstance(must_say, list):
        return True
    lowered = rewrite.casefold()
    for phrase in must_say:
        if isinstance(phrase, str) and phrase.strip() and phrase.casefold() in original.casefold():
            if phrase.casefold() not in lowered:
                return False
    return True

def generate_rewrite(
    claim_text: str,
    verdict: str,
    rule_id: str | None = None,
    original_text: str | None = None,
    intent: dict[str, Any] | None = None,
    evidence_text: str = "",
) -> str | None:
    """Generate a restrained rewrite; return None when config or validation fails."""
    original = (original_text or claim_text or "")[:_MAX_CONTENT_CHARS]
    result = _chat_json(
        "You are a compliance editor. Return JSON only: {\"rewrittenText\": string, \"rationale\": string}. "
        "Rewrite only the provided claim. Do not introduce a new number, date, price, guarantee, comparison, "
        "or factual promise unless directly supported by supplied evidence. Prefer cautious, plain language. "
        "Preserve every mustSay phrase that appears in the original. If the claim cannot be safely rewritten, "
        "return an empty rewrittenText.",
        {
            "claim": (claim_text or "")[:4000],
            "originalText": original,
            "verdict": verdict,
            "ruleId": rule_id,
            "intent": intent or {},
            "approvedEvidence": (evidence_text or "")[:8000],
        },
    )
    if not result:
        return None
    rewrite = result.get("rewrittenText")
    if not isinstance(rewrite, str):
        return None
    rewrite = re.sub(r"\s+", " ", rewrite).strip().strip('"')
    if not _meaning_preserved(original, rewrite, intent):
        _LOG.warning("LLM rewrite rejected because it removed a required phrase or was empty")
        return None
    return rewrite or None

def generate_premortem(
    content: str,
    findings: list[dict[str, Any]],
    risk_line: str,
) -> dict[str, Any] | None:
    result = _chat_json(
        "You are a cautious pre-publication compliance reviewer. Return JSON only with keys "
        "{\"risks\":[{\"viewpoint\": string, \"riskLine\": string, \"severity\": \"low|medium|high\", "
        "\"reason\": string}], \"highestRiskLine\": string}. Provide exactly four distinct viewpoints: "
        "regulatory, brand, customer, competitor. Tie each risk to supplied text/evidence; do not state "
        "that a law was violated unless the input establishes it. Never invent a citation.",
        {
            "content": (content or "")[:_MAX_CONTENT_CHARS],
            "findings": findings[:50],
            "candidateRiskLine": (risk_line or "")[:2000],
        },
    )
    if not result or not isinstance(result.get("risks"), list):
        return None
    risks = result["risks"]
    if len(risks) != 4:
        return None
    viewpoints = set()
    validated = []
    for item in risks:
        if not isinstance(item, dict):
            return None
        viewpoint = item.get("viewpoint")
        severity = item.get("severity")
        reason = item.get("reason")
        line = item.get("riskLine")
        if viewpoint not in _REQUIRED_VIEWPOINTS or viewpoint in viewpoints:
            return None
        if severity not in {"low", "medium", "high"}:
            return None
        if not all(isinstance(value, str) and value.strip() for value in (reason, line)):
            return None
        viewpoints.add(viewpoint)
        validated.append({
            "viewpoint": viewpoint, "riskLine": line[:2000],
            "severity": severity, "reason": reason[:1500],
        })
    if viewpoints != _REQUIRED_VIEWPOINTS:
        return None
    highest = result.get("highestRiskLine")
    if not isinstance(highest, str) or not highest.strip():
        highest = risk_line
    return {"risks": validated, "highestRiskLine": highest[:2000], "generationMethod": "llm"}
