import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { classifyAbsolute, classifyAbsoluteStroke } from "../src/ring/absolute.js"
import { causalFeatures, createCausalClassifier, FEATURE_COUNT, FEATURE_VERSION } from "../src/ring/causal-classifier.js"
import { createBeatDetector, createFistDetector } from "../src/ring/detectors.js"
import { createRingInput } from "../src/ring/input.js"
import { createClockOffset, createGyroBias } from "../src/ring/signal.js"
import { createCaptureHealth, summarizeCapture } from "../tools/capture-quality.js"
import { timedTrials } from "../tools/capture-metronome.js"
import { captureStorage } from "../tools/capture-storage.mjs"

const up = [0, 0, 1]
const rest = [0, 0, 9.81]
const bias = [0.4, -0.6, 0.3]
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

const beat = createBeatDetector({ beatFloor: 0.65, weakRise: 1.1, beatRise: 2.5,
  adaptiveFloor: false, earlyBeat: true, beatTau: 20 })
const speeds = [2, 2, 3, 2.8, 2.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 3, 4, 5, 7, 6.8, 6.3]
const strokes = speeds.map((speed, i) => beat.push(i / 100, speed)).filter(Boolean)
assert.deepEqual(strokes.map(event => [event.t, event.tier]), [[0.02, "weak"], [0.21, "strong"]])

function sparseFist(impact, stop, allowed) {
  const detector = createFistDetector()
  return [[1, 0.1, 0], [1.05, 5.5, impact], [1.11, stop, 0]]
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
assert.deepEqual(causalFeatures(history, 0.195, { t: 0.205, direction: [0, 0, 1] }), features)
assert.equal(causalFeatures(history.slice(0, 2), 0.005), null)
const zeros = Array(FEATURE_COUNT).fill(0)
const training = { featureVersion: FEATURE_VERSION, labels: ["ordinary", "up"],
  mean: zeros, scale: Array(FEATURE_COUNT).fill(1), output: { weights: [zeros, zeros], bias: [0, 1] } }
assert.ok(createCausalClassifier(training).predict(features.values).up > 0.7)
assert.ok(createCausalClassifier({ ...training, hidden: { weights: [zeros], bias: [0] },
  output: { weights: [[0], [0]], bias: [0, 2] } }).predict(features.values).up > 0.8)
assert.equal(createCausalClassifier({ ...training, featureVersion: -1 }), null)

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
  const record = { version: 1, kind: "group", id: crypto.randomUUID(), startedAt: new Date().toISOString(),
    durationMs: schedule.at(-1).endedAtMs, finishReason: "complete", frames: [], hands: { test: "left" },
    performingHand: "left", exercise: "transition-4beat", bpm: 120, playerId: "test", trials: schedule,
    quality: { recommendRetry: false } }
  let response = await post(record)
  assert.equal(response.status, 201)
  const file = JSON.parse(await readFile(join(directory, (await response.json()).saved), "utf8"))
  assert.equal(file.playerId, "test")
  assert.equal(file.trials[0].beatAtMs, schedule[0].beatAtMs)
  response = await post({ ...record, id: crypto.randomUUID(), exercise: "transition-3beat",
    quality: { recommendRetry: true } })
  assert.equal(response.status, 201)
  assert.match((await response.json()).saved, /-check-left-/)
  assert.deepEqual((await (await fetch(url)).json()).completedByMode.left, ["transition-4beat"])
} finally {
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true })
}
console.log("Online bias, clock, direction competition, prep, sparse fist, causal model and capture: pass")
