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
# only these are left out of the generated data tree.
WITHDRAWN_SECTION_IDS = frozenset({"pronunciation"})

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


def page_rows(doc: pymupdf.Document, printed_page: int) -> list[tuple[str, list[dict]]]:
    """Return each visible line of a printed page with the spans it was built from.

    The text is exactly what :func:`page_lines` returns, in the same order; the spans
    carry the typeface and colour, which is how a word the book is pointing at is told
    from the running text around it.

    Printed page numbers in this book equal the 1-based PDF page index.
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
    # Band lines into visual rows so that text drawn a couple of points apart on the
    # same row (common in this book's two-column pages) is ordered left to right.
    collected.sort(key=lambda item: (item[0], item[1]))
    rows: list[list[tuple[float, float, str, list[dict]]]] = []
    for item in collected:
        if rows and item[0] - rows[-1][-1][0] < 6:
            rows[-1].append(item)
        else:
            rows.append([item])
    return [
        (text, spans)
        for row in rows
        for _, _, text, spans in sorted(row, key=lambda i: i[1])
    ]


def page_lines(doc: pymupdf.Document, printed_page: int) -> list[str]:
    """Return the visible lines of a printed page in reading order."""
    return [text for text, _ in page_rows(doc, printed_page)]


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
