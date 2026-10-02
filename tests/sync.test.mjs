import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSyncEngine } from './helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const SAMPLE = {
  sectionId: 'sample',
  lessonId: 'lesson-01',
  audio: 'audio/x.mp3',
  sourceAudioFile: 'x.mp3',
  duration: 10,
  method: 'test',
  confidence: 1,
  mapping: { status: 'confirmed', method: 'test', contentScore: 1, runnerUp: null, notes: [] },
  words: [
    { word: 'Hello', start: 1, end: 1.5, match: 'exact', similarity: 1, spokenAs: 'Hello' },
    { word: 'brave', start: 1.5, end: 2, match: 'exact', similarity: 1, spokenAs: 'brave' },
    { word: 'world', start: null, end: null, match: null, similarity: null, spokenAs: null },
    { word: 'again', start: 3, end: 3.6, match: 'exact', similarity: 1, spokenAs: 'again' },
  ],
  sentences: [
    { first: 0, last: 1, start: 1, end: 2, text: 'Hello brave' },
    { first: 2, last: 3, start: 3, end: 3.6, text: 'world again' },
  ],
  unspokenAudio: [],
}

test('audio -> text: the word being spoken is found from a timestamp', () => {
  const engine = createSyncEngine(SAMPLE)
  assert.equal(engine.wordIndexAt(0.5), -1, 'before the first timed word nothing is active')
  assert.equal(engine.wordIndexAt(1.2), 0)
  assert.equal(engine.wordIndexAt(1.7), 1)
  assert.equal(engine.wordIndexAt(3.2), 3)
  assert.equal(engine.wordIndexAt(9.9), 3)
})

test('audio -> text: unspeached words never become active', () => {
  const engine = createSyncEngine(SAMPLE)
  for (let t = 0; t < 10; t += 0.01) {
    assert.notEqual(engine.wordIndexAt(t), 2, 'the untimed word must stay inactive')
  }
})

test('text -> audio: a word resolves to its own timestamp', () => {
  const engine = createSyncEngine(SAMPLE)
  assert.equal(engine.timeForWord(0), 1)
  assert.equal(engine.timeForWord(3), 3)
  assert.equal(engine.timeForWord(2), null, 'an unspeached word is not seekable')
})

test('text -> audio: a sentence resolves to the start of the spoken sentence', () => {
  const engine = createSyncEngine(SAMPLE)
  assert.equal(engine.sentenceAt(1), 0)
  assert.equal(engine.sentenceAt(3), 1)
  assert.equal(engine.sentenceStartAt(1), 1)
  assert.equal(engine.sentenceStartAt(3), 3)
})

test('the two directions agree on the real generated data', () => {
  const file = path.join(ROOT, 'data', 'grade-10', 'lesson-01', 'synchronization', 'reading.sync.json')
  const engine = createSyncEngine(readJson(file))
  let checked = 0
  engine.words.forEach((word, index) => {
    if (word.start === null) return
    assert.equal(engine.wordIndexAt(word.start + 0.01), index, `mismatch at "${word.word}"`)
    checked += 1
  })
  assert.ok(checked > 100, 'expected many timed words in the reading')
})

test('timed ratio reports how much of the page is spoken', () => {
  const engine = createSyncEngine(SAMPLE)
  assert.equal(engine.timedRatio, 0.75)
  assert.ok(engine.hasTiming)
})
