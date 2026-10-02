import test from 'node:test'
import assert from 'node:assert/strict'

import { detectDirection, detectLang, langFor, escapeHtml, bdi, arrow } from '../src/direction.ts'

test('English text is left-to-right', () => {
  assert.equal(detectDirection('Endangered Animals'), 'ltr')
  assert.equal(detectDirection('A tiger is a wild animal.'), 'ltr')
  assert.equal(detectLang('Endangered Animals'), 'en')
})

test('Persian text is right-to-left', () => {
  assert.equal(detectDirection('حیات وحش کوه'), 'rtl')
  assert.equal(detectDirection('درختان را قطع نکنید'), 'rtl')
  assert.equal(detectLang('درختان را قطع نکنید'), 'fa')
})

test('a Persian sentence with an English word in it stays right-to-left', () => {
  // The first strong character decides, which is what the Unicode algorithm does.
  assert.equal(detectDirection('یادگیری زبان English برای همه است'), 'rtl')
  assert.equal(detectDirection('English زبان یادگیری'), 'ltr')
})

test('digits and punctuation alone are not treated as right-to-left', () => {
  // These are exactly the strings that would otherwise flip in a bidi context.
  assert.equal(detectDirection('0:31'), 'ltr')
  assert.equal(detectDirection('1:23'), 'ltr')
  assert.equal(detectDirection('15-41'), 'ltr')
  assert.equal(detectDirection('4/9'), 'ltr')
  assert.equal(detectDirection('98%'), 'ltr')
  assert.equal(detectDirection(''), 'ltr')
})

test('Persian text starting with digits is still right-to-left', () => {
  // Persian-Indic digits are weak, so the Persian letters decide.
  assert.equal(detectDirection('۱۲۳ درخت'), 'rtl')
  assert.equal(detectDirection('123 درخت'), 'rtl')
})

test('a mixed line takes the direction of its first strong character', () => {
  // Unicode bidi resolves a paragraph from the first strong character, so a line that
  // starts in Latin is an LTR paragraph that merely *contains* a Persian run.  That run is
  // ordered by the browser's own algorithm, which is why bdi() exists for isolating it.
  assert.equal(detectDirection('Lesson 1: Saving Nature'), 'ltr')
  assert.equal(detectDirection('Lesson 1: نجات طبیعت'), 'ltr')
  assert.equal(detectDirection('نجات طبیعت: Lesson 1'), 'rtl')
})

test('langFor maps the two directions this app renders', () => {
  assert.equal(langFor('ltr'), 'en')
  assert.equal(langFor('rtl'), 'fa')
})

test('bdi escapes its content and isolates it', () => {
  assert.equal(bdi('0:31'), '<bdi dir="auto">0:31</bdi>')
  assert.equal(bdi('Lesson 1: Saving Nature )15-41('),
    '<bdi dir="auto">Lesson 1: Saving Nature )15-41(</bdi>')
  assert.equal(bdi('<script>'), '<bdi dir="auto">&lt;script&gt;</bdi>')
})

test('bdi keeps the parenthesis-heavy contents line intact', () => {
  // The PDF extracts "Lesson 1: Saving Nature )15-41("; isolated, it must not reorder.
  const line = 'Lesson 1: Saving Nature )15-41('
  assert.ok(bdi(line).includes(line))
})

test('escapeHtml escapes every dangerous character', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
})

test('arrows point along the reading direction', () => {
  assert.equal(arrow('ltr', 'back'), '←')
  assert.equal(arrow('ltr', 'forward'), '→')
  assert.equal(arrow('rtl', 'back'), '→')
  assert.equal(arrow('rtl', 'forward'), '←')
})
