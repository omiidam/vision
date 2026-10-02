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


def speech_words(transcript: dict) -> list[tuple[str, float, float]]:
    """Flatten a transcript into ``(word, start, end)`` triples in timeline order."""
    words: list[tuple[str, float, float]] = []
    for segment in transcript["segments"]:
        for word in segment["words"]:
            words.append((word["word"], float(word["start"]), float(word["end"])))
    words.sort(key=lambda w: w[1])
    return words


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
