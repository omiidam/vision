"""Inventory of the recorded audio and evidence-based mapping to textbook sections.

The mapping is *derived*, never assumed.  Two independent signals are combined:

1. **Filename evidence** - the recorded file names carry a section name and a lesson
   number (``new words and expressions1.mp3``).  This only produces a *candidate*.
2. **Content evidence** - each recording's transcript is scored against the textbook
   text of every section of every lesson.

A candidate is accepted only when the content evidence independently ranks that same
section first.  Everything else is reported as uncertain instead of being guessed.
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
    confidence: float = 0.0
    method: str = "none"
    notes: list[str] = field(default_factory=list)
    runner_up: tuple[float, str, str] | None = None

    @property
    def certain(self) -> bool:
        return self.section_id is not None and self.confidence >= 0.55 and not self.notes

    @property
    def status(self) -> str:
        if self.section_id is None:
            return "unmapped"
        if self.certain:
            return "confirmed"
        return "uncertain"


def scan(source_dir: Path) -> list[AudioFile]:
    files = sorted(source_dir.glob("*.mp3"), key=lambda p: p.name.lower())
    return [AudioFile(path=p, name=p.name, stem=p.stem) for p in files]


def _tokens(text: str) -> list[str]:
    return [w for w in (normalize_word(t) for t in text.split()) if w]


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


def filename_candidate(name: str, section_ids: list[str]) -> tuple[str | None, int | None]:
    """Read a lesson number and section hint out of a recorded file name."""
    stem = Path(name).stem.lower()
    digits = re.findall(r"\d+", stem)
    lesson_number = int(digits[-1]) if digits else None

    squashed = re.sub(r"[^a-z]+", " ", stem)
    squashed = re.sub(r"\b\d+\b", "", squashed).strip()
    squashed = re.sub(r"\s+", " ", squashed).strip()

    best, best_score = None, 0.0
    for section_id in section_ids:
        score = difflib.SequenceMatcher(None, squashed, section_id.replace("-", " ")).ratio()
        if score > best_score:
            best, best_score = section_id, score
    return (best if best_score >= 0.6 else None), lesson_number


def build_mapping(
    audio: AudioFile,
    transcript: list[str],
    section_text: dict[tuple[str, str], list[str]],
    section_ids: list[str],
) -> AudioMapping:
    transcript = [normalize_word(w) for w in transcript]
    scores: list[tuple[float, str, str]] = []
    for (lesson_id, section_id), words in section_text.items():
        scores.append((transcript_similarity(transcript, words), lesson_id, section_id))
    scores.sort(key=lambda row: (row[0], row[1], row[2]), reverse=True)

    mapping = AudioMapping(audio=audio)
    if not scores:
        mapping.notes.append("no section text available")
        return mapping

    best_score, best_lesson, best_section = scores[0]
    mapping.runner_up = (scores[1][0], scores[1][1], scores[1][2]) if len(scores) > 1 else None
    mapping.confidence = best_score

    candidate_section, candidate_lesson = filename_candidate(audio.name, section_ids)
    expected_lesson = f"lesson-{candidate_lesson:02d}" if candidate_lesson else None

    if best_score < 0.25:
        mapping.notes.append(f"low transcript similarity to every section (best {best_score})")
        return mapping

    if candidate_section and best_section != candidate_section:
        mapping.notes.append(
            f"filename suggests '{candidate_section}' but content matches '{best_section}' better"
        )
    if expected_lesson and best_lesson != expected_lesson:
        mapping.notes.append(
            f"filename suggests {expected_lesson} but content matches {best_lesson} better"
        )

    if mapping.runner_up and best_score - mapping.runner_up[0] < 0.05:
        mapping.notes.append(
            f"content score is nearly tied with {mapping.runner_up[1]}/{mapping.runner_up[2]} "
            f"({mapping.runner_up[0]})"
        )

    mapping.lesson_id = best_lesson
    mapping.section_id = best_section
    mapping.method = "transcript-similarity" + ("+filename" if candidate_section == best_section else "")
    return mapping
