// The rate helpers are pure functions in the real player module, so the test loads the
// shipped source rather than a copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAYBACK_RATES, DEFAULT_RATE, nearestRate, formatRate } from '../src/player.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the reader offers exactly the six required playback speeds', () => {
  assert.deepEqual([...PLAYBACK_RATES], [0.5, 0.75, 1, 1.25, 1.5, 2])
  assert.equal(DEFAULT_RATE, 1, 'playback starts at normal speed')
})

test('each speed is labelled the way it is shown in the transport', () => {
  assert.deepEqual(PLAYBACK_RATES.map(formatRate), ['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x'])
})

test('an unsupported rate snaps to the nearest supported one', () => {
  assert.equal(nearestRate(1), 1)
  assert.equal(nearestRate(0.6), 0.5)
  assert.equal(nearestRate(0.7), 0.75)
  assert.equal(nearestRate(1.1), 1)
  assert.equal(nearestRate(1.2), 1.25)
  assert.equal(nearestRate(1.9), 2)
  assert.equal(nearestRate(3), 2)
  assert.equal(nearestRate(0), 0.5)
})

test('a snapped rate is always one the control can display', () => {
  for (const value of [0, 0.1, 0.63, 1.01, 1.37, 1.99, 4, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.ok(PLAYBACK_RATES.includes(nearestRate(value)), `${value} did not snap to a listed rate`)
  }
})

test('an unusable rate falls back to normal speed, not to the slowest one', () => {
  assert.equal(nearestRate(Number.NaN), DEFAULT_RATE)
  assert.equal(nearestRate(Number.POSITIVE_INFINITY), DEFAULT_RATE)
})

test('a snapped rate formats without floating point noise', () => {
  assert.equal(formatRate(nearestRate(1.2)), '1.25x')
  assert.equal(formatRate(nearestRate(0.5)), '0.5x')
  assert.equal(formatRate(nearestRate(2)), '2x')
})

test('the transport shows the playback controls and nothing about the recording', () => {
  // A reader is reading the book, not looking at the files it came from: the transport is
  // the play control, the track, the elapsed time and the speed, and nothing underneath it
  // names the recording it plays or where it came from.
  const source = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
  const render = source.slice(
    source.indexOf('private renderTransport'),
    source.indexOf('private renderTransportState'),
  )
  assert.match(render, /class="transport"/, 'the transport is gone')
  assert.match(render, /class="play"/, 'the play control is gone')
  assert.match(render, /class="track"/, 'the progress track is gone')
  assert.match(render, /class="time"/, 'the elapsed time is gone')
  assert.match(render, /class="rate"/, 'the speed control is gone')
  // The whole category is gone, not just this one file name: nothing in the reader may
  // reach for the recording's name, its mapping notes, or the map they are listed in.
  for (const shown of ['sourceAudioFile', 'mapping.notes', 'audio-mapping.json', 'Recorded file']) {
    assert.ok(!render.includes(shown), `the transport still shows "${shown}"`)
  }
  // The whole view, not just the transport: there is one reader and one transport, and no
  // second place a name could be printed.
  for (const shown of ['sourceAudioFile', '.mp3', 'Recorded file']) {
    assert.ok(!source.includes(shown), `the reader still refers to "${shown}"`)
  }
})

test('the recording is still loaded and timed, it is only not named', () => {
  // What was removed is the label, not the recording: the file is still loaded, and the
  // word timings are still what the track and the badge are driven from.
  const source = fs.readFileSync(path.join(ROOT, 'src', 'views', 'lesson.ts'), 'utf8')
  assert.match(source, /this\.player\.load\(assetUrl\(entry\.audio\)\)/)
  assert.match(source, /const timed = sync\?\.words\[wordIndex\]/)
  assert.match(source, /badge\.title = `Alignment confidence/)
  // The timings themselves are untouched: the file name stays in the data, where it
  // belongs, because it is how a recording is traced back to its source.
  for (const lessonId of ['lesson-01', 'lesson-02']) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'data', 'grade-10', lessonId, 'manifest.json'), 'utf8'),
    )
    const audio = manifest.sections.filter((section) => section.audio)
    assert.ok(audio.length > 0, `${lessonId} lost its recordings`)
    for (const section of audio) {
      assert.ok(fs.existsSync(path.join(ROOT, section.audio)), `${lessonId}: ${section.audio} is gone`)
      const sync = JSON.parse(
        fs.readFileSync(path.join(ROOT, section.sync), 'utf8'),
      )
      assert.ok(sync.sourceAudioFile.endsWith('.mp3'), `${lessonId}: ${section.id} lost its timing`)
      assert.ok(sync.words.length > 0, `${lessonId}: ${section.id} has no word timings`)
    }
  }
})
