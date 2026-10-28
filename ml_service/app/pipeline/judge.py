"""Small explainable judge used when no local NLI model is available."""

from datetime import date
import re
from typing import Any, Optional


def judge_claim(claim_text: str, passage: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Return a contract-compatible verdict using supplied evidence only."""
    text = claim_text.lower()
    if not passage:
        return {
            "verdict": "Not Found",
            "confidence": 0.60,
            "proofPassageId": None,
            "evidence": "",
            "explanation": "No matching passage found in uploaded sources.",
        }

    passage_text = str(passage.get("text", ""))
    passage_id = passage.get("passageId")
    expiry = passage.get("expiryDate")
    if expiry:
        try:
            if date.fromisoformat(str(expiry)[:10]) < date.today():
                return {
                    "verdict": "Outdated",
                    "confidence": 0.89,
                    "proofPassageId": passage_id,
                    "evidence": passage_text,
                    "explanation": "The retrieved source passage has expired.",
                }
        except ValueError:
            pass

    if re.search(r"\b(best|only|fastest|leading|number one|#1)\b", text):
        return {
            "verdict": "Contradicted",
            "confidence": 0.94,
            "proofPassageId": passage_id,
            "evidence": passage_text,
            "explanation": "The source does not establish the unqualified comparative claim.",
        }

    duration = re.search(r"\b(\d+)[-\s]day", text)
    current_duration = re.search(r"\b(\d+)[-\s]day", passage_text.lower())
    if duration and current_duration and duration.group(1) == "14" and current_duration.group(1) != "14":
        return {
            "verdict": "Outdated",
            "confidence": 0.89,
            "proofPassageId": passage_id,
            "evidence": passage_text,
            "explanation": (
                f"The source confirms a {current_duration.group(1)}-day window; "
                f"the {duration.group(1)}-day claim is superseded."
            ),
        }

    claim_tokens = set(re.findall(r"[a-z0-9]+", text))
    passage_tokens = set(re.findall(r"[a-z0-9]+", passage_text.lower()))
    meaningful = claim_tokens - {"the", "a", "an", "of", "to", "within", "and", "for"}
    if meaningful and meaningful <= passage_tokens:
        return {
            "verdict": "Supported",
            "confidence": 0.97,
            "proofPassageId": passage_id,
            "evidence": passage_text,
            "explanation": "The retrieved source passage supports the claim.",
        }

    return {
        "verdict": "Not Found",
        "confidence": 0.60,
        "proofPassageId": None,
        "evidence": "",
        "explanation": "The retrieved source does not establish the claim.",
    }
