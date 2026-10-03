import { loadLesson, loadSectionText, loadSync, loadVocabulary, assetUrl } from '../content'
import { AudioPlayer, PLAYBACK_RATES, formatRate } from '../player'
import { SyncEngine } from '../sync'
import type {
  LessonManifest,
  SectionEntry,
  SectionText,
  SyncData,
  TextBlock,
  Vocabulary,
  VocabularyEntry,
} from '../types'
import { applyLanguage, arrow, bdi, documentDirection, escapeHtml } from '../direction'
import { formatPageRange } from '../pages'
import { isPlaceholder } from '../placeholder'
import { markTargets } from '../targets'

export interface ReaderHandlers {
  /** Called every animation frame while the recording is playing. */
  onTick(): void
  onEnded(): void
}

/**
 * The only section that carries the word list.  The vocabulary block is rendered inside
 * that section and nowhere else, so it never repeats at the bottom of every page.
 */
const VOCABULARY_SECTION_ID = 'new-words-and-expressions'

interface WordSpan {
  el: HTMLElement
  index: number
  start: number | null
}

/**
 * The lesson page: section navigation, the textbook text, and the synchronized player.
 *
 * The reader owns one <audio> element and drives highlighting from its `currentTime`.
 */
export class LessonView {
  private root: HTMLElement
  private player = new AudioPlayer()
  private engine: SyncEngine | null = null
  private words = new Map<number, WordSpan>()
  private activeWord = -1
  private activeSentence = -1
  private frame = 0
  private handlers: ReaderHandlers
  private currentEntry: SectionEntry | null = null
  private vocabularySource = ''
  /** Guards against a slow vocabulary fetch overwriting a newer section. */
  private vocabularyToken = 0
  private ticking = false

  constructor(root: HTMLElement, handlers: ReaderHandlers) {
    this.root = root
    this.handlers = handlers
    this.player.onPlayingChange((playing) => {
      // Only the button glyph changes here.  Re-rendering (and therefore re-loading) the
      // media element on play/pause would reset currentTime to 0 and abort playback.
      this.renderTransportState()
      if (playing) this.startTicking()
      else {
        this.stopTicking()
        // Stopping the loop must not leave the highlight where it was: it settles on the
        // word the audio stopped in, so pausing reads as paused rather than as stale.
        this.updateProgress(this.player.currentTime)
      }
    })
    // The media element is the single source of truth for the rate, so the control is
    // re-synced from the player whenever the rate changes - from this UI or elsewhere.
    this.player.onRateChange(() => this.renderRateControl())
  }

  async render(lessonId: string, sectionId: string | undefined): Promise<void> {
    this.stopTicking()
    this.player.pause()
    this.root.innerHTML = '<p class="muted">Loading lesson...</p>'

    let lesson: LessonManifest
    try {
      lesson = await loadLesson(`data/grade-10/${lessonId}/manifest.json`)
    } catch (error) {
      this.root.innerHTML = `<p class="error">Could not load ${lessonId}: ${(error as Error).message}</p>`
      return
    }

    const section = sectionId
      ? lesson.sections.find((entry) => entry.id === sectionId) ?? lesson.sections[0]
      : lesson.sections[0]

    this.root.innerHTML = this.shell(lesson, section)
    this.bindNavigation()
    this.vocabularySource = lesson.vocabulary
    await this.openSection(section)
  }

