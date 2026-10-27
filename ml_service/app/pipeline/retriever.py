"""Organisation-scoped deterministic lexical retrieval."""

from datetime import date
import re
from typing import Any


EXCLUDED_STATUSES = {"expired", "deleted", "blocked", "superseded", "processing", "error"}


def _tokens(text: str) -> set[str]:
    tokens = set(re.findall(r"[a-z0-9]+", text.lower()))
    return {token[:-1] if token.endswith("s") and len(token) > 3 else token for token in tokens}


def _active(passage: dict[str, Any]) -> bool:
    if passage.get("status") in EXCLUDED_STATUSES:
        return False
    expiry = passage.get("expiryDate")
    if expiry:
        try:
            if date.fromisoformat(str(expiry)[:10]) < date.today():
                return False
        except ValueError:
            pass
    return True


def retrieve_passages(query: str, org_id: str, index: Any, top_k: int = 5) -> list[dict[str, Any]]:
    query_tokens = _tokens(query)
    if not query_tokens:
        return []
    matches = []
    for passage in index.passages_for_org(org_id):
        if not _active(passage):
            continue
        passage_tokens = _tokens(str(passage.get("text", "")))
        score = len(query_tokens & passage_tokens) / max(1, len(query_tokens))
        if score >= 0.20:
            matches.append({**passage, "score": score})
    matches.sort(key=lambda item: (-item["score"], item["passageId"]))
    return matches[:top_k]


def retrieve_passage(query: str, passages: list[dict[str, Any]], org_id: str | None = None) -> dict[str, Any] | None:
    """Compatibility retrieval for explicit test passages and controlled calls."""
    query_tokens = _tokens(query)
    matches = []
    for passage in passages:
        if org_id and passage.get("orgId") and str(passage.get("orgId")) != str(org_id):
            continue
        if passage.get("status") in {"deleted", "blocked"}:
            continue
        score = len(query_tokens & _tokens(str(passage.get("text", "")))) / max(1, len(query_tokens))
        if score >= 0.20:
            matches.append({**passage, "score": score})
    matches.sort(key=lambda item: (-item["score"], item.get("passageId", "")))
    return matches[0] if matches else None
