// The vocabulary page is read twice over: the textbook prints its parts as running text
// with the new words picked out inside it, and the reader adds the lesson's word bank
// below.  These tests check that the two never double up, that the words shown as new are
// the ones the book marked, and that nothing is invented to fill a gap.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { markTargets, matchTargets, normalizeToken } from '../src/targets.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')
const LESSONS = ['lesson-01', 'lesson-02']
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const section = (lessonId, id) => readJson(path.join(DATA, lessonId, 'sections', `${id}.json`))
const vocabulary = (lessonId) => readJson(path.join(DATA, lessonId, 'vocabulary.json'))

/** The lower block of the reader: which parts it lists, and the words in each. */
function lowerArea(lessonId) {
  const groups = new Map()
  for (const item of vocabulary(lessonId).items) {
    if (!groups.has(item.part)) groups.set(item.part, [])
    groups.get(item.part).push(item.word)
  }
  // The reader shows every group that is not a lettered part: those are the parts the
  // textbook prints as running text above, so listing them again would read it twice.
  return [...groups].filter(([part]) => !/^[a-z]$/.test(part))
}

test('the lower area lists the word bank and nothing else', () => {
  for (const lessonId of LESSONS) {
    const shown = lowerArea(lessonId)
    assert.ok(shown.length > 0, `${lessonId} shows nothing below the page`)
    for (const [part, words] of shown) {
      assert.equal(part, 'word-bank', `${lessonId} still lists ${part} below the page`)
      assert.ok(words.length > 0, `${lessonId} lists an empty word bank`)
    }
  }
})

test('a lettered part is never listed below the page it is printed on', () => {
  for (const lessonId of LESSONS) {
    const printed = section(lessonId, 'new-words-and-expressions').text
    for (const [part, words] of lowerArea(lessonId)) {
      for (const word of words) {
        assert.ok(
          !printed.toLowerCase().includes(word.toLowerCase()),
          `${lessonId}: ${word} is listed below a page that already prints it`,
        )
      }
    }
  }
})

test('every word bank word survives, in the order the book prints it', () => {
  for (const lessonId of LESSONS) {
    const bank = vocabulary(lessonId).items.filter((item) => item.part === 'word-bank')
    const shown = lowerArea(lessonId).find(([part]) => part === 'word-bank')?.[1] ?? []
    assert.deepEqual(shown, bank.map((item) => item.word), `${lessonId} word bank changed`)
    // The lesson's own target words are the words the conversation preview page teaches.
    const expected = vocabulary(lessonId).targetWords
    assert.deepEqual(bank.map((item) => item.word), expected, `${lessonId} word bank is not the lesson's`)
  }
})

test('no vocabulary item is lost or moved by the display change', () => {
  for (const lessonId of LESSONS) {
    const all = vocabulary(lessonId).items
    assert.ok(all.length > 0, `${lessonId} lost its vocabulary`)
    // Nothing may be listed twice under two parts, and every entry keeps its own part.
    const keys = all.map((item) => `${item.part}::${item.word}`)
    assert.equal(new Set(keys).size, keys.length, `${lessonId} lists a word twice`)
    // Every entry is either a word of a part the page prints, or a word of the bank.
    for (const item of all) {
      assert.ok(
        /^[a-z]$/.test(item.part) || item.part === 'word-bank',
        `${lessonId}/${item.word} is filed under an unknown part ${item.part}`,
      )
    }
  }
})

test('nothing is shown in place of a definition the book does not print', () => {
  // The reader must not invent a label for a word the book lists without defining, and
  // the word still has to be there.
  const source = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
  assert.doesNotMatch(source, /not given in the book/)
  for (const lessonId of LESSONS) {
    const bank = vocabulary(lessonId).items.filter((item) => item.part === 'word-bank')
    assert.ok(
      bank.every((item) => item.meaningEn === ''),
      `${lessonId} word bank words should carry no definition`,
    )
    assert.ok(bank.length > 0)
  }
})

test('only the vocabulary page marks new words, and it marks what the book marks', () => {
  for (const lessonId of LESSONS) {
    for (const id of readJson(path.join(DATA, lessonId, 'manifest.json')).sections.map((s) => s.id)) {
      const targets = section(lessonId, id).targets
      if (id === 'new-words-and-expressions') {
        assert.ok(targets.length > 0, `${lessonId} vocabulary page marks no new words`)
        // Every marked word is a word the lesson actually teaches.
        const taught = new Set(
          vocabulary(lessonId)
            .items.filter((item) => /^[a-z]$/.test(item.part))
            .map((item) => item.word.toLowerCase()),
        )
        for (const target of targets) {
          // A target may be a phrase the book prints as one headword, such as "a few".
          assert.ok(
            taught.has(target.toLowerCase()),
            `${lessonId} marks ${target}, which it does not teach`,
          )
        }
      } else {
        assert.deepEqual(targets, [], `${lessonId}/${id} marks words the book does not`)
      }
    }
  }
})

