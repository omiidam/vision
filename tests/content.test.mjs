import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const SOURCE = path.join(ROOT, '10th-class')

/** The source keeps one folder per lesson; every recording is read from there. */
function sourceRecordings() {
  const found = []
  for (const entry of fs.readdirSync(SOURCE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const match = /^lesson[\s_-]*0*(\d+)$/i.exec(entry.name)
    if (!match) continue
    const lessonId = `lesson-${Number(match[1]).toString().padStart(2, '0')}`
    for (const name of fs.readdirSync(path.join(SOURCE, entry.name))) {
      if (name.toLowerCase().endsWith('.mp3')) {
        found.push({ lessonId, file: name, folder: entry.name })
      }
    }
  }
  return found
}

function syncFiles() {
  return fs
    .readdirSync(path.join(DATA, 'lesson-01', 'synchronization'))
    .map((name) => path.join(DATA, 'lesson-01', 'synchronization', name))
    .concat(
      fs
        .readdirSync(path.join(DATA, 'lesson-02', 'synchronization'))
        .map((name) => path.join(DATA, 'lesson-02', 'synchronization', name)),
    )
}

test('grade manifest exposes exactly lessons 1 and 2', () => {
  const manifest = readJson(path.join(DATA, 'manifest.json'))
  assert.equal(manifest.grade, 10)
  assert.equal(manifest.subject, 'English')
  assert.deepEqual(manifest.lessons.map((l) => l.id), ['lesson-01', 'lesson-02'])
  assert.deepEqual(manifest.lessons.map((l) => l.number), [1, 2])
  assert.ok(manifest.lessons.every((l) => l.title.length > 0 && !/TODO|placeholder/i.test(l.title)))
})

test('every section of both lessons exists and has real textbook text', () => {
  // How many sections a lesson publishes follows from what the generator withdraws, so
  // the count is read from the book rather than written down here.
  const textbook = fs.readFileSync(path.join(ROOT, 'tools', 'textbook.py'), 'utf8')
  const all = [...textbook.match(/SECTION_IDS = \[([^\]]*)\]/s)[1].matchAll(/"([^"]+)"/g)].map(
    ([, id]) => id,
  )
  const withdrawn = new Set(
    [...textbook.match(/WITHDRAWN_SECTION_IDS = frozenset\(\{([^}]*)\}\)/s)[1].matchAll(/"([^"]+)"/g)].map(
      ([, id]) => id,
    ),
  )
  const publishedCount = all.filter((id) => !withdrawn.has(id)).length
  assert.ok(publishedCount > 0, 'the book publishes no sections at all')
  for (const lessonId of ['lesson-01', 'lesson-02']) {
    const lesson = readJson(path.join(DATA, lessonId, 'manifest.json'))
    assert.equal(
      lesson.sections.length,
      publishedCount,
      `${lessonId} should expose every published section`,
    )
    for (const section of lesson.sections) {
      assert.ok(!withdrawn.has(section.id), `${lessonId} publishes the withdrawn ${section.id}`)
      const text = readJson(path.join(ROOT, section.text))
      assert.ok(text.blocks.length > 0, `${lessonId}/${section.id} has no blocks`)
      assert.ok(text.text.length > 20, `${lessonId}/${section.id} text is suspiciously short`)
      assert.ok(!/TODO|Lorem ipsum|placeholder/i.test(text.text))
      assert.deepEqual(text.blocks[0].lines.length > 0 ? true : [], true)
    }
  }
})

test('audio is only attached to sections whose recording exists on disk', () => {
  for (const lessonId of ['lesson-01', 'lesson-02']) {
    const lesson = readJson(path.join(DATA, lessonId, 'manifest.json'))
    for (const section of lesson.sections) {
      if (section.audio === null) {
        assert.equal(section.sync, null)
        assert.equal(section.duration, 0)
        continue
      }
      const audioPath = path.join(ROOT, section.audio)
      assert.ok(fs.existsSync(audioPath), `missing recording ${section.audio}`)
      assert.ok(section.duration > 1, `${section.audio} has no duration`)
      const sync = readJson(path.join(ROOT, section.sync))
      assert.equal(sync.lessonId, lessonId)
      assert.equal(sync.sectionId, section.id)
    }
  }
})

test('every source recording is mapped and reported', () => {
  const mapping = readJson(path.join(ROOT, 'data', 'audio-mapping.json'))
  const sources = sourceRecordings()
  assert.equal(sources.length, 8, 'expected 4 recordings per lesson folder')
  const mapped = mapping.audio.filter((entry) => entry.sectionId !== null)
  assert.equal(mapped.length, sources.length, 'every recording must be mapped to a section')
  assert.deepEqual(mapping.unmapped, [])
  for (const entry of mapping.audio) {
    assert.equal(entry.rule, 'filename')
    assert.ok(entry.contentScore > 0.5, `${entry.file} transcript barely corroborates the name`)
    assert.equal(entry.status, 'confirmed')
    assert.deepEqual(entry.notes, [])
  }
})

