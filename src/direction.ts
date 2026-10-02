/**
 * Text direction and language helpers.
 *
 * This project has two kinds of text: the English learning content, which is always
 * left-to-right, and Persian, which is right-to-left.  Rather than guessing from the
 * surrounding page, every piece of text is given an explicit `dir` and `lang`, and any
 * run that mixes scripts, digits or punctuation is isolated so the browser's bidi
 * algorithm cannot reorder it.
 */

export type Direction = 'ltr' | 'rtl'

/** Right-to-left scripts: Hebrew, Arabic, Syriac, Thaana and their presentation forms. */
const RTL = /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/

/**
 * Arabic-Indic digits carry no intrinsic direction (they are "weak" in the Unicode
 * bidirectional algorithm), so they must not make a run look right-to-left on their own.
 */
const WEAK_DIGITS = /[٠-٩۰-۹٫٬]/

const LETTER = /\p{L}/u

/**
 * The direction of a run of text, from its first strongly directional character.
 *
 * Digits, spaces and punctuation are skipped, so "0:31" and "15-41" are not mistaken
 * for right-to-left text and a timestamp cannot flip its own digits.
 */
export function detectDirection(text: string): Direction {
  for (const char of text) {
    if (WEAK_DIGITS.test(char)) continue
    if (RTL.test(char)) return 'rtl'
    if (LETTER.test(char)) return 'ltr'
  }
  return 'ltr'
}

/**
 * The language tag for a direction.
 *
 * The two languages this app renders are English and Persian, so right-to-left content is
 * Persian.  A Hebrew or Arabic string would be mislabelled, which is recorded here as the
 * one place to extend if another language is ever added.
 */
export function langFor(direction: Direction): 'en' | 'fa' {
  return direction === 'rtl' ? 'fa' : 'en'
}

export function detectLang(text: string): 'en' | 'fa' {
  return langFor(detectDirection(text))
}

/** Tag an element with the direction and language of the text it holds. */
export function applyLanguage(element: HTMLElement, text: string): Direction {
  const direction = detectDirection(text)
  element.setAttribute('dir', direction)
  element.setAttribute('lang', langFor(direction))
  return direction
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  )
}

/**
 * Escape a value and wrap it in an isolated bidi run.
 *
 * `<bdi>` gives the run its own direction derived from its own content, so timestamps
 * ("0:31"), counts ("4/9"), percentages ("98%"), file names and page ranges keep their
 * order even when they sit inside right-to-left text.
 */
export function bdi(value: string): string {
  return `<bdi dir="auto">${escapeHtml(value)}</bdi>`
}

/**
 * Arrows point along the reading direction: "back" points the way the reader came from,
 * which is the opposite in the two directions.
 */
const ARROWS: Record<Direction, { back: string; forward: string }> = {
  ltr: { back: '←', forward: '→' },
  rtl: { back: '→', forward: '←' },
}

export function arrow(direction: Direction, which: 'back' | 'forward'): string {
  return ARROWS[direction][which]
}

/** The direction the document is currently laid out in. */
export function documentDirection(): Direction {
  return document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr'
}
