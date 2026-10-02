// The frosted surfaces are one shared recipe, not a look repeated per component: a
// component that wants the effect joins the list rather than restating it.  These tests
// keep that true, keep both themes carrying the effect, and keep the text on top of it
// readable.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')

/** The theme blocks, so a rule can be checked against each theme separately. */
function themeBlock(name) {
  const start = CSS.indexOf(`:root[data-theme='${name}']`)
  if (name === 'light') {
    // The light values are shared with the bare :root selector.
    return CSS.slice(0, CSS.indexOf(":root[data-theme='dark']"))
  }
  const end = CSS.indexOf('\n}', start)
  return CSS.slice(start, end)
}

const GLASS_VARIABLES = [
  '--glass',
  '--glass-strong',
  '--glass-inset',
  '--glass-edge',
  '--glass-hairline',
  '--glass-sheen',
  '--glass-shadow',
  '--glass-shadow-hover',
  '--glass-blur',
  '--glass-blur-strong',
]

test('both themes define the same glass surface', () => {
  for (const name of ['light', 'dark']) {
    const block = themeBlock(name)
    for (const variable of GLASS_VARIABLES) {
      assert.match(
        block,
        new RegExp(`${variable}:`),
        `the ${name} theme does not define ${variable}`,
      )
    }
  }
})

test('the glass is translucent, so there is something for the blur to act on', () => {
  for (const name of ['light', 'dark']) {
    const glass = themeBlock(name).match(/--glass:\s*([^;]+);/)?.[1] ?? ''
    const alpha = Number(glass.match(/([\d.]+)\s*\)$/)?.[1] ?? '1')
    assert.ok(
      alpha > 0 && alpha < 1,
      `the ${name} --glass is not translucent (alpha ${alpha}), so no blur would show`,
    )
  }
})

test('every surface is frosted by the one shared rule', () => {
  // The recipe is declared once, and the components that should have it are named there.
  // A component styled on its own would drift from the others, so the list is asserted.
  const shared = CSS.slice(CSS.indexOf('/* The glass surface.'), CSS.indexOf('@supports (backdrop-filter'))
  for (const selector of [
    '.card',
    '.button',
    '.tab',
    '.rate-option',
    '.theme-toggle',
    '.badge',
    '.field',
    'select',
  ]) {
    assert.ok(shared.includes(selector), `${selector} is not part of the shared glass surface`)
  }
  // The blur itself is applied to the same list, behind a feature test.
  const blur = CSS.slice(CSS.indexOf('@supports (backdrop-filter'))
  for (const selector of ['.card', '.button', '.tab', '.rate-option', '.theme-toggle']) {
    assert.ok(blur.includes(selector), `${selector} never receives the blur`)
  }
})

test('the effect degrades where the platform cannot blur', () => {
  // Two fallbacks, because losing the blur must not lose the readability: a solid fill
  // where backdrop-filter is missing, and plain panels for reduced-transparency.  Both
  // reuse the theme's own card colour, so neither can drift from the theme.
  assert.match(
    CSS,
    /@supports not \(\(backdrop-filter[^{]*\{[\s\S]*?--glass:\s*var\(--card\);/,
  )
  assert.match(CSS, /@media \(prefers-reduced-transparency: reduce\)/)
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/)
})

test('focus is always visible on the controls', () => {
  // A frosted control loses its edge against a blurred backdrop, so the focus ring is
  // drawn outside the surface rather than relying on the border changing.
  assert.match(CSS, /:where\(a, button, input, select, textarea, \[tabindex\]\):focus-visible/)
  assert.match(CSS, /outline:\s*2px solid var\(--accent\)/)
  assert.match(CSS, /outline-offset:\s*2px/)
})

test('the text over the glass keeps a readable contrast in both themes', () => {
  // The one thing the effect must not cost.  Every text colour is composited over the
  // glass fill and the lightest and darkest page tints behind it, and the worst of those
  // combinations has to clear the WCAG AA ratio for body text.
  const parse = (value) => {
    const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1]
    if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const numbers = [...value.matchAll(/[\d.]+/g)].map(Number)
    return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1]
  }
  const composite = (fill, backdrop) =>
    fill.slice(0, 3).map((c, i) => c * fill[3] + backdrop[i] * (1 - fill[3]))
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
    const variable = (v) => parse(block.match(new RegExp(`${v}:\\s*([^;]+);`))?.[1] ?? '#000000')
    const glass = variable('--glass')
    // The page tints are translucent, so the page colour shows through the glass and is
    // the worst case for the text sitting on top of it.
    const backdrop = parse(block.match(/--bg:\s*(#[0-9a-f]{6});/i)?.[1] ?? '#ffffff')
    const behind = [composite(glass, backdrop), composite(glass, backdrop.map((c) => c * 0.94))]

    for (const text of ['--ink', '--muted', '--error']) {
      const ink = variable(text)
      for (const surface of behind) {
        const ratio = contrast(ink.slice(0, 3), surface)
        assert.ok(
          ratio >= 4.5,
          `${name}: ${text} on the glass is ${ratio.toFixed(2)}:1, below 4.5:1`,
        )
      }
    }

    // A filled control keeps a solid fill, so its label is checked against that instead.
    const filled = contrast(variable('--on-accent').slice(0, 3), variable('--accent').slice(0, 3))
    assert.ok(filled >= 4.5, `${name}: a filled button's label is ${filled.toFixed(2)}:1`)
  }
})

test('no component colour is written outside the two theme blocks', () => {
  // The glass added colours, and they are all defined per theme, so a theme can still be
  // changed in one place.  A literal in a component rule would silently ignore the theme.
  const body = CSS.slice(CSS.indexOf(":root[data-theme='dark']"))
  const afterThemes = body.slice(body.indexOf('}'))
  const literals = [...afterThemes.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
  assert.deepEqual(
    literals.map((m) => m[0]),
    [],
    'every surface colour must come from a theme variable',
  )
})
