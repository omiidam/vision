import { loadLesson, loadSectionText, loadSync, loadVocabulary, assetUrl } from '../content'
import { AudioPlayer } from '../player'
import { SyncEngine } from '../sync'
import type { LessonManifest, SectionEntry, SectionText, SyncData, Vocabulary } from '../types'
import { escapeHtml } from './home'

export interface ReaderHandlers {
  /** Called every animation frame while the recording is playing. */
  onTick(): void
  onEnded(): void
}

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

  constructor(root: HTMLElement, handlers: ReaderHandlers) {
    this.root = root
    this.handlers = handlers
    this.player.onPlayingChange((playing) => {
      this.renderTransport()
      if (playing) this.startTicking()
      else this.stopTicking()
    })
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
    await this.openSection(section)
    void loadVocabulary(lesson.vocabulary).then((vocab) => this.renderVocabulary(vocab)).catch(() => undefined)
  }

  private shell(lesson: LessonManifest, section: SectionEntry): string {
    const index = lesson.sections.findIndex((entry) => entry.id === section.id)
    const previous = lesson.sections[index - 1]
    const next = lesson.sections[index + 1]
    return `
      <header class="page-header">
        <a class="back" href="#/">← All lessons</a>
        <p class="eyebrow">Lesson ${lesson.number} &middot; ${escapeHtml(lesson.tocLine)}</p>
        <h1>${escapeHtml(lesson.title)}</h1>
      </header>

      <nav class="tabs" aria-label="Lesson sections">
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
            <h2 id="section-title">${escapeHtml(section.label)}</h2>
            <p class="muted" id="section-sub"></p>
          </div>
          <span class="badge" id="sync-badge"></span>
        </div>
        <div class="reader-body" id="reader-body"><p class="muted">Loading text...</p></div>
        <div id="reader-controls"></div>
        <div id="vocabulary"></div>
      </article>

      <nav class="pager">
        ${previous
          ? `<a class="button ghost" href="#/lesson/${lesson.id}/${previous.id}">← ${escapeHtml(previous.label)}</a>`
          : '<span></span>'}
        ${next
          ? `<a class="button ghost" href="#/lesson/${lesson.id}/${next.id}">${escapeHtml(next.label)} →</a>`
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

    sub.textContent = `${section.title} · pages ${section.pages[0]}–${section.pages[1]}`
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
      body.innerHTML = `<p class="error">${escapeHtml((error as Error).message)}</p>`
      return
    }

    this.engine = sync ? new SyncEngine(sync) : null
    this.renderText(body, text, sync)
    this.renderTransport(section, sync)
    this.updateProgress(0)
  }

  /** Render the canonical textbook text with one element per word. */
  private renderText(body: HTMLElement, text: SectionText, sync: SyncData | null): void {
    body.innerHTML = ''
    let wordIndex = 0

    for (const block of text.blocks) {
      const paragraph = document.createElement('p')
      paragraph.className = 'paragraph'
      paragraph.dataset.page = String(block.page)

      const tokens = block.lines.join(' ').split(/\s+/).filter(Boolean)
      for (const token of tokens) {
        if (/^[._]{3,}$/.test(token)) continue          // printed fill-in-the-blank rule
        const timed = sync?.words[wordIndex]
        const span = document.createElement('span')
        span.className = 'word'
        span.textContent = token
        if (timed && timed.start !== null) {
          span.dataset.start = String(timed.start)
          span.dataset.index = String(wordIndex)
          span.classList.add('timed')
          span.setAttribute('role', 'button')
          span.setAttribute('tabindex', '0')
          span.title = `Play from ${timed.start.toFixed(2)}s`
          this.words.set(wordIndex, { el: span, index: wordIndex, start: timed.start })
        } else {
          span.classList.add('untimed')
        }
        paragraph.append(span, document.createTextNode(' '))
        wordIndex += 1
      }
      body.append(paragraph)
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

  private renderTransport(section?: SectionEntry | null, sync?: SyncData | null): void {
    const host = this.root.querySelector<HTMLElement>('#reader-controls')
    const badge = this.root.querySelector<HTMLElement>('#sync-badge')
    if (!host) return
    const entry = section ?? this.currentEntry
    if (!entry || !entry.audio) {
      host.innerHTML = `<p class="muted">This section has no recording in the source folder, so it is read silently.</p>`
      if (badge) badge.textContent = 'text only'
      return
    }

    host.innerHTML = `
      <div class="transport">
        <button class="play" id="play" aria-label="Play or pause">▶</button>
        <div class="track" id="track" role="slider" aria-label="Seek" tabindex="0">
          <div class="track-fill" id="track-fill"></div>
        </div>
        <span class="time"><span id="time-now">0:00</span> / <span id="time-total">${formatTime(entry.duration)}</span></span>
      </div>
      <p class="muted small" id="sync-note"></p>
    `
    this.player.load(assetUrl(entry.audio))
    if (badge) {
      badge.textContent = `${Math.round((this.engine?.timedRatio ?? 0) * 100)}% word-timed`
      badge.title = `Alignment confidence ${(sync?.confidence ?? 0).toFixed(2)}`
    }
    const note = host.querySelector<HTMLElement>('#sync-note')
    if (note) {
      note.textContent = entry.syncStatus === 'confirmed'
        ? `Recorded file: ${sync?.sourceAudioFile ?? ''}`
        : `Mapping is ${entry.syncStatus} - ${sync?.mapping.notes.join('; ') || 'see data/audio-mapping.json'}`
    }

    host.querySelector<HTMLButtonElement>('#play')!.addEventListener('click', () => this.player.toggle())
    const track = host.querySelector<HTMLElement>('#track')!
    const seekFromEvent = (event: MouseEvent) => {
      const rect = track.getBoundingClientRect()
      const ratio = (event.clientX - rect.left) / rect.width
      this.seekTo(Math.max(0, Math.min(1, ratio)) * this.totalDuration())
    }
    track.addEventListener('click', seekFromEvent)
    track.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') this.player.seek(this.player.currentTime + 5)
      if (event.key === 'ArrowLeft') this.player.seek(this.player.currentTime - 5)
    })
    this.renderTransportState()
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
    if (this.frame) return
    const loop = () => {
      this.updateProgress(this.player.currentTime)
      this.frame = requestAnimationFrame(loop)
    }
    this.frame = requestAnimationFrame(loop)
  }

  private stopTicking(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  /** audio -> text: find the active word from the player's currentTime. */
  private updateProgress(time: number): void {
    const fill = this.root.querySelector<HTMLElement>('#track-fill')
    const now = this.root.querySelector<HTMLElement>('#time-now')
    const total = this.totalDuration()
    if (fill) fill.style.width = total > 0 ? `${Math.min(100, Math.max(0, (time / total) * 100))}%` : '0%'
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
    host.innerHTML = `
      <h3>New Words &amp; Expressions <span class="muted small">page ${vocabulary.source.definitionPages[0]}</span></h3>
      <dl class="vocab">
        ${vocabulary.items.map((item) => `
          <div class="vocab-item">
            <dt>${escapeHtml(item.word)}</dt>
            <dd>
              ${item.meaningEn ? escapeHtml(item.meaningEn) : '<span class="muted">not given in the book</span>'}
              ${item.examples.map((example) => `<span class="example">${escapeHtml(example)}</span>`).join('')}
            </dd>
          </div>
        `).join('')}
      </dl>
    `
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}
