// The vocabulary rule is universal: whatever the book marks as vocabulary for a section
// has to be registered for that section, for every lesson, with nothing hardcoded to the
// words that happen to be in Lessons 1 and 2 today.  These tests check the generated
// data against that rule, and the extractor against the shapes it has to tell apart.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'grade-10')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const GRADE = readJson(path.join(DATA, 'manifest.json'))
const LESSON_IDS = GRADE.lessons.map((l) => l.id)
const sectionFiles = LESSON_IDS.flatMap((lessonId) =>
  readJson(path.join(DATA, lessonId, 'manifest.json')).sections.map((s) => ({
    lessonId,
    section: s,
    file: path.join(ROOT, s.text),
  })),
)

const INDEX = readJson(path.join(DATA, 'vocabulary.json'))

/** Printed page range of every published section, keyed by lesson and section. */
const SECTION_PAGES = Object.fromEntries(
  LESSON_IDS.map((lessonId) => [
    lessonId,
    Object.fromEntries(
      readJson(path.join(DATA, lessonId, 'manifest.json')).sections.map((s) => [s.id, s.pages]),
    ),
  ]),
)

/**
 * Run the Python extractor once and report what it makes of the shapes below.  The
 * extractor is the real one in tools/, not a re-implementation in JavaScript.
 */
const BANKS = [
  'endangered, alive, increase, hear, protect, for example',
  'near, rocky, orbit, powerful',
  'Conversation 1',
  'Singular and Plural',
  'a',
  'powerful,',
]
// The two kinds of part a vocabulary page is printed in, and the third kind that is not a
// part at all: a heading that sends the reader to another book teaches nothing here.
const PART_CASES = {
  glossary: [
    [21, 'human: a person'],
    [21, 'All humans must take care of nature.'],
    [21, 'A. Look, Read and Practice.'],
    [21, 'instead: in place of someone or something else'],
  ],
  practice: [
    [21, 'A. Look, Read and Practice.'],
    [21, 'The Earth is our only home.', ['Earth']],
    [21, 'Many animals died out there.', ['died out']],
  ],
  pointer: [[21, 'C. Go to Part III of your Workbook and do A and B.', []]],
}
/**
 * The extractor is Python, and the book is a PDF, so a few checks have to run the real
 * one.  Where it cannot be run - a machine with no Python, or without the PDF library -
 * those checks are reported as skipped rather than failing: the data checks below them
 * still run, and they are the ones that decide what the reader shows.
 */
