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
