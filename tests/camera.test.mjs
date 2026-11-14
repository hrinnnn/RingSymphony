// Camera layer without a camera: verdict logic, fusion and the disagreement log, driven by
// synthetic landmark frames so the cases that are hard to stage in a room — a hand leaving frame
// mid-stroke, frame rate collapsing, a stalled video — are exercised deterministically.
import assert from 'node:assert/strict'
import { cameraDirection, CAMERA_WINDOW, MIN_FRAMES } from '../src/camera/direction.js'

// Screen coordinates, MediaPipe's convention: x and y normalised 0-1, y growing *downward*.
const frames = (points, { t0 = 1.0, step = 0.033, inFrame = true } = {}) =>
  points.map(([x, y], i) => ({ t: t0 + i * step, x, y, inFrame }))

const rising = [[0.5, 0.60], [0.5, 0.52], [0.5, 0.45], [0.5, 0.38], [0.5, 0.30]]
const falling = [...rising].reverse()

// ---------- cameraDirection ----------

// A rising hand has decreasing y. Getting this backwards would invert every vertical verdict,
// which is the whole point of the camera, so it is asserted first.
{
  const verdict = cameraDirection(frames(rising), 1.14)
  assert.equal(verdict.dir, 'up')
  assert.equal(verdict.axis, 'vertical')
  assert.ok(verdict.displacement > 0)
}
{
  assert.equal(cameraDirection(frames(falling), 1.14).dir, 'down')
}
{
  const verdict = cameraDirection(frames([[0.30, 0.5], [0.38, 0.5], [0.45, 0.5], [0.52, 0.5], [0.60, 0.5]]), 1.14)
  assert.equal(verdict.dir, 'right')
  assert.equal(verdict.axis, 'horizontal')
}
{
  assert.equal(cameraDirection(frames([[0.60, 0.5], [0.52, 0.5], [0.45, 0.5], [0.38, 0.5], [0.30, 0.5]]), 1.14).dir, 'left')
}

// A real conducting stroke is never purely on one axis; the dominant component decides.
{
  const diagonal = [[0.40, 0.60], [0.42, 0.50], [0.44, 0.40], [0.46, 0.32], [0.48, 0.25]]
  assert.equal(cameraDirection(frames(diagonal), 1.14).axis, 'vertical')
}

// Stale frames: a backgrounded tab or a stalled stream leaves the newest frame seconds old, and a
// verdict built from it would be confident and wrong.
{
  assert.equal(cameraDirection(frames(rising, { t0: 1.0 }), 9.0).dir, null, 'a verdict must not be built from stale frames')
}

// Frame rate collapse: at ~15fps in a dim room the window holds too few frames to tell a stroke
// from a single bad landmark, so the camera declines rather than guessing.
{
  assert.equal(cameraDirection(frames([[0.5, 0.60], [0.5, 0.30]]), 1.07).dir, null, 'two frames cannot distinguish a stroke from an outlier')
  assert.ok(MIN_FRAMES >= 4)
}

// Tracking lost, and a hand pinned at the frame edge: positions are reported but not measured.
{
  assert.equal(cameraDirection(frames(rising, { inFrame: false }), 1.14).dir, null)
}
{
  const atEdge = [[0.5, 0.05], [0.5, 0.04], [0.5, 0.03], [0.5, 0.02], [0.5, 0.01]]
  assert.equal(cameraDirection(frames(atEdge), 1.14).dir, null, 'a hand pinned at the frame edge is not measured')
}

// A still hand is noise, not a stroke. Displacement doubles as the confidence measure.
{
  const still = [[0.5, 0.500], [0.5, 0.502], [0.5, 0.499], [0.5, 0.501], [0.5, 0.500]]
  assert.equal(cameraDirection(frames(still), 1.14).dir, null)
}

// Only the window before the beat counts.
{
  const withOlder = [...frames([[0.5, 0.1], [0.5, 0.9]], { t0: 0.1 }), ...frames(rising, { t0: 1.0 })]
  assert.equal(cameraDirection(withOlder, 1.14).dir, 'up', 'frames before the window must not steer the verdict')
  assert.equal(CAMERA_WINDOW, 0.30)
}

// The return stroke falls *after* the beat, which is how the camera avoids the problem that no
// cosine threshold solves for the ring: it is simply never asked about it.
{
  const withReturn = [...frames(rising, { t0: 1.0 }), ...frames([[0.5, 0.35], [0.5, 0.50], [0.5, 0.65]], { t0: 1.18 })]
  assert.equal(cameraDirection(withReturn, 1.14).dir, 'up', 'the return stroke falls after the beat and is never examined')
}

// Empty and absent input decline rather than throw: every degradation path lands here.
{
  assert.equal(cameraDirection([], 1.0).dir, null)
  assert.equal(cameraDirection(null, 1.0).dir, null)
}

console.log('camera tests passed')