  private shell(lesson: LessonManifest, section: SectionEntry): string {
    const index = lesson.sections.findIndex((entry) => entry.id === section.id)
    const previous = lesson.sections[index - 1]
    const next = lesson.sections[index + 1]
    const dir = documentDirection()
    const back = arrow(dir, 'back')
    const forward = arrow(dir, 'forward')
    return `
      <header class="page-header" lang="en" dir="ltr">
        <a class="back" href="#/">${back} All lessons</a>
        <p class="eyebrow">Lesson ${bdi(String(lesson.number))} &middot; ${bdi(formatPageRange(lesson.pages))}</p>
        <h1>${escapeHtml(lesson.title)}</h1>
      </header>

      <nav class="tabs" aria-label="Lesson sections" lang="en" dir="ltr">
        ${lesson.sections.map((entry) => `
          <a class="tab${entry.id === section.id ? ' active' : ''}"
             href="#/lesson/${lesson.id}/${entry.id}">
            ${escapeHtml(entry.label)}
          </a>
        `).join('')}
      </nav>

      <article class="card reader" id="reader">
        <div class="reader-head">
          <div>
            <h2 id="section-title" lang="en" dir="ltr">${escapeHtml(section.label)}</h2>
            <p class="muted" id="section-sub" lang="en" dir="ltr"></p>
          </div>
          <span class="badge" id="sync-badge" lang="en" dir="ltr"></span>
        </div>
        <div class="reader-body" id="reader-body" lang="en" dir="ltr"><p class="muted">Loading text...</p></div>
        <div id="reader-controls"></div>
        <div id="vocabulary"></div>
      </article>

      <nav class="pager" lang="en" dir="ltr">
        ${previous
          ? `<a class="button ghost" href="#/lesson/${lesson.id}/${previous.id}">${back} ${escapeHtml(previous.label)}</a>`
          : '<span></span>'}
        ${next
          ? `<a class="button ghost" href="#/lesson/${lesson.id}/${next.id}">${escapeHtml(next.label)} ${forward}</a>`
          : '<span></span>'}
      </nav>
    `
  }

  private bindNavigation(): void {
    this.root.querySelectorAll<HTMLAnchorElement>('a.tab').forEach((tab) => {
      tab.addEventListener('click', (event) => {
        event.preventDefault()
        window.location.hash = new URL(tab.href).hash
      })
    })
  }

  private async openSection(section: SectionEntry): Promise<void> {
    this.currentEntry = section
    const body = this.root.querySelector<HTMLElement>('#reader-body')!
    const sub = this.root.querySelector<HTMLElement>('#section-sub')!
    const controls = this.root.querySelector<HTMLElement>('#reader-controls')!
    this.words.clear()
    this.activeWord = -1
    this.activeSentence = -1
    // Every section switch starts from an empty vocabulary block.
    this.root.querySelector<HTMLElement>('#vocabulary')!.innerHTML = ''

    // The heading above already names the section, so this line carries only where it is
    // printed.  The book's own subtitle for the section is kept in the manifest rather
    // than repeated here.
    sub.innerHTML = bdi(formatPageRange(section.pages))
    applyLanguage(sub, sub.textContent ?? '')
    body.innerHTML = '<p class="muted">Loading text...</p>'
    controls.innerHTML = ''

    let text: SectionText | null = null
    let sync: SyncData | null = null
    try {
      ;[text, sync] = await Promise.all([
        loadSectionText(section.text),
        section.sync ? loadSync(section.sync) : Promise.resolve(null),
      ])
    } catch (error) {
      body.innerHTML = `<p class="error" lang="en" dir="ltr">${escapeHtml((error as Error).message)}</p>`
      return
    }

    this.engine = sync ? new SyncEngine(sync) : null
    this.renderText(body, text, sync, section.id === VOCABULARY_SECTION_ID)
    this.renderTransport(section, sync)
    this.updateProgress(0)

    if (section.id === VOCABULARY_SECTION_ID) {
      const token = ++this.vocabularyToken
      const path = this.vocabularySource
      void loadVocabulary(path)
        .then((vocab) => {
          if (token === this.vocabularyToken) this.renderVocabulary(vocab)
        })
        .catch(() => undefined)
    }
  }

