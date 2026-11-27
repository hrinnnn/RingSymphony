import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
function motionReplay(rotate) {
  let now = 10
  let held = false
  const motions = []
  const input = createRingInput({ now: () => now, WebSocketImpl: null, boundHands: { left: "L" },
    motionActive: () => held,
    onEvent: event => { if (event.type === "button") held = event.action === "down" },
    onMotion: motion => motions.push(motion) })
  input.feed({ type: "status", rings: [{ address: "L", connected: true }] })
  const feed = (timestamp, extraGyro, sequence, vertical = 0) => {
    now = 10 + timestamp
    input.feed({ type: "imu", address: "L", timestamp, sequence,
      acc: rotate([0, 0, 9.81 + vertical]), gyr: rotate(bias.map((value, i) => value + extraGyro[i])) })
  }
  const zero = [0, 0, 0]
  const press = down => input.feed({ ...button, timestamp: now - 10, event: Number(!down),
    action: down ? "down" : "up", label: down ? "按下" : "松开" })
  for (let i = 0; i <= 200; i++) feed(i * 0.005, zero, i)
  assert.equal(motions.length, 0)
  press(true)
  feed(1.005, zero, 201)
  assert.ok(motions.at(-1).speed < 1e-9, "motion samples use bias-corrected gyro")
  for (let i = 202; i <= 220; i++) feed(i * 0.005, [0, 0, 2], i, 2)
  const upward = motions.at(-1)
  const { hand, address, dt, wYaw, vUp } = upward
  assert.equal(hand, "left")
  assert.equal(address, "L")
  assert.ok(Math.abs(dt - 0.005) < 1e-9 && Math.abs(wYaw - 2) < 0.01 && vUp > 0.15)
  for (let i = 221; i <= 232; i++) feed(i * 0.005, zero, i)
  assert.equal(motions.at(-1).vUp, 0, "stationary motion clears vertical drift")
  feed(1.165, zero, 233, 2)
  press(false)
  press(true)
  feed(1.17, zero, 234)
  assert.ok(Math.abs(motions.at(-1).vUp) < 1e-6,
    `release and repress clears velocity even without an intervening IMU frame: ${JSON.stringify(motions.at(-1))}`)
  for (let i = 235; i <= 250; i++) feed(i * 0.005, zero, i, -2)
  assert.ok(motions.at(-1).vUp < -0.13, "vertical motion does not require rotation")
  feed(1.35, zero, 251)
  assert.equal(motions.at(-1).dt, 0.02, "short gaps cannot multiply a returning gyro sample")
  const beforeReset = motions.length
  feed(1.75, zero, 252)
  assert.equal(motions.length, beforeReset, "long gaps do not move the cursor")
  return upward
}
const referenceMotion = motionReplay(vector => vector)
for (const rotate of [([x, y, z]) => [z, x, y], ([x, y, z]) => [x, -y, -z], ([x, y, z]) => {
  const c = Math.SQRT1_2
  return [x, c * (y - z), c * (y + z)]
}]) {
  const mounted = motionReplay(rotate)
  assert.ok(Math.abs(mounted.wYaw - referenceMotion.wYaw) < 1e-9)
  assert.ok(Math.abs(mounted.vUp - referenceMotion.vUp) < 1e-9)
}
{
  function previewStroke(cueDirection) {
    let now = 10
    const previews = []
    const events = []
    const input = createRingInput({ now: () => now, WebSocketImpl: null, boundHands: { left: "L" },
      previewDue: (_hand, _age, direction) => cueDirection === direction,
      onPreview: event => previews.push({ ...event, at: now }),
      onEvent: ({ timing: _timing, ...event }) => events.push(event) })
    input.feed({ type: "status", rings: [{ address: "L", connected: true }] })
    for (let i = 0; i < 200; i++) {
      const timestamp = i * 0.005
      now = 10 + timestamp
      const speed = i >= 100 && i <= 136 ? Math.sin((i - 100) * Math.PI / 36) * 4 : 0
      input.feed({ type: "imu", address: "L", timestamp, sequence: i, acc: rest, gyr: [0, 0, speed] })
    }
    return { previews, events }
  }
  const uncued = previewStroke("right")
  const cued = previewStroke("left")
  assert.equal(cued.previews[0].dir, "left")
  assert.ok(cued.previews[0].at < uncued.previews[0].at)
  assert.ok(uncued.events.some(event => event.type === "beat"))
  assert.deepEqual(cued.events, uncued.events, "preview eligibility never changes scored events")
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
  assert.ok(createCausalClassifier({ ...model, labels: ["ordinary", "return"] }))
}

const health = createCaptureHealth()
const frames = Array.from({ length: 1001 }, (_, i) =>
  ({ timestamp: i * 0.005, receivedMs: i * 5, sequence: i, hand: "left", acc: rest, gyr: bias }))
for (const frame of frames) health.push(frame, frame.receivedMs)
assert.ok(health.status(5000).bias)
assert.ok(Math.abs(health.status(5000).deviceRateHz - 200) < 1e-9)
assert.equal(health.status(5000).receiveRateHz, 200)
assert.equal(health.status(5060).receiveMaxGapMs, 60)
assert.equal(health.status(5060).deviceGaps, 0)
const summarize = rows => summarizeCapture(rows, { left: "left" }, 5000)
assert.equal(summarize(frames).tier, "realtime")
const jittered = frames.map(frame => frame.receivedMs >= 500 && frame.receivedMs < 590
  ? { ...frame, receivedMs: 590 } : frame)
