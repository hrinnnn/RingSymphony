import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { classifyAbsolute, classifyAbsoluteStroke, createReversalFilter } from "../src/ring/absolute.js"
import { causalFeatures, causalSequence, createCausalClassifier, FEATURE_COUNT, FEATURE_VERSION,
  SEQUENCE_CHANNELS, SEQUENCE_STEPS, SEQUENCE_VERSION } from "../src/ring/causal-classifier.js"
import { createBeatDetector, createFistDetector } from "../src/ring/detectors.js"
import { createRingInput } from "../src/ring/input.js"
import { createClockOffset, createGyroBias } from "../src/ring/signal.js"
import { createCaptureHealth, summarizeCapture } from "../tools/capture-quality.js"
import { timedTrials } from "../tools/capture-metronome.js"
import { captureStorage } from "../tools/capture-storage.mjs"

const up = [0, 0, 1]
const rest = [0, 0, 9.81]
const bias = [0.4, -0.6, 0.3]
const button = { type: "button", address: "L", seq: 9, timestamp: 2.02, event: 2, action: "click", label: "单击" }
{
  let now = 10
  const motions = []
  const input = createRingInput({ now: () => now, WebSocketImpl: null, boundHands: { left: "L" },
    onMotion: motion => motions.push(motion) })
  input.feed({ type: "status", rings: [{ address: "L", connected: true }] })
  const feed = (timestamp, gyr, sequence) => {
    now = 10 + timestamp
    input.feed({ type: "imu", address: "L", timestamp, sequence, acc: rest, gyr })
  }
  for (let i = 0; i <= 200; i++) feed(i * 0.005, bias, i)
  assert.ok(motions.at(-1).speed < 1e-9, "motion samples use bias-corrected gyro")
  feed(1.005, bias.map((b, i) => b + [1, 0, 2][i]), 201)
  const { hand, address, dt, wYaw, wPitch } = motions.at(-1)
  assert.equal(hand, "left")
  assert.equal(address, "L")
  assert.ok(Math.abs(dt - 0.005) < 1e-9 && Math.abs(wYaw - 2) < 0.01 && Math.abs(wPitch - 1) < 0.01)
  feed(1.105, bias, 202)
  assert.equal(motions.at(-1).dt, 0.02, "short gaps cannot multiply a returning gyro sample")
  const beforeReset = motions.length
  feed(1.505, bias, 203)
  assert.equal(motions.length, beforeReset, "long gaps do not move the cursor")
}
{
  let now = 10
  const events = []
  const input = createRingInput({ now: () => now, WebSocketImpl: null, boundHands: { left: "L" },
    onEvent: event => events.push(event) })
  input.feed({ type: "bridge", tcp: true, source: "ble" })
  input.feed(button)
  assert.equal(events.length, 0, "a button cannot allocate a hand")
  input.feed({ type: "status", rings: [{ address: "L", name: "Ringo L", connected: true }] })
  input.feed({ type: "imu", address: "L", name: "Ringo L", timestamp: 2, sequence: 0, acc: rest, gyr: [0, 0, 0] })
  input.compensation = 0.01
  now = 10.08
  input.feed({ ...button, address: "unassigned" })
  input.feed({ ...button, action: "double" })
  input.feed(button)
  assert.equal(events.length, 1)
  assert.ok(Math.abs(events[0].age - 0.07) < 1e-9)
  assert.deepEqual({ ...events[0], age: 0 }, { type: "button", hand: "left", event: 2,
    action: "click", label: "单击", age: 0, address: "L", name: "Ringo L" })
  assert.equal(input.snapshot().last.action, "click")
  assert.equal(input.snapshot().lastByHand.left.label, "单击")
  assert.equal(input.snapshot().lastButtonByHand.left.count, 1)
  assert.equal(input.snapshot().link.source, "ble")
  input.feed({ type: "bridge", tcp: true })
  assert.deepEqual(input.snapshot().link, { open: false, studio: true })
}

const gyro = createGyroBias()
const otherRing = createGyroBias()
for (let i = 0; i <= 62; i++) gyro.update(i * 0.005, rest, bias, 0.005)
assert.ok(gyro.ready)
assert.ok(gyro.value.every((value, axis) => Math.abs(value - bias[axis]) < 1e-9))
for (let i = 63; i <= 200; i++) gyro.update(i * 0.005, rest, [2, 1, -1], 0.005)
assert.ok(gyro.value.every((value, axis) => Math.abs(value - bias[axis]) < 1e-9))
assert.deepEqual(otherRing.value, [0, 0, 0])

