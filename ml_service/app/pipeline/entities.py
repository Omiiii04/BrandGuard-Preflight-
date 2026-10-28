"""Named-entity recognition with spaCy and deterministic watchlist matching."""
from __future__ import annotations
import logging
import os
import re
from typing import Any

_LOG = logging.getLogger(__name__)
_NLP = None
_NLP_MODEL_NAME = None
_NLP_ATTEMPTED = False

def _load_nlp():
    global _NLP, _NLP_MODEL_NAME, _NLP_ATTEMPTED
    name = os.getenv("SPACY_MODEL", "en_core_web_sm")
    if _NLP is not None and _NLP_MODEL_NAME == name:
        return _NLP
    if _NLP_ATTEMPTED and _NLP_MODEL_NAME == name:
        return None
    _NLP_ATTEMPTED, _NLP_MODEL_NAME = True, name
    try:
        import spacy
        _NLP = spacy.load(name, disable=["parser", "lemmatizer"])
        return _NLP
    except (ImportError, OSError) as error:
        _LOG.info("spaCy model unavailable; watchlist-only entity detection (%s)", type(error).__name__)
        _NLP = None
        return None

def detect_entities(content: str, watchlist: list[Any] | None = None) -> dict[str, Any]:
    """Return character-offset entities and watchlist hits without inventing spans."""
    content = content or ""
    by_span: dict[tuple[int, int, str], dict[str, Any]] = {}
    nlp = _load_nlp()
    if nlp is not None and content.strip():
        doc = nlp(content[:200_000])
        label_types = {
            "PERSON": "person", "ORG": "organization", "GPE": "location",
            "LOC": "location", "PRODUCT": "product", "EVENT": "event",
            "DATE": "date", "MONEY": "money", "PERCENT": "percentage",
        }
        for entity in doc.ents:
            if entity.label_ not in label_types:
                continue
            item = {
                "text": entity.text, "type": label_types[entity.label_],
                "label": entity.label_, "isWatchlisted": False,
                "span": {"start": entity.start_char, "end": entity.end_char},
            }
            by_span[(entity.start_char, entity.end_char, entity.text.casefold())] = item
    watchlist_hits = 0
    for term in watchlist or []:
        if not isinstance(term, str) or not term.strip():
            continue
        for match in re.finditer(re.escape(term.strip()), content, re.IGNORECASE):
            watchlist_hits += 1
            key = (match.start(), match.end(), match.group(0).casefold())
            existing = by_span.get(key)
            if existing:
                existing["isWatchlisted"] = True
                existing["watchlistTerm"] = term
                existing["type"] = "embargoed"
            else:
                by_span[key] = {
                    "text": match.group(0), "type": "embargoed",
                    "isWatchlisted": True, "watchlistTerm": term,
                    "span": {"start": match.start(), "end": match.end()},
                }
    entities = sorted(by_span.values(), key=lambda item: (item["span"]["start"], item["span"]["end"], item["text"]))
    return {
        "entities": entities,
        "watchlistHits": watchlist_hits,
        "engine": "spacy+watchlist" if nlp is not None else "watchlist-fallback",
    }
