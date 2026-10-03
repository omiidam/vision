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

test('the selected section is filled with the neutral grey in both themes', () => {
  const active = rule('.tab.active')
  assert.match(active, /background:\s*var\(--tab-active\)/)
  assert.match(active, /color:\s*var\(--tab-active-ink\)/)
  // The accent is for actions; the selected tab is told apart from it.
  assert.doesNotMatch(active, /--accent/)

  for (const name of ['light', 'dark']) {
    const fill = themeBlock(name).match(/--tab-active:\s*(#[0-9a-f]{6});/i)?.[1]
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
    const fill = parse(block.match(/--tab-active:\s*(#[0-9a-f]{6});/i)[1])
    const ink = parse(block.match(/--tab-active-ink:\s*(#[0-9a-f]{6});/i)[1])
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

test('the other filled controls stay on the accent', () => {
  // Only the tab bar moved to the grey.  The play button, the progress bar and the rate
  // options are actions, and they read as the accent.
  assert.match(rule('.track-fill'), /background:\s*var\(--accent\)/)
  assert.match(rule('.rate-option.active'), /background:\s*var\(--accent\)/)
  assert.match(CSS, /--accent:\s*#2f6df6;/)
  assert.match(CSS, /--accent:\s*#7aa2ff;/)
})