for (const mode of ["absolute", "template"]) {
  let arrival = 10
  const input = createRingInput({ now: () => arrival, WebSocketImpl: null, boundHands: { left: "L", right: "R" },
    storage: { getItem: key => key === "ringsymphony.direction-mode.v2" ? mode : null } })
  const biases = { L: bias, R: [-0.7, 0.2, 0.2] }
  input.feed({ type: "status", rings: ["L", "R"].map(address => ({ address, connected: true })) })
  for (let i = 0; i <= 70; i++) {
    arrival = 10 + i * 0.005
    for (const [address, gyr] of Object.entries(biases)) input.feed({
      type: "imu", address, sequence: i, timestamp: i * 0.005, acc: rest, gyr,
    })
  }
  const snapshot = input.snapshot()
  assert.equal(snapshot.directionMode, mode)
  for (const ring of snapshot.rings) assert.ok(ring.gyroBias.every(
    (component, axis) => Math.abs(component - biases[ring.address][axis]) < 1e-9))
}

const clock = createClockOffset()
assert.equal(clock.push(10, 1), 9)
assert.equal(clock.push(10.25, 1.05), 9)
assert.equal(clock.push(15.25, 6), 9.2)
clock.reset()
assert.equal(clock.push(20, 19), 1)

const yaw = [Math.sqrt(0.75), 0, 0.5]
assert.equal(classifyAbsolute({ gravity: up, rotation: yaw, linear: up, linMag: 3 }).direction, "up")
assert.equal(classifyAbsolute({ gravity: up, rotation: yaw, linear: up, linMag: 0.2 }).direction, "left")
assert.equal(classifyAbsoluteStroke([
  { t: 0.85, acc: [0, 0, 13], gyr: [3, 0, 0.2], up },
  { t: 0.93, acc: [0, 0, 14], gyr: [4, 0, 0.3], up },
  { t: 1, acc: rest, gyr: [5, 0, 0.4], up },
], 1).direction, "up")

const reversal = createReversalFilter()
assert.ok(reversal.accept("up", 1, false, true))
assert.equal(reversal.accept("down", 1.20, false, true), false, "a quick reversal remains suppressed")
assert.ok(reversal.accept("down", 1.35, false, true), "missing frames can hide the next stroke's drive")

const beat = createBeatDetector({ beatFloor: 0.65, weakRise: 1.1, beatRise: 2.5,
  adaptiveFloor: false, earlyBeat: true, beatTau: 20 })
const speeds = [2, 2, 3, 2.8, 2.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 3, 4, 5, 7, 6.8, 6.25]
const strokes = speeds.map((speed, i) => beat.push(i / 100, speed)).filter(Boolean)
assert.deepEqual(strokes.map(event => [event.t, event.tier]), [[0.02, "weak"], [0.21, "strong"]])

function sparseFist(impact, stop, allowed) {
  const detector = createFistDetector()
  return [[0.99, 0.1, 0], [1, 0.1, 0], [1.05, 5.5, impact], [1.11, stop, 0]]
    .map(([t, speed, acc]) => detector.push(t, [speed, 0, 0], () => allowed, acc)).filter(Boolean)
}
assert.equal(sparseFist(3, 0.5, true)[0]?.tier, "sparse")
assert.equal(sparseFist(25, 0.5, true).length, 0, "a heavy arm swing is not a fist")
assert.equal(sparseFist(3, 4.5, true).length, 0, "an impact without a stop is not a fist")
assert.equal(sparseFist(3, 0.5, false).length, 0, "the lower confidence recovery is restricted to a cutoff")

const history = Array.from({ length: 40 }, (_, i) =>
  ({ t: i * 0.005, up, acc: [0, 0, 9.81 + i / 10], gyr: [1, 0, 2] }))
