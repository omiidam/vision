// The lesson text is set inside one card, so the distance between the text and the edge
// of the card is a single decision - and it has to be the same on both edges, in either
// writing direction.  These tests keep that margin comfortable, keep the phone from
// spending a third of its line on it, and keep it written logically so it follows the
// direction of the page.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')

const rule = (selector) => {
  const start = CSS.indexOf(`${selector} {`)
  assert.ok(start > -1, `${selector} is missing from the stylesheet`)
  return CSS.slice(start, CSS.indexOf('}', start))
}

/** The block for a selector that declares `needle`; a selector can appear more than once
    (inside `@supports`, or again in a media query) and only one of them is the rule. */
function ruleWith(selector, needle) {
  for (let start = CSS.indexOf(`${selector} {`); start > -1; start = CSS.indexOf(`${selector} {`, start + 1)) {
    const block = CSS.slice(start, CSS.indexOf('}', start))
    if (block.includes(needle)) return block
  }
  assert.fail(`no ${selector} rule declares ${needle}`)
}

/** The inline padding of a rule, whether it is written longhand or as `padding`. */
function inlinePadding(declarations) {
  const shorthand = declarations.match(/padding:\s*([^;]+);/)?.[1]
  if (shorthand) {
    const parts = shorthand.trim().split(/\s+/)
    // One value all round, or block/inline.
    return parts.length === 1 ? parts[0] : parts[1]
  }
  return (
    declarations.match(/padding-inline:\s*([^;]+);/)?.[1] ??
    declarations.match(/padding-inline-start:\s*([^;]+);/)?.[1]
  )
}

const px = (value) => Number.parseFloat(value)

test('the card gives the lesson text a proper margin inside both edges', () => {
  const padding = inlinePadding(rule('.card'))
  assert.ok(padding, 'the card has no inline padding')
  // The old 16px ran the text close to the edge; the margin is now wider than it was.
  assert.ok(px(padding) >= 20, `the card's inline padding is ${padding}`)
})

test('the margin is the same on both sides, in either direction', () => {
  const body = ruleWith('.reader-body', 'padding-inline')
  // One value for both edges, written logically so it follows the direction.
  assert.match(body, /padding-inline:\s*(\d+)px;/)
  const sides = inlinePadding(body)
  assert.equal(sides, /^\d+px$/.exec(sides)[0], 'the two edges take different padding')
  assert.doesNotMatch(body, /padding-left|padding-right/)
  // No rule anywhere pulls the text back towards one edge with a physical property.
  assert.doesNotMatch(CSS, /padding-(left|right)\s*:/)
})

test('a phone keeps the margin but gives some of the width back', () => {
  const narrow = CSS.slice(CSS.indexOf('@media (max-width: 640px)'))
  const card = narrow.slice(narrow.indexOf('.card {'))
  const padding = inlinePadding(card.slice(0, card.indexOf('}')))
  // Smaller than the desktop margin, but never so small that the text touches the edge.
  assert.ok(px(padding) < 24, `the phone margin is ${padding}`)
  assert.ok(px(padding) >= 16, `the phone margin is ${padding}`)
  assert.doesNotMatch(narrow, /padding-(left|right)\s*:/)
})

test('only the inner margin moved', () => {
  const card = rule('.card')
  // The block padding, the width of the page and the card's shape are untouched.
  assert.match(card, /padding:\s*16px 24px;/)
  assert.match(card, /border-radius:\s*14px/)
  const app = rule('#app')
  assert.match(app, /max-width:\s*880px/)
})