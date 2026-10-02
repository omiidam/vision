# Vision 1 &middot; Grade 10 English &middot; Lessons 1 &amp; 2

An offline-first reader for the **Vision 1 – English for Schools** Grade 10 textbook
(`10th-class/10th.pdf`). It shows the book's own text and plays the recordings that ship
beside it, highlighting the word that is being spoken. Tapping any word seeks the audio to
that word and continues playing.

Only **Grade 10**, **Lesson 1 (Saving Nature)** and **Lesson 2 (Wonders of Creation)** are
implemented, as specified. The content pipeline is written so further lessons and grades
need data, not code.

---

## How it works

```
10th-class/10th.pdf   ─┐
10th-class/*.mp3      ─┼─►  tools/  ─►  data/grade-10/**  ─►  src/  ─►  dist/  ─►  Android APK
                      ─┘   (Python)     (JSON, committed)   (TS)
```

* The **PDF is the canonical text**. Every displayed sentence is extracted verbatim.
* The **audio supplies the timing only**. Word timestamps come from speech recognition and
  are aligned onto the printed words, so the reader always shows the textbook's wording.
* The **file name assigns each recording to a section**. The recordings are named
  `<section name><lesson number>.mp3`, so `conversation1.mp3` is the Conversation of
  Lesson 1 and `New Words & Expressions2.mp3` is the New Words & Expressions of Lesson 2.
  The transcript is still scored against that section, but only to corroborate the name -
  it never moves a recording, and any disagreement is recorded in `data/audio-mapping.json`.
* The UI contains **no lesson content at all**. It fetches manifests from `data/` at
  runtime, so Lesson 3+ is a data task.

---

## Repository layout

```
10th-class/                 source material (PDF + the eight recordings)
11th.pdf, 12th.pdf          other books in the same source folder (not processed yet)

tools/                      ingestion pipeline (Python)
  textbook.py               reads the book: contents pages, section pages, page text
  text.py                   splits extracted lines into blocks / sentences / words
  transcribe.py             faster-whisper word-level timestamps
  audio_map.py              file-name based audio -> section mapping, with corroboration
  align.py                  forced alignment of textbook words onto the audio timeline
  build_content.py          writes the whole data/ tree
  validate.py               regenerates the validation report

data/grade-10/              processed content (committed, fetched at runtime)
  manifest.json             grade -> lessons
  lesson-01/lesson-02/
    manifest.json           lesson -> sections (title, pages, audio, sync, confidence)
    sections/*.json         the canonical textbook text of one section
    synchronization/*.json  word + sentence timestamps for one section
    vocabulary.json         New Words & Expressions, as printed
    provenance.json         which pages and which recording each section came from
  audio-mapping.json        every recording, the section its file name points at, and any caveat

audio/grade-10/lesson-01|02/   the recordings, renamed to their section id

src/                        the application (TypeScript, no framework)
  sync.ts                   the synchronization engine (audio <-> text)
  player.ts                 the <audio> wrapper
  content.ts                data loading
  views/home.ts             lesson list
  views/lesson.ts           the reader: text, player, highlighting, click-to-seek

tests/                      node:test suites for the engine and the generated data
```

---

## Running the app

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm test           # engine + data integrity tests
```

`data/` and `audio/` are served and copied by a small Vite plugin, so they keep their
real folder layout in development and in the production build.

---

## Building the Android APK

The Android app is Capacitor; `android/` is committed so a fresh clone can build directly.

```bash
npm install
npm run build
npm run sync                 # copies dist/ into android/app/src/main/assets/public
cd android && ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run apk:build` does the same in one command. On Windows use `gradlew.bat assembleDebug`.

Requirements and local settings:

* **JDK 17**. This project pins Capacitor 6 on purpose: Capacitor 7 and later require
  JDK 21, and this repository is meant to build with the JDK 17 that is installed here.
  Upgrading to Capacitor 8 later is a `package.json` change plus `npx cap add android`.
* **Android SDK** with `ANDROID_HOME` set.
* `android/variables.gradle` carries the `compileSdkVersion` / `buildToolsVersion` this
  machine has installed (36 / 37.0.0). If your SDK differs, change those two numbers; the
  root `android/build.gradle` applies the build-tools revision to the Capacitor library
  modules too, which is why the plugin's own 34.0.0 default does not break the build.

A debug APK was produced successfully from this tree; APKs and Gradle output are
git-ignored, so a clone starts clean.

---

## Regenerating the content

```bash
pip install pymupdf faster-whisper

python tools/transcribe.py 10th-class     # .work/transcripts/*.json (cached; skip if present)
python tools/build_content.py 10th-class  # rewrites data/ and audio/
python tools/validate.py 10th-class       # rewrites VALIDATION.md
```

`tools/build_content.py` never invents content: section titles come from the book's
table of contents, section text comes from the book's pages, and vocabulary comes from the
printed New Words & Expressions lists. Persian meanings are **not** in the PDF text layer,
so `meaningFa` is deliberately empty rather than filled in.

The Whisper model is downloaded once into `.work/models/` (git-ignored).

---

## Synchronization, in one paragraph

`build_content.py` aligns the printed word list against the recognised word timeline with a
dynamic-programming alignment. Exact matches cost nothing, near matches cost
`1 - similarity`, a printed word the recording never says costs more than a filler word the
recording says but the book does not print. The result is a strictly increasing table of
`{word, start, end}`. At runtime `SyncEngine.wordIndexAt(currentTime)` binary-searches that
table to pick the active word, and `SyncEngine.timeForWord(index)` is the inverse used when
a word is clicked. Both directions read the same table, so they cannot disagree, and
`tests/sync.test.mjs` asserts the round trip against the real generated data.

Words the recording does not speak keep `start: null`: they are shown, but never highlighted
and never seekable, because inventing a timestamp for them would be a lie.

---

## Extending to Lesson 3+

1. Add the lesson's page ranges to `SECTION_PAGES` in `tools/textbook.py`.
2. Drop the recordings into `10th-class/`.
3. Run `transcribe.py`, then `build_content.py`.

No application code changes are required; the reader builds its tabs, player and
synchronization from the generated manifests.