test('the lesson folder decides the lesson and the file name decides the section', () => {
  const mapping = readJson(path.join(ROOT, 'data', 'audio-mapping.json'))
  const byFile = Object.fromEntries(mapping.audio.map((entry) => [entry.file, entry]))
  for (const { lessonId, file } of sourceRecordings()) {
    assert.ok(byFile[file], `${file} is missing from audio-mapping.json`)
    assert.equal(byFile[file].lessonId, lessonId, `${file} should follow its lesson folder`)
  }
})

test('the file name alone decides which section a recording belongs to', () => {
  const mapping = readJson(path.join(ROOT, 'data', 'audio-mapping.json'))
  // The recordings follow "<section name><lesson number>.mp3".  This table is derived
  // from that convention alone; the transcripts are not consulted here on purpose.
  const expected = {
    'conversation1.mp3': 'conversation',
    'conversation2.mp3': 'conversation',
    'new words and expressions1.mp3': 'new-words-and-expressions',
    'New Words & Expressions2.mp3': 'new-words-and-expressions',
    'reading1.mp3': 'reading',
    'reading2.mp3': 'reading',
    'listening and speaking1.mp3': 'listening-and-speaking',
    'Listening & Speaking2.mp3': 'listening-and-speaking',
  }
  const byName = Object.fromEntries(mapping.audio.map((entry) => [entry.file, entry]))
  assert.deepEqual(Object.keys(byName).sort(), Object.keys(expected).sort())
  for (const [file, sectionId] of Object.entries(expected)) {
    assert.equal(byName[file].sectionId, sectionId, `${file} is on the wrong section`)
  }
})

test('each mapped recording sits in the manifest of its lesson folder', () => {
  const mapping = readJson(path.join(ROOT, 'data', 'audio-mapping.json'))
  for (const entry of mapping.audio) {
    const lesson = readJson(path.join(ROOT, 'data', 'grade-10', entry.lessonId, 'manifest.json'))
    const section = lesson.sections.find((s) => s.id === entry.sectionId)
    assert.ok(section, `${entry.file} has no section in ${entry.lessonId}`)
    assert.ok(section.audio, `${entry.file} is not attached to its section`)
    assert.equal(section.audio, `audio/grade-10/${entry.lessonId}/${entry.sectionId}.mp3`)
  }
})

test('no two recordings claim the same section', () => {
  const mapping = readJson(path.join(ROOT, 'data', 'audio-mapping.json'))
  const claimed = mapping.audio.map((entry) => `${entry.lessonId}/${entry.sectionId}`)
  assert.equal(new Set(claimed).size, claimed.length, 'a section is claimed twice')
})

test('word timestamps are monotonic and inside the recording', () => {
  for (const file of syncFiles()) {
    const sync = readJson(file)
    let previous = -1
    for (const word of sync.words) {
      if (word.start === null) continue
      assert.ok(word.end !== null && word.end >= word.start, `${file}: bad interval for ${word.word}`)
      assert.ok(word.start >= previous, `${file}: timestamps are not monotonic at "${word.word}"`)
      assert.ok(word.end <= sync.duration + 0.5, `${file}: "${word.word}" runs past the recording`)
      previous = word.start
    }
  }
})

test('sentence ranges cover every word and point at real timings', () => {
  for (const file of syncFiles()) {
    const sync = readJson(file)
    const covered = sync.sentences.reduce((total, s) => total + (s.last - s.first + 1), 0)
    assert.equal(covered, sync.words.length, `${file}: sentences must cover every word`)
    for (const sentence of sync.sentences) {
      if (sentence.start === null) continue
      assert.ok(sentence.end >= sentence.start)
    }
  }
})

test('reading sections are almost fully word-timed', () => {
  for (const lessonId of ['lesson-01', 'lesson-02']) {
    const sync = readJson(path.join(DATA, lessonId, 'synchronization', 'reading.sync.json'))
    const timed = sync.words.filter((w) => w.start !== null).length / sync.words.length
    assert.ok(timed > 0.95, `${lessonId} reading only ${(timed * 100).toFixed(1)}% timed`)
    assert.ok(sync.confidence > 0.9, `${lessonId} reading confidence ${sync.confidence}`)
  }
})