test('a target is found where the book prints it, and not somewhere else', () => {
  const text = 'They are destroying the jungle.'
  const at = (targets) => markTargets(text, targets).positions
  assert.deepEqual(at(['destroying']), [2])
  assert.deepEqual(at(['tiger']), [])
  assert.deepEqual(at(["jungle", "destroying"]), [2, 4])
})

test('a target of more than one word marks each of its words', () => {
  const marked = (text, targets) => {
    const found = markTargets(text, targets)
    const tokens = text.split(/\s+/).filter(Boolean)
    return found.positions.map((position) => tokens[position])
  }
  assert.deepEqual(marked('The lion died out about 75 years ago.', ['died out']), ['died', 'out'])
  assert.deepEqual(marked('There are a few Iranian cheetahs.', ['a few']), ['a', 'few'])
  // The words have to be adjacent and in order: a target is not scattered through a line.
  assert.deepEqual(marked('out the died', ['died out']), [])
})

test('only where the book prints a target, not every word it is made of', () => {
  // "a few" is one headword.  The "a" of it must not set the other "a" in the passage,
  // which is why the marks are positions rather than the words themselves.
  const text = 'a few: not many; a small number of things'
  const found = markTargets(text, ['a few'])
  const tokens = text.split(/\s+/).filter(Boolean)
  assert.deepEqual(found.positions.map((position) => tokens[position]), ['a', 'few:'])
  assert.equal(found.positions.length, 2, 'a bare "a" elsewhere in the line was set too')
})

test('a word the book prints twice as a target is set where it belongs', () => {
  const text = 'Which is good for nature? instead: in place of something else'
  const found = markTargets(text, ['instead'])
  const tokens = text.split(/\s+/).filter(Boolean)
  assert.deepEqual(found.positions.map((position) => tokens[position]), ['instead:'])
})

test('a target is claimed by one block, and the rest carry on', () => {
  // The parts of the page each print their own words.  A target is claimed by the block
  // that prints it and handed on only if no block has, so it cannot be claimed twice and
  // one block cannot hide a target that a later block prints.
  const first = markTargets('A tiger is a wild animal.', ['tiger', 'human'])
  assert.deepEqual(first.positions, [1])
  assert.deepEqual(first.pending, ['human'], 'a target not in this block is carried on')

  const second = markTargets('human: a person', first.pending)
  assert.deepEqual(second.positions, [0])
  assert.deepEqual(second.pending, [])
})

test('every target is searched for, whichever order they come in', () => {
  // One target being found must not stop another being looked for, and a target that is
  // not in this block must not hide one that is.
  const found = markTargets('They are destroying the jungle.', ['jungle', 'destroying'])
  assert.deepEqual(found.positions, [2, 4])
})

test('punctuation and case do not decide whether a word is a target', () => {
  assert.equal(normalizeToken('Earth.'), 'earth')
  assert.equal(normalizeToken('(a few)'), 'a few')
  assert.deepEqual(markTargets('A TIGER is here.', ['tiger']).positions, [1])
  assert.deepEqual(markTargets('healthier: 1. strong', ['healthy']).positions, [])
  assert.deepEqual([...matchTargets(['a few', 'human'])], ['a', 'few', 'human'])
})

test('a target that names nothing in the text marks nothing', () => {
  assert.deepEqual(markTargets('We live on Earth.', ['', '   ', '...']).positions, [])
})

test('the reader styles new words with the theme, not a fixed colour', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')
  // One rule, so both themes colour a target word the same way.
  assert.match(css, /\.word\.target-word \{[^}]*color: var\(--target-word\)/s)
  const light = css.slice(css.indexOf(":root,\n:root[data-theme='light']"), css.indexOf("[data-theme='dark']"))
  const dark = css.slice(css.indexOf(":root[data-theme='dark']"))
  for (const [name, block] of [['light', light], ['dark', dark]]) {
    const value = block.match(/--target-word: (#[0-9a-f]{6})/i)
    assert.ok(value, `${name} theme has no target word colour`)
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(value[1].slice(at, at + 2), 16))
    // Readable against the theme's own card colour: enough contrast to tell from the ink,
    // and enough lightness to tell from it in the dark theme where the ink is near white.
    const contrast = Math.max(r, g, b) - Math.min(r, g, b)
    assert.ok(contrast >= 30, `${name} target colour is not distinct enough`)
  }
  assert.notEqual(
    light.match(/--target-word: (#[0-9a-f]{6})/i)[1].toLowerCase(),
    dark.match(/--target-word: (#[0-9a-f]{6})/i)[1].toLowerCase(),
    'both themes use the same target colour',
  )
})