const liveJitter = createCaptureHealth()
for (const frame of jittered) liveJitter.push(frame, frame.receivedMs)
const live = liveJitter.status(5000)
assert.ok(live.bias, "transport jitter does not reset stationary device sampling")
assert.equal(live.deviceGaps, 0)
assert.equal(live.receiveMaxGapMs, 95)
const offline = summarize(jittered)
assert.equal(offline.tier, "offline")
assert.equal(offline.recommendRetry, false)
assert.equal(offline.streams.left.receiveGaps, 1)
assert.equal(offline.streams.left.missing, 0)
const missing = summarize(frames.filter(frame => frame.sequence !== 100))
assert.equal(missing.tier, "retry")
assert.equal(missing.streams.left.missing, 1)
const deviceGap = summarize(frames.map(frame => frame.sequence >= 100 ? { ...frame, timestamp: frame.timestamp + 0.1 } : frame))
assert.equal(deviceGap.tier, "retry")
assert.equal(deviceGap.streams.left.deviceGaps, 1)
assert.equal(deviceGap.streams.left.receiveGaps, 0)
const reset = summarize(frames.map(frame => frame.sequence >= 100 ? { ...frame, timestamp: frame.timestamp - 0.5 } : frame))
assert.equal(reset.tier, "retry")
assert.equal(reset.streams.left.clockResets, 1)
assert.equal(summarize(frames.map(frame => ({ ...frame, timestamp: frame.timestamp * 2 }))).tier, "retry")
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
const configure = () => captureStorage(directory).configureServer({
  middlewares: { use(fn) { middleware = fn } }, config: { logger: console },
})
configure()
const server = createServer((req, res) => middleware(req, res, () => res.writeHead(404).end()))
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
try {
  const fixture = async (exercise, pulses, trials) => {
    const path = join(directory, `${exercise}.json`)
    const frames = Array.from({ length: 501 }, (_, sequence) => {
      const receivedMs = sequence * 5
      const speed = pulses.reduce((sum, [center, amplitude]) =>
        sum + amplitude * Math.max(0, 1 - Math.abs(receivedMs - center) / 25), 0)
      return { address: "test", timestamp: receivedMs / 1000, receivedMs, acc: rest, gyr: [0, 0, speed] }
    })
    await writeFile(path, JSON.stringify({ kind: "group", finishReason: "complete", playerId: "P01",
      exercise, performingHand: "right", hands: { test: "right" }, frames, trials }))
    return JSON.parse(execFileSync(process.execPath, ["tools/causal-samples.mjs", path, "--sequence"], { encoding: "utf8" })).data
  }
  const single = await fixture("beat-natural", [[500, 5], [680, -6], [810, -3], [1600, 5], [1900, 4]],
    [{ shownAtMs: 420, endedAtMs: 640 }, { shownAtMs: 1490, endedAtMs: 1750 }])
  assert.deepEqual(single.map(row => row.label), ["return"], "only a clear reversal 220–500 ms after a beat is a return")
  assert.equal(single[0].sequence.length, SEQUENCE_STEPS)
  assert.ok(single[0].sequence.at(-1)[2] < 0, "return features end at the reverse peak")
  const tempo = await fixture("transition-4beat", [[500, 5], [790, -3], [1000, -6], [1500, 6]],
    [{ beatAtMs: 500, direction: "left" }, { beatAtMs: 1000, direction: "right" }, { beatAtMs: 1500, direction: "left" }])
  assert.deepEqual(tempo.map(row => row.label), ["left", "return", "right", "left"], "the next target beat cannot be used as a return")

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
  const firstSave = await response.json()
  const file = JSON.parse(await readFile(join(directory, firstSave.saved), "utf8"))
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
  const retake = (overrides = {}) => post({ ...record, id: randomUUID(),
    startedAt: new Date(Date.parse(record.startedAt) + 1000).toISOString(), ...overrides })
    .then(async response => {
      assert.equal(response.status, 201)
      return response.json()
    })
  await retake({ playerId: "P02" })
  await retake({ bpm: 80, trials: timedTrials({ count: 32, pattern: ["down", "left", "right", "up"] }, 80) })
  await retake({ performingHand: "right", hands: { test: "right" } })
  await retake({ wearNote: "旋转 90 度" })
  const latest = await retake({ quality: { tier: "offline", recommendRetry: false } })
  assert.equal((await retake({ finishReason: "stopped" })).completedGroup, null)
  assert.equal((await retake({ quality: { tier: "retry", recommendRetry: true } })).completedGroup, null)
  assert.equal((await retake({ quality: undefined })).completedGroup, null)
  assert.equal((await retake({ plannedCount: schedule.length + 1 })).completedGroup, null)
  configure()
  const { completedGroups } = await (await fetch(url)).json()
  assert.deepEqual(new Set(completedGroups.map(group => JSON.stringify([
    group.playerId, group.exercise, group.performingHand, group.bpm, group.wearNote,
  ]))), new Set([
    ["test", "transition-4beat", "left", 120, ""],
    ["P02", "transition-4beat", "left", 120, ""],
    ["test", "transition-4beat", "left", 80, ""],
    ["test", "transition-4beat", "right", 120, ""],
    ["test", "transition-4beat", "left", 120, "旋转 90 度"],
  ].map(item => JSON.stringify(item))))
  assert.equal(completedGroups.length, 5)
  assert.ok(completedGroups.some(group => group.file === latest.saved))
  assert.ok(!completedGroups.some(group => group.file === firstSave.saved))
  assert.deepEqual(JSON.parse(await readFile(join(directory, firstSave.saved), "utf8")), file)
} finally {
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true })
}
console.log("Online bias, clock, direction competition, prep, sparse fist, causal model and capture: pass")
