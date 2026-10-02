// The vocabulary rule is universal: whatever the book marks as vocabulary for a section
// has to be registered for that section, for every lesson, with nothing hardcoded to the
// words that happen to be in Lessons 1 and 2 today.  These tests check the generated
// data against that rule, and the extractor against the shapes it has to tell apart.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const GRADE = readJson(path.join(DATA, 'manifest.json'))
const LESSON_IDS = GRADE.lessons.map((l) => l.id)
const sectionFiles = LESSON_IDS.flatMap((lessonId) =>
  readJson(path.join(DATA, lessonId, 'manifest.json')).sections.map((s) => ({
    lessonId,
    section: s,
    file: path.join(ROOT, s.text),
  })),
)

const INDEX = readJson(path.join(DATA, 'vocabulary.json'))

/**
 * Run the Python extractor once and report what it makes of the shapes below.  The
 * extractor is the real one in tools/, not a re-implementation in JavaScript.
 */
const BANKS = [
  'endangered, alive, increase, hear, protect, for example',
  'near, rocky, orbit, powerful',
  'Conversation 1',
  'Singular and Plural',
  'a',
  'powerful,',
]
const GLOSSARY_LINES = [
  [21, 'human: a person'],
  [21, 'All humans must take care of nature.'],
  [21, 'A. Look, Read and Practice.'],
  [21, 'instead: in place of someone or something else'],
]
const EXTRACTED = JSON.parse(
  execFileSync(
    'python',
    [
      '-c',
      `
import sys, json
sys.path.insert(0, "tools")
import vocabulary as V
print(json.dumps({
    "banks": [V.word_bank_items(x) for x in json.loads(sys.argv[1])],
    "glossary": V.glossary_entries([tuple(x) for x in json.loads(sys.argv[2])]),
}))
`,
      JSON.stringify(BANKS),
      JSON.stringify(GLOSSARY_LINES),
    ],
    { cwd: ROOT, encoding: 'utf8' },
  ),
)

test('every published section carries a vocabulary list, even an empty one', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    const data = readJson(file)
    assert.ok(Array.isArray(data.vocabulary), `${lessonId}/${section.id} has no vocabulary list`)
  }
})

test('every entry says which grade, lesson and section it belongs to', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    for (const entry of readJson(file).vocabulary) {
      assert.equal(entry.grade, GRADE.grade, `${entry.word}: wrong grade`)
      assert.equal(entry.lessonId, lessonId, `${entry.word}: wrong lesson`)
      assert.equal(entry.sectionId, section.id, `${entry.word}: wrong section`)
      assert.ok(Number.isInteger(entry.page), `${entry.word}: page must be a number`)
      assert.ok(
        entry.page >= section.pages[0] && entry.page <= section.pages[1],
        `${entry.word}: page ${entry.page} is outside the section's pages`,
      )
    }
  }
})

test('every entry keeps the slots a later editing pass will fill', () => {
  const REQUIRED = ['meaningEn', 'meaningFa', 'pronunciation', 'examples', 'audio', 'source', 'position']
  for (const entry of INDEX.entries) {
    for (const field of REQUIRED) {
      assert.ok(field in entry, `${entry.word}: missing ${field}`)
    }
    assert.equal(typeof entry.examples, 'object')
  }
})

test('positions number the words of a section from zero, in order', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    readJson(file).vocabulary.forEach((entry, index) => {
      assert.equal(entry.position, index, `${lessonId}/${section.id}: position ${index} out of order`)
    })
  }
})

test('a section never lists the same word twice', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    const words = readJson(file).vocabulary.map((e) => e.word.toLowerCase())
    assert.equal(new Set(words).size, words.length, `${lessonId}/${section.id} repeats a word`)
  }
})

test('the grade index is exactly every section vocabulary, merged', () => {
  const merged = sectionFiles.flatMap(({ file }) =>
    readJson(file).vocabulary.map((e) => `${e.lessonId}/${e.sectionId}/${e.word}`),
  )
  const indexed = INDEX.entries.map((e) => `${e.lessonId}/${e.sectionId}/${e.word}`)
  assert.deepEqual(indexed, merged, 'the index and the sections disagree')
})

test('the index counts every section that has vocabulary, and no others', () => {
  const expected = sectionFiles
    .map(({ lessonId, section, file }) => ({
      lessonId,
      sectionId: section.id,
      count: readJson(file).vocabulary.length,
    }))
    .filter((s) => s.count > 0)
  assert.deepEqual(INDEX.sections, expected)
})

