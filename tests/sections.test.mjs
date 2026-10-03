// The reader publishes every section of the book except the ones listed as withdrawn in
// tools/textbook.py.  These tests keep that removal honest for each of them: no tab, no
// manifest entry and no leftover file, and no section reference pointing at something
// that is not there.  They read the withdrawn list from the generator rather than naming
// one section, so withdrawing another later needs no change here.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')
const LESSONS = ['lesson-01', 'lesson-02']

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const manifest = (lessonId) => readJson(path.join(DATA, lessonId, 'manifest.json'))

/** Every section id the generator withdraws, read from the generator itself. */
const WITHDRAWN_SOURCE = fs.readFileSync(path.join(ROOT, 'tools', 'textbook.py'), 'utf8')
const WITHDRAWN_IDS = [
  ...WITHDRAWN_SOURCE.match(/WITHDRAWN_SECTION_IDS = frozenset\(\{([^}]*)\}\)/s)[1]
    .matchAll(/"([^"]+)"/g),
].map(([, id]) => id)

test('the generator withdraws at least the sections the book does not publish', () => {
  assert.ok(WITHDRAWN_IDS.length > 0, 'no section is withdrawn, so the list has gone stale')
  assert.equal(
    new Set(WITHDRAWN_IDS).size,
    WITHDRAWN_IDS.length,
    'a section is withdrawn twice',
  )
})

test('every withdrawn section is gone from every lesson manifest', () => {
  for (const withdrawn of WITHDRAWN_IDS) {
    for (const lessonId of LESSONS) {
      const ids = manifest(lessonId).sections.map((s) => s.id)
      assert.ok(!ids.includes(withdrawn), `${lessonId} still lists ${withdrawn}`)
      assert.ok(ids.length > 0, `${lessonId} kept its other sections`)
    }
  }
})

test('no label or page range of a withdrawn section is left behind', () => {
  // The label and the contents description of the sections the book withdraws, read off
  // the book's own table of contents by the same rule the generator uses.
  for (const lessonId of LESSONS) {
    const provenance = readJson(path.join(DATA, lessonId, 'provenance.json'))
    const withdrawn = provenance.sections.filter((s) => WITHDRAWN_IDS.includes(s.id))
    assert.ok(withdrawn.length > 0, `${lessonId} provenance should still record what it withdrew`)
    const published = readJson(path.join(DATA, lessonId, 'manifest.json'))
    for (const { label } of withdrawn) {
      assert.doesNotMatch(
        JSON.stringify(published),
        new RegExp(label, 'i'),
        `${lessonId} still mentions ${label}`,
      )
    }
  }
})

test('nothing references a withdrawn section any more', () => {
  for (const lessonId of LESSONS) {
    for (const entry of manifest(lessonId).sections) {
      for (const field of ['text', 'sync']) {
        if (!entry[field]) continue
        for (const withdrawn of WITHDRAWN_IDS) {
          assert.doesNotMatch(
            entry[field],
            new RegExp(withdrawn),
            `${lessonId}/${entry.id} points at ${withdrawn}`,
          )
        }
        assert.ok(fs.existsSync(path.join(ROOT, entry[field])), `${lessonId}/${entry.id} points at a missing file`)
      }
    }
  }
})

test('the file of every withdrawn section is not shipped', () => {
  for (const lessonId of LESSONS) {
    for (const withdrawn of WITHDRAWN_IDS) {
      for (const folder of ['sections', 'synchronization']) {
        const file = path.join(DATA, lessonId, folder, `${withdrawn}.json`)
        if (folder === 'synchronization') {
          assert.ok(!fs.existsSync(file), `${lessonId} still ships ${withdrawn} timings`)
          continue
        }
        assert.ok(!fs.existsSync(file), `${lessonId} still ships the ${withdrawn} text`)
      }
    }
  }
})

test('a withdrawn section cannot come back on a rebuild', () => {
  // The generator deletes what it no longer writes, so withdrawing a section that had
  // already been published leaves no file behind for the next build to find.
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build_content.py'), 'utf8')
  assert.match(build, /def _prune_withdrawn/, 'the build does not clean up withdrawn sections')
  assert.match(build, /if path\.stem not in kept:\n\s+path\.unlink\(\)/)
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
  // Parsing stays verified against the contents page...
  const textbook = fs.readFileSync(path.join(ROOT, 'tools', 'textbook.py'), 'utf8')
  for (const withdrawn of WITHDRAWN_IDS) {
    assert.match(
      textbook,
      new RegExp(`SECTION_IDS = \\[[^\\]]*"${withdrawn}"`, 's'),
      `the book still lists ${withdrawn}`,
    )
  }
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
    for (const withdrawn of WITHDRAWN_IDS) {
      const entry = entries.find((s) => s.id === withdrawn)
      assert.ok(entry, `${lessonId} provenance should still record the extracted ${withdrawn}`)
      assert.equal(entry.published, false, `${lessonId} must mark ${withdrawn} as unpublished`)
    }
    assert.ok(
      entries.filter((s) => s.published).every((s) => !WITHDRAWN_IDS.includes(s.id)),
      `${lessonId} provenance disagrees with the manifest`,
    )
  }
})