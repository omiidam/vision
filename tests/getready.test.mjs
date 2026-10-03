// "Get Ready" is the book's own introduction to a lesson: a page of exercises the book
// divides into parts.  Nothing about that structure is written by hand - the parts are
// read off the printed pages and carried on the blocks, and the reader builds a heading
// and a container from what it finds there.  These tests check the committed data against
// the textbook itself: the parts that exist, what each one holds, and the order of both.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')
const BOOK = path.join(ROOT, '10th-class', '10th.pdf')
const LESSON = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')
const TOOLS = fs.readFileSync(path.join(ROOT, 'tools', 'textbook.py'), 'utf8')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const LESSON_IDS = readJson(path.join(DATA, 'manifest.json')).lessons.map((l) => l.id)
const getReady = (lessonId) =>
  readJson(path.join(DATA, lessonId, 'sections', 'get-ready.json'))

/**
 * The printed pages of every Get Ready section, read from the textbook with the library
 * that reads the book, so "what the book prints" is never restated here.
 */
function printedPages(pages) {
  const source = `
import json, sys
import pymupdf
doc = pymupdf.open(sys.argv[1])
out = {}
for page in json.loads(sys.argv[2]):
    out[str(page)] = doc[page - 1].get_text()
print(json.dumps(out))
`
  for (const command of ['python', 'python3']) {
    try {
      return JSON.parse(
        execFileSync(command, ['-c', source, BOOK, JSON.stringify(pages)], {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      )
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return null
}

/** The words of the book, whitespace aside, so a printed row can be looked for in it. */
const printed = (text) => text.replace(/\s+/g, ' ').trim()

const views = LESSON_IDS.map((lessonId) => {
  const data = getReady(lessonId)
  // `source.pages` is the range the section occupies, and every printed page in it is
  // read: the exercises are printed on the pages between the first and the last.
  const [first, last] = data.source.pages
  const book = printedPages(
    Array.from({ length: last - first + 1 }, (_, index) => first + index),
  )
  return { lessonId, data, book }
})

test('every lesson divides Get Ready into the parts the book prints', () => {
  for (const { lessonId, data, book } of views) {
    const headings = data.blocks.filter((block) => block.kind === 'part-heading')
    assert.ok(headings.length > 0, `${lessonId}: Get Ready prints no part`)
    // The parts are named by the book, in the book's words, and named once each.
    for (const heading of headings) {
      assert.match(heading.lines.join(' '), /^Part\s+\S+$/, `${lessonId}: "${heading.lines[0]}"`)
      assert.equal(heading.lines.length, 1, `${lessonId}: a part heading wraps onto another row`)
      assert.equal(heading.part, heading.lines.join(' '))
    }
    assert.deepEqual(
      headings.map((heading) => heading.part),
      [...new Set(headings.map((heading) => heading.part))],
      `${lessonId}: a part is named twice`,
    )
    if (book) {
      // The number of parts is the number of part headings printed on those pages.
      const named = new Set(
        Object.values(book).flatMap((page) => [...printed(page).matchAll(/Part\s+[A-Za-z0-9IVX]+/g)])
          .map((match) => match[0]),
      )
      for (const heading of headings) {
        assert.ok(named.has(heading.part), `${lessonId}: ${heading.part} is not printed on these pages`)
      }
      assert.equal(
        headings.length,
        named.size,
        `${lessonId}: the book prints ${[...named].join(', ')}, the data has ${headings.length}`,
      )
    }
  }
})

test('every item is printed in the part it belongs to, in the order the book prints it', () => {
  for (const { lessonId, data, book } of views) {
    let part = null
    const seen = []
    for (const block of data.blocks) {
      if (block.kind === 'part-heading') part = block.part
      assert.equal(block.part ?? null, part, `${lessonId}: "${block.lines[0]}" is in the wrong part`)
      seen.push(block)
    }
    // Every item the reader shows is printed on one of these pages, verbatim.  A joined
    // row is checked as the words of its own rows, so a sentence the book broke across
    // two rows is found and a fragment that was never printed is not.
    if (!book) continue
    for (const block of seen) {
      const page = printed(book[String(block.page)] ?? '')
      for (const line of block.lines) {
        assert.ok(
          page.includes(printed(line)) || printed(line).split(' ').every((word) => page.includes(word)),
          `${lessonId}: "${line}" is not printed on page ${block.page}`,
        )
      }
    }
  }
})

test('an item the book broke over two rows is shown as the one item it is', () => {
  // The sentences the book prints in two columns, side by side.  Read row by row they
  // become four fragments; each one is a whole sentence and has to read as one.
  const data = getReady('lesson-02')
  const text = data.blocks.map((block) => block.lines.join(' '))
  assert.ok(text.includes('Our body is a wonderful system.'), 'a wrapped sentence was cut in half')
  assert.ok(
    text.includes('Camels can live without water for a long time.'),
    'a wrapped sentence was cut in half',
  )
  // And the grid of labels beside them stays one item each.
  for (const word of ['Camels', 'Ants', 'Planets', 'Body']) {
    assert.ok(text.includes(word), `${word} was merged into another item`)
  }
})

test('the reader gives each part its own heading and its own container', () => {
  // One rule, driven by what the data says: a block marked as a part heading opens a part,
  // and everything after it goes into that part until the next heading opens the next.
  assert.match(LESSON, /const parted = !grouped && text\.blocks\.some\(\(block\) => block\.kind === 'part-heading'\)/)
  assert.match(LESSON, /host\.className = 'reader-part'/)
  assert.match(LESSON, /host\.dataset\.part = block\.part \?\? ''/)
  assert.match(LESSON, /paragraph\.className = 'reader-part-heading'/)
  assert.match(LESSON, /;\(part \?\? openPart \?\? body\)\.append\(paragraph\)/)
  // The part is a container of its own, with room above it and the heading inside it.
  assert.match(CSS, /\.reader-part \{[^}]*border-block-start: 1px solid var\(--line\);[^}]*\}/)
  assert.match(CSS, /\.reader-part-heading \{/)
  assert.doesNotMatch(CSS, /\.reader-part\b[^{]*\{[^}]*position:\s*absolute/)
})

test('no part is written into the reader, and no part is counted there', () => {
  // The names, the number and the order of the parts are the book's.  The reader only
  // reads what the data carries, so a lesson printed with a different number of parts
  // needs no change here and cannot be given a part that is not printed.
  const render = LESSON.slice(LESSON.indexOf('private renderText'))
  assert.doesNotMatch(render, /Part (One|Two|Three|\d)|partIndex|countParts/)
  assert.doesNotMatch(render, /slice\(0, *\d\)/)
})

test('the committed data is exactly what the extractor reads off the book', () => {
  // Nothing in this data tree is written by hand, so the blocks of every lesson are the
  // blocks the extractor makes of the same printed pages, in the same order, with the
  // same parts.  A change to either side that is not the other shows up here.
  const source = `
import json, sys
sys.path.insert(0, 'tools')
import pymupdf
import textbook
doc = pymupdf.open('10th-class/10th.pdf')
out = []
for first, last in json.loads(sys.argv[1]):
    lines, blocks = textbook.get_ready_page_view(doc, (first, last))
    out.append([[b['page'], b['lines'], b.get('kind'), b.get('part')] for b in blocks])
print(json.dumps(out))
`
  const expected = JSON.parse(
    execFileSync('python', ['-c', source, JSON.stringify(views.map((v) => v.data.source.pages))], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  )
  views.forEach(({ lessonId, data }, index) => {
    assert.deepEqual(
      data.blocks.map((block) => [block.page, block.lines, block.kind ?? null, block.part ?? null]),
      expected[index],
      `${lessonId}: the data is not what the extractor reads`,
    )
  })
})

test('the parts are read off the page, not assumed', () => {
  // The extractor recognises whatever the book prints as a part heading, so a lesson
  // printed with three parts gets three.
  assert.match(TOOLS, /PART_HEADING_RE = re\.compile\(r"\^Part\\s\+\(\?:\[A-Za-z\]\+\|\\d\+\|\[IVXLCDM\]\+\)\$"\)/)
  assert.match(TOOLS, /def get_ready_page_view/)
  // And a page without parts is read the ordinary way rather than given empty ones.
  assert.match(TOOLS, /return \(lines, blocks\) if part is not None else None/)
})