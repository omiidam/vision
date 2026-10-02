// Guards against the lesson title being shown twice: the header already carries the
// lesson number, the page range and the title, so no other view may repeat that line.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(file, 'utf8')

const VIEWS = ['home.ts', 'lesson.ts', 'router.ts'].map((f) => path.join(ROOT, 'src', 'views', f))

test('no view renders the table-of-contents lesson line', () => {
  for (const file of VIEWS) {
    const source = read(file)
    assert.doesNotMatch(
      source,
      /tocLine/,
      `${path.relative(ROOT, file)} repeats the lesson line that the header already shows`,
    )
  }
})

test('the lesson header still shows the number, the pages and the title', () => {
  const source = read(path.join(ROOT, 'src', 'views', 'lesson.ts'))
  assert.match(source, /Lesson \$\{bdi\(String\(lesson\.number\)\)\}/, 'the lesson number is shown')
  assert.match(source, /formatPageRange\(lesson\.pages\)/, 'the page range is shown')
  assert.match(source, /<h1>\$\{escapeHtml\(lesson\.title\)\}<\/h1>/, 'the lesson title is shown')
})

test('the lessons list still shows the number, the pages and the title', () => {
  const source = read(path.join(ROOT, 'src', 'views', 'home.ts'))
  assert.match(source, /Lesson \$\{bdi\(String\(lesson\.number\)\)\}/)
  assert.match(source, /formatPageRange\(lesson\.pages\)/)
  assert.match(source, /<h2>\$\{escapeHtml\(lesson\.title\)\}<\/h2>/)
})

test('the section header names the section and gives its pages, and nothing else', () => {
  const source = read(path.join(ROOT, 'src', 'views', 'lesson.ts'))
  // The section name stays: it is the heading the reader navigates by.
  assert.match(source, /<h2 id="section-title"[^>]*>\$\{escapeHtml\(section\.label\)\}<\/h2>/)
  // The book's own subtitle for the section is not repeated under it.
  const sub = source.slice(source.indexOf('sub.innerHTML'), source.indexOf('applyLanguage(sub'))
  assert.doesNotMatch(sub, /section\.title/, 'the section description is shown again')
  assert.match(sub, /bdi\(formatPageRange\(section\.pages\)\)/, 'the pages are shown')
})

test('no view writes a page range of its own', () => {
  // Every page range goes through the one formatter, so a single-page section is written
  // the same way in a lesson, a section and a lesson added tomorrow.  The formatter itself
  // is the one place allowed to build the wording, and its comment is only prose.
  for (const file of VIEWS) {
    const code = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const handmade = code.match(/pages \$\{[^}]*\}\s*–\s*\$\{/g) ?? []
    assert.deepEqual(handmade, [], `${path.relative(ROOT, file)} writes a page range by hand`)
  }
  const pages = read(path.join(ROOT, 'src', 'pages.ts'))
  assert.match(pages, /export function formatPageRange/)
})

test('no lesson section text opens with a repeated lesson line', () => {
  const sections = path.join(ROOT, 'data', 'grade-10')
  const lessons = fs.readdirSync(sections).filter((name) => name.startsWith('lesson-'))
  assert.ok(lessons.length > 0, 'expected generated lessons')
  for (const lesson of lessons) {
    const dir = path.join(sections, lesson, 'sections')
    for (const name of fs.readdirSync(dir)) {
      const text = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      for (const block of text.blocks) {
        for (const line of block.lines) {
          assert.doesNotMatch(
            line,
            /^\s*Lesson\s+\d+\s*[:)]/i,
            `${lesson}/${name} repeats the lesson line inside its own text`,
          )
        }
      }
    }
  }
})

test('the stylesheet has no rule left for the removed line', () => {
  assert.doesNotMatch(read(path.join(ROOT, 'src', 'styles.css')), /^\.toc\s*\{/m)
})