function runExtractor(source, ...args) {
  for (const command of ['python', 'python3']) {
    try {
      return execFileSync(command, ['-c', source, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch (error) {
      // Only an interpreter that is missing counts as "cannot run"; a real error in the
      // extractor must still fail the suite rather than be passed over.
      if (error.code !== 'ENOENT') throw error
    }
  }
  return null
}

/**
 * The word banks read straight out of the book, per lesson and section.  This is an
 * oracle taken from the PDF rather than from the generated data, so a test can tell
 * whether the data still holds everything the book prints.
 */
const printedBanksOutput = runExtractor(
  `
import sys, json, pymupdf
sys.path.insert(0, "tools")
import vocabulary as V
doc = pymupdf.open("10th-class/" + __import__("textbook").BOOK_FILENAME)
out = {}
for lesson in json.loads(sys.argv[1]):
    out[lesson] = [
        [section_id, V.word_bank_entries(doc, tuple(pages))]
        for section_id, pages in json.loads(sys.argv[2])[lesson]
    ]
print(json.dumps(out))
`,
  JSON.stringify(LESSON_IDS),
  JSON.stringify(
    Object.fromEntries(
      LESSON_IDS.map((lessonId) => [
        lessonId,
        Object.entries(SECTION_PAGES[lessonId]).map(([id, pages]) => [id, pages]),
      ]),
    ),
  ),
)
const PRINTED_BANKS = printedBanksOutput ? JSON.parse(printedBanksOutput) : null

/**
 * Every visible line of every published section's printed pages, taken from the PDF.
 * A word the book marks for a section has to be printed on that section's pages: some of
 * them sit in the running text, and some in a callout panel such as the word bank beside
 * a conversation, which the reader's text for the section leaves out.
 */
const printedPagesOutput = runExtractor(
  `
import sys, json, pymupdf
sys.path.insert(0, "tools")
import textbook as B
doc = pymupdf.open("10th-class/" + B.BOOK_FILENAME)
out = {}
for lesson, sections in json.loads(sys.argv[1]).items():
    out[lesson] = {
        section_id: " ".join(
            text
            for page in range(pages[0], pages[1] + 1)
            for text in B.page_lines(doc, page)
        ).lower()
        for section_id, pages in sections
    }
print(json.dumps(out))
`,
  JSON.stringify(
    Object.fromEntries(
      LESSON_IDS.map((lessonId) => [
        lessonId,
        Object.entries(SECTION_PAGES[lessonId]),
      ]),
    ),
  ),
)
const PRINTED_PAGES = printedPagesOutput ? JSON.parse(printedPagesOutput) : null

/**
 * Run the real extractor over the shapes above and over the book's own vocabulary pages,
 * so the tests check the code that builds the data rather than a copy of it.
 */
const extractedOutput = runExtractor(
  `
import sys, json, pymupdf
sys.path.insert(0, "tools")
import textbook, vocabulary as V
doc = pymupdf.open("10th-class/" + textbook.BOOK_FILENAME)
SECTION_ID = "new-words-and-expressions"

def lines_of(case):
    return [V.Line(page=row[0], text=row[1], highlights=list(row[2] if len(row) > 2 else []))
            for row in case]

def describe(parts):
    return [[p.letter, p.title, [[e.word, e.source, e.part, e.meaning_en, e.examples]
                                  for e in V.part_entries(p, SECTION_ID)]]
            for p in parts]

cases = json.loads(sys.argv[2])
parts = {name: V.split_parts(lines_of(case)) for name, case in cases.items()}
pages = json.loads(sys.argv[3])
printed = V.split_parts(V.page_lines(doc, tuple(pages)))
print(json.dumps({
    "banks": [V.word_bank_items(x) for x in json.loads(sys.argv[1])],
    "cases": {name: describe(found) for name, found in parts.items()},
    "taught": {name: [p.letter for p in found if V.part_entries(p, SECTION_ID)]
               for name, found in parts.items()},
    "printed": describe(printed),
    "shown": [p.letter for p in V.vocabulary_page_parts(doc, tuple(pages), SECTION_ID)],
    "lines": [[line.text, line.highlights] for line in V.page_lines(doc, tuple(pages))],
}))
`,
  JSON.stringify(BANKS),
  JSON.stringify(PART_CASES),
  JSON.stringify(SECTION_PAGES['lesson-01']['new-words-and-expressions']),
)
const EXTRACTED = extractedOutput ? JSON.parse(extractedOutput) : null

const SKIPPED = 'the book and its extractor cannot be read on this machine'

/**
 * The two conversations as the book prints them: the introduction the page opens with,
 * then one entry per turn with the words of the turn the book wrapped onto the next
 * printed row joined back together.
 */
const CONVERSATION_TURNS = {
  'lesson-01': [
    "Maryam is visiting the Museum of Nature and Wildlife. She's talking to Mr. Razavi, who works in the museum.",
    'Maryam: Excuse me, what is it? Is it a leopard?',
    'Mr. Razavi: No, it is a cheetah.',
    'Maryam: Oh, a cheetah?',
    'Mr. Razavi: Yeah, an Iranian cheetah. It is an endangered animal.',
    'Maryam: I know. I heard around 70 of them are alive. Yes?',
    'Mr. Razavi: Right, but the number will increase.',
    'Maryam: Really?! How?',
    'Mr. Razavi: Well, we have some plans. For example, we are going to protect their homes, to make movies about their life, and to teach people how to take more care of them.',
  ],
  'lesson-02': [
    'Alireza is visiting an observatory. He is talking to Ms. Tabesh who works there.',
    'Ms.Tabesh: Are you interested in the planets?',
    "Alireza: Yes! They are really interesting for me, but I don't know much about them.",
    'Ms.Tabesh: Planets are really amazing but not so much alike. Do you know how they are different?',
    'Alireza: Umm... I know they go around the Sun in different orbits.',
    "Ms.Tabesh: That's right. They have different colors and sizes, too. Some are rocky like Mars, some have rings like Saturn and some have moons like Uranus.",
    'Alireza: How wonderful! Can we see them without a telescope?',
    'Ms.Tabesh: Yeah..., we can see the planets nearer to us without a telescope, such as Mercury, Venus, Mars, Jupiter and Saturn. We can see Uranus and Neptune only with powerful telescopes.',
    'Alireza: And which planet is the largest of all?',
    'Ms.Tabesh: Jupiter is the largest one. It has more than sixty moons. Do you want to look at it?',
    'Alireza: I really like that.',
  ],
}

/** A check that has to read the book, so it can only run where Python can read the PDF. */
const fromBook = (name, fn) =>
  test(name, { skip: EXTRACTED ? false : SKIPPED }, fn)

test('every published section carries a vocabulary list, even an empty one', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    const data = readJson(file)
    assert.ok(Array.isArray(data.vocabulary), `${lessonId}/${section.id} has no vocabulary list`)
  }
})

test('every entry says which grade, lesson and section it belongs to', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    for (const entry of readJson(file).vocabulary) {
      assert.equal(entry.grade, GRADE.grade, `${entry.word}: wrong grade`)
      assert.equal(entry.lessonId, lessonId, `${entry.word}: wrong lesson`)
      // The entry is written into the section whose file it is in...
      assert.equal(entry.listedIn, section.id, `${entry.word}: listed in the wrong section`)
      // ...and it names the section the book prints it in, which the page must agree with.
      const source = SECTION_PAGES[lessonId]?.[entry.sectionId]
      assert.ok(source, `${entry.word}: unknown source section ${entry.sectionId}`)
      assert.ok(
        entry.page >= source[0] && entry.page <= source[1],
        `${entry.word}: page ${entry.page} is outside ${entry.sectionId} (${source.join('-')})`,
      )
    }
  }
})

