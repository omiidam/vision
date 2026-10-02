import { loadGrade } from '../content'

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  )
}

export function renderHome(root: HTMLElement, grade: number): void {
  root.innerHTML = `
    <header class="page-header">
      <p class="eyebrow">Vision 1 &middot; English for Schools</p>
      <h1>Grade ${grade} English</h1>
      <p class="muted">
        Every lesson section is the textbook's own text. Play the recording and the spoken
        word is highlighted; tap a word to hear it from that point.
      </p>
    </header>
    <div id="home-lessons" class="stack"><p class="muted">Loading lessons...</p></div>
  `
  const container = root.querySelector<HTMLElement>('#home-lessons')!
  loadGrade(grade)
    .then((manifest) => {
      container.innerHTML = `
        ${manifest.lessons.map((lesson) => `
          <article class="card">
            <div class="card-head">
              <div>
                <p class="eyebrow">Lesson ${lesson.number} &middot; pages ${lesson.pages[0]}&ndash;${lesson.pages[1]}</p>
                <h2>${escapeHtml(lesson.title)}</h2>
              </div>
              <span class="badge">${lesson.audioCount}/${lesson.sectionCount} sections with audio</span>
            </div>
            <p class="toc">${escapeHtml(lesson.tocLine)}</p>
            <a class="button" href="#/lesson/${lesson.id}">Open Lesson ${lesson.number}</a>
          </article>
        `).join('')}
      `
    })
    .catch((error: Error) => {
      container.innerHTML = `<p class="error">Could not load the content manifest: ${escapeHtml(error.message)}</p>`
    })
}
