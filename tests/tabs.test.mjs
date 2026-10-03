// The section tabs are one list of anchors built from lesson.sections, so the selected
// section is styled by a single rule and nothing is styled per section.  These tests keep
// the selected pill on the neutral grey, keep it readable, and keep the other uses of the
// accent - the play button, the progress bar, the rate options - on the accent they had.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')
const LESSON = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')

/** The theme blocks, so a value can be checked per theme. */
function themeBlock(name) {
  const start = CSS.indexOf(`:root[data-theme='${name}']`)
  if (name === 'light') return CSS.slice(0, CSS.indexOf(":root[data-theme='dark']"))
  return CSS.slice(start, CSS.indexOf('\n}', start))
}

const rule = (selector) => {
  const start = CSS.indexOf(`${selector} {`)
  assert.ok(start > -1, `${selector} is missing from the stylesheet`)
  return CSS.slice(start, CSS.indexOf('}', start))
}

test('every section tab is the same anchor, so one rule styles them all', () => {
  const nav = LESSON.slice(LESSON.indexOf('<nav class="tabs"'), LESSON.indexOf('</nav>'))
  assert.match(nav, /lesson\.sections\.map/)
  // The class is decided by the section being open, never per section name.
  assert.match(nav, /class="tab\$\{entry\.id === section\.id \? ' active' : ''\}"/)
  // No section is given a colour of its own anywhere.
  assert.doesNotMatch(LESSON, /tab-active|8f8f8f/i)
})

test('the selected section is filled with the app accent', () => {
  const active = rule('.tab.active')
  // One accent for the whole app: the selected tab is filled with the same colour as
  // every other filled surface, so it can never drift from them.
  assert.match(active, /background:\s*var\(--accent\)/)
  assert.match(active, /color:\s*var\(--on-accent\)/)
  assert.doesNotMatch(CSS, /--tab-active/, 'the tab carries a colour of its own')

  for (const name of ['light', 'dark']) {
    const fill = themeBlock(name).match(/--accent:\s*(#[0-9a-f]{6});/i)?.[1]
    assert.equal(fill?.toLowerCase(), '#8f8f8f', `${name}: the selected tab is ${fill}`)
  }
})

test('the label on the grey pill stays readable in both themes', () => {
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
    const fill = parse(block.match(/--accent:\s*(#[0-9a-f]{6});/i)[1])
    const ink = parse(block.match(/--on-accent:\s*(#[0-9a-f]{6});/i)[1])
    const ratio = contrast(fill, ink)
    assert.ok(ratio >= 4.5, `${name}: the tab label is ${ratio.toFixed(2)}:1 on the grey`)
  }
})

test('the unselected tabs keep their own colours', () => {
  const tab = rule('.tab')
  assert.match(tab, /color:\s*var\(--muted\)/)
  assert.doesNotMatch(tab, /background/)
  assert.match(CSS, /\.tab:hover \{ color: var\(--ink\); \}/)
})

test('the tab and the app share one accent', () => {
  // The tab is a filled surface like any other, so it reads the app's accent rather than
  // a colour of its own.  Nothing here restates the accent, which is what makes a future
  // filled surface pick it up without being told.
  assert.match(CSS, /--accent:\s*#8f8f8f;/)
  assert.doesNotMatch(CSS, /--tab-active|--player-accent/)
  const filled = ['.button:not(.ghost)', '.tab.active', '.play', '.track-fill', '.rate-option.active']
  for (const selector of filled) {
    assert.match(rule(selector), /var\(--accent\)/, `${selector} does not use the accent`)
  }
})