test('every entry keeps the slots a later editing pass will fill', () => {
  const REQUIRED = ['meaningEn', 'meaningFa', 'pronunciation', 'examples', 'audio', 'source', 'position']
  for (const entry of INDEX.entries) {
    for (const field of REQUIRED) {
      assert.ok(field in entry, `${entry.word}: missing ${field}`)
    }
    assert.equal(typeof entry.examples, 'object')
  }
})

test('positions number the words of a section from zero, in order', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    readJson(file).vocabulary.forEach((entry, index) => {
      assert.equal(entry.position, index, `${lessonId}/${section.id}: position ${index} out of order`)
    })
  }
})

test('a section never lists the same word twice', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    const words = readJson(file).vocabulary.map((e) => e.word.toLowerCase())
    assert.equal(new Set(words).size, words.length, `${lessonId}/${section.id} repeats a word`)
  }
})

test('every word bank word is a separate entry, never a combined phrase', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    for (const entry of readJson(file).vocabulary) {
      if (entry.source !== 'word-bank') continue
      assert.ok(!/\s/.test(entry.word), `${lessonId}/${section.id}: "${entry.word}" is not one word`)
      assert.ok(!entry.word.includes(','), `${lessonId}/${section.id}: "${entry.word}" is a list`)
    }
  }
})

test('an entry either belongs to the section listing it, or was carried to the New Words page', () => {
  for (const lessonId of LESSON_IDS) {
    const ids = Object.keys(SECTION_PAGES[lessonId])
    const files = sectionFiles.filter((f) => f.lessonId === lessonId)
    for (const { section, file } of files) {
      for (const entry of readJson(file).vocabulary) {
        assert.ok(ids.includes(entry.sectionId), `${entry.word}: unknown section ${entry.sectionId}`)
        if (entry.sectionId === entry.listedIn) continue
        assert.equal(
          entry.listedIn,
          'new-words-and-expressions',
          `${entry.word}: carried somewhere other than the New Words page`,
        )
        assert.equal(entry.source, 'word-bank', `${entry.word}: only a word bank word is carried`)
      }
    }
  }
})

fromBook('every word bank word appears separately and in order on the New Words page', () => {
  for (const lessonId of LESSON_IDS) {
    // Straight from the book: every word of every word bank of the lesson, in the order
    // the sections and the banks are printed in.
    const printed = PRINTED_BANKS[lessonId].flatMap(([, words]) => words.map(([, word]) => word))
    assert.ok(printed.length > 0, `${lessonId} has no word bank words to register`)

    const newWords = readJson(path.join(DATA, lessonId, 'sections', 'new-words-and-expressions.json'))
    const listed = newWords.vocabulary.filter((e) => e.source === 'word-bank').map((e) => e.word)
    assert.deepEqual(listed, printed, `${lessonId}: the New Words page lost or reordered a word bank word`)

    // Each one is its own entry, not folded into a neighbour and not listed twice.
    const all = newWords.vocabulary.map((e) => e.word)
    assert.equal(new Set(all).size, all.length, `${lessonId}: a word is listed twice`)
    for (const word of printed) {
      assert.equal(all.filter((w) => w === word).length, 1, `${lessonId}: "${word}" is not listed once`)
    }
  }
})

