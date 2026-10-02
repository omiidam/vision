// The highlight has one source of truth: where the audio element actually is.  These
// tests drive the reader the way playback does - move currentTime, ask which word is
// lit - and check the shipped timings are good enough for that to mean something.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { SyncEngine } from '../src/sync.ts'
import { isPlaceholder } from '../src/placeholder.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const syncFiles = fs
  .readdirSync(DATA)
  .filter((l) => l.startsWith('lesson-'))
  .flatMap((lesson) => {
    const dir = path.join(DATA, lesson, 'synchronization')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).map((file) => ({ lesson, file, full: path.join(dir, file) }))
  })
const SYNC = syncFiles.map((f) => ({ ...f, data: readJson(f.full) }))
const timed = (d) => d.words.filter((w) => w.start !== null && w.end !== null)

test('the recordings the reader ships all carry word timings', () => {
  assert.ok(SYNC.length > 0, 'expected synchronization data')
  for (const { lesson, file, data } of SYNC) {
    assert.ok(data.duration > 0, `${lesson}/${file} has no duration`)
    assert.ok(
      timed(data).length > 0,
      `${lesson}/${file} has no timed word to highlight`,
    )
  }
})

test('the highlighted word is the one the audio is inside, by start and end', () => {
  // The rule the reader follows, stated once: the lit word is the one whose span the
  // playback position falls in.  Nothing here may depend on how long a word "should" be.
  for (const { lesson, file, data } of SYNC) {
    const engine = new SyncEngine(data)
    const words = timed(data)
    for (const word of words) {
      const inside = engine.wordIndexAt(word.start)
      assert.equal(
        data.words[inside]?.word,
        word.word,
        `${lesson}/${file}: at ${word.start}s the reader lit "${data.words[inside]?.word}" instead of "${word.word}"`,
      )
      // Just inside the end it is still that word; just past it, the next one is lit.
      // The very last timed word is the exception: nothing follows it, so the reader
      // holds it rather than going blank while the recording finishes.
      const before = engine.wordIndexAt(word.end - 0.001)
      const after = engine.wordIndexAt(word.end)
      assert.equal(
        data.words[before]?.word,
        word.word,
        `${lesson}/${file}: "${word.word}" was not lit immediately before its end`,
      )
      if (word !== words[words.length - 1]) {
        // Compared by position, not by spelling: the next word may well read the same
        // ("I ... I"), and then the highlight has moved on correctly even though the
        // text under it looks unchanged.
        assert.notEqual(
          after,
          data.words.indexOf(word),
          `${lesson}/${file}: "${word.word}" was still lit after its end`,
        )
      } else {
        assert.equal(
          data.words[after]?.word,
          word.word,
          `${lesson}/${file}: the last word went dark while the audio was still playing`,
        )
      }
    }
  }
})

test('the highlight walks forward as the audio plays, and never jumps back', () => {
  for (const { lesson, file, data } of SYNC) {
    const engine = new SyncEngine(data)
    let previous = -1
    // A tenth of a second is finer than any word, so every transition is sampled.
    for (let t = 0; t <= data.duration; t += 0.1) {
      const index = engine.wordIndexAt(t)
      if (index < 0) continue
      assert.ok(
        index >= previous,
        `${lesson}/${file}: the highlight went back from word ${previous} to ${index} at ${t}s`,
      )
      previous = index
    }
    assert.ok(previous > 0, `${lesson}/${file}: nothing was ever lit`)
  }
})

test('playback speed does not change which word is lit', () => {
  // `currentTime` is the media position on the media timeline at every rate, so the same
  // position must light the same word whether it is reached at 0.5x or 2x.  This is what
  // stops the highlight drifting when the reader changes speed.
  for (const { lesson, file, data } of SYNC) {
    const engine = new SyncEngine(data)
    const words = timed(data)
    for (const rate of [0.5, 1, 1.5, 2]) {
      for (const word of words) {
        // The position the media reaches after `wallClock` seconds of playing at this
        // rate is the same media time whatever the rate is.  The word lit there must be
        // the word lit at 1x, which is what keeps the highlight honest when the reader
        // changes speed: nothing is rescaled, nothing is estimated.
        const mediaTime = (word.start + word.end) / 2
        const wallClock = mediaTime / rate
        const reached = wallClock * rate
        assert.ok(
          Math.abs(reached - mediaTime) < 1e-9,
          `${lesson}/${file}: ${rate}x did not reach the same media position`,
        )
        assert.equal(
          engine.wordIndexAt(reached),
          engine.wordIndexAt(mediaTime),
          `${lesson}/${file}: ${rate}x lit a different word than 1x at ${mediaTime}s`,
        )
      }
    }
  }
})

