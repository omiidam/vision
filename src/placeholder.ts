// The printed fill-in-the-blank rule.
//
// A run of dots and underscores is the book's blank line to write on, not a word: nothing
// is said for it, so it is not displayed as one and it has no timestamp.  The content
// pipeline makes the same decision in Python when it tokenises a page (text.is_placeholder),
// and the two rules have to agree exactly.  If the reader dropped a different set of
// tokens than the pipeline did, it would render a word the timings have no entry for and
// every highlight after it would sit one word out of step with the audio.

/**
 * True for a printed blank: a token made only of dots, underscores and spaces.
 *
 * Any length counts, because the book prints the blank as long as the exercise needs, and
 * a lone full stop between two sentences of an answer line is one of them too.  An empty
 * token counts as well: it carries no word to speak, which is what the pipeline's set
 * comparison says about it too.
 */
export function isPlaceholder(token: string): boolean {
  for (const character of token) {
    if (character !== '.' && character !== '_' && character !== ' ') return false
  }
  return true
}