test('no section lists a word bank word except the vocabulary page', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    if (section.id === 'new-words-and-expressions') continue
    const bank = readJson(file).vocabulary.filter((e) => e.source === 'word-bank')
    assert.deepEqual(
      bank.map((e) => e.word),
      [],
      `${lessonId}/${section.id} repeats word bank words as its own vocabulary`,
    )
  }
})

fromBook('the words the book prints in a word bank are not listed twice anywhere', () => {
  for (const lessonId of LESSON_IDS) {
    const printed = PRINTED_BANKS[lessonId].flatMap(([, words]) => words.map(([, word]) => word))
    const listedEverywhere = sectionFiles
      .filter((f) => f.lessonId === lessonId)
      .flatMap(({ file }) => readJson(file).vocabulary.map((e) => e.word))
    for (const word of printed) {
      const count = listedEverywhere.filter((w) => w === word).length
      assert.equal(count, 1, `${lessonId}: "${word}" is listed ${count} times across the lesson`)
    }
  }
})

test('the New Words page lists its own parts first and the word bank words last', () => {
  for (const lessonId of LESSON_IDS) {
    const newWords = readJson(path.join(DATA, lessonId, 'sections', 'new-words-and-expressions.json'))
    const sources = newWords.vocabulary.map((e) => e.source)
    const firstWordBank = sources.indexOf('word-bank')
    assert.ok(firstWordBank >= 0, `${lessonId}: no word bank words on the New Words page`)
    assert.ok(
      sources.slice(firstWordBank).every((source) => source === 'word-bank'),
      `${lessonId}: a word of the page's own parts is listed after the word bank`,
    )
  }
})

test('the New Words page is read as parts, each listed once and in the printed order', () => {
  // Nothing here names a part: the parts come from the book, the word bank is the group
  // the data puts last, and the letters have to run in the order they are printed.
  for (const lessonId of LESSON_IDS) {
    const newWords = readJson(path.join(DATA, lessonId, 'sections', 'new-words-and-expressions.json'))
    const parts = []
    for (const entry of newWords.vocabulary) {
      // A part's words are one run: nothing from a part comes back after another part.
      if (parts[parts.length - 1] !== entry.part) parts.push(entry.part)
      assert.ok(entry.part, `${lessonId}/${entry.word}: the entry names no part`)
      assert.ok(entry.partTitle, `${lessonId}/${entry.word}: the part has no title`)
    }
    assert.equal(new Set(parts).size, parts.length, `${lessonId}: a part is listed in pieces`)
    assert.equal(parts[parts.length - 1], 'word-bank', `${lessonId}: the word bank is not last`)
    const letters = parts.filter((part) => part !== 'word-bank')
    assert.deepEqual(
      letters,
      [...letters].sort(),
      `${lessonId}: the parts are not in the order the book prints them`,
    )
    // A part's words are read the way the book marks them, and the word bank is the only
    // part made of words the page itself does not print.
    for (const entry of newWords.vocabulary) {
      assert.equal(
        entry.source === 'word-bank',
        entry.part === 'word-bank',
        `${entry.word}: the part and the source disagree`,
      )
      assert.ok(
        ['practice', 'glossary', 'word-bank'].includes(entry.source),
        `${lessonId}: "${entry.word}" is listed as ${entry.source}`,
      )
    }
  }
})

