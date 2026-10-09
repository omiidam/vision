"""Tokenising of extracted textbook text into blocks, sentences and words.

The textbook lines are the canonical text.  This module only splits them - it never
rewrites, corrects or reorders them.
"""

from __future__ import annotations

import re

from textbook import WRAP_GAP

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

#: A speaker label at the start of a line, as the book prints it in a conversation.
_TURN_RE = re.compile(r"^[A-Z][A-Za-z.]{1,24}(?:\s[A-Z][A-Za-z.]{1,24})*:\s")


def _opens_a_turn(line: str) -> bool:
    """True for a line that begins with the name of who is speaking.

    A conversation gives every speaker their own paragraph, so a name followed by a
    colon starts a turn even when the line is long enough to run on from the one above.
    """
    return bool(_TURN_RE.match(line))


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


#: How far two rows' left edges may differ and still be one column of text.  A row the
#: book wrapped onto the line below starts at the same edge as the row it continues, give
#: or take the indent it sets that row with; the next item of a page is printed well
#: beside it, a column away.
COLUMN_TOLERANCE = 15.0

#: The shortest row, in characters, that can be a paragraph of running text on its own.
#: A row shorter than this is a label, a table cell or an exercise line, and is set out
#: as something of its own rather than as a sentence of the text around it.
MIN_STANDALONE_TEXT = 45


#: The shortest row above one that can be its continuation.  A row of a word or two is
#: a cell of a table or a label of a grid, and the row below it belongs to the cell under
#: it rather than to the line above; a sentence carries on only from a row with enough in
#: it to be running text.
MIN_WRAP_HEAD = 4


def build_blocks(
    lines: list[tuple], conversation: bool = False
) -> tuple[list[dict], list[str]]:
    """Group extracted page lines into displayable blocks.

    Returns ``(blocks, flat_tokens)``.  Each block is ``{"page", "lines"}`` where a block
    is one paragraph or one short exercise line, so the reader UI can lay it out the way
    the book does.

    ``conversation`` groups a dialogue by who is speaking rather than by line length:
    every turn is a block of its own, and a line the book wrapped onto the next row
    stays with the turn it belongs to however short that line is.  On a page of running
    text the rule is the opposite - a short line there is a line of its own, not the tail
    of the paragraph above it.

    A line may carry where it sits on the page, as ``(page, text, top, left)``.  Where it
    is given, it decides the grouping for a line the page did not make into an item of its
    own: a row a few points under the row above it, at the same left edge, with a sentence
    still running into it, is the book wrapping that paragraph onto the next line and it
    stays with it - however short the row is.  A row printed further down, or in another
    column, or after a sentence that has finished, starts the next block.  Without a
    position the length rule alone stands, which is how the shorter exercise lines were
    grouped before positions were read off the page.
    """
    flat: list[str] = []
    blocks: list[dict] = []
    current: dict | None = None
    previous_page: int | None = None
    # Where the row before the current one sits, so the next row can be told as a wrap of
    # it or as something the book printed apart.  ``None`` when no line has a position.
    last_top: float | None = None
    last_left: float | None = None

    for item in lines:
        if len(item) == 4:
            page, line, top, left = item
        else:
            page, line = item
            top = left = None
        tokens = tokenize_line(line)
        if not tokens:
            continue
        if conversation:
            # Only a change of speaker, or of page, opens the next block.
            starts_block = current is None or page != previous_page or _opens_a_turn(line)
        else:
            # A new page, a heading-like line, or an exercise marker starts a new block.
            heading = bool(re.match(r"^[A-Z][A-Za-z0-9 &/'-]{2,}$", line)) and len(line) < 60
            numbered = bool(re.match(r"^[A-Z]\.\s|^[a-z]\.\s|^\d+[-.\)]\s", line))
            if current is None or page != previous_page or heading or numbered:
                starts_block = True
            elif top is not None and last_top is not None:
                # Where the page puts each row is the whole of the decision: a row that
                # sits just under the one above, in the same column, with a sentence
                # still running into it, is the book wrapping that paragraph onto the
                # next line and stays with it however short the row is.  Every other row
                # - printed further down, in another column, or after a sentence that
                # has finished - is something of its own: a panel beside the text, an
                # exercise line, a cell of a table.
                wrapped = (
                    0 < top - last_top <= WRAP_GAP
                    and abs(left - last_left) <= COLUMN_TOLERANCE
                    and len(current["lines"][-1]) >= MIN_WRAP_HEAD
                    and not _SENTENCE_END.search(current["lines"][-1])
                )
                starts_block = not wrapped
            else:
                # No position to read: the row's own length is all that is left, a short
                # row being a label or an exercise line rather than running text.
                starts_block = len(line) < MIN_STANDALONE_TEXT
        if starts_block:
            current = {"page": page, "lines": [line], "tokens": list(tokens)}
            blocks.append(current)
        else:
            current["lines"].append(line)
            current["tokens"].extend(tokens)

        flat.extend(tokens)
        previous_page = page
        # The next row is read against this one: only a row with no position of its own
        # (a line from a view that reads its blocks off the page itself) leaves the
        # continuation rule without the geometry it needs, and falls back to length.
        last_top, last_left = top, left

    return blocks, flat