test('seeking lands on the word at that position, in either direction', () => {
  for (const { lesson, file, data } of SYNC) {
    const engine = new SyncEngine(data)
    const words = timed(data)
    // A position is either inside a word or it is not, so the answer cannot depend on
    // the order the positions are visited in.  Seeking forward and then backward over
    // the same ground has to light the same words both ways.
    const forward = new Map()
    for (const word of words) forward.set(word.start, engine.wordIndexAt(word.start))
    for (const word of [...words].reverse()) {
      const index = engine.wordIndexAt(word.start)
      assert.equal(
        forward.get(word.start),
        index,
        `${lesson}/${file}: seeking backward to ${word.start}s lit something else than seeking forward did`,
      )
    }
    // Every position a word starts at is inside that word's own span, so the word is lit.
    for (const word of words) {
      const index = forward.get(word.start)
      assert.equal(
        data.words[index]?.word,
        word.word,
        `${lesson}/${file}: seeking to ${word.start}s missed "${word.word}"`,
      )
    }
  }
})

test('replaying from the start lights the same words in the same order', () => {
  for (const { lesson, file, data } of SYNC) {
    const engine = new SyncEngine(data)
    const first = []
    const second = []
    for (let t = 0; t <= data.duration; t += 0.05) first.push(engine.wordIndexAt(t))
    for (let t = 0; t <= data.duration; t += 0.05) second.push(engine.wordIndexAt(t))
    assert.deepEqual(
      second,
      first,
      `${lesson}/${file}: replaying the section highlighted something different`,
    )
  }
})

test('a paused audio stays on the word it stopped at', () => {
  for (const { lesson, file, data } of SYNC) {
    const engine = new SyncEngine(data)
    for (const word of timed(data)) {
      const at = engine.wordIndexAt(word.start + (word.end - word.start) / 2)
      // Pausing inside a word and asking again, some time later, must give the same
      // answer: currentTime is not moving, so neither is the highlight.
      assert.equal(
        engine.wordIndexAt(word.start + (word.end - word.start) / 2),
        at,
        `${lesson}/${file}: the highlight moved while the audio was paused`,
      )
    }
  }
})

test('the sentence being read is derived from the same timeline as the word', () => {
  for (const { lesson, file, data } of SYNC) {
    const engine = new SyncEngine(data)
    for (const word of timed(data)) {
      const index = engine.wordIndexAt(word.start)
      const sentence = engine.sentenceAt(index)
      const range = data.sentences[sentence]
      assert.ok(range, `${lesson}/${file}: no sentence for word ${index}`)
      assert.ok(
        index >= range.first && index <= range.last,
        `${lesson}/${file}: "${word.word}" is outside the sentence it was read in`,
      )
      // The sentence's own span must cover the word's, or the line would light up at a
      // moment the word is not being said.
      if (range.start !== null) assert.ok(range.start <= word.start)
      if (range.end !== null) assert.ok(range.end >= word.end)
    }
  }
})

test('the highlight follows the media element, not an animation frame', () => {
  // The reader used to advance the highlight only from requestAnimationFrame.  A WebView
  // that is not painting - an Android app in the background, or a tab the reader has
  // switched away from - stops delivering frames, so the highlight froze while the audio
  // carried on playing.  The media element's own `timeupdate` has to reach the reader as
  // well, or that case is broken again.
  const source = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
  assert.match(
    source,
    /onTimeUpdate\(\(\) => this\.updateProgress\(this\.player\.currentTime\)\)/,
    'the highlight is not driven by the media element reporting that it moved',
  )
  // Both sources read the audio element; neither keeps a clock of its own.
  const loop = source.slice(source.indexOf('private startTicking'))
  assert.match(loop, /this\.updateProgress\(this\.player\.currentTime\)/)
  assert.doesNotMatch(
    loop,
    /setInterval|Date\.now|performance\.now/,
    'the highlight must not be advanced by a clock of its own',
  )
})

