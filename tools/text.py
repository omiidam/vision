"""Tokenising of extracted textbook text into blocks, sentences and words.

The textbook lines are the canonical text.  This module only splits them - it never
rewrites, corrects or reorders them.
"""

from __future__ import annotations

import re

# Characters that carry no meaning for alignment.
_STRIP = ".,;:!?\"'()[]{}«»…—–-/\\|@#$%^&*_+=<>~`“”"

_TOKEN_RE = re.compile(r"\S+")


def normalize_word(word: str) -> str:
    """Lower-case, drop surrounding punctuation, and fold the book's smart quotes."""
    word = word.strip().strip(_STRIP)
    word = word.replace("’", "'").replace("‘", "'")
    word = word.replace("“", '"').replace("”", '"')
    word = word.replace("–", "-").replace("—", "-")
    return word.lower()


def is_placeholder(token: str) -> bool:
    """Fill-in-the-blank dotted lines are not spoken, so they are not displayed as words."""
    return set(token) <= set(". _")


def tokenize_line(line: str) -> list[str]:
    """Split a textbook line into whitespace-separated words, punctuation attached."""
    out = []
    for raw in _TOKEN_RE.findall(line):
        if is_placeholder(raw):
            continue
        out.append(raw)
    return out


_SENTENCE_END = re.compile(r"[.!?…]['\")\]”’]*$")


def split_sentences(tokens: list[str]) -> list[tuple[int, int]]:
    """Group a flat token list into ``(start, end)`` sentence ranges."""
    sentences: list[tuple[int, int]] = []
    start = 0
    for index, token in enumerate(tokens):
        stripped = token.strip(_STRIP).strip()
        if not stripped:
            continue
        # A closing dot run such as "...?!" or "animals." ends the sentence.
        if _SENTENCE_END.search(token):
            sentences.append((start, index + 1))
            start = index + 1
    if start < len(tokens):
        sentences.append((start, len(tokens)))
    return sentences or [(0, len(tokens))]


def build_blocks(lines: list[tuple[int, str]]) -> tuple[list[dict], list[str]]:
    """Group extracted page lines into displayable blocks.

    Returns ``(blocks, flat_tokens)``.  Each block is ``{"page", "lines"}`` where a block
    is one paragraph or one short exercise line, so the reader UI can lay it out the way
    the book does.
    """
    flat: list[str] = []
    blocks: list[dict] = []
    current: dict | None = None
    previous_page: int | None = None

    for page, line in lines:
        tokens = tokenize_line(line)
        if not tokens:
            continue
        # A new page, a heading-like line, or an exercise marker starts a new block.
        heading = bool(re.match(r"^[A-Z][A-Za-z0-9 &/'-]{2,}$", line)) and len(line) < 60
        numbered = bool(re.match(r"^[A-Z]\.\s|^[a-z]\.\s|^\d+[-.\)]\s", line))
        starts_block = (
            current is None
            or page != previous_page
            or heading
            or numbered
            or len(line) < 45
        )
        if starts_block:
            current = {"page": page, "lines": [line], "tokens": list(tokens)}
            blocks.append(current)
        else:
            current["lines"].append(line)
            current["tokens"].extend(tokens)

        flat.extend(tokens)
        previous_page = page

    return blocks, flat
