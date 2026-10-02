"""Forced alignment of textbook text onto an audio recording.

Whisper gives us word timings for *what was actually spoken*.  The textbook gives us the
*canonical text*.  This module puts the two together with a dynamic-programming
alignment over normalised tokens:

  * exact match                       cost 0
  * near match (fuzzy)                cost 1 - similarity
  * textbook word that was not spoken         cost TEXTBOOK_GAP
  * spoken word absent from the textbook      cost SPEECH_GAP

Textbook words that are skipped by the recording (fill-in-the-blank dots, headings that
are only printed) therefore keep a null timestamp instead of being given a fake one.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass

from text import normalize_word

TEXTBOOK_GAP = 1.10
SPEECH_GAP = 0.55
MATCH_CEILING = 0.62        # similarity above which a fuzzy match is trusted

# Textbook words the recording does not speak keep a null timestamp.  Guessing one would
# highlight a word at a moment when nothing is being said, so the table stays honest.


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


@dataclass
class AlignedToken:
    text: str
    start: float | None
    end: float | None
    similarity: float | None
    spoken_as: str | None
    interpolated: bool = False


@dataclass
class SpeechIsland:
    """A run of consecutive audio words that had no textbook counterpart."""
    start: float
    end: float
    text: str


def align(textbook: list[str], speech: list[tuple[str, float, float]]) -> tuple[list[AlignedToken], list[SpeechIsland], float]:
    """Align ``textbook`` words against timed ``speech`` words.

    Returns ``(tokens, islands, confidence)``.
    """
    ref = [normalize_word(w) for w in textbook]
    hyp = [normalize_word(w) for w, _, _ in speech]
    n, m = len(ref), len(hyp)

    # best[i][j] = cheapest way to consume the first i textbook words using the first j
    # spoken words.  Stored as three parallel matrices to keep memory flat.
    inf = float("inf")
    best = [[inf] * (m + 1) for _ in range(n + 1)]
    back = [[0] * (m + 1) for _ in range(n + 1)]   # 0 diag, 1 skip textbook word, 2 skip spoken word
    best[0][0] = 0.0
    for j in range(1, m + 1):
        best[0][j] = best[0][j - 1] + SPEECH_GAP
        back[0][j] = 2

    for i in range(1, n + 1):
        best[i][0] = best[i - 1][0] + TEXTBOOK_GAP
        back[i][0] = 1
        for j in range(1, m + 1):
            sim = similarity(ref[i - 1], hyp[j - 1])
            diag = best[i - 1][j - 1] + (1.0 - sim)
            skip_ref = best[i - 1][j] + TEXTBOOK_GAP
            skip_hyp = best[i][j - 1] + SPEECH_GAP
            options = ((diag, 0), (skip_ref, 1), (skip_hyp, 2))
            best[i][j], back[i][j] = min(options, key=lambda o: (o[0], o[1]))

    path: list[tuple[int, int, float]] = []
    i, j = n, m
    while i > 0 or j > 0:
        move = back[i][j]
        if move == 0 and i > 0 and j > 0:
            path.append((i - 1, j - 1, similarity(ref[i - 1], hyp[j - 1])))
            i, j = i - 1, j - 1
        elif move == 1:
            path.append((i - 1, -1, 0.0))
            i -= 1
        else:
            path.append((-1, j - 1, 0.0))
            j -= 1
    path.reverse()

    tokens: list[AlignedToken] = []
    islands: list[SpeechIsland] = []
    run: list[str] = []

    def close_island() -> None:
        if run:
            islands.append(SpeechIsland(speech[sp_start][1], speech[sp_start + len(run) - 1][2], " ".join(run)))
            run.clear()

    sp_start = 0
    for ti, sj, sim in path:
        if ti >= 0 and sj >= 0:
            close_island()
            _, start, end = speech[sj]
            tokens.append(AlignedToken(textbook[ti], round(start, 3), round(end, 3), round(sim, 3), speech[sj][0]))
        elif ti >= 0:
            close_island()
            tokens.append(AlignedToken(textbook[ti], None, None, None, None))
        else:
            if not run:
                sp_start = sj
            run.append(speech[sj][0])
    close_island()

    matched = [t for t in tokens if t.start is not None]
    confident = [t for t in matched if (t.similarity or 0) >= MATCH_CEILING]
    confidence = len(confident) / len(tokens) if tokens else 0.0
    return tokens, islands, round(confidence, 4)