fromBook('a part that teaches nothing is neither listed nor left in the text', () => {
  // The parts the book prints, straight from the PDF.  One that teaches no words has to
  // be gone from the data, and its own heading gone from the text the reader shows, so
  // that nothing of a part such as "go to the workbook" survives on the page.
  const file = sectionFiles.find(
    (s) => s.lessonId === 'lesson-01' && s.section.id === 'new-words-and-expressions',
  ).file
  const data = readJson(file)
  const listed = new Set(data.vocabulary.map((entry) => entry.part))
  let dropped = 0
  for (const [letter, title, entries] of EXTRACTED.printed) {
    if (entries.length > 0) {
      assert.ok(listed.has(letter.toLowerCase()), `part ${letter} teaches words but is not listed`)
      continue
    }
    dropped += 1
    assert.ok(!listed.has(letter.toLowerCase()), `part ${letter} teaches nothing yet is listed`)
    assert.ok(
      !data.text.includes(`${letter}. ${title}`),
      `the text still carries a part that teaches nothing: ${letter}. ${title}`,
    )
  }
  assert.ok(dropped > 0, 'the book printed no part that teaches nothing, so nothing was checked')
  assert.deepEqual(
    EXTRACTED.shown,
    EXTRACTED.printed.filter(([, , entries]) => entries.length > 0).map(([letter]) => letter),
    'the extractor did not leave out exactly the parts that teach nothing',
  )
})

fromBook('a word bank word keeps its own section and page on the New Words page', () => {
  for (const lessonId of LESSON_IDS) {
    const newWords = readJson(path.join(DATA, lessonId, 'sections', 'new-words-and-expressions.json'))
    const fromBank = newWords.vocabulary.filter((e) => e.source === 'word-bank')
    assert.ok(fromBank.length > 0, `${lessonId} lists no word bank words`)
    // Each word still names the section whose word bank it was printed in, and the page
    // it was printed on; only the list it belongs to changed.
    assert.ok(
      fromBank.every((e) => e.listedIn === 'new-words-and-expressions'),
      `${lessonId}: a word bank word is listed somewhere else`,
    )
    for (const entry of fromBank) {
      const pages = SECTION_PAGES[lessonId][entry.sectionId]
      assert.ok(pages, `${entry.word}: unknown source section ${entry.sectionId}`)
      assert.ok(
        entry.page >= pages[0] && entry.page <= pages[1],
        `${entry.word}: page ${entry.page} is outside ${entry.sectionId}`,
      )
    }
    // The words the book prints, with the section and page that print them.
    const printed = PRINTED_BANKS[lessonId].flatMap(([sectionId, words]) =>
      words.map(([page, word]) => [word, sectionId, page]),
    )
    assert.deepEqual(
      fromBank.map((e) => [e.word, e.sectionId, e.page]),
      printed,
      `${lessonId}: a word bank word changed where it came from`,
    )
  }
})

test('the vocabulary the reader renders is the same ordered listing', () => {
  for (const lessonId of LESSON_IDS) {
    const newWords = readJson(path.join(DATA, lessonId, 'sections', 'new-words-and-expressions.json'))
    const items = readJson(path.join(DATA, lessonId, 'vocabulary.json')).items
    assert.deepEqual(
      items.map((i) => i.word),
      newWords.vocabulary.map((e) => e.word),
      `${lessonId}: the rendered list and the section list disagree`,
    )
    assert.deepEqual(
      items.map((i) => i.source),
      newWords.vocabulary.map((e) => e.source),
      `${lessonId}: the rendered list lost where each word came from`,
    )
  }
})

test('the grade index is exactly every section vocabulary, merged', () => {
  const merged = sectionFiles.flatMap(({ file }) =>
    readJson(file).vocabulary.map((e) => `${e.listedIn}/${e.word}/${e.position}`),
  )
  const indexed = INDEX.entries.map((e) => `${e.listedIn}/${e.word}/${e.position}`)
  assert.deepEqual(indexed, merged, 'the index and the sections disagree')
})

test('the index counts every section that has vocabulary, and no others', () => {
  const expected = sectionFiles
    .map(({ lessonId, section, file }) => ({
      lessonId,
      sectionId: section.id,
      count: readJson(file).vocabulary.length,
    }))
    .filter((s) => s.count > 0)
  assert.deepEqual(INDEX.sections, expected)
})

