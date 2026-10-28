"""Organisation-scoped retrieval with FAISS semantic ranking and lexical fallback."""
from datetime import date
import re
from typing import Any

EXCLUDED_STATUSES = {"expired", "deleted", "blocked", "superseded", "processing", "error"}

def _tokens(text: str) -> set[str]:
    tokens = set(re.findall(r"[a-z0-9]+", text.lower()))
    return {token[:-1] if token.endswith("s") and len(token) > 3 else token for token in tokens}

def _active(passage: dict[str, Any], check_expiry: bool = True) -> bool:
    status = str(passage.get("status") or "ready").lower()
    if status in EXCLUDED_STATUSES:
        return False
    expiry = passage.get("expiryDate")
    if expiry:
        try:
            expiry_date = date.fromisoformat(str(expiry)[:10])
            if check_expiry and expiry_date < date.today():
                return False
        except ValueError:
            return False
    return True

def _lexical_search(query: str, passages: list[dict[str, Any]], top_k: int) -> list[dict[str, Any]]:
    query_tokens = _tokens(query)
    if not query_tokens:
        return []
    matches = []
    for passage in passages:
        passage_tokens = _tokens(str(passage.get("text", "")))
        score = len(query_tokens & passage_tokens) / max(1, len(query_tokens))
        if score >= 0.20:
            matches.append({**passage, "score": score, "retrievalMethod": "lexical"})
    matches.sort(key=lambda item: (-item["score"], str(item.get("passageId", ""))))
    return matches[:top_k]

def _search(query: str, passages: list[dict[str, Any]], top_k: int) -> list[dict[str, Any]]:
    from .semantic import rank_semantically
    semantic = rank_semantically(query, passages, top_k=top_k)
    return semantic if semantic is not None else _lexical_search(query, passages, top_k)

def retrieve_passages(query: str, org_id: str, index: Any, top_k: int = 5) -> list[dict[str, Any]]:
    """Retrieve only active, non-expired passages belonging to the requested org."""
    eligible = [p for p in index.passages_for_org(org_id) if _active(p)]
    return _search(query, eligible, top_k)

def retrieve_passage(query: str, passages: list[dict[str, Any]], org_id: str | None = None) -> dict[str, Any] | None:
    """Compatibility retrieval with lifecycle filtering and explicit Outdated support."""
    eligible = []
    for passage in passages:
        if org_id and passage.get("orgId") and str(passage.get("orgId")) != str(org_id):
            continue
        # Expired dates remain selectable only so the judge can issue Outdated;
        # expired/superseded lifecycle states are never treated as active evidence.
        if _active(passage, check_expiry=False):
            eligible.append(passage)
    matches = _search(query, eligible, 1)
    return matches[0] if matches else None