test('vocabulary comes from the book and invents no Persian text', () => {
  for (const lessonId of ['lesson-01', 'lesson-02']) {
    const vocab = readJson(path.join(DATA, lessonId, 'vocabulary.json'))
    assert.ok(vocab.items.length >= 4, `${lessonId} has too few vocabulary entries`)
    assert.ok(vocab.targetWords.length >= 4)
    const glossary = vocab.items.filter((item) => item.source === 'glossary')
    assert.ok(glossary.length >= 4, `${lessonId} has too few defined words`)
    // The page is read as its own parts followed by the word bank, and every item says
    // which part it belongs to, so the reader can group them without knowing the lesson.
    const parts = []
    for (const item of vocab.items) {
      if (parts[parts.length - 1] !== item.part) parts.push(item.part)
      assert.ok(item.partTitle, `${item.word}: the part has no title`)
    }
    assert.equal(parts[parts.length - 1], 'word-bank', `${lessonId}: the word bank is not last`)
    assert.ok(
      vocab.items.some((item) => item.part !== 'word-bank'),
      `${lessonId} lists only word bank words`,
    )
    for (const item of vocab.items) {
      assert.ok(item.word.length > 0)
      assert.equal(item.meaningFa, '', 'Persian meanings are not in the source, so they stay empty')
      // The book defines the words of its New Words page and leaves a word bank word
      // undefined, so only a defined entry is held to having a meaning and an example.
      if (item.source === 'glossary') {
        assert.ok(item.meaningEn.length > 0, `${item.word} has no printed meaning`)
        assert.ok(item.examples.length > 0, `${item.word} has no printed example`)
      } else {
        assert.equal(item.meaningEn, '', `${item.word} was given a meaning the book does not print`)
      }
    }
  }
})

test('each part is headed by the letter and title the book prints for it', () => {
  // The reader groups the page by the part on each entry, so the heading it shows has to
  // be built from the data rather than written out here.
  const source = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
  const render = source.slice(source.indexOf('private renderVocabulary'))
  assert.match(render, /groups\.find\(\(candidate\) => candidate\.key === item\.part\)/)
  assert.match(render, /item\.partTitle/)
  assert.match(render, /vocab-part/)
  // The words stay inside the part they are printed in: one section per group, in the
  // order the data lists them, and nothing dropped between two groups.
  assert.match(render, /group\.items\.map\(itemHtml\)\.join\(''\)/)
})

test('every block of the New Words page says what the book prints it as', () => {
  // The reader lays the page out from this, so a block of it has to say whether it is a
  // part heading or one printed item, and every block the reader groups has to be one the
  // content pipeline marked.  The blocks of any other section are running text and are
  // left unmarked, which is what tells the two apart without naming a section.
  for (const lessonId of readJson(path.join(DATA, 'manifest.json')).lessons.map((l) => l.id)) {
    const data = readJson(path.join(DATA, lessonId, 'sections', 'new-words-and-expressions.json'))
    const kinds = new Set(data.blocks.map((block) => block.kind))
    assert.deepEqual([...kinds].sort(), ['example', 'part-heading'], `${lessonId}: unmarked blocks`)
    const headings = data.blocks.filter((block) => block.kind === 'part-heading')
    assert.ok(headings.length > 0, `${lessonId}: the page prints no part heading`)
    for (const heading of headings) {
      assert.ok(
        /^[A-Z]\.\s.+[.!?]$/.test(heading.lines.join(' ')),
        `${lessonId}: "${heading.lines.join(' ')}" is not printed as a part heading`,
      )
      assert.equal(heading.lines.length, 1, `${lessonId}: a part heading wraps onto another row`)
    }
    // The reader groups the page and only the page, so no other section's blocks carry a
    // kind: a lesson whose text is grouped elsewhere would otherwise lose that grouping.
    for (const section of readJson(path.join(DATA, lessonId, 'manifest.json')).sections) {
      if (section.id === 'new-words-and-expressions') continue
      const other = readJson(path.join(ROOT, section.text))
      for (const block of other.blocks) {
        assert.equal(block.kind, undefined, `${lessonId}/${section.id}: block is marked`)
      }
    }
  }
})

test('a part the book prints side by side is a grid, and one it prints in rows is a list', () => {
  // The book lays the parts of its vocabulary page out differently, and which way a part
  // goes is read off the page: the parts printed as pictures set two captions on the same
  // printed row, and the parts printed as headwords give every entry a row of its own.
  // Nothing here names a part, so a lesson printed differently needs no change.
  for (const lessonId of readJson(path.join(DATA, 'manifest.json')).lessons.map((l) => l.id)) {
    const data = readJson(path.join(DATA, lessonId, 'sections', 'new-words-and-expressions.json'))
    const parts = new Map()
    for (const block of data.blocks) {
      assert.ok(block.part, `${lessonId}: a block names no part`)
      assert.ok(['grid', 'list'].includes(block.layout), `${lessonId}: "${block.layout}" is not a layout`)
      assert.equal(
        block.layout,
        block.columns > 1 ? 'grid' : 'list',
        `${lessonId}: part ${block.part} says ${block.layout} for ${block.columns} columns`,
      )
      parts.set(block.part, block.layout)
    }
    // A part is one run of blocks: the book prints it in one place, so its blocks are
    // never split up by another part coming between them.
    const runs = []
    for (const block of data.blocks) {
      if (runs[runs.length - 1] !== block.part) runs.push(block.part)
    }
    assert.equal(new Set(runs).size, runs.length, `${lessonId}: a part is printed in pieces`)

    // A part printed side by side is two columns wide; one printed in rows is one column.
    for (const [part, layout] of parts) {
      const blocks = data.blocks.filter((block) => block.part === part)
      const columns = blocks[0].columns
      if (layout === 'grid') {
        assert.ok(columns >= 2, `${lessonId}: part ${part} is a grid of ${columns} columns`)
      } else {
        assert.equal(columns, 1, `${lessonId}: part ${part} is a list of ${columns} columns`)
      }
    }
  }
})

