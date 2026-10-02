"""Speech-to-text with word-level timestamps.

Uses faster-whisper (CTranslate2).  The model directory is resolved from, in order:
``VISION_WHISPER_MODEL`` environment variable, a local ``.work/models/<name>`` folder,
then the Hugging Face hub id.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

WORK_DIR = Path(__file__).resolve().parent.parent / ".work"
TRANSCRIPT_DIR = WORK_DIR / "transcripts"

DEFAULT_MODEL = "small.en"


def resolve_model(name: str = DEFAULT_MODEL) -> str:
    override = os.environ.get("VISION_WHISPER_MODEL")
    if override:
        return override
    local = WORK_DIR / "models" / name
    if (local / "model.bin").exists():
        return str(local)
    return name


def _patch_av() -> None:
    """faster-whisper passes ``metadata_errors`` to ``av.open``; PyAV >= 17 dropped it."""
    try:
        import av
    except ImportError:  # pragma: no cover
        return
    original = av.open

    def open_(file, mode="r", **kwargs):
        kwargs.pop("metadata_errors", None)
        return original(file, mode, **kwargs)

    av.open = open_


def ensure_model(name: str = DEFAULT_MODEL) -> str:
    """Download the CTranslate2 model into ``.work/models`` when it is missing."""
    model_dir = WORK_DIR / "models" / name
    if (model_dir / "model.bin").exists():
        return str(model_dir)
    from huggingface_hub import snapshot_download

    repo = f"Systran/faster-whisper-{name}"
    model_dir.parent.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=repo,
        local_dir=str(model_dir),
        allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"],
    )
    return str(model_dir)


def transcribe_file(path: Path, model_name: str = DEFAULT_MODEL) -> dict:
    _patch_av()
    from faster_whisper import WhisperModel

    model = WhisperModel(resolve_model(model_name), device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(path), word_timestamps=True, beam_size=5, vad_filter=False)
    result = {
        "source_file": path.name,
        "model": model_name,
        "duration": round(info.duration, 3),
        "language": info.language,
        "segments": [],
    }
    for segment in segments:
        result["segments"].append({
            "id": segment.id,
            "start": round(segment.start, 3),
            "end": round(segment.end, 3),
            "text": segment.text,
            "words": [
                {"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3), "probability": round(w.probability, 3)}
                for w in (segment.words or [])
            ],
        })
    return result


#: Whisper occasionally reports a word with no duration at all - it lands on the same
#: instant as its neighbour.  Such a word can never be "the word the audio is inside",
#: because there is no instant inside it, so it would be silently skipped by the reader.
MIN_WORD_SECONDS = 0.02


def _span(start: float, end: float, previous_end: float | None, following_start: float | None) -> tuple[float, float]:
    """A word's span, widened when the recogniser reported no duration for it.

    The audio either side of the word is what bounds it: the end of the word before and
    the start of the word after.  The word is given the space between them, so it keeps
    its place on the timeline and is something the reader can actually land on.
    """
    if end > start:
        return start, end
    if following_start is not None and following_start > start:
        return start, following_start
    if previous_end is not None and previous_end < start:
        return previous_end, start
    return start, start + MIN_WORD_SECONDS


def speech_words(transcript: dict) -> list[tuple[str, float, float]]:
    """Flatten a transcript into ``(word, start, end)`` triples in timeline order."""
    words: list[tuple[str, float, float]] = []
    for segment in transcript["segments"]:
        for word in segment["words"]:
            words.append((word["word"], float(word["start"]), float(word["end"])))
    words.sort(key=lambda w: w[1])

    # A word and its neighbour sometimes share one instant, so the order between them is
    # not fixed by the sort alone; it is kept stable so the repair below sees the words in
    # the order they are spoken.
    repaired: list[tuple[str, float, float]] = []
    for position, (text, start, end) in enumerate(words):
        previous_end = repaired[-1][2] if repaired else None
        following_start = words[position + 1][1] if position + 1 < len(words) else None
        fixed_start, fixed_end = _span(start, end, previous_end, following_start)
        # A word that was given a duration only because it was the very last one has no
        # audio of its own to describe.  Timing it would invent a highlight the recording
        # cannot back, so it is left for the aligner to treat as unspoken.
        if fixed_end - fixed_start <= MIN_WORD_SECONDS and end <= start:
            continue
        repaired.append((text, fixed_start, fixed_end))
    return repaired


def main(argv: list[str]) -> int:
    source = Path(argv[1]) if len(argv) > 1 else None
    model_name = os.environ.get("VISION_WHISPER_MODEL_NAME", DEFAULT_MODEL)
    if source is None or source.is_dir():
        directory = Path(source or os.environ.get("VISION_SOURCE", "../10th-class"))
        files = sorted(directory.glob("*.mp3"))
    else:
        files = [source]

    ensure_model(model_name)
    TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)
    for file in files:
        out = TRANSCRIPT_DIR / f"{file.stem}.json"
        if out.exists():
            print(f"skip {file.name} (already transcribed)")
            continue
        print(f"transcribing {file.name} ...", flush=True)
        json.dump(transcribe_file(file, model_name), out.open("w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  -> {out.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
