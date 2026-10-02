// The rate helpers are pure functions in the real player module, so the test loads the
// shipped source rather than a copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PLAYBACK_RATES, DEFAULT_RATE, nearestRate, formatRate } from '../src/player.ts'

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