test('vocabulary is never invented: every word is printed in its own section', () => {
  // The book puts a word in a section's word bank because the section teaches it, so
  // the word has to appear in the section's own text.  A glossary headword can be a
  // phrase such as "a few", so every word of it is checked.
  for (const { lessonId, section, file } of sectionFiles) {
    const data = readJson(file)
    const printed = new Set(data.text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [])
    for (const entry of data.vocabulary) {
      for (const word of entry.word.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []) {
        assert.ok(
          printed.has(word),
          `${lessonId}/${section.id}: "${word}" is not in the section's own text`,
        )
      }
    }
  }
})

test('a label that introduces the text is not registered as a word', () => {
  // Lesson 1 prints "for example" inside its word bank as a label; that is not a word
  // the section teaches, so it must not have been registered.
  const conversation = readJson(path.join(DATA, 'lesson-01', 'sections', 'conversation.json'))
  const words = conversation.vocabulary.map((e) => e.word.toLowerCase())
  assert.ok(!words.includes('for'), 'a function word leaked in from a label')
  assert.ok(!words.includes('example'), 'a label leaked in as vocabulary')
  // A word bank names single words; only the printed glossary may hold a phrase.
  for (const { lessonId, section, file } of sectionFiles) {
    for (const entry of readJson(file).vocabulary) {
      if (entry.source === 'word-bank') {
        assert.ok(!/\s/.test(entry.word), `${lessonId}/${section.id}: "${entry.word}" is a phrase`)
      }
    }
  }
})

test('vocabulary lives beside the text, never inside it', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    const data = readJson(file)
    // The blocks are the textbook text the reader shows.  The word bank the book prints
    // above a conversation is part of that text and stays there; the structured list is
    // an extra key beside it, not a second copy spliced into the text.
    assert.ok(Array.isArray(data.blocks), `${lessonId}/${section.id} has no blocks`)
    assert.equal(
      Object.keys(data).filter((k) => k === 'vocabulary').length,
      1,
      `${lessonId}/${section.id} has more than one vocabulary list`,
    )
    assert.ok(
      !data.text.includes('"vocabulary"') && !data.text.includes('"sectionId"'),
      `${lessonId}/${section.id} has structured vocabulary written into its text`,
    )
  }
})

test('the section text is left exactly as the book prints it', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    const data = readJson(file)
    assert.equal(
      data.text,
      data.blocks.map((b) => b.lines.join(' ')).join('\n'),
      `${lessonId}/${section.id}: text no longer matches its blocks`,
    )
  }
})

test('the extractor reads a word bank list and drops its labels', () => {
  const [withLabel, plain, heading, title, single, oneWord] = EXTRACTED.banks
  assert.deepEqual(withLabel, ['endangered', 'alive', 'increase', 'hear', 'protect'])
  assert.deepEqual(plain, ['near', 'rocky', 'orbit', 'powerful'])
  assert.deepEqual(heading, [], 'a stray comma in a heading is not a word bank')
  assert.deepEqual(title, [], 'a title is not a word bank')
  assert.deepEqual(single, [], 'one word alone is not a word bank')
  assert.deepEqual(oneWord, [], 'a single trailing comma is not a word bank')
})

test('the extractor reads the printed glossary entries and their examples', () => {
  assert.deepEqual(EXTRACTED.glossary, [
    [21, 'human', 'a person', ['All humans must take care of nature.']],
    [21, 'instead', 'in place of someone or something else', []],
  ])
})

test('nothing in the extractor names the words of these lessons', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tools', 'vocabulary.py'), 'utf8')
  const code = source.replace(/#.*$/gm, '').replace(/"""[\s\S]*?"""/g, '')
  for (const word of ['endangered', 'alive', 'increase', 'protect', 'rocky', 'orbit', 'powerful']) {
    assert.ok(
      !new RegExp(`['"\`]${word}['"\`]`, 'i').test(code),
      `${word} is hardcoded in the extractor`,
    )
  }
})

test('the pipeline extracts vocabulary for every section, not a chosen few', () => {
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build_content.py'), 'utf8')
  // The call sits inside the per-section loop and names no section of its own.
  assert.match(
    build,
    /vocabulary\.entries_for_section\(\s*\n\s*doc, section\.section_id, tuple\(section\.pages\), data\["lines"\]/,
  )
  assert.doesNotMatch(build, /entries_for_section\([^)]*['"]conversation['"]/)
})
