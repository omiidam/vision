"""The Persian meanings of the vocabulary, and the rules that keep them honest.

The book does not carry the Persian half of its vocabulary page into the PDF - there is no
Persian text layer at all - so these meanings are the one part of the content tree that is
written by a person rather than read off the page.  That makes them easy to let rot: a word
the book stops printing would keep its meaning here forever, attached to nothing.

So the glossary is keyed by the words exactly as the book prints them and is checked both
ways against what the extractor actually found.  A key the book no longer prints is stale
and stops the build; a printed word with no key is reported, so a lesson added later says
what it is missing instead of quietly shipping empty meanings.
"""

from __future__ import annotations

import json
from pathlib import Path

#: The curated meanings, one file for the whole book.
GLOSSARY = Path(__file__).resolve().parent / "meanings_fa.json"


def _load() -> dict:
    with GLOSSARY.open(encoding="utf-8") as handle:
        raw = json.load(handle)
    # `_about` is the file's own note to a reader; it is not a grade.
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def meaning_for(grade: str, lesson_id: str, word: str) -> str:
    """The Persian meaning of one word, or the empty string when there is none."""
    return _load().get(grade, {}).get(lesson_id, {}).get(word, "")


def check(grade: str, lesson_id: str, printed: list[str]) -> tuple[list[str], list[str]]:
    """Compare the glossary against the words the book actually printed.

    Returns ``(missing, stale)``: printed words with no meaning, and meanings for words the
    book no longer prints.  Both are the caller's problem, and in different ways - `missing`
    is a gap to fill, `stale` is a mistake to delete.
    """
    keys = set(_load().get(grade, {}).get(lesson_id, {}))
    printed_set = set(printed)
    missing = [w for w in printed if w not in keys]
    stale = sorted(keys - printed_set)
    return missing, stale
