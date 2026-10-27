"""Organisation-scoped deterministic lexical retrieval."""

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
    expiry = passage.get("expiryDate") if check_expiry else None
    if expiry:
        try:
            if date.fromisoformat(str(expiry)[:10]) < date.today():
                return False
        except ValueError:
            # Invalid expiry metadata must fail closed rather than treating stale
            # evidence as current.
            return False
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
    matches.sort(key=lambda item: (-item["score"], str(item.get("passageId", ""))))
    return matches[:top_k]


def retrieve_passage(query: str, passages: list[dict[str, Any]], org_id: str | None = None) -> dict[str, Any] | None:
    """Compatibility retrieval; applies the same lifecycle policy as indexed retrieval."""
    query_tokens = _tokens(query)
    matches = []
    for passage in passages:
        if org_id and passage.get("orgId") and str(passage.get("orgId")) != str(org_id):
            continue
        # Date-expired evidence may be selected only so judge_claim can return
        # an explicit Outdated verdict. Lifecycle states such as expired and
        # superseded are always excluded, so inactive material is never treated
        # as current evidence.
        if not _active(passage, check_expiry=False):
            continue
        score = len(query_tokens & _tokens(str(passage.get("text", "")))) / max(1, len(query_tokens))
        if score >= 0.20:
            matches.append({**passage, "score": score})
    matches.sort(key=lambda item: (-item["score"], str(item.get("passageId", ""))))
    return matches[0] if matches else None
