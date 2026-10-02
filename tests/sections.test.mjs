// The reader publishes every section of the book except pronunciation.  These tests keep
// that removal honest: no tab, no manifest entry and no leftover file, and no section
// reference that points at something that is not there.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')
const LESSONS = ['lesson-01', 'lesson-02']

const WITHDRAWN = 'pronunciation'
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const manifest = (lessonId) => readJson(path.join(DATA, lessonId, 'manifest.json'))

test('the pronunciation section is gone from every lesson manifest', () => {
  for (const lessonId of LESSONS) {
    const ids = manifest(lessonId).sections.map((s) => s.id)
    assert.ok(!ids.includes(WITHDRAWN), `${lessonId} still lists ${WITHDRAWN}`)
    assert.ok(ids.length > 0, `${lessonId} kept its other sections`)
  }
})

test('no label or page range of the withdrawn section is left behind', () => {
  for (const lessonId of LESSONS) {
    const source = JSON.stringify(manifest(lessonId))
    assert.doesNotMatch(source, /Pronunciation/i, `${lessonId} still mentions Pronunciation`)
    assert.doesNotMatch(source, /Falling Intonation/i, `${lessonId} still mentions its title`)
  }
})

test('nothing references the withdrawn section any more', () => {
  for (const lessonId of LESSONS) {
    for (const entry of manifest(lessonId).sections) {
      for (const field of ['text', 'sync']) {
        if (!entry[field]) continue
        assert.doesNotMatch(entry[field], new RegExp(WITHDRAWN), `${lessonId}/${entry.id} points at ${WITHDRAWN}`)
        assert.ok(fs.existsSync(path.join(ROOT, entry[field])), `${lessonId}/${entry.id} points at a missing file`)
      }
    }
  }
})

test('the withdrawn section file itself is not shipped', () => {
  for (const lessonId of LESSONS) {
    const file = path.join(DATA, lessonId, 'sections', `${WITHDRAWN}.json`)
    assert.ok(!fs.existsSync(file), `${lessonId} still ships the ${WITHDRAWN} text`)
  }
})

test('the tabs and the pager are built from the manifest, so they cannot drift', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
  assert.match(source, /lesson\.sections\.map\(/, 'the tabs come from the manifest')
  assert.match(
    source,
    /lesson\.sections\.findIndex\(\(entry\) => entry\.id === section\.id\)/,
    'the pager indexes the same manifest list',
  )
})

test('an unknown or withdrawn section id falls back instead of breaking', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
  assert.match(
    source,
    /lesson\.sections\.find\(\(entry\) => entry\.id === sectionId\) \?\? lesson\.sections\[0\]/,
    'a stale link to a removed section lands on the first section',
  )
})

test('the generator withdraws the section but still parses it from the book', () => {
  const textbook = fs.readFileSync(path.join(ROOT, 'tools', 'textbook.py'), 'utf8')
  // Parsing stays verified against the contents page...
  assert.match(textbook, /SECTION_IDS = \[[^\]]*"pronunciation"/s, 'the book still lists the section')
  assert.match(textbook, /WITHDRAWN_SECTION_IDS = frozenset\(\{"pronunciation"\}\)/)
  // ...and only the published list reaches the data tree.
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build_content.py'), 'utf8')
  assert.match(build, /published = \[s for s in lesson\.sections if s\.section_id not in book\.WITHDRAWN_SECTION_IDS\]/)
})

test('the counts on the lessons list match what is actually published', () => {
  const grade = readJson(path.join(DATA, 'manifest.json'))
  for (const lesson of grade.lessons) {
    const published = manifest(lesson.id).sections
    assert.equal(lesson.sectionCount, published.length, `${lesson.id} section count is stale`)
    assert.equal(lesson.audioCount, published.filter((s) => s.audio).length, `${lesson.id} audio count is stale`)
  }
})

test('provenance records the extraction of every section and marks what is published', () => {
  for (const lessonId of LESSONS) {
    const provenance = readJson(path.join(DATA, lessonId, 'provenance.json'))
    const entries = provenance.sections
    const withdrawn = entries.find((s) => s.id === WITHDRAWN)
    assert.ok(withdrawn, `${lessonId} provenance should still record the extracted section`)
    assert.equal(withdrawn.published, false, `${lessonId} must mark ${WITHDRAWN} as unpublished`)
    assert.ok(
      entries.filter((s) => s.published).every((s) => !WITHDRAWN.includes(s.id)),
      `${lessonId} provenance disagrees with the manifest`,
    )
  }
})