test('vocabulary is never invented: every word is printed where it comes from', () => {
  // The book puts a word in a section's word bank because that section teaches it, so
  // the word has to be printed on the pages the entry names as its source.  Most are in
  // the running text of the section; a word bank is printed as a callout panel beside it,
  // which is on the page but not in the text the reader shows for the section.
  // A glossary headword can be a phrase such as "a few", so every word of it is checked.
  const pageTextOf = (lessonId, sectionId) => PRINTED_PAGES?.[lessonId]?.[sectionId] ?? null
  for (const lessonId of LESSON_IDS) {
    const manifests = readJson(path.join(DATA, lessonId, 'manifest.json')).sections
    const textOf = Object.fromEntries(
      manifests.map((s) => [s.id, readJson(path.join(ROOT, s.text)).text.toLowerCase()]),
    )
    for (const { lessonId: inLesson, file } of sectionFiles.filter((f) => f.lessonId === lessonId)) {
      for (const entry of readJson(file).vocabulary) {
        const source = textOf[entry.sectionId]
        assert.ok(source !== undefined, `${entry.word}: unknown source section ${entry.sectionId}`)
        // Where the book can be read, the printed page is the authority; where it cannot,
        // the generated text is all there is, and a word bank is in both.
        const printed = pageTextOf(inLesson, entry.sectionId)
        const where = printed === null ? source : `${source} ${printed}`
        for (const word of entry.word.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []) {
          assert.ok(
            new RegExp(`\\b${word}\\b`).test(where),
            `${inLesson}/${entry.sectionId}: "${word}" is not printed in the section it comes from`,
          )
        }
      }
    }
  }
})

test('a label that introduces the text is not registered as a word', () => {
  // Lesson 1 prints "for example" inside its word bank as a label; that is not a word
  // the section teaches, so it must not have been registered.
  const conversation = readJson(path.join(DATA, 'lesson-01', 'sections', 'conversation.json'))
  const words = conversation.vocabulary.map((e) => e.word.toLowerCase())
  assert.ok(!words.includes('for'), 'a function word leaked in from a label')
  assert.ok(!words.includes('example'), 'a label leaked in as vocabulary')
  // A word bank names single words; only the printed glossary may hold a phrase.
  for (const { lessonId, section, file } of sectionFiles) {
    for (const entry of readJson(file).vocabulary) {
      if (entry.source === 'word-bank') {
        assert.ok(!/\s/.test(entry.word), `${lessonId}/${section.id}: "${entry.word}" is a phrase`)
      }
    }
  }
})

test('vocabulary lives beside the text, never inside it', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    const data = readJson(file)
    // The blocks are the textbook text the reader shows.  The word bank the book prints
    // above a conversation is part of that text and stays there; the structured list is
    // an extra key beside it, not a second copy spliced into the text.
    assert.ok(Array.isArray(data.blocks), `${lessonId}/${section.id} has no blocks`)
    assert.equal(
      Object.keys(data).filter((k) => k === 'vocabulary').length,
      1,
      `${lessonId}/${section.id} has more than one vocabulary list`,
    )
    assert.ok(
      !data.text.includes('"vocabulary"') && !data.text.includes('"sectionId"'),
      `${lessonId}/${section.id} has structured vocabulary written into its text`,
    )
  }
})

test('the section text is left exactly as the book prints it', () => {
  for (const { lessonId, section, file } of sectionFiles) {
    const data = readJson(file)
    assert.equal(
      data.text,
      data.blocks.map((b) => b.lines.join(' ')).join('\n'),
      `${lessonId}/${section.id}: text no longer matches its blocks`,
    )
  }
})

fromBook('the extractor reads a word bank list and drops its labels', () => {
  const [withLabel, plain, heading, title, single, oneWord] = EXTRACTED.banks
  assert.deepEqual(withLabel, ['endangered', 'alive', 'increase', 'hear', 'protect'])
  assert.deepEqual(plain, ['near', 'rocky', 'orbit', 'powerful'])
  assert.deepEqual(heading, [], 'a stray comma in a heading is not a word bank')
  assert.deepEqual(title, [], 'a title is not a word bank')
  assert.deepEqual(single, [], 'one word alone is not a word bank')
  assert.deepEqual(oneWord, [], 'a single trailing comma is not a word bank')
})

fromBook('a part that prints headwords is read as a glossary, with its examples', () => {
  // The headword before the lettered heading opens the page, the one after it opens the
  // part the heading names; each is read with the part it is printed in.
  assert.deepEqual(EXTRACTED.cases.glossary, [
    ['', '', [['human', 'glossary', '', 'a person', ['All humans must take care of nature.']]]],
    ['A', 'Look, Read and Practice.', [
      ['instead', 'glossary', 'a', 'in place of someone or something else', []],
    ]],
  ])
})

