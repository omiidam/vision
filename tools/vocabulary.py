"""Vocabulary extraction: which words a section teaches, and where they come from.

The book marks the vocabulary of a section on the page itself, and it does so in more
than one way.  Two markings are recognised here, both of them properties of the printed
layout rather than a list of known words:

``word-bank``
    A panel of white lettering on a coloured background, set as a comma separated list
    of single words - the "Word Bank" badge printed above a Conversation.  White text can
    only have been laid over a coloured fill, which is what tells a badge apart from
    ordinary body text.

``glossary``
    The ``headword: definition`` entries of the New Words page, with their example
    sentences on the lines that follow.

Every section of every lesson goes through the same two checks, so a new lesson is
extracted by the same code with nothing to add here.  Nothing is invented: a word is
only registered when the book actually prints it as vocabulary.

Every word of a word bank is registered on its own, in the order the book prints it, and
each one keeps the section and page it was printed on.  Because the New Words &
Expressions page is the lesson's vocabulary page, it lists the lesson's word bank words
as well: separately, in that same order, together with its own glossary entries.  A word
therefore has two things worth telling apart, and both are recorded on every entry:

``section_id``
    the section that teaches the word - the word bank's own section.

``listed_in``
    the section whose vocabulary list the entry is written into.

The result is kept separate from the section text.  The words stay in the textbook text
exactly as printed - this module only records *which* of them the section teaches, and
where, so that the reader can show them without repeating itself.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace

#: White lettering is only ever read on top of a coloured panel, so it marks the
#: callouts (the word bank) rather than the running text.
CALLOUT_COLOR = 0xFFFFFF

#: A list item of the word bank is a single word.  Anything with a space inside it is a
#: label such as "for example", which introduces the passage instead of naming a word.
_ITEM_RE = re.compile(r"[A-Za-z][A-Za-z'\-]{0,28}")

#: A panel has to name at least this many words before it counts as a word bank, so a
#: stray comma in a heading cannot turn into vocabulary.
MIN_BANK_ITEMS = 2

#: The two ways the book marks vocabulary.
WORD_BANK = "word-bank"
GLOSSARY = "glossary"

#: The lesson's vocabulary page.  It lists the lesson's word bank words as well as its
#: own glossary entries.
NEW_WORDS_SECTION_ID = "new-words-and-expressions"

#: ``headword: definition`` as printed on the New Words page.
_HEADWORD_RE = re.compile(r"^([a-z][A-Za-z '\-]{0,28}):\s*(.*)$")

#: Lines that start a new exercise, so they end whatever entry was being read.
_SECTION_MARKER_RE = re.compile(r"^[A-Z]\.\s|^C\.\s")


@dataclass(order=True)
class Span:
    """One run of text on the page, with enough layout to recognise a callout.

    Ordered by position so that spans sort into reading order.
    """

    y: float
    x: float
    text: str
    font: str = ""
    size: float = 0.0
    color: int = 0


@dataclass
class VocabularyEntry:
    """One word a section teaches.

    Only ``word``, ``page``, ``source`` and ``section_id`` come from the book.  The
    remaining fields are the slots the reader will fill in later (Persian meaning,
    pronunciation, examples, audio); they are written empty rather than omitted so that
    the shape of a section's vocabulary does not change when they are filled.
    """

    word: str
    page: int
    source: str
    section_id: str
    position: int = 0
    meaning_en: str = ""
    examples: list[str] = field(default_factory=list)

    def as_json(self, grade: int, lesson_id: str, listed_in: str) -> dict:
        return {
            "word": self.word,
            "grade": grade,
            "lessonId": lesson_id,
            # The section that teaches the word, and the section listing it now.  They
            # differ for a word bank word listed on the New Words page.
            "sectionId": self.section_id,
            "listedIn": listed_in,
            "page": self.page,
            "position": self.position,
            "source": self.source,
            "meaningEn": self.meaning_en,
            "meaningFa": "",
            "pronunciation": "",
            "examples": list(self.examples),
            "audio": None,
        }


def _spans_on_page(page) -> list[Span]:
    """The page's text runs, in reading order."""
    found: list[Span] = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:                       # skip images
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"].strip()
                if not text:
                    continue
                found.append(
                    Span(
                        y=round(span["bbox"][1], 1),
                        x=round(span["bbox"][0], 1),
                        text=text,
                        font=span["font"],
                        size=float(span["size"]),
                        color=int(span["color"]),
                    )
                )
    found.sort()
    return found


