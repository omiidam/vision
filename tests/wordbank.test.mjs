// The word bank is a strip of words the reader recognises, not a list to read down: each
// word is its own pill and the row takes as many as fit.  These tests keep the layout a
// wrapping row, keep every word of every lesson in the bank, and keep them in the order
// the book prints them - nothing sorted, nothing dropped, nothing merged.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')
const LESSON = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
const LESSONS = ['lesson-01', 'lesson-02']

const rule = (selector) => {
  const start = CSS.indexOf(`${selector} {`)
  assert.ok(start > -1, `${selector} is missing from the stylesheet`)
  return CSS.slice(start, CSS.indexOf('}', start))
}

const bank = (lessonId) => {
  const data = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data', 'grade-10', lessonId, 'vocabulary.json'), 'utf8'),
  )
  // The lettered parts are the New Words page; the bank is everything else.
  return data.items.filter((item) => !/^[a-z]$/.test(item.part))
}

test('the word bank is a row of items that wraps, not a list read down', () => {
  const row = rule('.vocab')
  assert.match(row, /display:\s*flex/)
  assert.match(row, /flex-wrap:\s*wrap/)
  // A gap is what separates the words; no fixed column width forces one item per line.
  assert.doesNotMatch(row, /grid-template-columns/)

  const item = rule('.vocab-item')
  assert.match(item, /display:\s*flex/)
  assert.doesNotMatch(item, /grid-template-columns/)
  // Nothing is set to a width or a fixed basis that would stop the row filling the page.
  assert.doesNotMatch(item, /flex:\s*0 0|(?<!max-)\bwidth:\s*\d/)
  // A word longer than the screen wraps inside its own pill instead of overflowing.
  assert.match(item, /max-width:\s*100%/)
  // The word keeps its own weight, as the book sets a new word.
  assert.match(rule('.vocab-item dt'), /font-weight:\s*600/)
})

test('a narrow screen keeps the row and wraps it', () => {
  const narrow = CSS.slice(CSS.indexOf('@media (max-width: 640px)'))
  assert.doesNotMatch(narrow, /overflow-x:\s*(auto|scroll)/)
  assert.match(narrow, /\.vocab \{[^}]*gap:/)
  // Nothing in the bank is allowed to scroll the page sideways.
  assert.doesNotMatch(rule('.vocab'), /overflow/)
})

test('every word of every lesson is in the bank, in the book order', () => {
  for (const lessonId of LESSONS) {
    const items = bank(lessonId)
    assert.ok(items.length > 0, `${lessonId}: the bank is empty`)
    // The renderer emits the entries as the data lists them, one element per entry, so
    // neither the order nor the count can drift.
    const render = LESSON.slice(LESSON.indexOf('private renderVocabulary'))
    const list = render.slice(render.indexOf('const itemHtml'))
    assert.match(list, /group\.items\.map\(itemHtml\)\.join\(''\)/)
    assert.match(list, /<div class="vocab-item">\s*<dt lang="en" dir="ltr">\$\{headword\}<\/dt>/)
    // No sorting anywhere: the bank is the book's order.
    assert.doesNotMatch(LESSON, /\.sort\(/)
    for (const item of items) {
      assert.ok(item.word, `${lessonId}: a bank entry has no word`)
      assert.equal(item.partTitle, 'Word Bank')
    }
    assert.equal(new Set(items.map((item) => item.word)).size, items.length)
  }
})

test('the bank is its own section, apart from the parts of the New Words page', () => {
  // The lettered parts are printed in the reader above; only the unlettered groups are
  // listed here, so the bank never repeats Part A or Part B.
  assert.match(LESSON, /const bank = groups\.filter\(\(group\) => !\/\^\[a-z\]\$\/\.test\(group\.key\)\)/)
  assert.match(LESSON, /<section class="vocab-part" data-part="\$\{escapeHtml\(group\.key\)\}">/)
  // A word the book gives no gloss for is shown on its own; nothing is said about it.
  assert.doesNotMatch(LESSON, /not given in the book/i)
  for (const lessonId of LESSONS) {
    for (const item of bank(lessonId)) {
      assert.equal(item.meaningEn, '', `${lessonId}: ${item.word} gained a definition`)
      assert.equal(item.meaningFa, '')
    }
  }
})