/** Shapes of the generated content tree in `data/grade-10`. */

export interface GradeManifest {
  grade: number
  subject: string
  textbook: string
  lessons: GradeLessonEntry[]
}

export interface GradeLessonEntry {
  id: string
  number: number
  title: string
  tocLine: string
  pages: [number, number]
  manifest: string
  sectionCount: number
  audioCount: number
}

export interface LessonManifest {
  id: string
  number: number
  title: string
  grade: number
  subject: string
  tocLine: string
  pages: [number, number]
  sections: SectionEntry[]
  vocabulary: string
}

export interface SectionEntry {
  id: string
  label: string
  title: string
  pages: [number, number]
  text: string
  audio: string | null
  duration: number
  sync: string | null
  syncConfidence: number | null
  syncStatus: 'confirmed' | 'uncertain' | 'unmapped' | 'no-audio'
}

export interface TextBlock {
  page: number
  lines: string[]
}

/**
 * A word a section teaches, as identified by the book itself (its word bank, or the
 * glossary on the New Words page).  The entry carries where it came from so the reader
 * can group it, and it keeps the slots a later editing pass will fill - the Persian
 * meaning, pronunciation, examples and audio are present but empty.
 */
export interface SectionVocabularyEntry {
  word: string
  grade: number
  lessonId: string
  /** The section that teaches the word: the word bank's own section. */
  sectionId: string
  /**
   * The section whose vocabulary list this entry is written into.  It differs from
   * `sectionId` for a word bank word, which the New Words & Expressions page lists as
   * well as the section that prints it.
   */
  listedIn: string
  /** Printed page the word is identified on. */
  page: number
  /** Order within the list this entry appears in, starting at 0. */
  position: number
  /** How the book identifies the word: 'word-bank', 'practice' or 'glossary'. */
  source: 'word-bank' | 'practice' | 'glossary'
  /**
   * The part of the vocabulary page the word belongs to: the letter of the printed part,
   * or 'word-bank' for the lesson's word bank words.  The listing runs in printed order,
   * so the parts appear in the order the book sets them out.
   */
  part: string
  /** The part's heading as printed, e.g. "A. Look, Read and Practice." */
  partTitle: string
  meaningEn: string
  meaningFa: string
  pronunciation: string
  examples: string[]
  audio: string | null
}

export interface SectionText {
  id: string
  lessonId: string
  label: string
  title: string
  source: { pdf: string; pages: [number, number] }
  blocks: TextBlock[]
  text: string
  /** Vocabulary this section teaches. Separate from the text, which is never altered. */
  vocabulary: SectionVocabularyEntry[]
}

export type WordMatch = 'exact' | 'fuzzy' | 'interpolated' | 'low'

export interface SyncWord {
  word: string
  /** Seconds on the audio timeline, or null when the recording does not speak it. */
  start: number | null
  end: number | null
  match: WordMatch | null
  similarity: number | null
  spokenAs: string | null
}

export interface SyncSentence {
  /** Index range of the words that make up this sentence. */
  first: number
  last: number
  start: number | null
  end: number | null
  text: string
}

export interface SpokenIsland {
  start: number
  end: number
  transcript: string
}

export interface SyncData {
  sectionId: string
  lessonId: string
  audio: string
  sourceAudioFile: string
  duration: number
  method: string
  confidence: number
  mapping: {
    status: string
    method: string
    contentScore: number
    runnerUp: { score: number; lessonId: string; sectionId: string } | null
    notes: string[]
  }
  words: SyncWord[]
  sentences: SyncSentence[]
  /** Parts of the recording with no printed counterpart (e.g. listening exercises). */
  unspokenAudio: SpokenIsland[]
}

export interface VocabularyEntry {
  word: string
  pronunciation: string
  meaningEn: string
  meaningFa: string
  examples: string[]
  audio: string | null
  page: number
  /** How the book identifies the word: 'word-bank', 'practice' or 'glossary'. */
  source: 'word-bank' | 'practice' | 'glossary'
  /** The section the word was printed in, which is not always the New Words page. */
  sectionId: string
  /** The part of the vocabulary page the word belongs to, in printed order. */
  part: string
  /** The part's heading as printed, e.g. "A. Look, Read and Practice." */
  partTitle: string
}

export interface Vocabulary {
  lessonId: string
  source: { pdf: string; definitionPages: [number, number]; previewPage: number | null }
  targetWords: string[]
  items: VocabularyEntry[]
}
