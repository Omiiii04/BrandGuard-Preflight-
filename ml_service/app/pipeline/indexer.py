"""Durable, deterministic lexical source index."""

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any


MAX_PASSAGE_CHARS = 600


def _chunks(text: str) -> list[str]:
    chunks = []
    for block in re.split(r"\n\s*\n", text):
        remaining = block.strip()
        while remaining:
            if len(remaining) <= MAX_PASSAGE_CHARS:
                chunks.append(remaining)
                break
            cut = remaining.rfind(" ", 0, MAX_PASSAGE_CHARS + 1)
            cut = cut if cut > 0 else MAX_PASSAGE_CHARS
            chunks.append(remaining[:cut].rstrip())
            remaining = remaining[cut:].lstrip()
    return chunks


def split_passages(document: dict[str, Any], source: dict[str, Any]) -> list[dict[str, Any]]:
    """Split parsed pages and retain source identity separately from passage identity."""
    passages = []
    for page in document.get("pages", []):
        for chunk_index, text in enumerate(_chunks(str(page.get("text", "")))):
            if not text:
                continue
            identity = "\x00".join(
                str(value) for value in (
                    source.get("orgId", ""), source.get("sourceId", ""),
                    source.get("version", "1.0"), page.get("page"), chunk_index, text,
                )
            )
            passages.append({
                "passageId": hashlib.sha256(identity.encode("utf-8")).hexdigest(),
                "sourceId": str(source.get("sourceId", "")),
                "orgId": str(source.get("orgId", "")),
                "fileName": source.get("fileName", document.get("fileName", "")),
                "page": page.get("page"),
                "version": str(source.get("version", "1.0")),
                "expiryDate": source.get("expiryDate"),
                "ownerName": source.get("ownerName", ""),
                "status": source.get("status", "ready"),
                "text": text,
            })
    return passages


class PersistentLexicalIndex:
    def __init__(self, root: str | os.PathLike[str]):
        self.root = Path(root)
        self.path = self.root / "passages.json"
        self.root.mkdir(parents=True, exist_ok=True)
        self._state = self._load()

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"version": 1, "passages": []}
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                state = json.load(handle)
            if not isinstance(state, dict) or not isinstance(state.get("passages"), list):
                raise ValueError("invalid index structure")
            return state
        except (OSError, json.JSONDecodeError, ValueError) as error:
            raise RuntimeError(f"INDEX_LOAD_FAILED: {error}") from error

    def _save(self) -> None:
        fd, temporary = tempfile.mkstemp(prefix="passages-", suffix=".json", dir=self.root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(self._state, handle, ensure_ascii=False, indent=2)
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def ingest(self, document: dict[str, Any], source: dict[str, Any]) -> list[dict[str, Any]]:
        org_id = str(source.get("orgId", ""))
        source_id = str(source.get("sourceId", ""))
        self._state["passages"] = [
            passage for passage in self._state["passages"]
            if not (str(passage.get("orgId")) == org_id and str(passage.get("sourceId")) == source_id)
        ]
        passages = split_passages(document, source)
        self._state["passages"].extend(passages)
        self._save()
        return passages

    def passages_for_org(self, org_id: str) -> list[dict[str, Any]]:
        return [p for p in self._state["passages"] if str(p.get("orgId")) == str(org_id)]
