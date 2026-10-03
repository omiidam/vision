"""Vocabulary extraction: which words a lesson teaches, and where the book prints them.

The book marks vocabulary on the page itself, and it does so in three ways, all of them
properties of the printed layout rather than a list of known words:

``word-bank``
    A panel of white lettering on a coloured background, set as a comma separated list
    of single words - the "Word Bank" badge printed beside a Conversation.  White text
    can only have been laid over a coloured fill, which is what tells a badge apart from
    ordinary body text.

``practice``
    A word set in bold and in a colour of its own, sitting inside a sentence, on a
    practice part of the vocabulary page.  The book prints the sentence and points at the
    word in it.

``glossary``
    The ``headword: definition`` entries of the vocabulary page, with the example
    sentences printed under them.

The vocabulary page itself is split into the parts it is printed in - the book marks each
one with a lettered heading such as "A. Look, Read and Practice." - and a part teaches
words in whichever of the two ways fits it: a part that prints headwords is a glossary,
and a part that only prints sentences with the target words picked out is a practice
part.  A part that teaches no words at all is a pointer to somewhere else, such as an
exercise in the workbook, and is not part of the reader's vocabulary page.

So the vocabulary a lesson is taught is read the same way for every lesson: the word
banks of its sections, and the parts of its vocabulary page that teach words.  A lesson
added later is read by the same code with nothing to add here.  Nothing is invented: a
word is only registered when the book actually prints it as vocabulary.

Every word of a word bank is registered on its own, in the order the book prints it, and
each entry keeps the section and page it was printed on.  Because the vocabulary page is
where a lesson collects its words, it carries them together with its own parts.  Two
things are therefore worth telling apart, and both are recorded on every entry:

``section_id``
    the section the word was printed in, which is where it came from.

``listed_in``
    the section whose vocabulary list the entry is written into.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace

import textbook as book

#: White lettering is only ever read on top of a coloured panel, so it marks the
#: callouts (the word bank) rather than the running text.
CALLOUT_COLOR = 0xFFFFFF

#: The colour the book's running text is set in.  A word the book is pointing at is set
#: in bold and in some other colour.
BODY_COLOR = 0x231F20

#: A list item of the word bank is a single word.  Anything with a space inside it is a
#: label such as "for example", which introduces the passage instead of naming a word.
_ITEM_RE = re.compile(r"[A-Za-z][A-Za-z'\-]{0,28}")

#: A panel has to name at least this many words before it counts as a word bank, so a
#: stray comma in a heading cannot turn into vocabulary.
MIN_BANK_ITEMS = 2

#: The three ways the book marks vocabulary.
WORD_BANK = "word-bank"
PRACTICE = "practice"
GLOSSARY = "glossary"

#: The lesson's vocabulary page.  It lists the lesson's word bank words as well as its
#: own parts.
NEW_WORDS_SECTION_ID = "new-words-and-expressions"

#: The group the word bank words are listed under, after the page's own parts.
WORD_BANK_PART = WORD_BANK
WORD_BANK_PART_TITLE = "Word Bank"

#: A lettered heading that opens a part of the vocabulary page, such as
#: "A. Look, Read and Practice.".
_PART_MARKER_RE = re.compile(r"^([A-Z])\.\s+(.+[.!?])$")

#: ``headword: definition`` as printed on the vocabulary page.
_HEADWORD_RE = re.compile(r"^([a-z][A-Za-z '\-]{0,28}):\s*(.*)$")

#: A line that continues the definition of the headword above it, rather than opening a
#: new entry.
_NUMBERED_SENSE_RE = re.compile(r"^\d+\.\s")

#: The punctuation a sentence leaves on the end of the word before it.  The book prints
#: the word and the full stop in one go, so the stop belongs to the sentence.
_TRAILING_PUNCTUATION = ".,;:!?"

#: The rows of one picture caption stand about one line of leading apart, while the next
#: picture of the page starts a whole caption lower down.  The gap between two rows of
#: the same caption is therefore a printed line, and anything larger opens a new one.
#: The gap is also never zero: the row printed beside this one in the other column sits
#: on almost the same height, and the two are captions of their own.
CAPTION_GAP = 30.0

#: How far sideways a wrapped row may sit from the row it continues.  A caption is set
#: in one column and its rows line up with it; the caption in the column beside it is
#: much further away than this, so the two are never mistaken for one.
CAPTION_INDENT = 60.0

#: How far apart two rows may sit and still be one printed row.  A page of pictures sets
#: the captions beside each other on the same row, so this is the whole of the difference
#: between a row the book prints two items on and the next row down.
SAME_ROW_GAP = 6.0

#: The two ways the book lays out the parts of a vocabulary page.
GRID = "grid"
LIST = "list"


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
class Line:
    """A printed line, with the words the book picks out inside it.

    ``x`` and ``y`` are where the book prints it, in points from the top left of the
    page.  They are what says which lines belong to the same picture caption, and that
    is a fact about the printed page rather than about the words: a caption is a block
    of rows, and the next caption is the picture below it.
    """

    page: int
    text: str
    highlights: list[str] = field(default_factory=list)
    x: float = 0.0
    y: float = 0.0

    def as_text(self) -> tuple[int, str]:
        return (self.page, self.text)


@dataclass
class Part:
    """One lettered part of the vocabulary page."""

    letter: str
    title: str
    #: The heading exactly as printed, e.g. "A. Look, Read and Practice.".
    heading: str = ""
    lines: list[Line] = field(default_factory=list)
    entries: list["VocabularyEntry"] = field(default_factory=list)

    @property
    def key(self) -> str:
        return self.letter.lower()


@dataclass
class VocabularyEntry:
    """One word a lesson teaches.

    Only ``word``, ``page``, ``source`` and ``section_id`` come from the book, together
    with the part of the page the word was found in.  The remaining fields are the slots
    the reader will fill in later (Persian meaning, pronunciation, examples, audio); they
    are written empty rather than omitted so that the shape of a section's vocabulary does
    not change when they are filled.
    """

    word: str
    page: int
    source: str
    section_id: str
    part: str = WORD_BANK
    part_title: str = WORD_BANK_PART_TITLE
    position: int = 0
    meaning_en: str = ""
    examples: list[str] = field(default_factory=list)

    def as_json(self, grade: int, lesson_id: str, listed_in: str) -> dict:
        return {
            "word": self.word,
            "grade": grade,
            "lessonId": lesson_id,
            # The section the word was printed in, and the section listing it now.  A
            # word bank word is printed in one section and listed on the lesson's
            # vocabulary page, so the two are usually different.
            "sectionId": self.section_id,
            "listedIn": listed_in,
            "page": self.page,
            "position": self.position,
            "source": self.source,
            "part": self.part,
            "partTitle": self.part_title,
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
    """The word bank printed on some pages, as ``(page, word)`` in reading order.

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


