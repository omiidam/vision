/**
 * A very small wrapper around a single <audio> element.
 *
 * The synchronization engine only ever reads `currentTime` from here, which is the
 * media element's own decoded playback position - never a timer or an animation.
 */
export class AudioPlayer {
  readonly element: HTMLAudioElement
  private listeners = new Set<(playing: boolean) => void>()
  private pendingSeek: number | null = null

  constructor() {
    const element = new Audio()
    element.preload = 'metadata'
    element.crossOrigin = 'anonymous'
    // Keep it in the document: Android's media controls and the tests both need a
    // real, reachable media element.
    element.hidden = true
    element.setAttribute('data-role', 'lesson-audio')
    document.body.append(element)
    this.element = element
    element.addEventListener('play', () => this.emit(true))
    element.addEventListener('pause', () => this.emit(false))
    element.addEventListener('ended', () => this.emit(false))
    element.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek !== null) {
        const target = this.pendingSeek
        this.pendingSeek = null
        element.currentTime = Math.min(target, this.duration || target)
      }
    })
  }

  private emit(playing: boolean) {
    this.listeners.forEach((listener) => listener(playing))
  }

  onPlayingChange(listener: (playing: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get currentTime(): number {
    return this.element.currentTime
  }

  get duration(): number {
    return Number.isFinite(this.element.duration) ? this.element.duration : 0
  }

  get playing(): boolean {
    return !this.element.paused && !this.element.ended
  }

  load(source: string): void {
    // Never re-load the same source: element.load() resets currentTime to 0 and aborts
    // whatever is playing, which would break seeking and resume.
    const absolute = new URL(source, document.baseURI).href
    if (this.element.src === absolute) return
    this.element.pause()
    this.element.src = absolute
    this.element.load()
  }

  async play(): Promise<void> {
    try {
      await this.element.play()
    } catch {
      /* autoplay blocked - the play button will be used instead */
    }
  }

  pause(): void {
    this.element.pause()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else void this.play()
  }

  seek(seconds: number): void {
    // `duration` is NaN until the metadata arrives (slow network, cold Android start),
    // and assigning NaN to currentTime throws, so clamp only when it is known.
    const limit = this.duration > 0 ? this.duration : Number.MAX_SAFE_INTEGER
    const target = Math.max(0, Math.min(seconds, limit))
    if (!Number.isFinite(target)) return
    if (this.element.readyState === 0) {
      // Metadata has not arrived yet.  Remember the position and apply it as soon as
      // the browser knows how long the recording is, otherwise the seek is dropped.
      this.pendingSeek = target
      return
    }
    this.pendingSeek = null
    this.element.currentTime = target
  }
}
