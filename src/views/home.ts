import { loadGrade } from '../content'
import { applyLanguage, bdi, escapeHtml } from '../direction'

export { escapeHtml }

export function renderHome(root: HTMLElement, grade: number): void {
  const heading = `Grade ${grade} English`
  const intro =
    'Every lesson section is the textbook\'s own text. Play the recording and the spoken ' +
    'word is highlighted; tap a word to hear it from that point.'

  root.innerHTML = `
    <header class="page-header" lang="en" dir="ltr">
      <p class="eyebrow">Vision 1 &middot; English for Schools</p>
      <h1>${escapeHtml(heading)}</h1>
      <p class="muted">${escapeHtml(intro)}</p>
    </header>
    <div id="home-lessons" class="stack" lang="en" dir="ltr">
      <p class="muted">Loading lessons...</p>
    </div>
  `
  applyLanguage(root.querySelector<HTMLElement>('.page-header')!, heading)

  const container = root.querySelector<HTMLElement>('#home-lessons')!
  loadGrade(grade)
    .then((manifest) => {
      container.innerHTML = manifest.lessons.map((lesson) => {
        const pages = `pages ${lesson.pages[0]}–${lesson.pages[1]}`
        const counts = `${lesson.audioCount}/${lesson.sectionCount} sections with audio`
        const openLabel = `Open Lesson ${lesson.number}`
        return `
          <article class="card">
            <div class="card-head">
              <div>
                <p class="eyebrow">Lesson ${bdi(String(lesson.number))} &middot; ${bdi(pages)}</p>
                <h2>${escapeHtml(lesson.title)}</h2>
              </div>
              <span class="badge">${bdi(counts)}</span>
            </div>
            <p class="toc">${bdi(lesson.tocLine)}</p>
            <a class="button" href="#/lesson/${lesson.id}">${escapeHtml(openLabel)}</a>
          </article>
        `
      }).join('')

      // Each card is tagged from its own text, so a Persian lesson title in the
      // contents would mark that card right-to-left on its own.
      container.querySelectorAll<HTMLElement>('.card').forEach((card) => {
        applyLanguage(card, card.textContent ?? '')
      })
    })
    .catch((error: Error) => {
      container.innerHTML = `<p class="error" lang="en" dir="ltr">Could not load the content manifest: ${escapeHtml(error.message)}</p>`
    })
}
