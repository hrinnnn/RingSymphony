// Camera layer without a camera: verdict logic, fusion and the disagreement log, driven by
// synthetic landmark frames so the cases that are hard to stage in a room — a hand leaving frame
// mid-stroke, frame rate collapsing, a stalled video — are exercised deterministically.
import assert from 'node:assert/strict'
import { cameraDirection, CAMERA_WINDOW, MIN_FRAMES } from '../src/camera/direction.js'
import { fuseDirection } from '../src/camera/fuse.js'
import { readFile } from 'node:fs/promises'
import { createRingInput } from '../src/ring/input.js'
import { createCameraLog, LOG_CAP } from '../src/camera/log.js'
import { handedToRole, rolesContradicted, createCameraTracker } from '../src/camera/tracker.js'

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
// Horizontal is flipped relative to the image. The player faces the camera unmirrored - the
// pixels must not be mirrored, or MediaPipe's handedness inverts - so a stroke the player makes
// to their own left travels toward increasing x in the image.
{
  const verdict = cameraDirection(frames([[0.30, 0.5], [0.38, 0.5], [0.45, 0.5], [0.52, 0.5], [0.60, 0.5]]), 1.14)
  assert.equal(verdict.dir, 'left', 'increasing image x is the player moving to their own left')
  assert.equal(verdict.axis, 'horizontal')
}
{
  assert.equal(cameraDirection(frames([[0.60, 0.5], [0.52, 0.5], [0.45, 0.5], [0.38, 0.5], [0.30, 0.5]]), 1.14).dir, 'right')
}

// The left/right flip, stated as the invariant rather than as two coordinates. This was wrong in
// the first version and reached a player as "I swipe left and it says 右" - the same symptom the
// ring's own axis confusion produces, which is what made it hard to spot.
{
  const toImageRight = frames([[0.35, 0.5], [0.45, 0.5], [0.55, 0.5], [0.62, 0.5], [0.68, 0.5]])
  const toImageLeft = frames([[0.68, 0.5], [0.62, 0.5], [0.55, 0.5], [0.45, 0.5], [0.35, 0.5]])
  assert.notEqual(cameraDirection(toImageRight, 1.14).dir, cameraDirection(toImageLeft, 1.14).dir)
  assert.equal(cameraDirection(toImageRight, 1.14).dir, 'left', 'the camera is not mirrored, so the player and the image disagree about left')
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
  // Three frames do answer: at 30fps a 300ms window yields ~6 arrived frames, and in a dim room
  // ~3. Requiring four declined every verdict in poor light - the conditions the camera is most
  // needed in - and declining is silent, indistinguishable from having no camera.
  assert.equal(MIN_FRAMES, 3)
  assert.equal(cameraDirection(frames([[0.5, 0.60], [0.5, 0.45], [0.5, 0.30]]), 1.07).dir, 'up')
}

