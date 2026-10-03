// The audio player is one component - the transport the reader builds - and its filled
// controls share one colour, given as a theme variable rather than written into each
// control.  These tests keep that: the colour is the neutral in both themes, the glyph and
// the rate stay readable on it, and a section with a recording gets it without anyone
// having to ask again.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')
const LESSON = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
const DATA = path.join(ROOT, 'data', 'grade-10')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const rule = (selector) => {
  const start = CSS.indexOf(`${selector} {`)
  assert.ok(start > -1, `${selector} is missing from the stylesheet`)
  return CSS.slice(start, CSS.indexOf('}', start))
}

const themeBlock = (name) => {
  const start = CSS.indexOf(`:root[data-theme='${name}']`)
  return name === 'light'
    ? CSS.slice(0, CSS.indexOf(":root[data-theme='dark']"))
    : CSS.slice(start, CSS.indexOf('\n}', start))
}

test('the player has one accent, and it is the neutral grey in both themes', () => {
  for (const name of ['light', 'dark']) {
    const fill = themeBlock(name).match(/--player-accent:\s*(#[0-9a-f]{6});/i)?.[1]
    assert.equal(fill?.toLowerCase(), '#8f8f8f', `${name}: the player accent is ${fill}`)
  }
})

test('the glyph on the play button and the rate stay readable on it', () => {
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

  for (const name of ['light', 'dark']) {
    const block = themeBlock(name)
    const fill = parse(block.match(/--player-accent:\s*(#[0-9a-f]{6});/i)[1])
    const ink = parse(block.match(/--on-player-accent:\s*(#[0-9a-f]{6});/i)[1])
    const ratio = contrast(fill, ink)
    assert.ok(ratio >= 4.5, `${name}: the player label is ${ratio.toFixed(2)}:1 on the grey`)
  }
})

test('every filled control of the player takes the shared colour', () => {
  // The play button, the played part of the track, and the rate that is on.  These are
  // the whole of the player's active state, and each one reads the token rather than a
  // colour of its own, so one edit moves all of them.
  assert.match(rule('.play'), /background:\s*var\(--player-accent\)/)
  assert.match(rule('.play'), /color:\s*var\(--on-player-accent\)/)
  assert.match(rule('.track-fill'), /background:\s*var\(--player-accent\)/)
  assert.match(rule('.rate-option.active'), /background:\s*var\(--player-accent\)/)
  assert.match(rule('.rate-option.active'), /color:\s*var\(--on-player-accent\)/)
  for (const selector of ['.play', '.track-fill', '.rate-option.active']) {
    assert.doesNotMatch(rule(selector), /--accent\b/, `${selector} still uses the app accent`)
  }
})

test('the player keeps its shape, its hover, and its inactive controls', () => {
  const play = rule('.play')
  assert.match(play, /width:\s*42px;\s*height:\s*42px;/)
  assert.match(play, /border-radius:\s*50%/)
  // Hover is a change of depth, not of colour.
  assert.match(CSS, /\.play:hover \{ box-shadow: var\(--glass-shadow-hover\), var\(--glass-sheen\); \}/)
  assert.match(CSS, /\.rate-option:hover \{ color: var\(--ink\); \}/)
  // A rate that is not the one playing is unchanged: muted text on the glass, no fill.
  const rate = rule('.rate-option')
  assert.match(rate, /color:\s*var\(--muted\)/)
  assert.doesNotMatch(rate, /background/)
  // The track itself is still the unfilled part of the bar.
  assert.doesNotMatch(rule('.track'), /--player-accent/)
})

test('every section with a recording gets the same player', () => {
  // One transport builder serves every section, so a section that has a recording cannot
  // end up with a different one, now or later.
  const transports = LESSON.match(/class="transport"/g) ?? []
  assert.equal(transports.length, 1, 'the player is built in more than one place')
  assert.match(LESSON, /class="rate-option/)
  assert.match(LESSON, /class="track"|class="track"/)

  const lessons = readJson(path.join(DATA, 'manifest.json')).lessons
  let withAudio = 0
  for (const lesson of lessons) {
    for (const section of readJson(path.join(DATA, lesson.id, 'manifest.json')).sections) {
      if (section.audio) withAudio += 1
    }
  }
  assert.ok(withAudio > 0, 'no section has a recording at all')
})

test('the colour is a theme value, not one written into a rule', () => {
  // A literal in a component rule would ignore the theme, so the grey the player is drawn
  // in has to come from the same place every other colour comes from.
  const body = CSS.slice(CSS.indexOf(":root[data-theme='dark']"))
  const literals = [...body.slice(body.indexOf('}')).matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
  assert.deepEqual([...literals].map((m) => m[0]), [])
  // The player is styled once, by its own rules, not repeated per section.
  assert.equal((CSS.match(/^\.play \{/gm) ?? []).length, 1)
  assert.equal((CSS.match(/^\.rate-option\.active \{/gm) ?? []).length, 1)
})