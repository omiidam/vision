import { renderHome } from './home'
import { LessonView } from './lesson'
import { initTheme, toggleTheme } from '../theme'

/**
 * Hash routing.  Capacitor serves the app from a single index.html, so a hash route
 * keeps deep links and the back button working without any server configuration.
 */
export function startRouter(app: HTMLElement): void {
  initTheme()

  // One toggle for the whole app, living outside #view so it survives every re-render.
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'theme-toggle'
  toggle.setAttribute('aria-live', 'polite')
  const label = () => {
    const dark = document.documentElement.dataset.theme === 'dark'
    toggle.textContent = dark ? 'Light theme' : 'Dark theme'
    toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`)
    toggle.setAttribute('title', dark ? 'Switch to the light theme' : 'Switch to the dark theme')
  }
  label()
  toggle.addEventListener('click', () => {
    toggleTheme()
    label()
  })
  app.append(toggle)

  const lesson = new LessonView(app.querySelector<HTMLElement>('#view')!, {
    onTick() {
      /* reserved for future read-along telemetry */
    },
    onEnded() {
      /* reserved */
    },
  })

  const route = () => {
    const hash = window.location.hash.replace(/^#\/?/, '')
    const parts = hash.split('/').filter(Boolean)
    window.scrollTo(0, 0)
    if (parts[0] === 'lesson' && parts[1]) {
      void lesson.render(parts[1], parts[2])
    } else {
      renderHome(app.querySelector<HTMLElement>('#view')!, 10)
    }
  }

  window.addEventListener('hashchange', route)
  route()
}
