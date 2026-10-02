// Where a section or lesson is printed in the book.  The book decides the range, so the
// only rule here is how a range is written: a section that covers one page says that page
// once instead of repeating it, and a real span keeps both ends.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatPageRange } from '../src/pages.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

test('a section printed on one page is not written as a range', () => {
  assert.equal(formatPageRange([19, 19]), 'pages 19')
  assert.doesNotMatch(formatPageRange([19, 19]), /–/, 'a single page is written twice')
})

test('a section printed across pages keeps both ends', () => {
  assert.equal(formatPageRange([19, 21]), 'pages 19–21')
  assert.equal(formatPageRange([15, 18]), 'pages 15–18')
})

test('the page numbers come from the book, whichever page it is', () => {
  // No page is named here, so a lesson or section printed anywhere is described the same
  // way: the numbers are read, never assumed.
  for (const [first, last] of [[1, 1], [7, 7], [100, 100], [4, 9], [2, 3]]) {
    const text = formatPageRange([first, last])
    assert.match(text, new RegExp(`^pages ${first}`))
    if (first === last) assert.equal(text, `pages ${first}`)
    else assert.equal(text, `pages ${first}–${last}`)
  }
})

test('every section in the book is written the way the book prints it', () => {
  const lessons = fs
    .readdirSync(DATA)
    .filter((name) => name.startsWith('lesson-'))
  assert.ok(lessons.length > 0, 'expected generated lessons')
  let sections = 0
  for (const lesson of lessons) {
    const manifest = readJson(path.join(DATA, lesson, 'manifest.json'))
    for (const section of manifest.sections) {
      sections += 1
      const [first, last] = section.pages
      const text = formatPageRange(section.pages)
      if (first === last) {
        assert.equal(text, `pages ${first}`, `${lesson}/${section.id} repeats a single page`)
      } else {
        assert.equal(text, `pages ${first}–${last}`, `${lesson}/${section.id} lost a page`)
      }
    }
  }
  assert.ok(sections > 0, 'the book has no sections to check')
})
