import type { SyncData, SyncWord } from './types'

/**
 * The synchronization engine.
 *
 * It maps an audio position to a word index (audio -> text) and a word index back to
 * an audio position (text -> audio).  Both directions use the same pre-computed,
 * monotonic word table, so they can never disagree with each other.
 */
export class SyncEngine {
  readonly words: SyncWord[]
  readonly duration: number

  /** Indices of the words that actually have a timestamp. */
  private readonly timed: number[]
  private starts: Float64Array
  private ends: Float64Array
  private sentences: SyncData['sentences']

  constructor(data: SyncData) {
    this.words = data.words
    this.duration = data.duration
    this.timed = []
    for (let i = 0; i < this.words.length; i++) {
      const word = this.words[i]
      if (word.start !== null && word.end !== null) this.timed.push(i)
    }
    this.starts = new Float64Array(this.timed.length)
    this.ends = new Float64Array(this.timed.length)
    this.timed.forEach((wordIndex, k) => {
      this.starts[k] = this.words[wordIndex].start as number
      this.ends[k] = this.words[wordIndex].end as number
    })
    this.sentences = data.sentences
  }

  get hasTiming(): boolean {
    return this.timed.length > 0
  }

  get timedRatio(): number {
    return this.words.length === 0 ? 0 : this.timed.length / this.words.length
  }

  /**
   * audio -> text.  Binary search finds the last word that had already started at
   * `time`; if `time` falls in a gap between two words the next word is reported so the
   * highlight keeps following the audio instead of sticking to the previous word.
   * Returns -1 before the first timed word.
   */
  wordIndexAt(time: number): number {
    const n = this.timed.length
    if (n === 0 || time < this.starts[0]) return -1
    let lo = 0
    let hi = n - 1
    let last = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.starts[mid] <= time) {
        last = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (time < this.ends[last]) return this.timed[last]
    return last + 1 < n ? this.timed[last + 1] : this.timed[n - 1]
  }

  /** text -> audio.  Untimed words resolve to null and are not clickable. */
  timeForWord(index: number): number | null {
    const word = this.words[index]
    return word && word.start !== null ? word.start : null
  }

  /** Word index range of the sentence containing `wordIndex`. */
  sentenceAt(wordIndex: number): number {
    for (let i = 0; i < this.sentences.length; i++) {
      const sentence = this.sentences[i]
      if (wordIndex >= sentence.first && wordIndex <= sentence.last) return i
    }
    return 0
  }

  /** Start time of the sentence containing `wordIndex`, or null if unspeached. */
  sentenceStartAt(wordIndex: number): number | null {
    const sentence = this.sentences[this.sentenceAt(wordIndex)]
    return sentence ? sentence.start : null
  }

  /** Proportion (0..1) of the recording that this word table covers. */
  coverageEnd(): number {
    const n = this.timed.length
    return n === 0 ? 0 : this.ends[n - 1]
  }
}
