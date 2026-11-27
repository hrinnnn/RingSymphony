// Beat detector thresholds: the floor adapts to how hard the player is actually conducting,
// so a gentle conductor is not judged against the same absolute bar as an energetic one.
import assert from 'node:assert/strict'
import { createBeatDetector } from '../src/ring/detectors.js'

// A gentle conductor whose peaks never reach the old 1.6 rad/s floor must still produce beats.
{
  const detector = createBeatDetector()
  const events = []
  for (let i = 0; i < 8000; i += 1) {
    const t = i * 0.005
    const phase = (i % 200) / 200
    const speed = phase < 0.15 ? 0.15 + 0.85 * Math.sin((phase / 0.15) * Math.PI) : 0.15
    const event = detector.push(t, speed)
    if (event) events.push(event)
  }
  assert.ok(events.length > 20, `gentle strokes must register beats, got ${events.length}`)
}

// Idle noise must not be promoted into beats once the floor is allowed to fall.
{
  let seed = 1
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const detector = createBeatDetector()
  const events = []
  for (let i = 0; i < 8000; i += 1) {
    const event = detector.push(i * 0.005, 0.05 + random() * 0.05)
    if (event) events.push(event)
  }
  assert.equal(events.length, 0, `idle noise must not produce beats, got ${events.length}`)
}

// The adaptive floor must stay inside the clamp range at both extremes.
{
  const detector = createBeatDetector()
  for (let i = 0; i < 4000; i += 1) detector.push(i * 0.005, 0.02)
  assert.ok(detector.floor >= 0.65, `floor must not fall below floorMin, got ${detector.floor}`)
  for (let i = 4000; i < 8000; i += 1) detector.push(i * 0.005, 12)
  assert.ok(detector.floor <= 1.6, `floor must not rise above floorMax, got ${detector.floor}`)
}

// Opting out restores the fixed floor exactly.
{
  const detector = createBeatDetector({ adaptiveFloor: false })
  for (let i = 0; i < 2000; i += 1) detector.push(i * 0.005, 0.05)
  assert.equal(detector.floor, 1.6)
}

console.log('detectors ok')

// A clear stroke is strong; a soft one above the floor is weak.
{
  const detector = createBeatDetector({ adaptiveFloor: false })
  const strong = [0, 0, 2, 6, 1, 0].map((s, i) => detector.push(i * 0.01, s)).filter(Boolean)
  assert.equal(strong.length, 1)
  assert.equal(strong[0].tier, 'strong')
}
// A soft stroke that clears the low bar but not the high one is weak.
// With the current defaults and mean ≈ 0.5, the floor sets the low
// bar at 0.5 rad/s and beatRise sets the high bar near 0.6 rad/s.
{
  const detector = createBeatDetector({ adaptiveFloor: false, beatFloor: 0.5 })
  for (let i = 0; i < 400; i += 1) detector.push(i * 0.005, 0.5)
  const weak = [0.5, 0.5, 0.55, 0.57, 0.44, 0.5].map((s, i) => detector.push(2 + i * 0.01, s)).filter(Boolean)
  assert.equal(weak.length, 1)
  assert.equal(weak[0].tier, 'weak')
}

console.log('detectors tier ok')

// Two slightly declining samples on the shoulder are still part of a rising stroke.
{
  const detector = createBeatDetector({ adaptiveFloor: false, beatFloor: 0.65, earlyBeat: true })
  const speeds = [0.2, 0.75, 1.4, 1.37, 1.34, 1.8, 2.25, 2.18, 2, 1.7]
  const events = speeds.map((speed, i) => detector.push(i * 0.005, speed)).filter(Boolean)
  assert.deepEqual(events.map(event => event.peakSpeed), [2.25])
}

// Missing samples may hide the middle of a stroke, but a stronger main peak
// should still get past the lockout left by a weak preparatory peak.
{
  const detector = createBeatDetector({ adaptiveFloor: false, beatFloor: 0.65, earlyBeat: true,
    weakRise: 1.1, beatRise: 2.2, beatTau: 20 })
  const frames = [[0, 2], [0.01, 2], [0.02, 3], [0.03, 2.8], [0.04, 2.5], [0.05, 0.5],
    [0.09, 3], [0.10, 4], [0.11, 4.65], [0.12, 4.4], [0.13, 4.0]]
  const events = frames.map(([t, speed]) => detector.push(t, speed)).filter(Boolean)
  assert.deepEqual(events.map(event => [event.tier, event.peakSpeed]), [['weak', 3], ['strong', 4.65]])
}

// The first stroke of a level must register however firmly the player calibrated. Calibration
// seeds the detector's floor, so a player who calibrated with a firm wave and then conducts
// gently had no history for the floor to have learned from, and their opening beat was judged
// against a bar it could not clear.
{
  const gentleAfterCalibration = (beatFloor) => {
    const detector = createBeatDetector({ beatFloor })
    let t = 0
    for (let i = 0; i < 200; i += 1) { detector.push(t, 0.3); t += 0.005 }
    let beats = 0
    for (let k = 0; k <= 60; k += 1) {
      if (detector.push(t, 1.0 * Math.sin(Math.PI * k / 60))) beats += 1
      t += 0.005
    }
    return beats
  }
  for (const floor of [0.875, 1.75, 3.5]) {
    assert.equal(gentleAfterCalibration(floor), 1, `a gentle stroke must register after calibrating at ${floor}`)
  }
}

// A detector that has only just started watching holds off reporting: the resting estimate seeds
// low so a soft stroke is not lost, which would otherwise let a hand already in motion report
// noise as beats before the estimate has risen.
{
  const detector = createBeatDetector()
  let t = 0
  let early = 0
  for (let k = 0; k < 40; k += 1) { if (detector.push(t, 2.0 + Math.sin(k))) early += 1; t += 0.005 }
  assert.equal(early, 0, 'a detector mid-motion from its first frame reports nothing during warmup')
}

console.log('detectors first-stroke ok')