def _is_highlight(span: dict) -> bool:
    """True for a word the book is pointing at: set in bold and in a colour of its own."""
    return "bold" in span["font"].lower() and span["color"] not in (BODY_COLOR, CALLOUT_COLOR)


def page_lines(doc, page_range: tuple[int, int]) -> list[Line]:
    """The pages' lines in reading order, each carrying the words picked out inside it.

    The text is the reader's own page text, so filtering these lines keeps the audio
    alignment intact.

    Every word the book prints in its own colour is recorded, whether or not running text
    sits beside it.  A caption can be a whole line of the new expression - the book's
    "Pay attention!" over a picture is one - and that expression is the target of the
    caption, exactly as a word picked out inside a sentence is.  What is not a word is
    told apart where the words are collected, not here: a part heading opens a part and
    the letter it is headed by is the heading's, so it is left out of that part's words.
    """
    lines: list[Line] = []
    for printed_page in range(page_range[0], page_range[1] + 1):
        for text, spans in book.page_rows(doc, printed_page):
            lines.append(
                Line(
                    page=printed_page,
                    text=text,
                    highlights=[
                        s["text"].strip().strip(_TRAILING_PUNCTUATION).strip()
                        for s in spans
                        if _is_highlight(s)
                        and s["text"].strip().strip(_TRAILING_PUNCTUATION).strip()
                    ],
                    x=min((s["bbox"][0] for s in spans), default=0.0),
                    y=min((s["bbox"][1] for s in spans), default=0.0),
                )
            )
    return lines


def split_parts(lines: list[Line]) -> list[Part]:
    """Split the printed lines into the lettered parts they belong to.

    Lines before the first lettered heading are kept in a part of their own, so no text
    is dropped.
    """
    parts: list[Part] = []
    current = Part(letter="", title="")

    def opened(part: Part) -> bool:
        """True for a part that carries a heading or any text of its own."""
        return bool(part.letter or part.lines)

    for line in lines:
        marker = _PART_MARKER_RE.match(line.text)
        if marker:
            # Anything printed before the first lettered heading is a part of its own, and
            # it is kept: a page that opens with words rather than a heading still teaches
            # them, and they are the first thing the page shows.
            if opened(current):
                parts.append(current)
            current = Part(
                letter=marker.group(1),
                title=marker.group(2).strip(),
                heading=line.text,
            )
            continue
        current.lines.append(line)
    if opened(current):
        parts.append(current)
    return parts


