// How a lesson or section's place in the book is written.  Every view that shows a page
// range goes through here, so the wording is the same everywhere and a section that
// covers one page says so instead of repeating the number twice.

/**
 * The page or pages something is printed on, as the reader sees it: "pages 19" for a
 * single page, and "pages 19–21" for a span of them.
 *
 * The book decides the range, so this only reads the two numbers it is given.  A section
 * or lesson added later is described the same way without any change here.
 */
export function formatPageRange(pages: [number, number]): string {
  const [first, last] = pages
  return first === last ? `pages ${first}` : `pages ${first}–${last}`
}
