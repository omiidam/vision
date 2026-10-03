// The app has one accent, and every filled surface, active state and link that is "the
// accent" is that one colour: the lesson cards' Open buttons, the back link, the badges,
// the focus ring, the open section tab, and the audio player's play button, progress and
// rate.  These tests keep it there, so a future lesson, section or player inherits it
// without anyone having to ask again, and keep the two colours the accent needs - the
// label that sits on it and the ink that names it - readable in both themes.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')

const themeBlock = (name) => {
  const start = CSS.indexOf(`:root[data-theme='${name}']`)
  return name === 'light'
    ? CSS.slice(0, CSS.indexOf(":root[data-theme='dark']"))
    : CSS.slice(start, CSS.indexOf('\n}', start))
}

const rule = (selector) => {
  const start = CSS.indexOf(`${selector} {`)
  assert.ok(start > -1, `${selector} is missing from the stylesheet`)
  return CSS.slice(start, CSS.indexOf('}', start))
}

const parse = (hex) =>
  [0, 2, 4].map((i) => parseInt(hex.match(/^#([0-9a-f]{6})$/i)[1].slice(i, i + 2), 16))
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

test('the one accent is the neutral grey, in both themes', () => {
  for (const name of ['light', 'dark']) {
    const accent = themeBlock(name).match(/--accent:\s*(#[0-9a-f]{6});/i)?.[1]
    assert.equal(accent?.toLowerCase(), '#8f8f8f', `${name}: the accent is ${accent}`)
  }
  // Nothing anywhere else restates the accent hue, so there is one value to change.
  assert.doesNotMatch(CSS, /#2f6df6|#7aa2ff|#1f57d6|#a8c6ff|#e8efff|#33405e|#c3d6fb/i)
  assert.doesNotMatch(CSS, /--tab-active|--player-accent/, 'the accent is spread over tokens')
})

test('the label that sits on the accent, and the ink that names it, stay readable', () => {
  for (const name of ['light', 'dark']) {
    const block = themeBlock(name)
    const accent = parse(block.match(/--accent:\s*(#[0-9a-f]{6});/i)[1])
    const onAccent = parse(block.match(/--on-accent:\s*(#[0-9a-f]{6});/i)[1])
    const ink = parse(block.match(/--accent-ink:\s*(#[0-9a-f]{6});/i)[1])
    // The label on a filled button, on the open tab and on the active rate.
    const onFill = contrast(accent, onAccent)
    assert.ok(onFill >= 4.5, `${name}: a filled button's label is ${onFill.toFixed(2)}:1`)
    // The ink is read as text on the card, never on the accent itself.
    const card = parse(block.match(/--card:\s*(#[0-9a-f]{6});/i)[1])
    const asText = contrast(card, ink)
    assert.ok(asText >= 4.5, `${name}: an accent link is ${asText.toFixed(2)}:1 on the card`)
  }
})

test('every accent surface is drawn from that one variable', () => {
  // The lesson cards' Open buttons, the open section tab, the audio player's play
  // button, its progress fill and the rate that is on.
  assert.match(rule('.button:not(.ghost)'), /background:\s*var\(--accent\)/)
  assert.match(rule('.button:not(.ghost)'), /color:\s*var\(--on-accent\)/)
  assert.match(rule('.tab.active'), /background:\s*var\(--accent\)/)
  assert.match(rule('.tab.active'), /color:\s*var\(--on-accent\)/)
  assert.match(rule('.play'), /background:\s*var\(--accent\)/)
  assert.match(rule('.track-fill'), /background:\s*var\(--accent\)/)
  assert.match(rule('.rate-option.active'), /background:\s*var\(--accent\)/)
  assert.match(rule('.rate-option.active'), /color:\s*var\(--on-accent\)/)
})

test('the things that name the accent keep their own ink', () => {
  // A link and a badge are text on the card, so they are drawn in the readable ink
  // rather than in the fill, which would be too close to the card behind them.
  assert.match(rule('.back'), /color:\s*var\(--accent-ink\)/)
  assert.match(rule('.button.ghost'), /color:\s*var\(--accent-ink\)/)
  assert.match(CSS, /\.badge \{[^}]*color: var\(--accent-ink\);[^}]*\}/s)
  // The focus ring is still a ring of the same weight and offset, in the accent.
  assert.match(CSS, /outline:\s*2px solid var\(--accent\)/)
  assert.match(CSS, /outline-offset:\s*2px/)
})

test('the soft fills that go with the accent are neutral too', () => {
  // A tinted hover and the marker on the spoken sentence belong to the accent family,
  // so they are greys as well: a blue tint left behind would be the accent showing
  // through in the one place it is no longer supposed to be.
  const isGrey = (hex) => {
    const [r, g, b] = parse(hex)
    return r === g && g === b
  }
  for (const name of ['light', 'dark']) {
    const block = themeBlock(name)
    for (const token of ['--accent-soft', '--active-line', '--active-bg']) {
      const value = block.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6});`, 'i'))?.[1]
      assert.ok(value, `${name}: ${token} is missing`)
      assert.ok(isGrey(value), `${name}: ${token} is ${value}, which is not a neutral`)
    }
  }
  // The page behind the glass is washed with the accent, so it is washed with the
  // neutral; its second glow is a different hue on purpose and stays as it was.
  assert.match(CSS, /--page-glow: rgba\(143, 143, 143, 0\.1\);/)
  assert.match(CSS, /--page-glow-2: rgba\(120, 87, 214, 0\.08\);/)
  // The book's own colours are untouched: the red it sets a new word in, the amber it
  // highlights one with, and the error colour.
  assert.match(CSS, /--target-word: #c2262c;/)
  assert.match(CSS, /--target-word: #f08a8c;/)
  assert.match(CSS, /--word-bg: #ffe08a;/)
  assert.match(CSS, /--error: #b42318;/)
  assert.match(CSS, /--error: #ff9d94;/)
})