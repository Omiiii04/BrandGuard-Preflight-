"""Claim extraction and deterministic evidence selection."""

from typing import Any, Iterable, Optional
import re

from .judge import judge_claim
from .retriever import retrieve_passage

SUPERLATIVE_RE = re.compile(
    r"\b(?:best|only|fastest|leading|number one|#1)\b[^.!?,;:\n]*?"
    r"(?=\s+(?:for|with|and|to|of)\b|[.!?,;:\n]|$)",
    re.IGNORECASE,
)
DURATION_RE = re.compile(
    r"\b(?:within\s+)?\d+[-\s]days?(?:\s+of\s+(?:the\s+)?delivery(?:\s+date)?)?",
    re.IGNORECASE,
)
PERCENT_RE = re.compile(r"\b\d+(?:\.\d+)?%")
PRICE_RE = re.compile(r"(?:[$€£₹]\s?\d+(?:[,.]\d{3})*(?:\.\d{1,2})?)")
DATE_RE = re.compile(
    r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b",
    re.IGNORECASE,
)


def meaning_check(original: str, suggested_fix: str, intent: Optional[dict[str, Any]]) -> dict[str, list[str]]:
    must_say = (intent or {}).get("mustSay", [])
    if not isinstance(must_say, list):
        must_say = []
    original_lower = original.lower()
    fix_lower = suggested_fix.lower()
    kept, changed, dropped = [], [], []
    for phrase in must_say:
        if not isinstance(phrase, str) or not phrase.strip():
            continue
        normalized = phrase.lower().strip()
        in_original = normalized in original_lower
        in_fix = normalized in fix_lower
        if in_original and in_fix:
            kept.append(phrase)
        elif in_original and not in_fix:
            dropped.append(phrase)
        elif in_fix and not in_original:
            changed.append(phrase)
    return {"kept": kept, "changed": changed, "dropped": dropped}


def suggested_fix(claim_text: str, verdict: str) -> str:
    if verdict == "Supported":
        return ""
    if re.search(r"\b(best|only|fastest|leading|number one|#1)\b", claim_text, re.I):
        return "We offer a 30-day returns policy."
    if re.search(r"\b14[-\s]day", claim_text, re.I):
        return "Our 30-day return window applies to eligible items."
    return ""


def extract_claims(
    content: str,
    passages: Iterable[dict[str, Any]],
    intent: Optional[dict[str, Any]] = None,
    org_id: Optional[str] = None,
    banned_terms: Optional[Iterable[str]] = None,
    image_context: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    candidates: list[tuple[int, int, str, str]] = []

    for match in SUPERLATIVE_RE.finditer(content):
        candidates.append((match.start(), match.end(), match.group(0).strip(), "rule.superlative.unqualified"))
    for pattern, rule_id in (
        (DURATION_RE, "rule.date.return-window"),
        (PERCENT_RE, "rule.quantitative.percentage"),
        (PRICE_RE, "rule.quantitative.price"),
        (DATE_RE, "rule.quantitative.date"),
    ):
        for match in pattern.finditer(content):
            candidates.append((match.start(), match.end(), match.group(0).strip(), rule_id))

    for term in banned_terms or []:
        if not isinstance(term, str) or not term:
            continue
        for match in re.finditer(re.escape(term), content, re.IGNORECASE):
            candidates.append((match.start(), match.end(), match.group(0), "rule.banned-term"))

    if image_context is not None and not str(image_context.get("altText", "")).strip():
        candidates.append((0, 0, "", "rule.accessibility.alt-text"))

    unique: dict[tuple[int, int, str], tuple[int, int, str, str]] = {}
    for candidate in candidates:
        unique[(candidate[0], candidate[1], candidate[2].lower())] = candidate

    claims = []
    for start, end, span_text, rule_id in sorted(unique.values(), key=lambda item: (item[0], item[1])):
        passage = None
        if rule_id == "rule.banned-term" or rule_id == "rule.accessibility.alt-text":
            judged = {
                "verdict": "Contradicted",
                "confidence": 1.0,
                "proofPassageId": None,
                "evidence": "",
                "explanation": "The supplied guideline rule was violated.",
            }
        else:
            passage = retrieve_passage(span_text, passages, org_id)
            if rule_id == "rule.superlative.unqualified" and not passage:
                judged = {
                    "verdict": "Contradicted",
                    "confidence": 1.0,
                    "proofPassageId": None,
                    "evidence": "",
                    "explanation": "An unqualified superlative is not permitted without substantiation.",
                }
            else:
                judged = judge_claim(span_text, passage)
        proof_source_id = None
        if judged["proofPassageId"]:
            proof_source_id = (passage or {}).get("sourceId") or judged["proofPassageId"]
        fix = suggested_fix(span_text, judged["verdict"])
        evidence = None
        if passage and judged["proofPassageId"]:
            evidence = {
                "passageId": str(passage.get("passageId", "")),
                "sourceId": str(passage.get("sourceId", "")) if passage.get("sourceId") else None,
                "fileName": passage.get("fileName", ""),
                "page": passage.get("page"),
                "version": passage.get("version", ""),
                "expiryDate": passage.get("expiryDate"),
                "ownerName": passage.get("ownerName", ""),
                "passage": passage.get("text", ""),
            }
        claims.append(
            {
                "text": span_text,
                "span": {"start": start, "end": end},
                "type": "violation" if judged["proofPassageId"] else "question",
                "verdict": judged["verdict"],
                "confidence": judged["confidence"],
                "ruleId": rule_id,
                "proofPassageId": proof_source_id,
                "suggestedFix": fix,
                "meaningCheck": meaning_check(span_text, fix, intent),
                "explanation": judged["explanation"],
                "evidence": evidence,
            }
        )
    return claims
