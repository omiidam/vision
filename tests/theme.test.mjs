// The theme helpers read the document and localStorage at call time, so the test stubs
// just enough of a browser and loads the shipped module.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const state = { stored: {}, systemPrefersDark: true, store: null }

globalThis.document = {
  documentElement: { dataset: {}, style: {} },
}
globalThis.window = {
  get localStorage() {
    return state.store
  },
  matchMedia: (query) => ({ matches: state.systemPrefersDark && query.includes('dark') }),
}

const { THEMES, applyTheme, initTheme, isTheme, preferredTheme, setTheme, storedTheme, toggleTheme } =
  await import('../src/theme.ts')

/** A working localStorage, or one that refuses to be used. */
function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value) },
  }
}

function brokenStorage() {
  return {
    getItem() { throw new Error('storage unavailable') },
    setItem() { throw new Error('storage unavailable') },
  }
}

function reset({ stored = {}, systemPrefersDark = true, store = memoryStorage(stored) } = {}) {
  state.stored = stored
  state.systemPrefersDark = systemPrefersDark
  state.store = store
  document.documentElement.dataset = {}
  document.documentElement.style = {}
}

test.beforeEach(() => reset())

test('exactly two themes are offered', () => {
  assert.deepEqual([...THEMES], ['light', 'dark'])
  assert.equal(isTheme('light'), true)
  assert.equal(isTheme('dark'), true)
  assert.equal(isTheme('sepia'), false)
  assert.equal(isTheme(null), false)
})

test('choosing a theme applies it to the document and remembers it', () => {
  const storage = state.store = memoryStorage()
  setTheme('dark')
  assert.equal(document.documentElement.dataset.theme, 'dark')
  assert.equal(storage.data['vision:theme'], 'dark')
  assert.equal(storedTheme(), 'dark')
})

test('the browser is told which colour scheme is in use', () => {
  applyTheme('dark')
  assert.equal(document.documentElement.style.colorScheme, 'dark')
  applyTheme('light')
  assert.equal(document.documentElement.style.colorScheme, 'light')
})

test('toggling flips between the two themes and persists each time', () => {
  reset({ systemPrefersDark: false })
  assert.equal(toggleTheme(), 'dark')
  assert.equal(document.documentElement.dataset.theme, 'dark')
  assert.equal(storedTheme(), 'dark')
  assert.equal(toggleTheme(), 'light')
  assert.equal(storedTheme(), 'light')
})

test('a saved theme is used on the next start', () => {
  reset({ stored: { 'vision:theme': 'dark' } })
  assert.equal(preferredTheme(), 'dark')
  assert.equal(initTheme(), 'dark')
  assert.equal(document.documentElement.dataset.theme, 'dark')
})

test('with no saved theme the system preference decides', () => {
  reset({ systemPrefersDark: true })
  assert.equal(preferredTheme(), 'dark')
  reset({ systemPrefersDark: false })
  assert.equal(preferredTheme(), 'light')
})

test('a corrupted saved value is ignored instead of half-applied', () => {
  reset({ stored: { 'vision:theme': 'sepia' } })
  assert.equal(storedTheme(), null)
  assert.equal(preferredTheme(), 'dark', 'falls back to the system preference')
  assert.equal(initTheme(), 'dark')
})

test('storage that throws does not break the theme', () => {
  state.store = brokenStorage()
  assert.equal(storedTheme(), null)
  assert.doesNotThrow(() => setTheme('dark'))
  assert.equal(document.documentElement.dataset.theme, 'dark', 'still applied for this session')
})

test('the stylesheet defines exactly these two themes, dark on #454747', () => {
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  // A selector list may name several of them at once (`:root, :root[data-theme='light']`),
  // so collect the themes named anywhere in each top-level rule.
  const themes = new Set()
  for (const [, selector] of css.matchAll(/^([^{}]+)\{/gm)) {
    for (const [, name] of selector.matchAll(/:root(?:\[data-theme='(\w+)'\])?/g)) {
      themes.add(name ?? 'light')
    }
  }
  assert.deepEqual([...themes].sort(), ['dark', 'light'], 'one light and one dark block')
  assert.match(css, /:root\[data-theme='dark'\][\s\S]*?--bg:\s*#454747;/)
  assert.match(css, /:root,\s*:root\[data-theme='light'\][\s\S]*?--bg:\s*#ffffff;/)
})

test('no rule hardcodes a colour that a theme cannot override', () => {
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  // The only literal colours allowed are the theme definitions themselves.
  const afterThemes = css.slice(css.indexOf(":root[data-theme='dark']"))
  const body = afterThemes.slice(afterThemes.indexOf('}'))
  const literals = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
  assert.deepEqual(literals.map((m) => m[0]), [], 'every component colour must come from a variable')
})