def _renumber(entries: list[VocabularyEntry]) -> list[VocabularyEntry]:
    """Number a list from zero, so ``position`` always describes the list it is in."""
    return [replace(entry, position=index) for index, entry in enumerate(entries)]


def _glossary_groups(lines: list[Line]) -> list[list[Line]]:
    """The printed entries of a glossary part, each with the lines printed under it.

    A ``headword: definition`` line opens an entry and every other line belongs to the
    entry above it, so a definition the book wrapped onto the next row and the example
    sentences under it stay with their headword.
    """
    groups: list[list[Line]] = []
    for line in lines:
        if _HEADWORD_RE.match(line.text) or not groups:
            groups.append([line])
        else:
            groups[-1].append(line)
    return groups


def _continues_caption(previous: Line, line: Line) -> bool:
    """True when ``line`` is the rest of the caption ``previous`` opens.

    Both halves of that are printed facts.  The rows of one caption are a line of
    leading apart and line up in one column; the caption printed beside it is in the
    other column, and the caption printed below it is a whole picture lower down.
    """
    return (
        previous.page == line.page
        and 0 < line.y - previous.y <= CAPTION_GAP
        and abs(line.x - previous.x) <= CAPTION_INDENT
    )


def caption_groups(lines: list[Line]) -> list[list[Line]]:
    """The captions of a practice part, each with the rows the book wrapped it onto.

    A page of pictures is printed in two columns, so the rows of the two captions beside
    each other are one line apart and alternate in reading order.  Each row is therefore
    matched against the caption it can continue - the nearest one above it in its own
    column - rather than against the row printed just before it, which belongs to the
    caption in the other column.
    """
    groups: list[list[Line]] = []
    for line in lines:
        joined: list[Line] | None = None
        gap: float | None = None
        for group in groups:
            previous = group[-1]
            if not _continues_caption(previous, line):
                continue
            distance = line.y - previous.y
            if gap is None or distance < gap:
                joined, gap = group, distance
        if joined is None:
            groups.append([line])
        else:
            joined.append(line)
    return groups


def part_groups(part: Part) -> list[list[Line]]:
    """The blocks a part is printed in, in the order the book prints them.

    A part that prints headwords is a list of entries, so one block is one entry with
    the lines printed under it.  A part that only prints sentences is a page of
    pictures, so one block is one picture's caption with the rows it wrapped onto: the
    target word is inside its own example and never split away from it.
    """
    if any(_HEADWORD_RE.match(line.text) for line in part.lines):
        return _glossary_groups(part.lines)
    return caption_groups(part.lines)


def part_columns(part: Part) -> int:
    """How many items the book prints side by side in this part.

    Read off the page rather than assumed.  The book prints a part of pictures as a grid:
    two captions share a printed row, one in each column, and the next row of two follows
    below.  A part printed as headwords gives every entry a row of its own, so the most
    items sharing any one row of it is one.  That count is the number of columns the
    reader lays the part out in, which is why a page of pictures comes out as two columns
    and a list of words as one without either being named here.
    """
    groups = part_groups(part)
    rows: list[list[list[Line]]] = []
    for group in groups:
        top = group[0].y
        for row in rows:
            if abs(row[0][0].y - top) <= SAME_ROW_GAP:
                row.append(group)
                break
        else:
            rows.append([group])
    return max((len(row) for row in rows), default=1)


def _group_text(group: list[Line]) -> str:
    """A block as one line of running text, its printed rows joined in order."""
    return " ".join(line.text for line in group)


def _glossary_entries(part: Part, section_id: str) -> list[VocabularyEntry]:
    """The ``headword: definition`` entries a part prints, with their example lines."""
    entries: list[VocabularyEntry] = []
    for group in _glossary_groups(part.lines):
        head = _HEADWORD_RE.match(group[0].text)
        if not head:
            continue
        meaning = head.group(2).strip()
        examples: list[str] = []
        for line in group[1:]:
            if _NUMBERED_SENSE_RE.match(line.text.strip()):
                meaning = (meaning + " " + line.text.strip()).strip()
            else:
                examples.append(line.text)
        entries.append(
            VocabularyEntry(
                word=head.group(1).strip(),
                page=group[0].page,
                source=GLOSSARY,
                section_id=section_id,
                part=part.key,
                part_title=part.title,
                meaning_en=meaning,
                examples=examples,
            )
        )
    return entries