const features = causalFeatures(history, 0.195)
assert.equal(features.values.length, FEATURE_COUNT)
assert.ok(features.values.every(Number.isFinite))
assert.deepEqual(causalFeatures([...history, { ...history[0], t: 0.2 }], 0.195), features)
assert.deepEqual(causalFeatures(history, 0.195, { t: 0.205, direction: [1, 0] }), features)
const angled = history.map((frame, i) => ({
  ...frame, up: [1 / Math.sqrt(2), 0, 1 / Math.sqrt(2)],
  acc: [4 + i / 8, Math.sin(i / 4), 6], gyr: [1 + i / 14, Math.sin(i / 7), 2 - i / 36],
}))
const rotated = angled.map((frame, i) => {
  const rotate = (v) => {
    const [x, y, z] = frame.up
    const cos = Math.cos(i / 3)
    const sin = Math.sin(i / 3)
    const cross = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]]
    const along = v.reduce((sum, component, axis) => sum + component * frame.up[axis], 0)
    return v.map((component, axis) => cos * component + sin * cross[axis] + (1 - cos) * along * frame.up[axis])
  }
  return { ...frame, acc: rotate(frame.acc), gyr: rotate(frame.gyr) }
})
const previousAngle = causalFeatures(angled, 0.16).direction
const rotatedPrevious = causalFeatures(rotated, 0.16).direction
const originalFeatures = causalFeatures(angled, 0.195, { t: 0.16, direction: previousAngle })
const rotatedFeatures = causalFeatures(rotated, 0.195, { t: 0.16, direction: rotatedPrevious })
for (const [i, value] of originalFeatures.values.entries()) {
  assert.ok(Math.abs(value - rotatedFeatures.values[i]) < 1e-8, `feature ${i} depends on yaw mounting angle`)
}
assert.equal(causalFeatures(history.slice(0, 2), 0.005), null)
const zeros = Array(FEATURE_COUNT).fill(0)
const training = { featureVersion: FEATURE_VERSION, labels: ["ordinary", "up"],
  mean: zeros, scale: Array(FEATURE_COUNT).fill(1), output: { weights: [zeros, zeros], bias: [0, 1] } }
assert.ok(createCausalClassifier(training).predict(features.values).up > 0.7)
assert.ok(createCausalClassifier({ ...training, hidden: { weights: [zeros], bias: [0] },
  output: { weights: [[0], [0]], bias: [0, 2] } }).predict(features.values).up > 0.8)
assert.equal(createCausalClassifier({ ...training, featureVersion: -1 }), null)

{
  const samples = [0, 0.03, 0.06, 0.09, 0.12, 0.15, 0.18, 0.20]
    .map(t => ({ t, up, acc: [0, 0, 9.81 + 10 * t], gyr: [0, 0, 0] }))
  const sequence = causalSequence(samples, 0.2)
  assert.equal(sequence.length, SEQUENCE_STEPS)
  assert.ok(sequence.every(row => row.length === SEQUENCE_CHANNELS))
  assert.ok(Math.abs(sequence[0][0] - 0.2) < 1e-9)
  assert.ok(Math.abs(sequence[1][0] - 0.4) < 1e-9, "resampling interpolates the 20 ms grid")
  assert.ok(Math.abs(sequence.at(-1)[0] - 2) < 1e-9)
  const future = { t: 0.21, up, acc: [0, 0, 1000], gyr: [999, 999, 999] }
  assert.deepEqual(causalSequence([...samples, future], 0.2), sequence)
  assert.deepEqual(causalSequence(samples.filter(f => f.t < 0.04 || f.t >= 0.15), 0.2)[4], Array(6).fill(0))
  assert.equal(causalSequence([future], 0.2), null)
  const axis = value => [value, 0, 0, 0, 0, 0]
  const model = { arch: "cnn", labels: ["ordinary", "up"], sequenceVersion: SEQUENCE_VERSION,
    mean: axis(0), scale: Array(6).fill(1),
    convolutions: [{ weights: [[...axis(1), ...axis(2), ...axis(0)]], bias: [0] },
      { weights: [[1, 2, 0]], bias: [0] }],
    output: { weights: [[0, 0], [0.02, 0.01]], bias: [0, 0] } }
  const cnn = createCausalClassifier(model)
  const output = cnn.predict(Array.from({ length: 10 }, (_, i) => axis(i + 1)))
  const expected = 1 / (1 + Math.exp(-(0.02 * 32.9 + 0.01 * 72)))
  assert.ok(Math.abs(output.up - expected) < 1e-9, "causal padding, dilation, average and last-step pooling agree")
  assert.equal(cnn.predict(Array.from({ length: 10 }, () => axis(-2))).up, 0.5, "negative activations are rectified")
  assert.equal(cnn.predict([axis(0)]), null)
  assert.equal(createCausalClassifier({ ...model, sequenceVersion: -1 }), null)
  assert.ok(createCausalClassifier({ ...training, arch: "linear" }))
}