def _callout_runs(page) -> list[str]:
    """The white callouts on a page, each returned as one joined string.

    Spans are grouped into a run while they share a typeface and sit on consecutive
    lines, which keeps one badge together and keeps two different badges apart.
    """
    spans = [s for s in _spans_on_page(page) if s.color == CALLOUT_COLOR]
    runs: list[list[Span]] = []
    for span in spans:
        if runs:
            previous = runs[-1][-1]
            if span.font == previous.font and span.y - previous.y <= span.size * 1.6:
                runs[-1].append(span)
                continue
        runs.append([span])
    return [" ".join(s.text for s in run) for run in runs]


def word_bank_items(run: str) -> list[str]:
    """The words named by one callout, in the order the book prints them.

    An item that is not a single word (a label such as "for example") is dropped, and
    the whole run is rejected unless it names at least two words.
    """
    if "," not in run:
        return []
    words: list[str] = []
    for piece in run.split(","):
        piece = piece.strip().strip(".").strip()
        if not piece or " " in piece:
            continue
        if _ITEM_RE.fullmatch(piece):
            words.append(piece)
    return words if len(words) >= MIN_BANK_ITEMS else []


def word_bank_entries(doc, page_range: tuple[int, int]) -> list[tuple[int, str]]:
    """The word bank printed on a section's pages, as ``(page, word)`` in reading order.

    The page number is the printed page, which is the same number the section's text and
    its audio are already keyed by.
    """
    found: list[tuple[int, str]] = []
    for printed_page in range(page_range[0], page_range[1] + 1):
        page = doc[printed_page - 1]
        for run in _callout_runs(page):
            for word in word_bank_items(run):
                found.append((printed_page, word))
    return found


def glossary_entries(lines: list[tuple[int, str]]) -> list[tuple[int, str, str, list[str]]]:
    """The ``headword: definition`` entries of a New Words page.

    Returns ``(page, headword, definition, examples)`` exactly as printed.  A numbered
    line continues the definition of the entry above it; any other line is an example.
    """
    entries: list[list] = []
    for page, line in lines:
        stripped = line.strip()
        if _SECTION_MARKER_RE.match(stripped):
            continue                                   # a new exercise ends the entry
        head = _HEADWORD_RE.match(stripped)
        if head:
            entries.append([page, head.group(1).strip(), head.group(2).strip(), []])
            continue
        if not entries:
            continue
        if re.match(r"^\d+\.\s", stripped):            # a numbered second sense
            entries[-1][2] = (entries[-1][2] + " " + stripped).strip()
        else:
            entries[-1][3].append(stripped)
    return [(page, word, meaning, examples) for page, word, meaning, examples in entries]


def entries_for_section(
    doc,
    section_id: str,
    page_range: tuple[int, int],
    lines: list[tuple[int, str]],
) -> list[VocabularyEntry]:
    """Every word the section itself teaches, however the book marks it."""
    found: list[VocabularyEntry] = []

    # One entry per word, in the order the word bank prints them.
    for page, word in word_bank_entries(doc, page_range):
        found.append(
            VocabularyEntry(
                word=word,
                page=page,
                source=WORD_BANK,
                section_id=section_id,
                position=len(found),
            )
        )

    if section_id == NEW_WORDS_SECTION_ID:
        for page, word, meaning, examples in glossary_entries(lines):
            found.append(
                VocabularyEntry(
                    word=word,
                    page=page,
                    source=GLOSSARY,
                    section_id=section_id,
                    position=len(found),
                    meaning_en=meaning,
                    examples=examples,
                )
            )
    return found


def _renumber(entries: list[VocabularyEntry]) -> list[VocabularyEntry]:
    """Number a list from zero, so ``position`` always describes the list it is in."""
    return [replace(entry, position=index) for index, entry in enumerate(entries)]


def listing_for_new_words(
    per_section: dict[str, list[VocabularyEntry]],
    section_order: list[str],
) -> list[VocabularyEntry]:
    """What the lesson's New Words & Expressions page lists.

    The New Words page is where a lesson keeps its vocabulary, so it lists the word bank
    words of every section of the lesson - separately, in the order the book prints them -
    followed by its own glossary entries.  Each word keeps the section and page it was
    printed on; only its position changes, to number this list.

    The word bank of a section is swept in once even when that section is the New Words
    page itself, so a word can never be listed twice.
    """
    word_bank = [
        entry
        for section_id in section_order
        for entry in per_section.get(section_id, [])
        if entry.source == WORD_BANK
    ]
    glossary = [
        entry for entry in per_section.get(NEW_WORDS_SECTION_ID, []) if entry.source == GLOSSARY
    ]
    return _renumber(word_bank + glossary)
