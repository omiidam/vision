"""Builds the processed content tree consumed by the application.

Output layout (committed to the repository; no lesson content is hardcoded in the UI)::

    data/grade-10/
      manifest.json
      lesson-01/
        manifest.json
        sections/<section-id>.json
        vocabulary.json
        synchronization/<section-id>.sync.json
        provenance.json
      lesson-02/...

    audio/grade-10/lesson-01/<section-id>.mp3

Every field is either lifted verbatim from the textbook PDF or derived from a transcript;
nothing is written by hand.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import audio_map
import text as textmod
import textbook as book
import transcribe
import vocabulary
from align import align

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / ".work"
DATA = ROOT / "data" / "grade-10"
AUDIO_OUT = ROOT / "audio" / "grade-10"

GENERATED_BY = "tools/build_content.py"
BOOK_SHA = None  # filled in at runtime

#: The section whose pages are laid out as a dialogue rather than as running text.
CONVERSATION_SECTION_ID = "conversation"


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
        handle.write("\n")


def section_lines(doc, section) -> list[tuple[int, str]]:
    lines: list[tuple[int, str]] = []
    # A conversation is set out as speaker names beside what is said, and the page also
    # carries the lesson's word bank and the exercise it closes with.  The conversation
    # extractor keeps the dialogue itself, one line per turn, and leaves the other two
    # where the book puts them: the bank is listed on the vocabulary page, and the
    # exercise is not part of what the speakers say.
    if section.section_id == CONVERSATION_SECTION_ID:
        conversation = book.conversation_page_lines(doc, tuple(section.pages))
        if conversation is not None:
            return conversation
    for page in range(section.pages[0], section.pages[1] + 1):
        lines.extend((page, text) for text in book.page_lines(doc, page))
    return lines


def speech_from(transcript_path: Path) -> tuple[list[tuple[str, float, float]], float]:
    if not transcript_path.exists():
        return [], 0.0
    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    return transcribe.speech_words(data), float(data["duration"])


def vocabulary_items(entries: list[vocabulary.VocabularyEntry]) -> list[dict]:
    """The lesson's vocabulary list in the shape the reader renders.

    ``source``, ``sectionId`` and ``part`` travel with each entry, so a word can be told
    where it was printed and which part of the page it belongs to, instead of being shown
    as if the book had left its definition out.
    """
    return [
        {
            "word": entry.word,
            "pronunciation": "",
            "meaningEn": entry.meaning_en,
            "meaningFa": "",
            "examples": list(entry.examples),
            "audio": None,
            "page": entry.page,
            "source": entry.source,
            "sectionId": entry.section_id,
            "part": entry.part,
            "partTitle": entry.part_title,
        }
        for entry in entries
    ]


def _target_words(doc, section) -> list[str]:
    """The words a section teaches, read from the page rather than from its text.

    This is the same extraction the section's own vocabulary is built from, so the
    preview can never drift from the structured data.
    """
    return [word for _, word in vocabulary.word_bank_entries(doc, tuple(section.pages))]


def build_sync(words, speech, duration, mapping, section, lesson_id) -> dict:
    tokens, islands, confidence = align(words, speech)
    sentences = textmod.split_sentences(words)
    sentence_rows = []
    for i0, i1 in sentences:
        timed = [t for t in tokens[i0:i1] if t.start is not None]
        sentence_rows.append({
            "first": i0,
            "last": i1 - 1,
            "start": timed[0].start if timed else None,
            "end": timed[-1].end if timed else None,
            "text": " ".join(words[i0:i1]),
        })
    return {
        "sectionId": section.section_id,
        "lessonId": lesson_id,
        "audio": f"audio/grade-10/{lesson_id}/{section.section_id}.mp3",
        "sourceAudioFile": mapping.audio.name,
        "duration": round(duration, 3),
        "method": "whisper-word-timestamps + dynamic-programming forced alignment",
        "confidence": confidence,
        "mapping": {
            "status": mapping.status,
            "method": mapping.method,
            "contentScore": round(mapping.content_score, 4),
            "contentBest": (
                {"score": round(mapping.content_best[0], 4),
                 "lessonId": mapping.content_best[1],
                 "sectionId": mapping.content_best[2]}
                if mapping.content_best else None
            ),
            "notes": mapping.notes,
        },
        "words": [
            {
                "word": t.text,
                "start": t.start,
                "end": t.end,
                "match": (
                    None if t.similarity is None
                    else ("exact" if t.similarity >= 0.999 else
                          "fuzzy" if t.similarity >= 0.62 else
                          "interpolated" if t.interpolated else "low")
                ),
                "similarity": t.similarity,
                "spokenAs": t.spoken_as,
            }
            for t in tokens
        ],
        "sentences": sentence_rows,
        "unspokenAudio": [
            {"start": round(i.start, 3), "end": round(i.end, 3), "transcript": i.text}
            for i in islands if i.end - i.start >= 0.8
        ],
    }


def _prune_withdrawn(lesson_dir: Path, lesson) -> None:
    """Delete the files of a lesson's sections the reader no longer publishes.

    Withdrawing a section stops it being written; this stops it being left over.  Only a
    file this build would no longer write is removed, and only from a lesson's own
    generated folders, so no other content can be caught by it.
    """
    kept = {s.section_id for s in lesson.sections if s.section_id not in book.WITHDRAWN_SECTION_IDS}
    for folder in ("sections", "synchronization"):
        for path in (lesson_dir / folder).glob("*.json"):
            if path.stem not in kept:
                path.unlink()


def build() -> dict:
    source_dir = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT.parent / "10th-class")
    doc, lessons = book.load_textbook(str(source_dir))
    book_path = source_dir / book.BOOK_FILENAME
    import hashlib
    book_sha = hashlib.sha256(book_path.read_bytes()).hexdigest()

    # ---- 1. textbook text -------------------------------------------------------
    sections: dict[str, dict[str, dict]] = {}
    for lesson in lessons:
        sections[lesson.lesson_id] = {}
        for section in lesson.sections:
            lines = section_lines(doc, section)
            # The words the book itself points at on this page.  Only the vocabulary page
            # marks them, so any other section has none.
            targets: list[str] = []
            if section.section_id == vocabulary.NEW_WORDS_SECTION_ID:
                # The vocabulary page shows the parts that teach words.  The same parts
                # decide the vocabulary below, so the two cannot disagree.
                page_lines = vocabulary.vocabulary_page_lines(
                    doc, tuple(section.pages), section.section_id
                )
                if page_lines:
                    lines = [line.as_text() for line in page_lines]
                    targets = vocabulary.line_targets(page_lines)
            blocks, flat = textmod.build_blocks(
                lines, conversation=section.section_id == CONVERSATION_SECTION_ID
            )
            sections[lesson.lesson_id][section.section_id] = {
                "meta": section,
                "lines": lines,
                "blocks": blocks,
                "words": flat,
                "targets": targets,
            }

    # ---- 2. audio inventory + mapping ------------------------------------------
    audio_files = audio_map.scan(source_dir)
    transcripts: dict[str, dict] = {}
    for audio in audio_files:
        words, duration = speech_from(WORK / "transcripts" / f"{audio.stem}.json")
        audio.duration = duration
        audio.transcript_words = words                       # type: ignore[attr-defined]
        path = WORK / "transcripts" / f"{audio.stem}.json"
        if path.exists():
            transcripts[audio.stem] = json.loads(path.read_text(encoding="utf-8"))

    section_text = {
        (lesson_id, section_id): [textmod.normalize_word(w) for w in data["words"]]
        for lesson_id, lesson_sections in sections.items()
        for section_id, data in lesson_sections.items()
    }

    mappings = [
        audio_map.build_mapping(
            audio, [w for w, _, _ in getattr(audio, "transcript_words", [])],
            section_text, book.SECTION_IDS,
        )
        for audio in audio_files
    ]

    # Two recordings named after the same section of the same lesson cannot both be used.
    # The rule cannot break the tie, so the clash is reported and the later name is left
    # unassigned rather than being resolved by content similarity.
    claimed: dict[tuple[str, str], str] = {}
    for mapping in mappings:
        if mapping.section_id is None:
            continue
        key = (mapping.lesson_id, mapping.section_id)
        if key in claimed:
            mapping.notes.append(
                f"its name points at {mapping.lesson_id}/{mapping.section_id}, which "
                f"{claimed[key]} already claims; left unassigned"
            )
            mapping.blocked = True
            continue
        claimed[key] = mapping.audio.name

    # ---- 3. write the content tree --------------------------------------------
    grade_manifest = {"grade": 10, "subject": "English", "textbook": "Vision 1 - English for Schools", "lessons": []}

    # Every section's vocabulary in one file, so a lesson that is added later appears
    # here by itself without anything else having to change.
    grade_vocabulary: list[dict] = []

    for lesson in lessons:
        lesson_id = lesson.lesson_id
        published = [s for s in lesson.sections if s.section_id not in book.WITHDRAWN_SECTION_IDS]

        # A section that was published and is now withdrawn leaves its file behind, and
        # nothing reads the manifest to find that.  It is deleted here instead, so the
        # text of a withdrawn section cannot survive a rebuild or be served by accident.
        _prune_withdrawn(DATA / lesson_id, lesson)

        # What each section lists, worked out for the whole lesson before anything is
        # written: the word banks are printed beside other sections' text but belong to
        # the lesson's vocabulary page, so they cannot be collected one section at a time.
        listed = vocabulary.entries_by_section(
            doc,
            [(s.section_id, tuple(s.pages)) for s in published],
        )
        new_words_listing = listed.get(vocabulary.NEW_WORDS_SECTION_ID, [])

        lesson_sections = []
        for section in published:
            data = sections[lesson_id][section.section_id]
            section_vocabulary = [
                entry.as_json(10, lesson_id, section.section_id)
                for entry in listed[section.section_id]
            ]
            grade_vocabulary.extend(section_vocabulary)
            mapping = next(
                (m for m in mappings if m.assigned
                 and m.lesson_id == lesson_id and m.section_id == section.section_id),
                None,
            )
            audio_name = None
            audio_duration = 0.0
            if mapping:
                audio_name = f"audio/grade-10/{lesson_id}/{section.section_id}.mp3"
                audio_duration = mapping.audio.duration

            write_json(
                DATA / lesson_id / "sections" / f"{section.section_id}.json",
                {
                    "id": section.section_id,
                    "lessonId": lesson_id,
                    "label": section.label,
                    "title": section.description or section.label,
                    "source": {"pdf": "10th-class/" + book.BOOK_FILENAME, "pages": list(section.pages)},
                    "blocks": [
                        {"page": b["page"], "lines": b["lines"]}
                        for b in data["blocks"]
                    ],
                    "text": "\n".join(" ".join(b["lines"]) for b in data["blocks"]),
                    # The words the book points at inside this text.  Kept beside it, as
                    # the vocabulary is: the reader picks them out of the running text by
                    # these words, so what it shows as new is what the book set as new.
                    "targets": data["targets"],
                    # The vocabulary listed on this page.  Kept beside the text, not
                    # inside it: the text stays exactly as printed, word banks included,
                    # and a word bank is never repeated here as a vocabulary item.
                    "vocabulary": section_vocabulary,
                },
            )

            lesson_sections.append({
                "id": section.section_id,
                "label": section.label,
                "title": section.description or section.label,
                "pages": list(section.pages),
                "text": "data/grade-10/%s/sections/%s.json" % (lesson_id, section.section_id),
                "audio": audio_name,
                "duration": round(audio_duration, 3),
                "sync": (
                    "data/grade-10/%s/synchronization/%s.sync.json" % (lesson_id, section.section_id)
                    if audio_name else None
                ),
                "syncConfidence": round(mapping.content_score, 4) if mapping else None,
                "syncStatus": mapping.status if mapping else "no-audio",
            })

            if audio_name:
                write_json(
                    DATA / lesson_id / "synchronization" / f"{section.section_id}.sync.json",
                    build_sync(data["words"], mapping.audio.transcript_words, audio_duration,
                               mapping, section, lesson_id),
                )
                target = AUDIO_OUT / lesson_id / f"{section.section_id}.mp3"
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(mapping.audio.path, target)

        write_json(
            DATA / lesson_id / "manifest.json",
            {
                "id": lesson_id,
                "number": lesson.number,
                "title": lesson.title,
                "grade": 10,
                "subject": "English",
                "tocLine": lesson.toc_line,
                "pages": list(lesson.page_range),
                "sections": lesson_sections,
                "vocabulary": f"data/grade-10/{lesson_id}/vocabulary.json",
            },
        )

        vocab_section = sections[lesson_id].get("new-words-and-expressions")
        convo_section = sections[lesson_id].get("conversation")
        write_json(
            DATA / lesson_id / "vocabulary.json",
            {
                "lessonId": lesson_id,
                "source": {
                    "pdf": "10th-class/" + book.BOOK_FILENAME,
                    "definitionPages": list(vocab_section["meta"].pages) if vocab_section else [],
                    "previewPage": convo_section["meta"].pages[0] if convo_section else None,
                },
                "targetWords": (
                    _target_words(doc, convo_section["meta"]) if convo_section else []
                ),
                # The same ordered listing the New Words page carries, so the reader
                # shows every word bank word there without any per-section special case.
                "items": vocabulary_items(new_words_listing),
            },
        )

        grade_manifest["lessons"].append({
            "id": lesson_id,
            "number": lesson.number,
            "title": lesson.title,
            "tocLine": lesson.toc_line,
            "pages": list(lesson.page_range),
            "manifest": f"data/grade-10/{lesson_id}/manifest.json",
            "sectionCount": len(lesson_sections),
            "audioCount": sum(1 for s in lesson_sections if s["audio"]),
        })

    write_json(DATA / "manifest.json", grade_manifest)
    # Counted by the section each entry is listed in, so the totals match the section
    # files.  A word bank word counts once, on the vocabulary page that lists it.
    section_counts: dict[tuple[str, str], int] = {}
    for entry in grade_vocabulary:
        key = (entry["lessonId"], entry["listedIn"])
        section_counts[key] = section_counts.get(key, 0) + 1
    write_json(
        DATA / "vocabulary.json",
        {
            "grade": 10,
            "subject": "English",
            "textbook": "Vision 1 - English for Schools",
            "sections": [
                {"lessonId": lesson_id, "sectionId": section_id, "count": count}
                for (lesson_id, section_id), count in sorted(section_counts.items())
            ],
            "entries": grade_vocabulary,
        },
    )

    for lesson in lessons:
        write_json(
            DATA / lesson.lesson_id / "provenance.json",
            {
                "lessonId": lesson.lesson_id,
                "textbook": {"file": "10th-class/" + book.BOOK_FILENAME, "sha256": book_sha},
                "tocLine": lesson.toc_line,
                "sections": [
                    {
                        "id": s.section_id,
                        "label": s.label,
                        "contentsDescription": s.description,
                        "pages": list(s.pages),
                        # The extraction covers every section in the book, including the
                        # ones the reader does not publish.
                        "published": s.section_id not in book.WITHDRAWN_SECTION_IDS,
                        "textSource": "verbatim PDF text extraction (pymupdf)",
                        "audio": next(
                            (m.audio.name for m in mappings
                             if m.assigned and m.lesson_id == lesson.lesson_id
                             and m.section_id == s.section_id),
                            None,
                        ),
                    }
                    for s in lesson.sections
                ],
            },
        )

    unmapped = [m.audio.name for m in mappings if not m.assigned]
    write_json(
        ROOT / "data" / "audio-mapping.json",
        {
            "generatedBy": GENERATED_BY,
            "sourceDirectory": "10th-class",
            "rule": {
                "authoritative": "filename",
                "pattern": "<section name><lesson number>.mp3",
                "examples": {
                    "conversation1.mp3": "lesson-01 / conversation",
                    "New Words & Expressions2.mp3": "lesson-02 / new-words-and-expressions",
                    "Listening & Speaking2.mp3": "lesson-02 / listening-and-speaking",
                },
                "contentSimilarity": "corroboration only; it never changes the assignment",
            },
            "audio": [
                {
                    "file": m.audio.name,
                    "duration": round(m.audio.duration, 3),
                    "lessonId": m.lesson_id,
                    "sectionId": m.section_id,
                    "rule": "filename",
                    "contentScore": round(m.content_score, 4),
                    "status": m.status,
                    "method": m.method,
                    "contentBest": (
                        {"score": round(m.content_best[0], 4), "lessonId": m.content_best[1],
                         "sectionId": m.content_best[2]} if m.content_best else None
                    ),
                    "notes": m.notes,
                }
                for m in mappings
            ],
            "unmapped": unmapped,
        },
    )

    return {"lessons": lessons, "sections": sections, "mappings": mappings,
            "transcripts": transcripts, "book_sha": book_sha}


if __name__ == "__main__":
    result = build()
    for mapping in result["mappings"]:
        print(f"{mapping.audio.name:32s} -> {mapping.lesson_id}/{mapping.section_id} "
              f"by filename, content={mapping.content_score:.3f} status={mapping.status} "
              f"notes={mapping.notes}")
