/**
 * Picking out the words a textbook sets as new inside a page of running text.
 *
 * The book marks a word by setting it in a colour of its own, and those marks are read
 * out of the PDF during the build and carried in a section's `targets`.  This module
 * finds those words in the printed text so the reader can set them apart from the words
 * around them.  It never changes the text: it only reports which tokens are the ones the
 * book pointed at.
 *
 * A target can be more than one word ("died out", "a few"), so the text is walked as a
 * run of tokens and a target matches when its own words appear there in order.  The
 * search starts as early as it can, so a target is found at the first place it occurs
 * rather than at some later repetition of the same word.
 */

/** A token reduced to the form the marks are matched by: no case, no surrounding punctuation. */
export function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/**
 * The tokens a target is made of, or an empty list when it names nothing in the text.
 *
 * A target the book never prints - a word it only lists, or one that belongs to a part
 * the reader does not show - yields no words, so it can never match anything.
 */
function targetWords(target: string): string[] {
  return target.split(/\s+/).map(normalizeToken).filter(Boolean)
}

/**
 * The positions of the words of `text` that print one of `pending`, and what is still to
 * find.
 *
 * A target is claimed once: the targets left over are handed back so the caller can carry
 * them to the next block of the same text.  That is what stops a target printed near the
 * end of one block being claimed again by the next, while still letting every target be
 * looked for from the start of each block - a target found in one block must not hide a
 * different target that only this block prints.
 *
 * What comes back is where the words are, not which words they are.  A target of more
 * than one word ("a few") shares a word with the rest of the text, and marking by word
 * would set every "a" in the passage as well as the one that is part of the target.
 *
 * Every target is searched for independently, so the order they are found in says
 * nothing about the order the book prints them.
 */
export function markTargets(
  text: string,
  pending: string[],
): { positions: number[]; pending: string[] } {
  const tokens = text.split(/\s+/).filter(Boolean)
  const forms = tokens.map(normalizeToken)
  const positions = new Set<number>()
  const left: string[] = []

  for (const target of pending) {
    const words = targetWords(target)
    if (words.length === 0) continue
    const at = forms.findIndex((_, from) =>
      words.every((word, offset) => forms[from + offset] === word),
    )
    if (at < 0) {
      left.push(target)
      continue
    }
    for (let offset = 0; offset < words.length; offset += 1) positions.add(at + offset)
  }
  return { positions: [...positions].sort((a, b) => a - b), pending: left }
}

/**
 * Every word of `targets`, normalised, so a word can be asked about on its own.
 *
 * This is the coarse view used where a target is shown as a list in its own right (a
 * vocabulary entry, say) rather than matched against a run of running text.
 */
export function matchTargets(targets: string[]): Set<string> {
  const marked = new Set<string>()
  for (const target of targets) {
    for (const word of targetWords(target)) marked.add(word)
  }
  return marked
}