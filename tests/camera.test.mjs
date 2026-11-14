// Camera layer without a camera: verdict logic, fusion and the disagreement log, driven by
// synthetic landmark frames so the cases that are hard to stage in a room — a hand leaving frame
// mid-stroke, frame rate collapsing, a stalled video — are exercised deterministically.
import assert from 'node:assert/strict'
import { cameraDirection, CAMERA_WINDOW, MIN_FRAMES } from '../src/camera/direction.js'
import { fuseDirection } from '../src/camera/fuse.js'
import { readFile } from 'node:fs/promises'
import { createRingInput } from '../src/ring/input.js'
import { createCameraLog, LOG_CAP } from '../src/camera/log.js'

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

// ---------- fuseDirection ----------

const up = { dir: 'up', axis: 'vertical', displacement: 0.3 }
const down = { dir: 'down', axis: 'vertical', displacement: 0.3 }
const left = { dir: 'left', axis: 'horizontal', displacement: 0.3 }
const right = { dir: 'right', axis: 'horizontal', displacement: 0.3 }
const noVerdict = { dir: null, reason: '手不在画面内' }

// The vertical pair is the confusable one, so the camera overrules the ring there and only there.
assert.deepEqual(fuseDirection('up', down), { dir: 'down', source: 'camera', disagreed: true })
assert.deepEqual(fuseDirection('down', up), { dir: 'up', source: 'camera', disagreed: true })

// Left and right sit 95 degrees apart with differently-shaped returns, so the ring is not blind
// there and keeps the call.
assert.deepEqual(fuseDirection('left', right), { dir: 'left', source: 'ring', disagreed: true })
assert.deepEqual(fuseDirection('right', left), { dir: 'right', source: 'ring', disagreed: true })

// A cross-axis disagreement is not the 166-degree confusion the camera is justified by.
assert.deepEqual(fuseDirection('up', left), { dir: 'up', source: 'ring', disagreed: true })
assert.deepEqual(fuseDirection('left', up), { dir: 'left', source: 'ring', disagreed: true })

// Fill-in. The ring declining is far more common than it disagreeing, and an unclassified beat was
// never going to score, so any earned verdict is strictly better than the toast it replaces.
assert.deepEqual(fuseDirection(null, up), { dir: 'up', source: 'camera', disagreed: false })
assert.deepEqual(fuseDirection(null, left), { dir: 'left', source: 'camera', disagreed: false })

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
