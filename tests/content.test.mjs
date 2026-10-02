import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

function syncFiles() {
  return fs
    .readdirSync(path.join(DATA, 'lesson-01', 'synchronization'))
    .map((name) => path.join(DATA, 'lesson-01', 'synchronization', name))
    .concat(
      fs
        .readdirSync(path.join(DATA, 'lesson-02', 'synchronization'))
        .map((name) => path.join(DATA, 'lesson-02', 'synchronization', name)),
    )
}

test('grade manifest exposes exactly lessons 1 and 2', () => {
  const manifest = readJson(path.join(DATA, 'manifest.json'))
  assert.equal(manifest.grade, 10)
  assert.equal(manifest.subject, 'English')
  assert.deepEqual(manifest.lessons.map((l) => l.id), ['lesson-01', 'lesson-02'])
  assert.deepEqual(manifest.lessons.map((l) => l.number), [1, 2])
  assert.ok(manifest.lessons.every((l) => l.title.length > 0 && !/TODO|placeholder/i.test(l.title)))
})

test('every section of both lessons exists and has real textbook text', () => {
  for (const lessonId of ['lesson-01', 'lesson-02']) {
    const lesson = readJson(path.join(DATA, lessonId, 'manifest.json'))
    assert.ok(lesson.sections.length >= 9, `${lessonId} should expose every section`)
    for (const section of lesson.sections) {
      const text = readJson(path.join(ROOT, section.text))
      assert.ok(text.blocks.length > 0, `${lessonId}/${section.id} has no blocks`)
      assert.ok(text.text.length > 20, `${lessonId}/${section.id} text is suspiciously short`)
      assert.ok(!/TODO|Lorem ipsum|placeholder/i.test(text.text))
      assert.deepEqual(text.blocks[0].lines.length > 0 ? true : [], true)
    }
  }
})

test('audio is only attached to sections whose recording exists on disk', () => {
  for (const lessonId of ['lesson-01', 'lesson-02']) {
    const lesson = readJson(path.join(DATA, lessonId, 'manifest.json'))
    for (const section of lesson.sections) {
      if (section.audio === null) {
        assert.equal(section.sync, null)
        assert.equal(section.duration, 0)
        continue
      }
      const audioPath = path.join(ROOT, section.audio)
      assert.ok(fs.existsSync(audioPath), `missing recording ${section.audio}`)
      assert.ok(section.duration > 1, `${section.audio} has no duration`)
      const sync = readJson(path.join(ROOT, section.sync))
      assert.equal(sync.lessonId, lessonId)
      assert.equal(sync.sectionId, section.id)
    }
  }
})

test('every source recording is mapped and reported', () => {
  const mapping = readJson(path.join(ROOT, 'data', 'audio-mapping.json'))
  const sources = fs
    .readdirSync(path.join(ROOT, '10th-class'))
    .filter((name) => name.toLowerCase().endsWith('.mp3'))
  const mapped = mapping.audio.filter((entry) => entry.sectionId !== null)
  assert.equal(mapped.length, sources.length, 'every recording must be mapped to a section')
  assert.deepEqual(mapping.unmapped, [])
  for (const entry of mapping.audio) {
    assert.ok(entry.confidence > 0.5, `${entry.file} confidence too low: ${entry.confidence}`)
    assert.equal(entry.status, 'confirmed')
  }
})

test('word timestamps are monotonic and inside the recording', () => {
  for (const file of syncFiles()) {
    const sync = readJson(file)
    let previous = -1
    for (const word of sync.words) {
      if (word.start === null) continue
      assert.ok(word.end !== null && word.end >= word.start, `${file}: bad interval for ${word.word}`)
      assert.ok(word.start >= previous, `${file}: timestamps are not monotonic at "${word.word}"`)
      assert.ok(word.end <= sync.duration + 0.5, `${file}: "${word.word}" runs past the recording`)
      previous = word.start
    }
  }
})

test('sentence ranges cover every word and point at real timings', () => {
  for (const file of syncFiles()) {
    const sync = readJson(file)
    const covered = sync.sentences.reduce((total, s) => total + (s.last - s.first + 1), 0)
    assert.equal(covered, sync.words.length, `${file}: sentences must cover every word`)
    for (const sentence of sync.sentences) {
      if (sentence.start === null) continue
      assert.ok(sentence.end >= sentence.start)
    }
  }
})

test('reading sections are almost fully word-timed', () => {
  for (const lessonId of ['lesson-01', 'lesson-02']) {
    const sync = readJson(path.join(DATA, lessonId, 'synchronization', 'reading.sync.json'))
    const timed = sync.words.filter((w) => w.start !== null).length / sync.words.length
    assert.ok(timed > 0.95, `${lessonId} reading only ${(timed * 100).toFixed(1)}% timed`)
    assert.ok(sync.confidence > 0.9, `${lessonId} reading confidence ${sync.confidence}`)
  }
})

test('vocabulary comes from the book and invents no Persian text', () => {
  for (const lessonId of ['lesson-01', 'lesson-02']) {
    const vocab = readJson(path.join(DATA, lessonId, 'vocabulary.json'))
    assert.ok(vocab.items.length >= 4, `${lessonId} has too few vocabulary entries`)
    assert.ok(vocab.targetWords.length >= 4)
    for (const item of vocab.items) {
      assert.ok(item.word.length > 0)
      assert.ok(item.meaningEn.length > 0, `${item.word} has no printed meaning`)
      assert.equal(item.meaningFa, '', 'Persian meanings are not in the source, so they stay empty')
      assert.ok(item.examples.length > 0, `${item.word} has no printed example`)
    }
  }
})
