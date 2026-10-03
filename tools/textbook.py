"""Shared knowledge about the source material: the *Vision 1 / English for Schools*
Grade 10 Student Book PDF that lives next to the audio files.

Nothing in this module invents content.  Lesson and section titles are parsed out of
the book's own table of contents, and every section's text is extracted verbatim from
the PDF pages that the section occupies.
"""

from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass, field

import pymupdf

# --------------------------------------------------------------------------- paths

BOOK_FILENAME = "10th.pdf"

# Section identifiers used in the generated data tree.  The order is the order in
# which the sections appear in the book.
SECTION_IDS = [
    "get-ready",
    "conversation",
    "new-words-and-expressions",
    "reading",
    "grammar",
    "listening-and-speaking",
    "pronunciation",
    "writing",
    "what-you-learned",
]

# Sections the book contains but the reader does not publish.  Parsing still reads every
# section off the contents page (so the extraction stays verified against the book), and
# only these are left out of the generated data tree.  Being listed here is what withdraws
# a section: nothing anywhere else decides, so a lesson added later cannot publish one of
# these either, and no manifest, tab or page of text is ever written for it.
WITHDRAWN_SECTION_IDS = frozenset({"pronunciation", "what-you-learned"})

# The sections the reader publishes, in book order.
PUBLISHED_SECTION_IDS = [s for s in SECTION_IDS if s not in WITHDRAWN_SECTION_IDS]

# Printed page ranges (inclusive) for each section of each lesson.  Derived from the
# table of contents ("Lesson 1: Saving Nature (15-41)") and verified against the page
# content; see tools/audit_sections.py.
SECTION_PAGES: dict[str, dict[str, tuple[int, int]]] = {
    "lesson-01": {
        "get-ready": (15, 18),
        "conversation": (19, 19),
        "new-words-and-expressions": (20, 21),
        "reading": (22, 22),
        "grammar": (24, 29),
        "listening-and-speaking": (30, 31),
        "pronunciation": (32, 33),
        "writing": (34, 39),
        "what-you-learned": (40, 41),
    },
    "lesson-02": {
        "get-ready": (44, 46),
        "conversation": (47, 47),
        "new-words-and-expressions": (48, 49),
        "reading": (50, 50),
        "grammar": (52, 57),
        "listening-and-speaking": (58, 59),
        "pronunciation": (60, 61),
        "writing": (62, 67),
        "what-you-learned": (68, 69),
    },
}

# --------------------------------------------------------------------------- lessons


@dataclass
class LessonInfo:
    lesson_id: str
    number: int
    title: str            # e.g. "Saving Nature"
    toc_line: str         # e.g. "Lesson 1: Saving Nature )15-41("
    page_range: tuple[int, int]
    page_span: str        # e.g. "(15-41)"
    sections: list["SectionInfo"] = field(default_factory=list)


@dataclass
class SectionInfo:
    section_id: str
    label: str            # e.g. "New Words & Expressions"
    description: str      # e.g. "Learning Vocabulary of Reading"
    pages: tuple[int, int]


# --------------------------------------------------------------------------- helpers


def normalize(text: str) -> str:
    """NFKC + collapse whitespace, keeping the book's own characters."""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2013", "-").replace("\u2014", "-")
    text = text.replace("\u00a0", " ")
    return re.sub(r"[ \t]+", " ", text).strip()


