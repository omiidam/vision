import { renderHome } from './views/home'
import { LessonView } from './views/lesson'

/**
 * Hash routing.  Capacitor serves the app from a single index.html, so a hash route
 * keeps deep links and the back button working without any server configuration.
 */
export function startRouter(app: HTMLElement): void {
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