const health = createCaptureHealth()
const frames = Array.from({ length: 1001 }, (_, i) =>
  ({ timestamp: i * 0.005, receivedMs: i * 5, sequence: i, hand: "left", acc: rest, gyr: bias }))
for (const frame of frames) health.push(frame, frame.receivedMs)
assert.ok(health.status(5000).bias)
assert.equal(health.status(5000).rate, 200)
assert.ok(health.status(5060).maxGapMs > 50)
assert.equal(summarizeCapture(frames, { left: "left" }, 5000).recommendRetry, false)
assert.equal(summarizeCapture(frames.filter(frame => frame.sequence !== 100), { left: "left" }, 5000).streams.left.missing, 1)
health.resetStill()
assert.equal(health.status(5000).bias, null)

const schedule = timedTrials({ count: 32, pattern: ["down", "left", "right", "up"] }, 120)
assert.equal(schedule.length, 32)
assert.deepEqual(schedule.slice(0, 4).map(trial => trial.direction), ["down", "left", "right", "up"])
assert.equal(schedule[1].beatAtMs - schedule[0].beatAtMs, 500)
const aniso = timedTrials({ count: 40, pattern: ["down", "left", "right", "up"], single: true }, 100, () => 0.5)
assert.equal(aniso[1].cueAtMs - aniso[0].beatAtMs, 2000)
assert.equal(aniso.filter(trial => trial.direction === "right").length, 10)

const directory = await mkdtemp(join(tmpdir(), "ringsymphony-capture-test-"))
let middleware
captureStorage(directory).configureServer({ middlewares: { use(fn) { middleware = fn } }, config: { logger: console } })
const server = createServer((req, res) => middleware(req, res, () => res.writeHead(404).end()))
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
try {
  const origin = `http://127.0.0.1:${server.address().port}`
  const url = `${origin}/api/capture`
  const post = record => fetch(url, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(record) })
  const record = { version: 1, kind: "group", id: randomUUID(), startedAt: new Date().toISOString(),
    durationMs: schedule.at(-1).endedAtMs, finishReason: "complete", frames: [], hands: { test: "left" },
    performingHand: "left", exercise: "transition-4beat", bpm: 120, playerId: "test", trials: schedule,
    quality: { recommendRetry: false } }
  const { type: _type, ...wire } = button
  const savedButton = { ...wire, hand: "left", address: "test", receivedMs: 25 }
  let response = await post(record)
  assert.equal(response.status, 201)
  const file = JSON.parse(await readFile(join(directory, (await response.json()).saved), "utf8"))
  assert.equal(file.playerId, "test")
  assert.equal(file.trials[0].beatAtMs, schedule[0].beatAtMs)
  response = await post({ ...record, id: randomUUID(), exercise: "transition-3beat",
    quality: { recommendRetry: true }, buttons: [savedButton] })
  assert.equal(response.status, 201)
  const groupPath = (await response.json()).saved
  assert.match(groupPath, /-check-left-/)
  assert.deepEqual(JSON.parse(await readFile(join(directory, groupPath), "utf8")).buttons, [savedButton])
  response = await post({ ...record, id: randomUUID(), kind: "game", game: { level: { title: "Test" } },
    buttons: [savedButton] })
  assert.equal(response.status, 201)
  const gamePath = (await response.json()).saved
  assert.deepEqual(JSON.parse(await readFile(join(directory, gamePath, "game.json"), "utf8")).buttons, [savedButton])
  response = await post({ ...record, id: randomUUID(), buttons: [{ ...savedButton, hand: "right" }] })
  assert.equal(response.status, 400)
  assert.deepEqual((await (await fetch(url)).json()).completedByMode.left, ["transition-4beat"])
} finally {
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true })
}
console.log("Online bias, clock, direction competition, prep, sparse fist, causal model and capture: pass")
