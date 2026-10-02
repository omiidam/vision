import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const SOURCE = path.join(ROOT, '10th-class')

/** The source keeps one folder per lesson; every recording is read from there. */
function sourceRecordings() {
  const found = []
  for (const entry of fs.readdirSync(SOURCE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const match = /^lesson[\s_-]*0*(\d+)$/i.exec(entry.name)
    if (!match) continue
    const lessonId = `lesson-${Number(match[1]).toString().padStart(2, '0')}`
    for (const name of fs.readdirSync(path.join(SOURCE, entry.name))) {
      if (name.toLowerCase().endsWith('.mp3')) {
        found.push({ lessonId, file: name, folder: entry.name })
      }
    }
  }
  return found
}

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
    // The pronunciation section is withdrawn from the reader, so eight are published.
    assert.equal(lesson.sections.length, 8, `${lessonId} should expose every published section`)
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
  const sources = sourceRecordings()
  assert.equal(sources.length, 8, 'expected 4 recordings per lesson folder')
  const mapped = mapping.audio.filter((entry) => entry.sectionId !== null)
  assert.equal(mapped.length, sources.length, 'every recording must be mapped to a section')
  assert.deepEqual(mapping.unmapped, [])
  for (const entry of mapping.audio) {
    assert.equal(entry.rule, 'filename')
    assert.ok(entry.contentScore > 0.5, `${entry.file} transcript barely corroborates the name`)
    assert.equal(entry.status, 'confirmed')
    assert.deepEqual(entry.notes, [])
  }
})

test('the lesson folder decides the lesson and the file name decides the section', () => {
  const mapping = readJson(path.join(ROOT, 'data', 'audio-mapping.json'))
  const byFile = Object.fromEntries(mapping.audio.map((entry) => [entry.file, entry]))
  for (const { lessonId, file } of sourceRecordings()) {
    assert.ok(byFile[file], `${file} is missing from audio-mapping.json`)
    assert.equal(byFile[file].lessonId, lessonId, `${file} should follow its lesson folder`)
  }
})

test('the file name alone decides which section a recording belongs to', () => {
  const mapping = readJson(path.join(ROOT, 'data', 'audio-mapping.json'))
  // The recordings follow "<section name><lesson number>.mp3".  This table is derived
  // from that convention alone; the transcripts are not consulted here on purpose.
  const expected = {
    'conversation1.mp3': 'conversation',
    'conversation2.mp3': 'conversation',
    'new words and expressions1.mp3': 'new-words-and-expressions',
    'New Words & Expressions2.mp3': 'new-words-and-expressions',
    'reading1.mp3': 'reading',
    'reading2.mp3': 'reading',
    'listening and speaking1.mp3': 'listening-and-speaking',
    'Listening & Speaking2.mp3': 'listening-and-speaking',
  }
  const byName = Object.fromEntries(mapping.audio.map((entry) => [entry.file, entry]))
  assert.deepEqual(Object.keys(byName).sort(), Object.keys(expected).sort())
  for (const [file, sectionId] of Object.entries(expected)) {
    assert.equal(byName[file].sectionId, sectionId, `${file} is on the wrong section`)
  }
})

test('each mapped recording sits in the manifest of its lesson folder', () => {
  const mapping = readJson(path.join(ROOT, 'data', 'audio-mapping.json'))
  for (const entry of mapping.audio) {
    const lesson = readJson(path.join(ROOT, 'data', 'grade-10', entry.lessonId, 'manifest.json'))
    const section = lesson.sections.find((s) => s.id === entry.sectionId)
    assert.ok(section, `${entry.file} has no section in ${entry.lessonId}`)
    assert.ok(section.audio, `${entry.file} is not attached to its section`)
    assert.equal(section.audio, `audio/grade-10/${entry.lessonId}/${entry.sectionId}.mp3`)
  }
})

test('no two recordings claim the same section', () => {
  const mapping = readJson(path.join(ROOT, 'data', 'audio-mapping.json'))
  const claimed = mapping.audio.map((entry) => `${entry.lessonId}/${entry.sectionId}`)
  assert.equal(new Set(claimed).size, claimed.length, 'a section is claimed twice')
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