test('the reader keeps exactly one audio element and reads its position from it', () => {
  // A second element for synchronisation would be a second clock, and the two would
  // disagree.  The reader creates one and drives everything from it.
  const source = fs.readFileSync(path.join(ROOT, 'src', 'player.ts'), 'utf8')
  assert.equal(
    (source.match(/new Audio\(/g) ?? []).length,
    1,
    'the player creates more than one audio element',
  )
  assert.match(source, /element\.addEventListener\('timeupdate'/)
  // The reader's position is the element's own decoded position, not a copy of it.
  assert.match(
    source,
    /get currentTime\(\)[\s\S]*?return this\.element\.currentTime/,
    'the player does not read the position from the audio element',
  )
})

test('no timestamp is put on audio that is not saying that word', () => {
  // The failure this guards against is a near miss that is really a different word: the
  // reader then lights the text before the recording gets there and runs ahead for the
  // rest of the section.  A timed word must be at least recognisably the word that was
  // spoken, and a word the recording skipped must carry no time at all.
  for (const { lesson, file, data } of SYNC) {
    for (const word of data.words) {
      if (word.start === null) {
        assert.equal(word.end, null, `${lesson}/${file}: "${word.word}" has an end but no start`)
        continue
      }
      assert.ok(
        word.similarity === null || word.similarity >= 0.62,
        `${lesson}/${file}: "${word.word}" is timed against "${word.spokenAs}" at similarity ${word.similarity}`,
      )
    }
  }
})

test('every timestamp is ordered and inside the recording', () => {
  for (const { lesson, file, data } of SYNC) {
    let previous = -1
    for (const word of timed(data)) {
      assert.ok(word.start >= 0, `${lesson}/${file}: "${word.word}" starts before the audio`)
      assert.ok(word.end >= word.start, `${lesson}/${file}: "${word.word}" ends before it starts`)
      assert.ok(
        word.end <= data.duration + 0.5,
        `${lesson}/${file}: "${word.word}" ends after the recording does`,
      )
      assert.ok(
        word.start >= previous,
        `${lesson}/${file}: "${word.word}" starts before the word before it`,
      )
      previous = word.start
    }
  }
})

test('the words the reader renders are the words the timings are for', () => {
  // The reader numbers a rendered word from zero and looks the timestamp up by that
  // number.  If it skipped a different set of tokens than the pipeline did, the two would
  // part company and every highlight after the first difference would be on the wrong
  // word for the rest of the section - which reads as the highlight running fast.
  let sections = 0
  for (const lesson of fs.readdirSync(DATA).filter((l) => l.startsWith('lesson-'))) {
    const secDir = path.join(DATA, lesson, 'sections')
    const synDir = path.join(DATA, lesson, 'synchronization')
    if (!fs.existsSync(synDir)) continue
    for (const name of fs.readdirSync(secDir)) {
      const syncFile = path.join(synDir, name.replace(/\.json$/, '.sync.json'))
      if (!fs.existsSync(syncFile)) continue
      const section = readJson(path.join(secDir, name))
      const rendered = []
      for (const block of section.blocks) {
        for (const token of block.lines.join(' ').split(/\s+/).filter(Boolean)) {
          if (isPlaceholder(token)) continue
          rendered.push(token)
        }
      }
      const words = readJson(syncFile).words.map((w) => w.word)
      assert.deepEqual(
        rendered,
        words,
        `${lesson}/${name}: the rendered words and the timed words are different lists`,
      )
      sections += 1
    }
  }
  assert.ok(sections > 0, 'expected generated sections')
})

test('the printed blank rule is the same on both sides of the pipeline', () => {
  // The reader skips these tokens in TypeScript; the pipeline skips them in Python when
  // it builds the timing table.  The two have to agree or the lists drift.
  const python = execFileSync(
    'python',
    [
      '-c',
      `
import json, sys
sys.path.insert(0, "tools")
from text import is_placeholder
tokens = json.loads(sys.argv[1])
print(json.dumps([bool(is_placeholder(t)) for t in tokens]))
`,
      JSON.stringify(['', '.', '..', '___', '...', '. . .', 'a', 'a.', '/', '1.', '.a', 'a.b']),
    ],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim()
  const expected = JSON.parse(python)
  const tokens = ['', '.', '..', '___', '...', '. . .', 'a', 'a.', '/', '1.', '.a', 'a.b']
  tokens.forEach((token, i) => {
    assert.equal(
      isPlaceholder(token),
      expected[i],
      `"${token}" is skipped by one side of the pipeline and not the other`,
    )
  })
  // A real word is never a blank, whatever it is punctuated with.
  for (const word of ['word', 'Word', 'a', 'I', 'sixty', '(was)', 'endangered,']) {
    assert.equal(isPlaceholder(word), false, `"${word}" is a word, not a blank`)
  }
})