def _practice_entries(part: Part, section_id: str) -> list[VocabularyEntry]:
    """The words a part points at, each keeping the caption it is printed in.

    One entry per word, in the order the book prints them.  Every word keeps the whole
    caption it sits in as its example: the sentence is the book's own context for the
    word, and it belongs with it whether the book wrapped it onto one row or two.
    """
    entries: list[VocabularyEntry] = []
    for group in caption_groups(part.lines):
        if _HEADWORD_RE.match(group[0].text) or _PART_MARKER_RE.match(group[0].text):
            continue
        example = _group_text(group)
        for line in group:
            for word in line.highlights:
                entries.append(
                    VocabularyEntry(
                        word=word,
                        page=line.page,
                        source=PRACTICE,
                        section_id=section_id,
                        part=part.key,
                        part_title=part.title,
                        examples=[example],
                    )
                )
    return entries


def part_entries(part: Part, section_id: str) -> list[VocabularyEntry]:
    """The words a part teaches.

    A part that prints headwords is a glossary; a part that only prints sentences with
    the target words picked out is a practice part.
    """
    glossary = _glossary_entries(part, section_id)
    return glossary if glossary else _practice_entries(part, section_id)


def vocabulary_page_parts(doc, page_range: tuple[int, int], section_id: str) -> list[Part]:
    """The parts of the vocabulary page that teach words, in the order they are printed.

    A part that teaches nothing - a pointer to an exercise in another book, for instance -
    is left out, and with it the lines it covers.
    """
    parts = split_parts(page_lines(doc, page_range))
    for part in parts:
        part.entries = part_entries(part, section_id)
    return [part for part in parts if part.entries]


def entries_by_section(
    doc,
    section_pages: list[tuple[str, tuple[int, int]]],
) -> dict[str, list[VocabularyEntry]]:
    """The vocabulary each section of a lesson lists, keyed by section id.

    A word bank is printed beside the text it belongs to - a Conversation opens with one -
    but those words are the lesson's vocabulary rather than that section's, so they are
    collected here and listed on the vocabulary page.  No other section repeats them: a
    section's own list holds only the words it teaches itself.
    """
    word_bank: list[VocabularyEntry] = []
    for section_id, pages in section_pages:
        for page, word in word_bank_entries(doc, pages):
            word_bank.append(
                VocabularyEntry(word=word, page=page, source=WORD_BANK, section_id=section_id)
            )

    listed: dict[str, list[VocabularyEntry]] = {
        section_id: [] for section_id, _ in section_pages
    }
    vocabulary_page = next(
        (pages for section_id, pages in section_pages if section_id == NEW_WORDS_SECTION_ID),
        None,
    )
    if vocabulary_page is None:
        return listed

    # The page's own parts come first, in the order they are printed, and the lesson's
    # word bank words follow them, so the page reads as the book sets it out.
    own: list[VocabularyEntry] = []
    for part in vocabulary_page_parts(doc, vocabulary_page, NEW_WORDS_SECTION_ID):
        own.extend(part.entries)
    listed[NEW_WORDS_SECTION_ID] = _renumber(own + word_bank)
    return listed


def vocabulary_page_view(
    doc,
    page_range: tuple[int, int],
    section_id: str,
) -> tuple[list[Line], list[dict]] | None:
    """The vocabulary page as the reader shows it: its lines, and the blocks they are in.

    The blocks come from the page itself, not from the length of a line: a part heading
    is a block of its own, a picture caption is one block however many rows the book
    wrapped it onto, and a printed entry is its headword with the lines under it.  A
    part that teaches no words is left out, and with it the lines it covers.

    The printed text is untouched: the lines are exactly what the book prints, in the
    order it prints them, and a block only says which of those lines were printed
    together.
    """
    parts = vocabulary_page_parts(doc, page_range, section_id)
    if not parts:
        return None
    lines: list[Line] = []
    blocks: list[dict] = []
    for part in parts:
        page = part.lines[0].page if part.lines else None
        # How the book lays this part out: a grid of the width it prints, or a list when
        # it gives every entry a row of its own.  Both are properties of the page, so the
        # reader lays a part out the way the book does without naming a part.
        columns = part_columns(part)
        layout = GRID if columns > 1 else LIST
        if part.heading and page is not None:
            lines.append(Line(page=page, text=part.heading))
            blocks.append({
                "page": page,
                "lines": [part.heading],
                "kind": "part-heading",
                "part": part.key,
                "layout": layout,
                "columns": columns,
            })
        for group in part_groups(part):
            lines.extend(group)
            blocks.append({
                "page": group[0].page,
                "lines": [line.text for line in group],
                "kind": "example",
                "part": part.key,
                "layout": layout,
                "columns": columns,
            })
    return lines, blocks


def line_targets(lines: list[Line]) -> list[str]:
    """Every word the book points at across these lines, in the order they are printed.

    The headings of the parts are not words the lesson teaches, so what they point at is
    left out: the letter is what the heading is.
    """
    targets: list[str] = []
    for line in lines:
        if _PART_MARKER_RE.match(line.text):
            continue
        targets.extend(line.highlights)
    return targets