test('the items of a grid part are printed in the order they are read left to right', () => {
  // A grid fills each row left to right and starts the next row below, so the blocks of a
  // grid part are in reading order with no gaps and nothing doubled.  The blocks are read
  // from the page in that order and never sorted, so this is the order the book prints.
  for (const lessonId of readJson(path.join(DATA, 'manifest.json')).lessons.map((l) => l.id)) {
    const data = readJson(path.join(DATA, lessonId, 'sections', 'new-words-and-expressions.json'))
    for (const part of new Set(data.blocks.map((block) => block.part))) {
      const items = data.blocks.filter(
        (block) => block.part === part && block.kind === 'example',
      )
      const texts = items.map((block) => block.lines.join(' '))
      assert.equal(
        new Set(texts).size,
        texts.length,
        `${lessonId}: part ${part} prints the same item twice`,
      )
      // Every line of the page is still there, in the order it was printed: a layout
      // describes where an item goes, never which items there are or what they say.  The
      // page's own text is the blocks joined, so that is what they are checked against.
      const shown = data.blocks.flatMap((block) => block.lines.join(' '))
      assert.deepEqual(
        shown,
        data.text.split('\n'),
        `${lessonId}: part ${part} reordered or changed the printed lines`,
      )
    }
  }
})

test('the reader lays each part out the way the book prints it', () => {
  // The layout is carried on each block, so the reader does not decide for itself which
  // parts have two columns: a part the book prints side by side becomes a grid as wide as
  // the page sets it, and a part it prints in rows stays a single column.  Nothing here
  // names a part, so a part printed another way needs no change here either.
  const source = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
  const render = source.slice(source.indexOf('private partContainer'))
  assert.match(render, /block\.layout === 'grid'/)
  assert.match(render, /vocab-grid/)
  assert.match(render, /--part-columns/)
  assert.match(render, /block\.columns \?\? 2/)
  // A heading is not an item: it stands on its own above its part rather than taking a
  // cell in the grid, which would push every item along by one.
  assert.match(
    source,
    /block\.kind === 'example'\s*\n\s*\? this\.partContainer/,
    'the heading of a part is being laid out as one of its items',
  )
  // The grid fills each row left to right and starts the next row below, which is the
  // order the book prints its items in, and the order the blocks arrive in.
  const css = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')
  assert.match(css, /\.vocab-grid\s*\{[\s\S]*?display: grid;/)
  assert.match(css, /grid-template-columns: repeat\(var\(--part-columns, 2\)/)
  // The list is one column.  It is styled as the absence of a grid, so a part that is not
  // printed side by side can never come out as a two-column table.
  assert.match(css, /:not\(\.vocab-grid\)/)
  assert.doesNotMatch(css, /vocab-grid[^{]*\{[^}]*grid-template-columns: repeat\(var\(--part-columns, 2\)[^}]*\}[\s\S]*?vocab-list[^{]*\{[^}]*display: grid/)
})

test('the New Words page shows the parts the book prints and no pointer to the workbook', () => {
  for (const lessonId of ['lesson-01', 'lesson-02']) {
    const data = readJson(path.join(DATA, lessonId, 'sections', 'new-words-and-expressions.json'))
    // A part such as "C. Go to Part III of your Workbook and do A and B." teaches no words
    // and is not part of the reader's page, so neither its heading nor its words are here.
    assert.ok(
      !/Workbook/i.test(data.text),
      `${lessonId}: the page still sends the reader to the workbook`,
    )
    for (const entry of data.vocabulary) {
      assert.ok(
        !/Workbook/i.test(entry.word),
        `${lessonId}: "${entry.word}" came from the part that points at the workbook`,
      )
    }
    // Every part the page does show is listed under the heading the book prints for it.
    for (const entry of data.vocabulary) {
      if (entry.part === 'word-bank') continue
      assert.ok(
        data.text.includes(`${entry.part.toUpperCase()}. ${entry.partTitle}`),
        `${lessonId}: the heading of part ${entry.part} is not in the page's text`,
      )
    }
  }
})