  /**
   * Render the canonical textbook text with one element per word.
   *
   * `grouped` is the vocabulary page, which the book prints as separate items rather than
   * as running text.  There the blocks come from the page, so each one is shown as the
   * item it is: the target word where the book sets it, the example the book prints with
   * it directly underneath, and a rule between one item and the next.
   *
   * A page the book divides into parts - the Get Ready exercises - is `parted` instead.
   * There the part a block is printed in is read off the page, so each part is given its
   * own heading and its own container and the exercises of one part can never be read as
   * belonging to the next.  The count, the names and the contents of the parts are all
   * the book's; nothing is named or counted here.
   */
  private renderText(
    body: HTMLElement,
    text: SectionText,
    sync: SyncData | null,
    grouped = false,
  ): void {
    body.innerHTML = ''
    // Whether the book prints this page in parts.  A page it does not keeps the reading
    // order it is given, with no containers invented for it.
    const parted = !grouped && text.blocks.some((block) => block.kind === 'part-heading')
    body.classList.toggle('reader-grouped', grouped)
    body.classList.toggle('reader-parted', parted)
    let wordIndex = 0
    // The part currently open, if the page is printed in parts.  A block with no part of
    // its own - the opening quotation of a Get Ready page - is left on the page itself.
    let openPart: HTMLElement | null = null

    // The words the book sets as new inside this text.  They are matched against the
    // running text rather than replaced, so the textbook's own wording and its order are
    // exactly what is shown.
    const targets = text.targets ?? []
    let pending = targets

    for (const block of text.blocks) {
      // Where a block goes on the page.  The vocabulary page is printed in parts, and
      // the book lays each part out its own way: a part of pictures is a grid of the
      // width it prints, and a part of headwords is one entry under the next.  That is
      // read off the page and carried on the block, so the parts are laid out the way
      // the book sets them out rather than by naming a part here.
      const part = grouped && block.kind === 'example'
        ? this.partContainer(body, block)
        : null
      // The heading of a part opens that part: a container of its own with the name the
      // book gives it, so the exercise below it is read as this part and not the next.
      const isPartHeading = parted && block.kind === 'part-heading'
      if (isPartHeading) {
        const host = document.createElement('section')
        host.className = 'reader-part'
        host.dataset.part = block.part ?? ''
        host.lang = 'en'
        host.dir = 'ltr'
        body.append(host)
        openPart = host
      }
      const paragraph = document.createElement(isPartHeading ? 'h4' : 'p')
      if (isPartHeading) {
        paragraph.className = 'reader-part-heading'
      } else {
        paragraph.className = block.kind
          ? `paragraph block-${block.kind}`
          : 'paragraph'
        if (part) paragraph.classList.add('item')
      }
      paragraph.dataset.page = String(block.page)
      // The textbook text is English; tag it from the block's own text so a block that
      // ever carries Persian is laid out right-to-left by itself.
      applyLanguage(paragraph, block.lines.join(' '))

      // On the vocabulary page the rows the book wrapped onto the next line are kept on
      // their own line, as it prints them: joining them would read as one run and lose
      // where the caption begins and ends.  Everywhere else the block is running text
      // and is joined as before.
      const tokens = block.lines.join(' ').split(/\s+/).filter(Boolean)
      // A target is claimed by the block that prints it, and what is left over is carried
      // to the next block, so nothing is claimed twice across the page.  The marks come
      // back as positions in this block, so a word that is only part of a longer target
      // is set where the book prints it and nowhere else in the passage.
      const found = markTargets(block.lines.join(' '), pending)
      pending = found.pending
      const targetAt = new Set(found.positions)
      let tokenAt = 0
      // A grouped block is a set of printed rows, and the book wraps a caption onto a
      // second row now and then.  Those rows are kept on their own line so a caption
      // reads as the block of text it is printed as; running text elsewhere is one
      // paragraph and is joined as it always was.
      //
      // Nothing is renumbered to do it.  The words still run in the block's own order and
      // the marks are still positions in that list, so `rowEnds` holds the index of the
      // first word of the row after each row, and `row` is the element the words of the
      // current row go into.
      let row: HTMLElement = paragraph
      const rowEnds: number[] = []
      if (grouped && block.kind === 'example') {
        let counted = 0
        for (const line of block.lines) {
          counted += line.split(/\s+/).filter(Boolean).length
          rowEnds.push(counted)
        }
        row = document.createElement('span')
        row.className = 'line'
        paragraph.append(row)
      }
      let rowAt = 0
      for (const token of tokens) {
        // Where this token sits in the block, whether or not it is rendered.  The marks
        // are positions in this same list of tokens, so the count has to keep step with
        // it over every token, or a word after a blank would be looked for in the wrong
        // place.
        const here = tokenAt
        tokenAt += 1
        // The printed fill-in-the-blank rule.  This has to be exactly the rule the
        // content pipeline uses when it tokenises a line (text.is_placeholder): a run of
        // dots and underscores of any length.  A narrower rule here would render a word
        // the timings have no entry for, and every highlight after it would be one word
        // out of step with the audio for the rest of the section.
        if (isPlaceholder(token)) continue
        const timed = sync?.words[wordIndex]
        const span = document.createElement('span')
        span.className = 'word'
        span.textContent = token
        applyLanguage(span, token)
        if (targetAt.has(here)) span.classList.add('target-word')
        if (timed && timed.start !== null) {
          span.dataset.start = String(timed.start)
          span.dataset.index = String(wordIndex)
          span.classList.add('timed')
          span.setAttribute('role', 'button')
          span.setAttribute('tabindex', '0')
          span.title = `Play from ${timed.start.toFixed(2)}s`
          span.setAttribute('aria-label', `Play from ${timed.start.toFixed(2)} seconds: ${token}`)
          this.words.set(wordIndex, { el: span, index: wordIndex, start: timed.start })
        } else {
          span.classList.add('untimed')
        }
        row.append(span, document.createTextNode(' '))
        wordIndex += 1
        // The book broke the line where the row ends here, so the next printed row starts
        // a line of its own.  A row the book printed as nothing but a blank has already
        // been passed, so the word after it still starts a line rather than a second one.
        while (here + 1 >= rowEnds[rowAt] && rowAt < rowEnds.length - 1) {
          rowAt += 1
          row = document.createElement('span')
          row.className = 'line'
          paragraph.append(row)
        }
      }
      // A grid item is placed by the grid; a list item, and all running text, is appended
      // to the page itself.  On a page printed in parts, everything after a heading goes
      // into the part that heading opened, until the next heading opens the next part.
      ;(part ?? openPart ?? body).append(paragraph)
    }

    body.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('.word.timed')
      if (!target) return
      this.seekTo(Number(target.dataset.start))
    })
    body.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = (event.target as HTMLElement).closest<HTMLElement>('.word.timed')
      if (!target) return
      event.preventDefault()
      this.seekTo(Number(target.dataset.start))
    })
  }

  /**
   * The element a vocabulary item is rendered into, opening its part if this is the first
   * item of it.
   *
   * The heading of a part is not an item and is not rendered here: it stands on its own
   * above the part.  The items then go into the layout the book prints that part in - a
   * grid as wide as the page sets it, so the items fill it left to right and then start
   * the next row, or a single column where the book gives each entry a row of its own.
   * Either way the items stay in the order the book prints them: the layout is only how
   * they are set out on screen, never which item comes next.
   */
  private partContainer(body: HTMLElement, block: TextBlock): HTMLElement {
    // The part is named by its letter and the layout the book prints it in, so a part is
    // found again by the blocks that follow it rather than by counting.
    const key = `${block.part ?? ''}:${block.layout ?? 'list'}`
    const found = [...body.querySelectorAll<HTMLElement>(':scope > [data-part-key]')]
      .find((section) => section.dataset.partKey === key)
    if (found) return found
    const host = document.createElement('section')
    host.className = 'vocab-part-body'
    host.dataset.partKey = key
    if (block.layout === 'grid') {
      host.classList.add('vocab-grid')
      // The width the book prints the part in, so a part printed in two columns is two
      // columns here and one printed in one is one.
      host.style.setProperty('--part-columns', String(block.columns ?? 2))
    }
    // Appended after the heading, so the part reads as the book sets it out.
    body.append(host)
    return host
  }

  private renderTransport(section?: SectionEntry | null, sync?: SyncData | null): void {
    const host = this.root.querySelector<HTMLElement>('#reader-controls')
    const badge = this.root.querySelector<HTMLElement>('#sync-badge')
    if (!host) return
    const entry = section ?? this.currentEntry
    if (!entry || !entry.audio) {
      host.innerHTML = `<p class="muted" lang="en" dir="ltr">This section has no recording in the source folder, so it is read silently.</p>`
      if (badge) badge.textContent = 'text only'
      return
    }

    host.innerHTML = `
      <div class="transport" lang="en" dir="ltr">
        <button class="play" id="play" aria-label="Play or pause">▶</button>
        <div class="track" id="track" role="slider" aria-label="Seek" tabindex="0" dir="ltr">
          <div class="track-fill" id="track-fill"></div>
        </div>
        <span class="time" dir="ltr"><bdi id="time-now">0:00</bdi> / <bdi id="time-total">${formatTime(entry.duration)}</bdi></span>
        <div class="rate" id="rate" role="group" aria-label="Playback speed" dir="ltr">
          ${PLAYBACK_RATES.map((rate) => `
            <button type="button" class="rate-option" data-rate="${rate}"
                    aria-pressed="false">${formatRate(rate)}</button>
          `).join('')}
        </div>
      </div>
    `
    this.player.load(assetUrl(entry.audio))
    if (badge) {
      badge.innerHTML = `${bdi(`${Math.round((this.engine?.timedRatio ?? 0) * 100)}%`)} word-timed`
      badge.title = `Alignment confidence ${(sync?.confidence ?? 0).toFixed(2)}`
    }
    host.querySelector<HTMLButtonElement>('#play')!.addEventListener('click', () => this.player.toggle())
    host.querySelectorAll<HTMLButtonElement>('.rate-option').forEach((option) => {
      option.addEventListener('click', () => this.player.setRate(Number(option.dataset.rate)))
    })
    const track = host.querySelector<HTMLElement>('#track')!
    const seekFromEvent = (event: MouseEvent) => {
      const rect = track.getBoundingClientRect()
      if (rect.width === 0) return
      // The track is marked dir="ltr", so its inline start is always the left edge and
      // the progress bar fills the same way in either document direction.
      const ratio = (event.clientX - rect.left) / rect.width
      this.seekTo(Math.max(0, Math.min(1, ratio)) * this.totalDuration())
    }
    track.addEventListener('click', seekFromEvent)
    track.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') this.player.seek(this.player.currentTime + 5)
      if (event.key === 'ArrowLeft') this.player.seek(this.player.currentTime - 5)
    })
    this.renderTransportState()
    this.renderRateControl()
  }

  /** Mark the rate the audio element is actually playing at. */
  private renderRateControl(): void {
    const rate = this.player.rate
    this.root.querySelectorAll<HTMLButtonElement>('.rate-option').forEach((option) => {
      const active = Number(option.dataset.rate) === rate
      option.classList.toggle('active', active)
      option.setAttribute('aria-pressed', String(active))
    })
  }

  private totalDuration(): number {
    return this.player.duration || this.currentEntry?.duration || 0
  }

  private seekTo(seconds: number): void {
    this.player.seek(seconds)
    this.updateProgress(this.player.currentTime)
    if (!this.player.playing) void this.player.play()
  }

  private startTicking(): void {
    if (this.ticking) return
    this.ticking = true
    // Two sources, both reading the audio element's own currentTime.
    //
    // `timeupdate` comes from the media element itself, so it keeps arriving when the
    // page is not painting - an Android WebView in the background, or a browser tab the
    // user has switched away from.  Between those events the player samples the element's
    // own position, so the highlight does not sit a quarter of a second behind the voice,
    // and `requestAnimationFrame` adds the smooth pass just before a paint while the page
    // is on screen.
    //
    // All three report the position the audio has actually reached.  None of them keeps a
    // clock of its own, so none of them can drift from the recording.
    this.player.onTimeUpdate(() => this.updateProgress(this.player.currentTime))
    this.player.startSampling()
    const loop = () => {
      if (!this.ticking) return
      this.updateProgress(this.player.currentTime)
      this.frame = requestAnimationFrame(loop)
    }
    this.frame = requestAnimationFrame(loop)
  }

  private stopTicking(): void {
    this.ticking = false
    this.player.offTimeUpdate()
    this.player.stopSampling()
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  /** audio -> text: find the active word from the player's currentTime. */
  private updateProgress(time: number): void {
    const fill = this.root.querySelector<HTMLElement>('#track-fill')
    const now = this.root.querySelector<HTMLElement>('#time-now')
    const total = this.totalDuration()
    if (fill) fill.style.width = total > 0 ? `${Math.min(100, Math.max(0, (time / total) * 100))}%` : '0%'
    // A <bdi> element keeps its own direction, so "0:31" never becomes "31:0" when the
    // surrounding text is right-to-left.
    if (now) now.textContent = formatTime(time)

    const engine = this.engine
    if (!engine || !engine.hasTiming) return
    const index = engine.wordIndexAt(time)
    if (index === this.activeWord) return

    const previous = this.words.get(this.activeWord)
    previous?.el.classList.remove('active')

    const current = this.words.get(index)
    if (current) {
      current.el.classList.add('active')
      this.scrollIntoView(current.el)
    }
    const sentence = index >= 0 ? engine.sentenceAt(index) : -1
    if (sentence !== this.activeSentence) {
      this.activeSentence = sentence
      this.root.querySelectorAll<HTMLElement>('.paragraph').forEach((paragraph) => {
        paragraph.classList.toggle('active', Boolean(current) && paragraph.contains(current!.el))
      })
    }
    this.activeWord = index
    this.handlers.onTick()
  }

  private scrollIntoView(element: HTMLElement): void {
    const scroller = this.root.querySelector<HTMLElement>('#reader-body')
    if (!scroller) return
    const box = element.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    const margin = 48
    if (box.top < view.top + margin) {
      scroller.scrollTop -= view.top + margin - box.top
    } else if (box.bottom > view.bottom - margin) {
      scroller.scrollTop += box.bottom - (view.bottom - margin)
    }
  }

  private renderTransportState(): void {
    const button = this.root.querySelector<HTMLButtonElement>('#play')
    if (button) button.textContent = this.player.playing ? '❚❚' : '▶'
  }

  private renderVocabulary(vocabulary: Vocabulary): void {
    const host = this.root.querySelector<HTMLElement>('#vocabulary')
    if (!host || vocabulary.items.length === 0) return

    // The words are grouped by the part the book prints them in, in the order the data
    // lists them: each part of the page first, then the lesson's word bank.  Grouping is
    // driven by the part on each entry, so a lesson whose page is set out differently
    // needs no change here.
    const groups: { key: string; title: string; items: VocabularyEntry[] }[] = []
    for (const item of vocabulary.items) {
      let group = groups.find((candidate) => candidate.key === item.part)
      if (!group) {
        // A part is headed by the letter the book gives it and the title it prints beside
        // it, so the reader sees "A. Look, Read and Practice."  The word bank is not a
        // lettered part and is headed by its own title.
        const lettered = /^[a-z]$/.test(item.part)
        group = {
          key: item.part,
          title: lettered ? `${item.part.toUpperCase()}. ${item.partTitle}` : item.partTitle,
          items: [],
        }
        groups.push(group)
      }
      group.items.push(item)
    }

    // The lettered parts are already shown as the textbook prints them, in the text
    // above, so listing them again here would read the page twice.  The word bank is the
    // one list here that the text does not contain: it is printed beside the conversation
    // and other sections, not on this page, so it has nowhere else to be read.
    const bank = groups.filter((group) => !/^[a-z]$/.test(group.key))

    const itemHtml = (item: VocabularyEntry) => {
      const headword = escapeHtml(item.word)
      // The Persian gloss is empty in the source book, so it is only rendered when
      // there is something to show; it carries dir="rtl" and lang="fa" on its own.
      const persian = item.meaningFa
        ? `<span class="meaning-fa" lang="fa" dir="rtl">${escapeHtml(item.meaningFa)}</span>`
        : ''
      // A word the book lists without defining it has no definition to show.  Saying so
      // would read as a gap in the book, so nothing is shown in its place and the word
      // stands on its own.
      const meaning = item.meaningEn
        ? `<span lang="en" dir="ltr">${escapeHtml(item.meaningEn)}</span>`
        : ''
      return `
      <div class="vocab-item">
        <dt lang="en" dir="ltr">${headword}</dt>
        <dd>
          ${meaning}
          ${persian}
          ${item.examples.map((example) => `<span class="example" lang="en" dir="ltr">${escapeHtml(example)}</span>`).join('')}
        </dd>
      </div>`
    }

    host.innerHTML = `
      ${bank
        .map(
          (group) => `
        <section class="vocab-part" data-part="${escapeHtml(group.key)}">
          <h4>${escapeHtml(group.title)}</h4>
          <dl class="vocab">
            ${group.items.map(itemHtml).join('')}
          </dl>
        </section>`,
        )
        .join('')}
    `
    host.setAttribute('lang', 'en')
    host.setAttribute('dir', 'ltr')
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}
