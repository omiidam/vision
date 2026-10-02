"""Inventory of the recorded audio and its mapping to textbook sections.

**The file name is the authoritative mapping rule.**  The recordings follow a consistent
convention: the section name followed by the lesson number, for example
``new words and expressions1.mp3`` -> New Words & Expressions of Lesson 1, and
``Listening & Speaking2.mp3`` -> Listening & Speaking of Lesson 2.  That pattern assigns
every recording to exactly one section, so the mapping is read off the name rather than
inferred.

Content similarity is kept, but only as **corroboration**: each recording's transcript is
still scored against the textbook text of the section the name points at.  A disagreement
is never allowed to move the assignment - the name decides - but it is recorded as a note
in the generated metadata instead of being silently dropped.  A name that cannot be parsed
is reported as unmapped; it is never guessed from content.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from pathlib import Path

from text import normalize_word


@dataclass
class AudioFile:
    path: Path
    name: str
    duration: float = 0.0
    stem: str = ""


@dataclass
class AudioMapping:
    audio: AudioFile
    lesson_id: str | None = None
    section_id: str | None = None
    content_score: float = 0.0
    method: str = "filename"
    notes: list[str] = field(default_factory=list)
    content_best: tuple[float, str, str] | None = None
    blocked: bool = False

    @property
    def assigned(self) -> bool:
        """True when this recording will actually be wired up to a section."""
        return self.section_id is not None and not self.blocked

    @property
    def status(self) -> str:
        """``confirmed`` = the name parsed and the content agrees.

        ``uncertain`` = the name parsed and assigned the section, but the transcript does
        not corroborate it.  The assignment still follows the name; the doubt is recorded.
        """
        if self.section_id is None:
            return "unmapped"
        if self.blocked:
            return "conflict"
        return "confirmed" if self.content_score >= CORROBORATION_FLOOR else "uncertain"


def scan(source_dir: Path) -> list[AudioFile]:
    files = sorted(source_dir.glob("*.mp3"), key=lambda p: p.name.lower())
    return [AudioFile(path=p, name=p.name, stem=p.stem) for p in files]


CORROBORATION_FLOOR = 0.25   # below this the transcript does not back up the file name
NAME_MATCH_FLOOR = 0.72     # fuzzy fallback when a name is not written exactly


def transcript_similarity(speech: list[str], textbook: list[str]) -> float:
    """Fraction of spoken words that also occur in the textbook text, best-effort ordered."""
    if not speech:
        return 0.0
    reference = set(textbook)
    matched = sum(1 for w in speech if w in reference)
    # reward long, well-attended sections: use the softer mean of the two ratios
    coverage = matched / len(speech)
    density = matched / max(len(textbook), 1)
    return round(0.5 * coverage + 0.5 * min(1.0, density * 3), 4)


def parse_filename(name: str, section_ids: list[str]) -> tuple[str | None, int | None, float]:
    """Read the section and lesson number out of a recorded file name.

    ``"New Words & Expressions2.mp3"`` -> ``("new-words-and-expressions", 2, 1.0)``.
    Section names are matched on their words, so ``&`` versus ``and`` and the difference
    in capitalisation between recordings are both handled.  The third value is how
    closely the name matched, which is 1.0 for a word-for-word match.
    """
    stem = Path(name).stem.lower()
    numbers = re.findall(r"\d+", stem)
    lesson_number = int(numbers[-1]) if numbers else None

    words = re.sub(r"\d+", " ", stem).split()
    best, best_score = None, 0.0
    for section_id in section_ids:
        target = section_id.replace("-", " ").split()
        # exact when the name carries every word of the section (and nothing else)
        if words == target:
            return section_id, lesson_number, 1.0
        if set(target) <= set(words):
            score = 0.95
        else:
            score = difflib.SequenceMatcher(None, " ".join(words), " ".join(target)).ratio()
        if score > best_score:
            best, best_score = section_id, score
    return (best if best_score >= NAME_MATCH_FLOOR else None), lesson_number, best_score


def build_mapping(
    audio: AudioFile,
    transcript: list[str],
    section_text: dict[tuple[str, str], list[str]],
    section_ids: list[str],
) -> AudioMapping:
    """Assign the recording named by its file name, then check the transcript agrees."""
    mapping = AudioMapping(audio=audio)

    section_id, lesson_number, name_score = parse_filename(audio.name, section_ids)
    if section_id is None:
        mapping.method = "none"
        mapping.notes.append(
            f"file name '{audio.name}' does not follow the '<section><lesson number>' "
            f"convention, so it was not assigned to a section"
        )
        return mapping
    if lesson_number is None:
        mapping.method = "filename (no lesson number)"
        mapping.notes.append(
            f"file name names the section '{section_id}' but carries no lesson number; "
            f"assigned to lesson 1 by convention"
        )
        lesson_number = 1

    mapping.section_id = section_id
    mapping.lesson_id = f"lesson-{lesson_number:02d}"
    mapping.method = f"filename ({section_id.replace('-', ' ')}, name match {name_score:.2f})"

    # Corroboration only - it records evidence, it never moves the assignment.
    transcript = [normalize_word(w) for w in transcript]
    scores = sorted(
        ((transcript_similarity(transcript, words), lesson, section)
         for (lesson, section), words in section_text.items()),
        key=lambda row: (row[0], row[1], row[2]),
        reverse=True,
    )
    if not scores:
        mapping.notes.append("no section text available to corroborate the file name")
        return mapping

    mapping.content_best = scores[0]
    mapping.content_score = next(
        (score for score, lesson, section in scores
         if lesson == mapping.lesson_id and section == mapping.section_id),
        0.0,
    )

    top_score, top_lesson, top_section = scores[0]
    if (top_lesson, top_section) != (mapping.lesson_id, mapping.section_id):
        mapping.notes.append(
            f"the transcript resembles {top_lesson}/{top_section} most ({top_score:.3f}); "
            f"the file name is authoritative, so it stays mapped to "
            f"{mapping.lesson_id}/{mapping.section_id} (score {mapping.content_score:.3f})"
        )
    if mapping.content_score < CORROBORATION_FLOOR:
        mapping.notes.append(
            f"the transcript barely overlaps the text of {mapping.lesson_id}/{mapping.section_id} "
            f"({mapping.content_score:.3f}); check that this recording really belongs here"
        )
    return mapping
