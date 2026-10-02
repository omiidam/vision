import type {
  GradeManifest,
  LessonManifest,
  SectionEntry,
  SectionText,
  SyncData,
  Vocabulary,
} from './types'

/**
 * All content lives in the generated `data/` tree and is fetched at runtime.  Nothing
 * about a lesson is compiled into the application code.
 */

const cache = new Map<string, Promise<unknown>>()

export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href
}

export function fetchJson<T>(path: string): Promise<T> {
  let pending = cache.get(path)
  if (!pending) {
    pending = fetch(assetUrl(path), { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`${response.status} while loading ${path}`)
      return (await response.json()) as T
    })
    cache.set(path, pending)
  }
  return pending as Promise<T>
}

export const loadGrade = (grade: number) => fetchJson<GradeManifest>(`data/grade-${grade}/manifest.json`)
export const loadLesson = (path: string) => fetchJson<LessonManifest>(path)
export const loadSectionText = (path: string) => fetchJson<SectionText>(path)
export const loadSync = (path: string) => fetchJson<SyncData>(path)
export const loadVocabulary = (path: string) => fetchJson<Vocabulary>(path)

export function findSection(lesson: LessonManifest, sectionId: string): SectionEntry | undefined {
  return lesson.sections.find((section) => section.id === sectionId)
}