// A full vertical stroke reaches the top of a laptop webcam's view. The first version required
// every frame to be clear of the edges, so one clipped frame at the end of a good stroke threw the
// whole stroke away - which systematically killed the vertical verdicts the camera exists for, and
// reached a player as "it struggles with ups and downs". The frames before the hand left still
// prove which way it was going.
{
  const exits = frames([[0.5, 0.45], [0.5, 0.33], [0.5, 0.22], [0.5, 0.10], [0.5, 0.02]])
  assert.equal(cameraDirection(exits, 1.14).dir, 'up', 'a stroke that leaves the frame still has a measurable beginning')
}
// The same for a down-stroke leaving the bottom.
{
  const exits = frames([[0.5, 0.55], [0.5, 0.67], [0.5, 0.78], [0.5, 0.90], [0.5, 0.99]])
  assert.equal(cameraDirection(exits, 1.14).dir, 'down')
}
// But a hand that is *only* ever at the edge has nothing measurable, and says so distinctly.
{
  const pinned = frames([[0.5, 0.02], [0.5, 0.01], [0.5, 0.02], [0.5, 0.01], [0.5, 0.02]])
  const verdict = cameraDirection(pinned, 1.14)
  assert.equal(verdict.dir, null)
  assert.equal(verdict.reason, '手在画面边缘', 'the reason has to name the fix: move back into frame')
}
// Displacement is never measured across a tracking dropout: the frames either side are two
// separate observations, and joining them would describe a motion nobody made.
{
  // Low in frame, then tracking is lost, then high in frame and barely moving. Joined across the
  // gap this reads as a big up-stroke; measured honestly, neither run carries enough motion.
  const split = [
    ...frames([[0.5, 0.80], [0.5, 0.79], [0.5, 0.78]], { t0: 1.00 }),
    ...frames([[0.5, 0.50], [0.5, 0.40]], { t0: 1.10, inFrame: false }),
    ...frames([[0.5, 0.21], [0.5, 0.20], [0.5, 0.20]], { t0: 1.20 }),
  ]
  const verdict = cameraDirection(split, 1.28)
  assert.equal(verdict.dir, null, 'a gap must not be read as one long stroke')
  assert.equal(verdict.reason, '位移过小')
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

// ---------- fuseDirection ----------

const up = { dir: 'up', axis: 'vertical', displacement: 0.3 }
const down = { dir: 'down', axis: 'vertical', displacement: 0.3 }
const left = { dir: 'left', axis: 'horizontal', displacement: 0.3 }
const right = { dir: 'right', axis: 'horizontal', displacement: 0.3 }
const noVerdict = { dir: null, reason: '手不在画面内' }

// Measured over 64 labelled strokes in two sessions: the ring answered 60/60 correctly, the camera
// 46/51, and all three overrides turned a CORRECT ring answer into an error while fixing none. So
// when the ring answers, the ring decides - on every axis.
//
// This reverses the earlier rule, which let the camera overrule on the 166-degree vertical
// confusion in direction.js:37. That geometry is real but it described an *uncalibrated* ring: the
// stored calibration was missing its gyro bias, a ~0.78 rad/s offset tilting a stroke's feature by
// up to 27 degrees. With the bias restored the ring is not blind, so there is no coin flip to beat.
assert.deepEqual(fuseDirection('up', down), { dir: 'up', source: 'ring', disagreed: true })
assert.deepEqual(fuseDirection('down', up), { dir: 'down', source: 'ring', disagreed: true })
assert.deepEqual(fuseDirection('left', right), { dir: 'left', source: 'ring', disagreed: true })
assert.deepEqual(fuseDirection('up', left), { dir: 'up', source: 'ring', disagreed: true })

// Fill-in survives, because converting a guaranteed no-score into a score cannot cost anything the
// player already had - but only on a displacement big enough to trust. Both measured fill-ins were
// wrong, at 0.036 and 0.055: the camera reading a stroke's edge rather than its body.
const bigUp = { dir: 'up', axis: 'vertical', displacement: 0.12 }
const bigLeft = { dir: 'left', axis: 'horizontal', displacement: 0.12 }
const weakUp = { dir: 'up', axis: 'vertical', displacement: 0.05 }
assert.deepEqual(fuseDirection(null, bigUp), { dir: 'up', source: 'camera', disagreed: false })
assert.deepEqual(fuseDirection(null, bigLeft), { dir: 'left', source: 'camera', disagreed: false })
assert.deepEqual(fuseDirection(null, weakUp), { dir: null, source: 'ring', disagreed: false },
  'a small displacement is a stroke edge, not a stroke')

// No verdict: the ring's answer stands untouched, including when the ring also had none. This is
// the path every degradation converges on, so it must leave the pipeline exactly as it was.
assert.deepEqual(fuseDirection('up', noVerdict), { dir: 'up', source: 'ring', disagreed: false })
assert.deepEqual(fuseDirection(null, noVerdict), { dir: null, source: 'ring', disagreed: false })
assert.deepEqual(fuseDirection('up', null), { dir: 'up', source: 'ring', disagreed: false })
assert.deepEqual(fuseDirection(null, null), { dir: null, source: 'ring', disagreed: false })

// Agreement is not disagreement, and must not be logged as one.
assert.deepEqual(fuseDirection('up', up), { dir: 'up', source: 'ring', disagreed: false })
assert.deepEqual(fuseDirection('left', left), { dir: 'left', source: 'ring', disagreed: false })

console.log('fusion tests passed')

// ---------- cameraVerdict wired through the ring pipeline ----------
//
// Driven with recorded IMU data through the real input hub, so the fusion runs where it actually
// runs: before the return filter, which decides whether a beat survives at all.

const recording = async (cls, person) => {
  const raw = JSON.parse(await readFile(new URL(`../recordings/${cls}/${person}.json`, import.meta.url), 'utf8'))
  return raw.t.map((t, i) => ({ t, acc: raw.acc[i], gyr: raw.gyr[i] }))
}

// Feeds one recording through a hub built with the given options, returning the events it emitted.
async function drive(options = {}) {
  let clock = 100
  const events = []
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const input = createRingInput({ onEvent: e => events.push(e), now: () => clock, WebSocketImpl: null, storage, ...options })
  input.feed({ type: 'status', rings: [{ address: 'A', name: 'Ringo-A', connected: true }] })
  for (const [i, f] of (await recording('四拍', 'yyh')).entries()) {
    clock = 100 + f.t + 0.02
    input.feed({ type: 'imu', address: 'A', name: 'Ringo-A', timestamp: f.t, sequence: i, acc: f.acc, gyr: f.gyr })
  }
  return { events, input }
}

// Without a camera the pipeline must be byte-identical to the pre-camera one. This is the anti-goal
// the whole design rests on: a player with no webcam gets exactly what they got before.
{
  const bare = await drive()
  const nulled = await drive({ cameraVerdict: () => null })
  assert.deepEqual(nulled.events, bare.events, 'a camera with no verdict must not perturb the pipeline')
  assert.ok(bare.events.filter(e => e.type === 'beat').length > 30)
}

// A camera that throws - permission revoked mid-level, the tracker crashing - must not stop beats
// reaching the game. The degradation is silent and total.
{
  const thrown = await drive({ cameraVerdict: () => { throw new Error('permission revoked') } })
  const bare = await drive()
  assert.deepEqual(thrown.events, bare.events, 'a throwing camera must degrade to no camera, not break the beat path')
}

// The camera fills in where the ring declined. The recording is uncalibrated, so every beat comes
// through with dir null - which is exactly the 方向不确定 case the fill-in rule targets.
{
  const { events, input } = await drive({ cameraVerdict: () => ({ dir: 'up', axis: 'vertical', displacement: 0.3 }) })
  const beats = events.filter(e => e.type === 'beat')
  assert.ok(beats.length > 0)
  assert.ok(beats.every(e => e.dir === 'up'), 'the camera answers where the ring could not')
  assert.ok(input.snapshot().cameraStats.fills > 0, 'fills are counted separately from overrides')
  assert.equal(input.snapshot().cameraStats.overrides, 0)
}

// The verdict is asked for on the uncompensated page clock. Compensation is a judgement offset
// clamped to +-300ms; anchoring on it would slide a 300ms window onto the return stroke.
{
  const asked = []
  await drive({ cameraVerdict: (hand, at) => { asked.push({ hand, at }); return null } })
  assert.ok(asked.length > 0, 'the camera is consulted for right-hand beats')
  assert.ok(asked.every(a => a.hand === 'right'))
  assert.ok(asked.every(a => a.at > 100 && a.at < 400), 'the verdict time is on the page clock')
}

// The per-ring offset has to leave input.js so camera frames and ring events can share a clock.
{
  const { input } = await drive()
  assert.ok(Number.isFinite(input.snapshot().rings[0].offset), 'the page-clock offset is exposed for the camera')
}

console.log('ring wiring tests passed')

// ---------- the persisted disagreement log ----------

const fakeStorage = () => {
  const store = new Map()
  return { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
}
const entry = (t) => ({ t, hand: 'right', axis: 'vertical', ring: 'up', cam: 'down', source: 'camera', earned: true, frames: [] })

// The point of persisting: playing the game accumulates the labelled data the repo does not have,
// and a log that died on refresh could never do that.
{
  const storage = fakeStorage()
  const log = createCameraLog({ storage, cap: 3 })
  for (const t of [1, 2, 3, 4]) log.record(entry(t))
  assert.deepEqual(log.entries().map(e => e.t), [2, 3, 4], 'the cap drops the oldest, never the newest')
  assert.equal(createCameraLog({ storage, cap: 3 }).entries().length, 3, 'the log must survive a refresh')
}

// Private mode throws on getItem, a full quota throws on setItem, and neither may cost a beat.
{
  const hostile = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota exceeded') } }
  const log = createCameraLog({ storage: hostile })
  assert.doesNotThrow(() => log.record(entry(1)))
  assert.equal(log.entries().length, 1, 'the session log still works when storage does not')
}
assert.doesNotThrow(() => createCameraLog({ storage: null }).record(entry(1)))

// Export has to produce something a person can actually take away and label.
{
  const log = createCameraLog({ storage: fakeStorage() })
  log.record(entry(1))
  const parsed = JSON.parse(log.toJSON())
  assert.equal(parsed.entries.length, 1)
  assert.ok(parsed.version && parsed.exported, 'an exported log carries its own version and date')
}

// Clearing is explicit and total - this is webcam-derived data, so there must be a way out.
{
  const storage = fakeStorage()
  const log = createCameraLog({ storage })
  log.record(entry(1))
  log.clear()
  assert.deepEqual(log.entries(), [])
  assert.deepEqual(createCameraLog({ storage }).entries(), [], 'clearing reaches storage, not just memory')
}

assert.equal(LOG_CAP, 500)
console.log('camera log tests passed')

// ---------- tracker helpers ----------
//
// Only the pure parts are testable here: the tracker imports MediaPipe lazily, inside enable(),
// precisely so that importing this module under Node does not drag in the wasm runtime.

assert.equal(handedToRole('Right'), 'right')
assert.equal(handedToRole('Left'), 'left')
assert.equal(handedToRole('nonsense'), null)
assert.equal(handedToRole(undefined), null)

// Facing an unmirrored camera, the subject's right hand appears on the *left* of the image, at low
// x. So right-at-high-x means either the pixels are mirrored (handedness inverts, and every
// verdict would be attributed to the wrong hand) or the rings are worn opposite to their roles.
// Reported, never silently corrected - auto-swapping would hide a real setup problem and make the
// symptom look like a fusion bug.
assert.equal(rolesContradicted({ right: { x: 0.8 }, left: { x: 0.2 } }), true)
assert.equal(rolesContradicted({ right: { x: 0.2 }, left: { x: 0.8 } }), false)
assert.equal(rolesContradicted({ right: { x: 0.8 }, left: null }), false, 'one hand cannot contradict an ordering')
assert.equal(rolesContradicted({ right: null, left: null }), false)

console.log('tracker helper tests passed')

// A hand appearing or disappearing must reach the page. The first version only emitted when the
// role-mismatch flag flipped, so the chip froze on whatever it said when the camera was switched
// on and a player with their hands plainly up still read 手不在画面内.
{
  const tracker = createCameraTracker({ now: () => 0 })
  const seen = []
  tracker.onStatus(s => seen.push(s.hands))
  const landmark = (x, y) => ({ x, y, z: 0 })
  const hand = (x, y) => Array.from({ length: 21 }, () => landmark(x, y))
  // observe() is internal, so drive it the way the loop does: through the exported test seam.
  tracker.__observe({ handedness: [[{ categoryName: 'Right' }]], landmarks: [hand(0.4, 0.5)] }, 0.1)
  assert.ok(seen.length >= 1, 'a hand appearing must notify the page')
  assert.equal(seen[seen.length - 1].right, true)
  tracker.__observe({ handedness: [], landmarks: [] }, 0.2)
  assert.equal(seen[seen.length - 1].right, false, 'a hand disappearing must notify the page too')
}

console.log('tracker notification tests passed')