fromBook('a part that only prints sentences is read as a practice part', () => {
  // One entry per word the book points at, in the order it prints them.
  assert.deepEqual(EXTRACTED.cases.practice, [
    ['A', 'Look, Read and Practice.', [
      ['Earth', 'practice', 'a', '', []],
      ['died out', 'practice', 'a', '', []],
    ]],
  ])
})

fromBook('a part heading is never read as a word of the lesson', () => {
  // The letter of a part heading is printed in the same bold colour as a target word, so
  // it is flagged as one.  The heading is a heading, though: it opens a part and is not
  // read out of it, so the letter never becomes vocabulary.
  const headings = EXTRACTED.lines.filter(([text]) => /^[A-Z]\.\s/.test(text))
  assert.ok(headings.length > 0, 'the page prints no lettered heading to check')
  for (const { file } of sectionFiles) {
    for (const entry of readJson(file).vocabulary) {
      assert.ok(entry.word.length > 1, `${entry.word} is too short to be a word`)
      assert.ok(!/^[A-Z]$/.test(entry.word), `${entry.word} is a part letter, not a word`)
    }
  }
})

fromBook('a part that points at another book teaches no words here', () => {
  // "C. Go to Part III of your Workbook and do A and B." is a heading with nothing under
  // it, so it becomes a part with no entries and is left out of the vocabulary page.
  assert.deepEqual(EXTRACTED.cases.pointer, [
    ['C', 'Go to Part III of your Workbook and do A and B.', []],
  ])
  assert.deepEqual(EXTRACTED.taught.pointer, [], 'a pointer to another book was taught')
})

test('nothing in the extractor names the words of these lessons', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tools', 'vocabulary.py'), 'utf8')
  const code = source.replace(/#.*$/gm, '').replace(/"""[\s\S]*?"""/g, '')
  for (const word of ['endangered', 'alive', 'increase', 'protect', 'rocky', 'orbit', 'powerful']) {
    assert.ok(
      !new RegExp(`['"\`]${word}['"\`]`, 'i').test(code),
      `${word} is hardcoded in the extractor`,
    )
  }
})

test('the pipeline extracts vocabulary for every section, not a chosen few', () => {
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build_content.py'), 'utf8')
  // One call for the whole lesson, driven by the sections it is given, naming none.
  assert.match(build, /for section in published/)
  assert.match(build, /vocabulary\.entries_by_section\(/)
  assert.doesNotMatch(build, /entries_by_section\([^)]*['"]conversation['"]/)
})

test('the vocabulary listing is built from the whole lesson, in one shared place', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tools', 'vocabulary.py'), 'utf8')
  assert.match(source, /def entries_by_section\(/)
  // It must sweep every section it is handed, rather than a section it names itself.
  assert.match(source, /for section_id, pages in section_pages:/)
  assert.doesNotMatch(source, /['"]conversation['"]/)
})

fromBook('a conversation is read as the dialogue it is, one block per turn', () => {
  // The book prints a conversation as a column of speaker names with what is said beside
  // it, and the page also carries the lesson's word bank and the exercise it closes with.
  // A conversation is the dialogue: every speaker's name with their own words, and
  // nothing else from the page.
  for (const [lessonId, expected] of Object.entries(CONVERSATION_TURNS)) {
    const data = readJson(path.join(DATA, lessonId, 'sections', 'conversation.json'))
    const spoken = data.blocks.map((b) => b.lines.join(' '))
    assert.deepEqual(spoken, expected, `${lessonId}: conversation no longer reads as the book prints it`)
    // The word bank is vocabulary, and the exercise is not something anyone says, so
    // neither may end up inside the conversation.
    assert.ok(
      !data.text.includes('Answer the following questions'),
      `${lessonId}: the exercise after the conversation leaked into it`,
    )
    assert.deepEqual(
      data.vocabulary, [],
      `${lessonId}: the conversation must not list vocabulary of its own`,
    )
  }
})

fromBook('every word of a conversation turn belongs to the speaker who says it', () => {
  // A turn that the book wrapped onto the next printed row stays one block, so a speaker
  // is never credited with the tail of what the speaker above them said.
  const turns = readJson(path.join(DATA, 'lesson-01', 'sections', 'conversation.json')).blocks
  for (const block of turns) {
    const text = block.lines.join(' ')
    assert.ok(
      text.split(':').length <= 2,
      `a turn holds more than one speaker: ${JSON.stringify(text)}`,
    )
  }
})
