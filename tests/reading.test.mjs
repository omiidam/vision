// A reading passage is the one place in the book where the paragraphs are the content.
// The book sets each of them as a block of its own, so the reader can only show the
// paragraph structure the book printed if the blocks are read off the page.  These tests
// check the committed data against the textbook itself: the blocks it prints, their
// order, their boundaries, and the title above them - and that the words themselves have
// not moved, because the recording is timed word by word.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')
const LESSON = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const LESSON_IDS = readJson(path.join(DATA, 'manifest.json')).lessons.map((l) => l.id)
const readings = LESSON_IDS.map((lessonId) => ({
  lessonId,
  data: readJson(path.join(DATA, lessonId, 'sections', 'reading.json')),
  sync: readJson(path.join(DATA, lessonId, 'synchronization', 'reading.sync.json')),
}))

const words = (text) => text.split(/\s+/).filter(Boolean)

/** Run the real extractor, or read the PDF with the library that reads the book. */
function askPython(source, ...args) {
  return JSON.parse(
    execFileSync('python', ['-c', source, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  )
}

/** The blocks the book prints on each reading page, in the order it prints them. */
function printedBlocks(pages) {
  return askPython(
    `
import json, sys
sys.path.insert(0, 'tools')
import pymupdf
import textbook
doc = pymupdf.open('10th-class/10th.pdf')
out = []
for first, last in json.loads(sys.argv[1]):
    _lines, blocks = textbook.reading_page_view(doc, (first, last))
    out.append([[b['page'], b['lines'][0], b.get('kind')] for b in blocks])
print(json.dumps(out))
`,
    JSON.stringify(pages),
  )
}

/** The text of every printed page, whitespace aside, keyed by printed page. */
function printedText(pages) {
  return askPython(
    `
import json, sys, re
import pymupdf
doc = pymupdf.open('10th-class/10th.pdf')
out = {}
for page in json.loads(sys.argv[1]):
    out[str(page)] = re.sub(r'\\s+', ' ', doc[page - 1].get_text()).strip()
print(json.dumps(out))
`,
    JSON.stringify(pages),
  )
}

/**
 * What the book prints for this block.  The one thing it never prints here is the
 * apostrophe: the content pipeline folds the book's curly quote to a straight one for
 * every section of every lesson, so it is folded back before the block is looked for.
 */
const asPrinted = (text) => text.replace(/'/g, '’')

/** The book's curly quote folded the way the pipeline folds it, so both sides match. */
const fold = (text) => text.replace(/’/g, "'")

test('every reading is the blocks the book prints, in the order it prints them', () => {
  const expected = printedBlocks(readings.map(({ data }) => data.source.pages))
  readings.forEach(({ lessonId, data }, index) => {
    assert.deepEqual(
      data.blocks.map((block) => [block.page, block.lines[0], block.kind ?? null]),
      expected[index].map(([page, line, kind]) => [page, line, kind ?? null]),
      `${lessonId}: the reading is not the paragraphs the book prints`,
    )
  })
})

test("the title is the book's heading, and it stands above the passage", () => {
  for (const { lessonId, data } of readings) {
    const titles = data.blocks.filter((block) => block.kind === 'reading-title')
    assert.equal(titles.length, 1, `${lessonId}: the passage has ${titles.length} titles`)
    assert.equal(data.blocks[0].kind, 'reading-title', `${lessonId}: the title is not first`)
    assert.equal(titles[0].lines.length, 1, `${lessonId}: the title wraps onto another row`)
    // The passage is the paragraphs after the title, and each one is a paragraph the
    // book broke: it is a block of its own and it finishes with a full stop.
    const paragraphs = data.blocks.slice(1)
    assert.ok(paragraphs.length >= 2, `${lessonId}: the passage is one block`)
    for (const paragraph of paragraphs) {
      const text = paragraph.lines.join(' ')
      assert.match(text, /[.!?…]$/, `${lessonId}: "${text.slice(-40)}" does not finish a paragraph`)
      assert.equal(paragraph.lines.length, 1, `${lessonId}: a paragraph is still broken into rows`)
      assert.equal(paragraph.kind, undefined, `${lessonId}: a paragraph is marked as something else`)
    }
  }
})

test("nothing is lost, added, or reordered between the book and the reader", () => {
  const printed = printedText([...new Set(readings.flatMap(({ data }) => data.source.pages))])
  for (const { lessonId, data } of readings) {
    const page = data.source.pages
      .map((number) => printed[String(number)])
      .join(' ')
      .replace(/\bL E S S O N\b|\b\d{1,3}\b/g, ' ')
    // Every block the reader shows is printed by the book, word for word.
    for (const block of data.blocks) {
      const text = block.lines.join(' ')
      assert.ok(
        page.includes(asPrinted(text)),
        `${lessonId}: "${text.slice(0, 40)}" is not printed as it stands`,
      )
    }
    // And the words come out in the order the book prints them.
    const bookWords = words(fold(page))
    let at = 0
    for (const word of data.blocks.flatMap((block) => words(block.lines.join(' ')))) {
      const found = bookWords.indexOf(word, at)
      assert.ok(found >= 0, `${lessonId}: "${word}" is out of the book's order`)
      at = found + 1
    }
  }
})

test('the words are unchanged, so the recording still lines up with the text', () => {
  // The recording is aligned word by word.  Re-grouping the same words into the
  // paragraphs the book prints must not add, drop or move a word, or every highlight
  // after the first paragraph would be out of step with the audio.
  for (const { lessonId, data, sync } of readings) {
    const text = data.blocks.flatMap((block) => words(block.lines.join(' ')))
    assert.equal(text.length, sync.words.length, `${lessonId}: the words and the timings differ`)
    for (const [index, entry] of sync.words.entries()) {
      assert.equal(entry.word, text[index], `${lessonId}: word ${index} is "${text[index]}"`)
    }
    assert.ok(sync.words.filter((word) => word.start !== null).length / sync.words.length > 0.95)
  }
})

test('the order comes from the data, and the reader does not sort it', () => {
  // Nothing in the reader may reorder blocks: the order the book prints is the order the
  // data carries and the order the page shows.
  assert.doesNotMatch(LESSON, /\.sort\(|\.reverse\(\)/)
  const render = LESSON.slice(LESSON.indexOf('private renderText'))
  assert.match(render, /for \(const block of text\.blocks\)/)
  assert.match(CSS, /\.paragraph\.block-reading-title \{/)
})