def parse_toc_page(lines: list[tuple[int, int, str]]) -> dict:
    """Parse one table-of-contents page into lesson metadata.

    ``lines`` is a list of ``(x, y, text)`` tuples in reading order.  The page has two
    columns: section labels around x≈85 and their descriptions around x≈165.
    """
    lesson_line = next((t for _, _, t in lines if t.strip().lower().startswith("lesson ")), None)
    if lesson_line is None:
        raise ValueError("no lesson heading found on contents page")

    m = re.match(r"Lesson\s+(\d+)\s*:\s*(.*?)\s*\)\s*([\d\s\u2013-]+)\s*\(\s*$", lesson_line.strip())
    if not m:
        raise ValueError(f"unparsable lesson heading: {lesson_line!r}")
    number = int(m.group(1))
    title = normalize(m.group(2))
    span = normalize(m.group(3))

    def cluster(entries: list[tuple[float, str]]) -> list[tuple[float, str]]:
        """Merge stacked fragments of one multi-line cell into a single entry."""
        merged: list[tuple[float, str]] = []
        for y, text in sorted(entries):
            if merged and y - merged[-1][0] < 20:
                merged[-1] = (merged[-1][0], merged[-1][1] + " " + text)
            else:
                merged.append((y, text))
        return merged

    label_entries: list[tuple[float, str]] = []
    desc_entries: list[tuple[float, str]] = []
    for x, y, text in lines:
        if not text.strip() or text.strip().startswith("Lesson "):
            continue
        if x < 130 and y > 140:
            label_entries.append((y, normalize(text)))
        elif 130 <= x < 200:
            desc_entries.append((y, 0, normalize(text)))
        elif 200 <= x < 340:
            desc_entries.append((y, 1, normalize(text)))

    labels = cluster(label_entries)
    descriptions: list[tuple[float, str]] = []
    for bucket in (0, 1):
        column = cluster([(y, t) for y, b, t in desc_entries if b == bucket])
        descriptions.extend(column)

    def slug(text: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", text.replace("&", " and ").lower()).split()

    sections: list[SectionInfo] = []
    for label_y, label in labels:
        nearby = [d for d in descriptions if abs(d[0] - label_y) < 22]
        for section_id in SECTION_IDS:
            if slug(section_id.replace("-", " ")) == slug(label):
                # the contents page splits some descriptions across two sub-columns
                text = " / ".join(d[1] for d in sorted(nearby, key=lambda d: d[0]))
                sections.append(SectionInfo(section_id, label, text, (0, 0)))
                break

    if [s.section_id for s in sections] != SECTION_IDS:
        raise ValueError(
            f"contents page did not yield the expected section list: {[s.section_id for s in sections]}"
        )

    pages = SECTION_PAGES[f"lesson-{number:02d}"]
    for section in sections:
        section.pages = pages[section.section_id]

    return LessonInfo(
        lesson_id=f"lesson-{number:02d}",
        number=number,
        title=title,
        toc_line=lesson_line,
        page_range=(int(span.split("-")[0]), int(span.split("-")[1])),
        page_span=span,
        sections=sections,
    )


def _is_running_furniture(text: str) -> bool:
    """Running headers/footers: the vertical 'L E S S O N n' marks and page numbers."""
    stripped = text.strip()
    if not stripped:
        return True
    if re.sub(r"\s+", "", stripped) in {"L", "LESON", "LESSON", "LSSN"}:
        return True            # the vertical "L E S S O N" sidebar
    if re.fullmatch(r"[^A-Za-z0-9]*", stripped):
        return True            # Persian-only glyph runs carry no usable text layer
    if re.fullmatch(r"\d{1,3}", stripped):
        return True
    if stripped == "LESSON":
        return True
    if re.fullmatch(r"LESSON\s*\d?", stripped):
        return True
    return False


#: White lettering is only ever read on top of a coloured panel, so it marks a callout
#: (a word bank) rather than the running text.  Same definition as
#: :data:`vocabulary.CALLOUT_COLOR`, which is where the word bank is read from.
CALLOUT_COLOR = 0xFFFFFF

#: A speaker label in a conversation, such as ``Maryam:`` or ``Ms.Tabesh:``.  The book
#: prints the name in a column of its own and sets what is said beside it.
SPEAKER_RE = re.compile(r"^[A-Z][A-Za-z.]{1,24}(?:\s[A-Z][A-Za-z.]{1,24})*:\s*$")

#: The instruction a conversation page closes with, above the questions it asks.
_EXERCISE_RE = re.compile(r"^Answer the following questions\b", re.I)

#: A heading that divides an exercise page into parts: "Part One", "Part II", "Part 3".
#: The book names a part in words or in numerals and always on a line of its own.
PART_HEADING_RE = re.compile(r"^Part\s+(?:[A-Za-z]+|\d+|[IVXLCDM]+)$")

#: The gap, in printed points, between two rows the book prints as one item wrapped onto
#: the next row.  A wrapped row sits about 16pt below the row above it; the next item of a
#: column starts at least 24pt below, so anything under this gap is a wrap and anything
#: over it is a new item.
WRAP_GAP = 20.0

#: The shortest row, in characters, the book prints as running text rather than as one
#: label of the grid.  A grid of words beside one another is a row of short labels, and a
#: label is an item whole; a sentence the book broke across two rows is only a fragment
#: until its second row is joined back onto it.
MIN_RUNNING_TEXT = 20

#: How much of a row has to sit over the item it would continue.  A wrapped row runs under
#: the text it continues; the next label of a grid is set beside it, not under it.
OVERLAP = 0.4

#: A heading is set in a noticeably larger size than the body text of the same page: the
#: title of a reading is 24pt over 11.5pt of running text.  Anything this much larger than
#: the page's own body size is a heading rather than a line of the passage.
HEADING_RATIO = 1.4


def page_rows(doc: pymupdf.Document, printed_page: int) -> list[tuple[str, list[dict]]]:
    """Return each visible line of a printed page with the spans it was built from.

    The text is exactly what :func:`page_lines` returns, in the same order; the spans
    carry the typeface and colour, which is how a word the book is pointing at is told
    from the running text around it.

    Printed page numbers in this book equal the 1-based PDF page index.
    """
    return [(text, spans) for _, text, spans in page_geometry_rows(doc, printed_page)]


def page_geometry_rows(
    doc: pymupdf.Document, printed_page: int
) -> list[tuple[float, str, list[dict]]]:
    """Each visible line of a printed page with its left edge and its spans.

    The lines are in the same reading order :func:`page_rows` returns; the left edge is
    what tells a speaker's name from the words beside it, which the book sets in two
    columns of one visual row.
    """
    return [
        item
        for row in _visual_rows(doc, printed_page)
        for item in row
    ]


def _visual_rows(
    doc: pymupdf.Document, printed_page: int
) -> list[list[tuple[float, str, list[dict]]]]:
    """The page's visible lines banded into visual rows, each ordered left to right.

    Text drawn a couple of points apart on the same row - this book sets a speaker's
    name beside what they say that way - shares one row here.  Each entry of a row is
    ``(left edge, text, spans)``.
    """
    page = doc[printed_page - 1]
    collected: list[tuple[float, float, str, list[dict]]] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            text = normalize("".join(span["text"] for span in line["spans"]))
            if _is_running_furniture(text):
                continue
            x0, y0, x1, _ = line["bbox"]
            # drop lines that are mostly outside the printable text column
            if x1 < 40 or x0 > 580:
                continue
            collected.append((y0, x0, text, list(line["spans"])))
    collected.sort(key=lambda item: (item[0], item[1]))
    rows: list[list[tuple[float, float, str, list[dict]]]] = []
    for item in collected:
        if rows and item[0] - rows[-1][-1][0] < 6:
            rows[-1].append(item)
        else:
            rows.append([item])
    return [
        [(x0, text, spans) for _, x0, text, spans in sorted(row, key=lambda i: i[1])]
        for row in rows
    ]


def conversation_page_lines(
    doc: pymupdf.Document, page_range: tuple[int, int]
) -> list[tuple[int, str]] | None:
    """The lines of a conversation, one line per speaker turn, or ``None`` if it has none.

    The book sets a conversation out as a column of speaker names with what is said
    beside it, so a name and the words on its visual row are one printed line and are
    joined here.  A turn the book wraps over several rows keeps those rows in order, so
    the turn still reads as the paragraph the reader shows.

    The word bank printed beside the conversation and the questions the page closes
    with are not part of the conversation: the bank is the lesson's vocabulary, listed
    on the vocabulary page, and the questions are an exercise that follows the dialogue.
    """
    lines: list[tuple[int, str]] = []
    for printed_page in range(page_range[0], page_range[1] + 1):
        rows = page_geometry_rows(doc, printed_page)
        if not any(SPEAKER_RE.match(text) for _, text, _ in rows):
            return None
        for row in _visual_rows(doc, printed_page):
            for text in _join_speaker_row(row):
                if _is_word_bank(text[2]):
                    continue
                if _EXERCISE_RE.match(text[1]):
                    return lines
                lines.append((printed_page, text[1]))
    return lines


def _join_speaker_row(row: list[tuple[float, str, list[dict]]]) -> list[tuple[float, str, list[dict]]]:
    """A visual row of a conversation, with a speaker's name joined onto its words.

    The name is set in a column of its own, so it is the leftmost run on the row and
    everything to its right is what that speaker says.  A row without a name is returned
    unchanged, and a row the book already set as one line is returned as it stands.
    """
    if not row or not SPEAKER_RE.match(row[0][1]):
        return row
    return [(row[0][0], " ".join(item[1] for item in row), row[0][2])]


def _is_word_bank(spans: list[dict]) -> bool:
    """True for a line the book sets as a callout panel rather than as running text.

    White lettering can only have been laid over a coloured panel, which is what the
    word bank printed beside a conversation is.
    """
    return bool(spans) and all(span["color"] == CALLOUT_COLOR for span in spans)


def page_lines(doc: pymupdf.Document, printed_page: int) -> list[str]:
    """Return the visible lines of a printed page in reading order."""
    return [text for text, _ in page_rows(doc, printed_page)]


# --------------------------------------------------------------------------- Get Ready


def _printed_lines(
    doc: pymupdf.Document, printed_page: int
) -> list[tuple[float, float, float, str]]:
    """Every visible line of a page with the box it was printed in, in reading order."""
    page = doc[printed_page - 1]
    collected: list[tuple[float, float, float, str]] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            text = normalize("".join(span["text"] for span in line["spans"]))
            if not text or _is_running_furniture(text):
                continue
            x0, y0, x1, _ = line["bbox"]
            if x1 < 40 or x0 > 580:
                continue
            collected.append((round(y0, 1), round(x0, 1), round(x1, 1), text))
    collected.sort(key=lambda item: (item[0], item[1]))
    return collected


def _ends_a_sentence(text: str) -> bool:
    """True for a row the book finishes with, which nothing is printed under."""
    return bool(re.search(r"[.?!…:]$", text.strip()))


# -------------------------------------------------------------------------- Reading


def _printed_blocks(doc: pymupdf.Document, printed_page: int) -> list[dict]:
    """Each block of text a printed page carries, with the rows it is printed in.

    A block is one thing the book sets together: a heading, or a paragraph.  The rows are
    the lines of that thing, top to bottom, and the size is the largest set in them, which
    is what tells a heading from the body text under it.
    """
    page = doc[printed_page - 1]
    blocks: list[dict] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        rows: list[tuple[float, float, float, str, float]] = []
        for line in block["lines"]:
            text = normalize("".join(span["text"] for span in line["spans"]))
            if not text or _is_running_furniture(text):
                continue
            x0, y0, x1, _ = line["bbox"]
            if x1 < 40 or x0 > 580:
                continue
            rows.append((round(y0, 1), round(x0, 1), round(x1, 1), text,
                         max(span["size"] for span in line["spans"])))
        if not rows:
            continue
        rows.sort(key=lambda row: (row[0], row[1]))
        blocks.append({
            "y": rows[0][0],
            "x0": min(row[1] for row in rows),
            "x1": max(row[2] for row in rows),
            "size": max(row[4] for row in rows),
            "rows": rows,
        })
    blocks.sort(key=lambda block: (block["y"], block["x0"]))
    return blocks


def reading_page_view(
    doc: pymupdf.Document, page_range: tuple[int, int]
) -> tuple[list[tuple[int, str]], list[dict]]:
    """The lines and the blocks of a reading page, one block per printed paragraph.

    A reading passage is running text, and the book sets each of its paragraphs as a block
    of its own: the paragraph is what the book broke, not how long each of its rows
    happens to be.  Reading such a page by the length of its rows splits one paragraph
    into several and can run the heading into the first sentence, so the paragraphs are
    read from the page instead.

    The title is kept as its own block, marked as the heading it is, so it stands above
    the passage rather than opening it.  Two blocks are only one paragraph where the book
    broke one across them: the first does not end a sentence, and the second starts just
    below it in the same column.
    """
    paragraphs: list[dict] = []
    body_size = 0.0
    sizes: list[float] = []
    for printed_page in range(page_range[0], page_range[1] + 1):
        for block in _printed_blocks(doc, printed_page):
            sizes.extend(row[4] for row in block["rows"])
            block["page"] = printed_page
    if sizes:
        # The size most of the page is set in is the size of its running text.
        body_size = max(set(sizes), key=sizes.count)

    for printed_page in range(page_range[0], page_range[1] + 1):
        for block in _printed_blocks(doc, printed_page):
            text = " ".join(row[3] for row in block["rows"])
            heading = body_size and block["size"] >= HEADING_RATIO * body_size
            merged = False
            if paragraphs and not paragraphs[-1]["heading"]:
                previous = paragraphs[-1]
                gap = block["y"] - previous["y"]
                overlaps = block["x0"] < previous["x1"] and previous["x0"] < block["x1"]
                if 0 < gap <= WRAP_GAP and overlaps and not _ends_a_sentence(previous["text"]):
                    previous["text"] += " " + text
                    previous["y"] = block["y"]
                    previous["x1"] = max(previous["x1"], block["x1"])
                    merged = True
            if merged:
                continue
            paragraphs.append({
                "page": printed_page,
                "y": block["y"],
                "x0": block["x0"],
                "x1": block["x1"],
                "heading": bool(heading),
                "text": text,
            })

    lines: list[tuple[int, str]] = []
    blocks: list[dict] = []
    for paragraph in paragraphs:
        lines.append((paragraph["page"], paragraph["text"]))
        block = {"page": paragraph["page"], "lines": [paragraph["text"]]}
        if paragraph["heading"]:
            block["kind"] = "reading-title"
        blocks.append(block)
    return lines, blocks


def get_ready_items(doc: pymupdf.Document, printed_page: int) -> list[str]:
    """The items printed on a Get Ready page, in the order the book prints them.

    An exercise page is a grid of short items, several of them side by side, and any one
    of them may be wrapped onto a second row.  Reading such a page row by row would join
    two columns of items into one line and cut a wrapped item in half, so the rows are
    put back into the items the book prints.

    A row belongs to the item above it only when the book wrapped it: it sits just below
    that item's last row, running under the text it continues, and the row above is
    running text the book had not finished.  Everything else - an item printed beside
    another item, or the next label of the grid directly below this one - is an item of
    its own.
    """
    open_items: list[dict] = []
    for y0, x0, x1, text in _printed_lines(doc, printed_page):
        wrapped = None
        for item in open_items:
            gap = y0 - item["y"]
            if not 0 < gap <= WRAP_GAP:
                continue
            if _ends_a_sentence(item["text"]):
                continue
            # A label of the grid is an item whole, however long its neighbours are.
            if len(item["text"]) < MIN_RUNNING_TEXT:
                continue
            # The wrapped row runs under the text it continues.
            overlap = min(x1, item["x1"]) - max(x0, item["x0"])
            if overlap < OVERLAP * min(x1 - x0, item["x1"] - item["x0"]):
                continue
            if wrapped is None or item["y"] > wrapped["y"]:
                wrapped = item
        if wrapped is None:
            open_items.append({"y": y0, "x0": x0, "x1": x1, "text": text})
        else:
            wrapped["text"] += " " + text
            wrapped["y"] = y0
    return [item["text"] for item in open_items]


def get_ready_page_view(
    doc: pymupdf.Document, page_range: tuple[int, int]
) -> tuple[list[tuple[int, str]], list[dict]] | None:
    """The lines and the blocks of a Get Ready page, divided into the book's parts.

    The book prints this page as a number of parts, each headed by its own line and each
    holding its own exercise.  The part a line is printed in is read off the page and
    travels with the block, so the reader can give every part its own heading and its own
    container instead of deciding for itself where one part ends and the next begins.
    The count and the names of the parts come from the book, never from here.

    ``None`` is returned when the page is not divided into parts, so a page without them
    is read the ordinary way.
    """
    lines: list[tuple[int, str]] = []
    blocks: list[dict] = []
    part: str | None = None
    for printed_page in range(page_range[0], page_range[1] + 1):
        for item in get_ready_items(doc, printed_page):
            lines.append((printed_page, item))
            if PART_HEADING_RE.match(item):
                part = item
                blocks.append({
                    "page": printed_page,
                    "lines": [item],
                    "kind": "part-heading",
                    "part": part,
                })
            elif part is not None:
                blocks.append({"page": printed_page, "lines": [item], "part": part})
            else:
                blocks.append({"page": printed_page, "lines": [item]})
    return (lines, blocks) if part is not None else None


def load_textbook(source_dir: str) -> tuple[pymupdf.Document, list[LessonInfo]]:
    book_path = os.path.join(source_dir, BOOK_FILENAME)
    if not os.path.exists(book_path):
        raise FileNotFoundError(book_path)
    doc = pymupdf.open(book_path)

    lessons: list[LessonInfo] = []
    for index, page in enumerate(doc):
        lines = []
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                text = normalize("".join(span["text"] for span in line["spans"]))
                if text:
                    lines.append((round(line["bbox"][0], 1), round(line["bbox"][1], 1), text))
        headings = [t for _, _, t in lines if t.strip().lower().startswith("lesson ") and ":" in t]
        if len(lines) < 60 and len(headings) == 1:
            number = int(re.match(r"Lesson\s+(\d+)\s*:", headings[0], re.I).group(1))
            if f"lesson-{number:02d}" in SECTION_PAGES:
                lessons.append(parse_toc_page(lines))

    if [lesson.number for lesson in lessons] != [1, 2]:
        raise ValueError(f"expected to detect lessons 1 and 2, got {[l.number for l in lessons]}")
    return doc, lessons
