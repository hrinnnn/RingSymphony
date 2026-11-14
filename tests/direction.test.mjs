import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createHandDetector } from "../src/ring/detectors.js"
import { CALIBRATION_VERSION, createDirectionCalibration, createReturnFilter, directionFeature, directionFeatureResult } from "../src/ring/direction.js"
import { createRingInput } from "../src/ring/input.js"

const calibration = createDirectionCalibration()
const vectors = { down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0] }
for (const [direction, feature] of Object.entries(vectors)) {
  for (let i = 0; i < 3; i += 1) {
    calibration.arm(direction, "A", 0)
    assert.equal(calibration.capture(feature, "A", 0.5, -0.1), false, "a peak before calibration must not capture")
    assert.equal(calibration.capture(feature, "B", 2), false, "other ring must not be captured")
    assert.equal(calibration.capture(feature, "A", 2, -0.1), false, "a peak before calibration must not be captured")
    assert.equal(calibration.capture(feature, "A", 2), true)
  }
}
assert.equal(calibration.status(2).ready, true)
for (const [direction, feature] of Object.entries(vectors)) {
  assert.equal(calibration.classify(feature, "A"), direction)
}
assert.equal(calibration.classify([Math.SQRT1_2, Math.SQRT1_2, 0], "A"), null, "ambiguous directions are rejected")
assert.equal(calibration.classifyDetailed([Math.SQRT1_2, Math.SQRT1_2, 0], "A").reason, "与校准动作差异过大")
assert.equal(calibration.classifyDetailed([0, 0, 1], "A").reason, "与校准动作差异过大")
assert.equal(calibration.classify(vectors.up, "B"), null, "calibration belongs to one ring")
calibration.arm("up", "A", 10)
assert.equal(calibration.status(26).pending, null, "calibration times out")
assert.equal(calibration.status(26).ready, false, "recalibrating a direction clears its old samples")

const similar = createDirectionCalibration()
for (const direction of Object.keys(vectors)) {
  for (let i = 0; i < 3; i += 1) {
    similar.arm(direction, "A", 0)
    similar.capture(direction === "up" ? vectors.down : vectors[direction], "A", 2)
  }
}
assert.equal(similar.status(2).ready, false, "indistinguishable directions cannot complete calibration")
assert.match(similar.status(2).message, /相似/)

const broken = Array.from({ length: 30 }, (_, i) => ({ t: i * 0.005 + (i >= 15 ? 0.1 : 0), gyr: [1, 0, 0] }))
assert.equal(directionFeature(broken, broken.at(-1).t), null, "do not classify a window spanning a gap")
assert.equal(directionFeatureResult(broken, broken.at(-1).t).reason, "数据不足或断帧")
const complete = Array.from({ length: 31 }, (_, i) => ({ t: i * 0.005, gyr: [1, 0, 0] }))
const shortGap = complete.filter((_, i) => i < 10 || i > 19)
assert.deepEqual(directionFeatureResult(shortGap, 0.15).feature, [1, 0, 0], "one 55 ms gap is tolerated when enough data remains")
assert.equal(directionFeatureResult(shortGap, 0.15).hasGap, true)
assert.equal(directionFeatureResult(complete, 0.15).hasGap, false)
const multipleGaps = complete.filter((_, i) => !((i >= 5 && i <= 10) || (i >= 19 && i <= 24)))
assert.equal(directionFeature(multipleGaps, 0.15), null, "multiple gaps cannot be classified")
const sparse = complete.filter((_, i) => i >= 2 && (i < 5 || i > 16))
assert.equal(directionFeature(sparse, 0.15), null, "a short gap with insufficient observed coverage is rejected")
const reversed = [...complete]
reversed[10] = { ...reversed[10], t: reversed[9].t }
assert.equal(directionFeature(reversed, 0.15), null, "non-increasing timestamps are rejected")
const weak = Array.from({ length: 31 }, (_, i) => ({ t: i * 0.005, gyr: [0.1, 0, 0] }))
assert.equal(directionFeatureResult(weak, 0.15).reason, "方向信号过弱或相互抵消")

// These isolated candidate strokes are chosen for a reproducible smoke test, not ground-truth labels:
// each recording also contains return strokes and does not provide per-stroke annotations.
const files = {
  up: ["上", [6.01, 6.94, 7.84], [8.75, 9.64]],
  down: ["下", [1.93, 2.73, 3.57], [4.38, 5.19]],
  left: ["左", [1.59, 2.33, 3.06], [3.79, 4.52]],
  right: ["右", [1.63, 2.39, 3.07], [3.85, 4.49]],
}
const recordings = {}
const framesByDirection = {}
for (const [direction, [name]] of Object.entries(files)) {
  const raw = JSON.parse(await readFile(new URL(`../recordings/方向/${name}.json`, import.meta.url), "utf8"))
  framesByDirection[direction] = raw
  let detector = createHandDetector("right")
  const history = []
  const events = []
  for (let i = 0; i < raw.t.length; i += 1) {
    const t = raw.t[i]
    if (i && t - raw.t[i - 1] > 0.05) {
      detector = createHandDetector("right")
      history.length = 0
    }
    history.push({ t, gyr: raw.gyr[i] })
    while (history.length && history[0].t < t - 0.8) history.shift()
    for (const event of detector.push({ t, acc: raw.acc[i], gyr: raw.gyr[i] })) {
      if (event.type === "beat") events.push({ t: event.t, feature: directionFeature(history, event.t) })
    }
  }
  recordings[direction] = events
}
function featureAt(direction, time) {
  const event = recordings[direction].find((item) => Math.abs(item.t - time) < 0.03)
  assert.ok(event?.feature, `${direction} sample near ${time}s`)
  return event.feature
}
const recorded = createDirectionCalibration()
for (const [direction, [, train]] of Object.entries(files)) {
  for (const time of train) {
    recorded.arm(direction, "recording", 0)
    recorded.capture(featureAt(direction, time), "recording", 2)
  }
}
assert.equal(recorded.status(2).ready, true)
const returnFilter = createReturnFilter()
const filteredUp = recordings.up.filter((event) => {
  const direction = recorded.classify(event.feature, "recording")
  return !direction || returnFilter.accept(event.feature, event.t)
})
for (const time of [6.35, 7.31, 8.21]) {
  assert.ok(recordings.up.some((event) => Math.abs(event.t - time) < 0.03), `up recording has candidate return near ${time}s`)
  assert.ok(!filteredUp.some((event) => Math.abs(event.t - time) < 0.03), `candidate return near ${time}s is suppressed`)
}
for (const time of [6.01, 6.94, 7.84]) {
  assert.ok(filteredUp.some((event) => Math.abs(event.t - time) < 0.03), `up candidate at ${time}s is retained`)
}
const filter = createReturnFilter()
assert.equal(filter.accept(vectors.up, 1), true)
assert.equal(filter.accept(vectors.down, 1.37), false, "near-immediate reverse rotation is suppressed")
assert.equal(filter.accept(vectors.down, 1.5), true, "a later opposite stroke is retained")
assert.equal(filter.accept(vectors.left, 1.87), true, "a different stroke within the window is retained")
filter.reset()
assert.equal(filter.accept(vectors.right, 1.9), true, "reset clears the previous stroke")
filter.reset()
filter.accept(vectors.left, 1)
assert.equal(filter.isReturn([0.75, 0.66, 0], 1.3), false, "a loosely opposite stroke is not a return at the strict threshold")
assert.equal(filter.isReturn([0.75, 0.66, 0], 1.3, -0.5), true, "but is one at the looser preview threshold")
assert.equal(filter.isReturn(vectors.right, 1.3), true, "an unclassified opposite stroke is detected as a return")
assert.equal(filter.isReturn(vectors.right, 1.3, -0.5), true)
assert.equal(filter.isReturn(vectors.right, 1.6), false, "a return outside the window is allowed")
assert.equal(filter.isReturn(vectors.left, 1.3), false, "the same direction is not a return")
for (const [direction, [, , test]] of Object.entries(files)) {
  for (const time of test) {
    assert.equal(recorded.classify(featureAt(direction, time), "recording"), direction, `${direction} candidate at ${time}s`)
  }
}
// Remove a packet-sized span before each held-out candidate and replay the actual detector path.
for (const [direction, [, , [time]]] of Object.entries(files)) {
  const raw = framesByDirection[direction]
  const detector = createHandDetector("right")
  const history = []
  const events = []
  let lastTime = null
  for (let i = 0; i < raw.t.length; i += 1) {
    const t = raw.t[i]
    if (t < time - 1 || t > time + 0.3 || (t > time - 0.115 && t <= time - 0.065)) continue
    if (lastTime !== null && (t <= lastTime || t - lastTime > 0.065)) {
      detector.gap()
      history.length = 0
    }
    lastTime = t
    history.push({ t, gyr: raw.gyr[i] })
    for (const event of detector.push({ t, acc: raw.acc[i], gyr: raw.gyr[i] })) {
      if (event.type === "beat") events.push({ t: event.t, dir: recorded.classify(directionFeature(history, event.t), "recording") })
    }
  }
  assert.ok(events.some((event) => Math.abs(event.t - time) < 0.03 && event.dir === direction),
    `${direction} candidate remains classified after a packet-sized gap`)
}
console.log("Direction: calibration, ambiguity, gaps, and separate candidate strokes from four recordings pass")

// Exercise the real input path: guided calibration consumes IMU frames, then a later stroke emits its direction.
let clock = 100
let sequence = 0
const emitted = []
const hub = createRingInput({
  now: () => clock,
  onEvent: (event) => emitted.push(event),
  WebSocketImpl: null,
  storage: { getItem: () => null, setItem() {} },
})
hub.feed({ type: "status", rings: [{ address: "A", name: "test", connected: true }] })
function frame(acc, gyr) {
  hub.feed({ type: "imu", address: "A", timestamp: clock, sequence: sequence++, acc, gyr })
  clock += 0.005
}
function still(seconds) {
  for (let i = 0; i < seconds * 200; i += 1) frame([0, 0, 9.81], [0, 0, 0])
}
function stroke(direction, time, calibrating = false) {
  const raw = framesByDirection[direction]
  let armed = false
  for (let i = 0; i < raw.t.length; i += 1) {
    if (raw.t[i] < time - 1.4 || raw.t[i] > time + 0.35) continue
    if (calibrating && !armed && raw.t[i] >= time - 0.2) {
      hub.calibrate(direction)
      armed = true
    }
    frame(raw.acc[i], raw.gyr[i])
  }
  assert.ok(!calibrating || armed)
}
still(1)
for (const [direction, [, train]] of Object.entries(files)) {
  const examples = direction === "up" ? [8.75, 9.64, 10.61] : train
  for (const [index, time] of examples.entries()) {
    stroke(direction, time, true)
    assert.equal(hub.snapshot().direction.counts[direction], index + 1, `${direction} calibration via IMU: ${hub.snapshot().direction.message}`)
    still(1)
  }
}
assert.equal(hub.snapshot().direction.ready, true, hub.snapshot().direction.message)
emitted.length = 0
stroke("left", 3.79)
assert.ok(emitted.some((event) => event.type === "beat" && event.dir === "left"), "later IMU stroke emits its classified direction")
still(1)
emitted.length = 0
const upRecording = framesByDirection.up
for (let i = 0; i < upRecording.t.length; i += 1) {
  if (upRecording.t[i] >= 6.65 && upRecording.t[i] <= 7.55) frame(upRecording.acc[i], upRecording.gyr[i])
}
assert.deepEqual(emitted.filter((event) => event.type === "beat").map((event) => event.dir), ["up"], "input suppresses the recorded fast return without emitting an opposite beat")
hub.feed({ type: "status", rings: [{ address: "A", name: "test", connected: false }] })
assert.equal(hub.snapshot().direction.ready, false, "disconnect invalidates calibration")
// Left-hand palm calibration is independent of right-hand direction calibration.
let palmClock = 1200
let palmDevice = 0
let palmSequence = 0
const palmEvents = []
const palms = createRingInput({
  now: () => palmClock,
  onEvent: (event) => palmEvents.push(event),
  WebSocketImpl: null,
  storage: { getItem: () => null, setItem() {} },
})
palms.feed({ type: "status", rings: [{ address: "L", connected: true }] })
function palmFrame(az) {
  palms.feed({ type: "imu", address: "L", timestamp: palmDevice, sequence: palmSequence++, acc: [0, 0, az], gyr: [0, 0, 0] })
  palmClock += 0.005
  palmDevice += 0.005
}
function palmStill(seconds) {
  for (let i = 0; i < seconds * 200; i += 1) palmFrame(9.81)
}
function palmStroke(az) {
  for (let i = 0; i < 60; i += 1) palmFrame(az)
  palmStill(1.1)
}
palmStill(0.6)
palms.setRole("L", "left")
palms.startPalmCalibration()
assert.equal(palms.snapshot().direction.ready, false, "left calibration can start before right direction calibration")
for (let i = 0; i < 3; i += 1) {
  palmStroke(13.81)
  assert.equal(palms.snapshot().palmCalibration.counts.up, i + 1, "left calibration captures upward palms")
}
for (let i = 0; i < 3; i += 1) {
  palmStroke(5.81)
  assert.equal(palms.snapshot().palmCalibration.counts.down, i + 1, "left calibration captures downward palms")
}
assert.equal(palms.snapshot().palmCalibration.ready, true, "left calibration completes independently")
assert.equal(palmEvents.filter((event) => event.type === "palm").length, 0, "calibration gestures do not leak into gameplay")
palmStroke(13.81)
palmStroke(5.81)
assert.deepEqual(palmEvents.filter((event) => event.type === "palm").map((event) => event.dir), ["up", "down"])
console.log("Direction: real input stream calibration and classified beat pass")

// Gentle strokes immediately after clicking must be captured and remain detectable in play.
let wall = 200
let device = 0
let seq = 0
const gentleEvents = []
const gentlePreviews = []
const gentle = createRingInput({
  now: () => wall,
  onEvent: (event) => gentleEvents.push(event),
  onPreview: (event) => gentlePreviews.push({ ...event, eventCount: gentleEvents.length, ready: gentle.snapshot().direction.ready }),
  WebSocketImpl: null,
  storage: { getItem: () => null, setItem() {} },
})
gentle.feed({ type: "status", rings: [{ address: "G", connected: true }] })
function gentleFrame(gyr = [0, 0, 0]) {
  gentle.feed({ type: "imu", address: "G", timestamp: device, sequence: seq++, acc: [0, 0, 9.81], gyr })
  wall += 0.005
  device += 0.005
}
function gentleStill() {
  for (let i = 0; i < 100; i += 1) gentleFrame()
}
function gentleStroke(vector, skip = () => false) {
  for (let i = 0; i <= 60; i += 1) {
    const speed = 1.25 * Math.sin(Math.PI * i / 60)
    if (skip(i)) {
      wall += 0.005
      device += 0.005
    } else gentleFrame(vector.map((value) => value * speed))
  }
}
gentleStill()
for (const [direction, vector] of Object.entries(vectors)) {
  for (let i = 0; i < 3; i += 1) {
    gentle.calibrate(direction)
    // Simulate a change in arrival latency: calibration is gated by device timestamps, not the clock offset estimate.
    if (direction === "down" && i === 0) wall += 1.5
    gentleStroke(vector)
    assert.equal(gentle.snapshot().direction.counts[direction], i + 1, gentle.snapshot().direction.message)
    gentleStill()
  }
}
assert.ok(gentlePreviews.every((preview) => preview.ready), "previews are suppressed until calibration is complete")
assert.equal(gentle.snapshot().direction.ready, true, gentle.snapshot().direction.message)
gentleEvents.length = 0
gentlePreviews.length = 0
gentleStroke(vectors.left)
assert.ok(gentleEvents.some((event) => event.type === "beat" && event.dir === "left"), "calibrated gentle stroke must also work in play")
assert.ok(gentlePreviews.some((preview) => preview.dir === "left" && preview.eventCount === 0), "visual preview arrives before the confirmed beat")
assert.equal(gentleEvents.filter((event) => event.type === "beat").length, 1, "previews never generate scoring events")
gentleStill()
gentle.clearDirectionStats()
gentleEvents.length = 0
gentleStroke(vectors.left, (i) => i >= 19 && i <= 28)
assert.deepEqual(gentleEvents.filter((event) => event.type === "beat").map((event) => event.dir), ["left"], "an in-progress stroke survives a 55 ms gap")
assert.equal(gentle.snapshot().directionStats.accepted, 1)
gentleStill()
gentleStroke([0, 0, 1])
assert.equal(gentle.snapshot().directionStats.mismatch, 1, "an intact but unmatched direction is counted separately")
gentleStill()
gentleStroke([0, 0, 1], (i) => i >= 19 && i <= 28)
assert.equal(gentle.snapshot().directionStats.mismatchGap, 1, "unmatched directions spanning a gap are counted separately")
gentle.clearDirectionStats()
assert.ok(Object.values(gentle.snapshot().directionStats).every((value) => value === 0))
gentleStill()
device += 0.1
gentleFrame()
for (const speed of [1, 2, 3, 2, 1, 0]) gentleFrame([speed, 0, 0])
assert.equal(gentle.snapshot().directionStats.data, 1, "a beat without enough post-gap history is counted as insufficient data")
assert.equal(gentleEvents.at(-1).dir, null, "insufficient data cannot produce a direction")
gentleStill()
device += 0.1
gentleFrame()
gentleStill()
gentleEvents.length = 0
gentleStroke(vectors.right)
assert.ok(gentleEvents.some((event) => event.type === "beat" && event.dir === "right"), "calibrated sensitivity survives a short data gap")
device = 0
gentleFrame()
assert.equal(gentle.snapshot().direction.ready, false, "device clock restart invalidates calibration")
console.log("Direction: immediate gentle strokes, latency, gaps and clock restart pass")

// One-click calibration requires stillness between strokes so fast returns cannot become the next sample.
let autoClock = 500
let autoSeq = 0
const autoEvents = []
const auto = createRingInput({
  now: () => autoClock,
  onEvent: (event) => autoEvents.push(event),
  WebSocketImpl: null,
  storage: { getItem: () => null, setItem() {} },
})
auto.feed({ type: "status", rings: [{ address: "R", connected: true }] })
function autoFrame(gyr = [0, 0, 0]) {
  const bias = [0.28, -0.76, -0.08]
  auto.feed({ type: "imu", address: "R", timestamp: autoSeq * 0.005, sequence: autoSeq, acc: [0, 0, 9.81], gyr: gyr.map((value, axis) => value + bias[axis]) })
  autoSeq += 1
  autoClock += 0.005
}
function autoStill(seconds) {
  for (let i = 0; i < seconds * 200; i += 1) autoFrame()
}
function autoStroke(vector) {
  for (let i = 0; i <= 60; i += 1) {
    const speed = 1.25 * Math.sin(Math.PI * i / 60)
    autoFrame(vector.map((value) => value * speed))
  }
}
autoStill(1)
auto.startAutomaticCalibration()
autoStill(0.2)
autoSeq += 10
autoClock += 0.05
autoStill(0.6)
assert.equal(auto.snapshot().direction.pending, "down", "a short data gap does not prevent offset-aware settling")
for (const direction of ["down", "left", "right", "up"]) {
  for (let i = 0; i < 3; i += 1) {
    autoStill(0.8)
    assert.equal(auto.snapshot().direction.pending, direction, `automatic calibration prompts ${direction}`)
    autoStroke(vectors[direction])
    assert.equal(auto.snapshot().direction.counts[direction], i + 1)
    autoStroke(vectors[direction].map((value) => -value))
    assert.equal(auto.snapshot().direction.counts[direction], i + 1, "fast return is not captured as the next example")
  }
}
assert.equal(auto.snapshot().automaticCalibration.active, false)
assert.equal(auto.snapshot().direction.ready, true, auto.snapshot().direction.message)
autoStill(1)
autoEvents.length = 0
autoStroke(vectors.right)
assert.ok(autoEvents.some((event) => event.type === "beat" && event.dir === "right"), "automatic calibration works for gameplay")

assert.throws(() => auto.startDirectionRerecord("invalid"), /无效/)
auto.startDirectionRerecord("left")
assert.deepEqual(auto.snapshot().direction.counts, { down: 3, left: 0, right: 3, up: 3 }, "supplemental recording replaces only the selected direction")
assert.equal(auto.snapshot().direction.ready, false, "incomplete replacement cannot be used for gameplay")
assert.throws(() => auto.startAutomaticCalibration(), /请先停止/)
for (let i = 0; i < 3; i += 1) {
  autoStill(0.8)
  assert.equal(auto.snapshot().direction.pending, "left")
  autoStroke(vectors.left)
  assert.equal(auto.snapshot().direction.counts.left, i + 1)
  autoStroke(vectors.right)
}
assert.equal(auto.snapshot().automaticCalibration.active, false, "supplemental recording stops after the chosen direction")
assert.equal(auto.snapshot().direction.ready, true)
assert.deepEqual(auto.snapshot().direction.counts, { down: 3, left: 3, right: 3, up: 3 })
auto.startDirectionRerecord("up")
autoStill(0.8)
autoStroke(vectors.up)
auto.stopAutomaticCalibration()
assert.equal(auto.snapshot().direction.counts.up, 1)
auto.startAutomaticCalibration()
autoStill(0.8)
assert.equal(auto.snapshot().direction.pending, "up", "interrupted supplemental recording can be resumed from the main flow")
assert.equal(auto.snapshot().direction.counts.left, 3)
auto.stopAutomaticCalibration()

auto.resetDirection()
auto.startAutomaticCalibration()
autoStill(0.8)
autoStill(15.1)
assert.equal(auto.snapshot().automaticCalibration.active, false, "automatic calibration stops after an action timeout")
assert.match(auto.snapshot().automaticCalibration.message, /未检测到/)
auto.startAutomaticCalibration()
autoStill(0.8)
autoStroke(vectors.down)
assert.equal(auto.snapshot().direction.counts.down, 1)
auto.stopAutomaticCalibration()
assert.equal(auto.snapshot().automaticCalibration.active, false)
assert.equal(auto.snapshot().direction.pending, null)
auto.startAutomaticCalibration()
autoStill(0.8)
assert.equal(auto.snapshot().direction.pending, "down", "resuming continues the partially completed direction")
assert.equal(auto.snapshot().direction.counts.down, 1, "resuming retains earlier samples")
auto.feed({ type: "status", rings: [{ address: "R", connected: false }] })
assert.equal(auto.snapshot().automaticCalibration.active, false)
assert.match(auto.snapshot().automaticCalibration.message, /停止/)
console.log("Direction: one-click calibration, fast returns, timeout and disconnect pass")

// An unrelated ring's timestamp gap must not reset right-hand settling.
let dualClock = 800
let rightSeq = 0
let leftSeq = 0
const dual = createRingInput({
  now: () => dualClock,
  WebSocketImpl: null,
  storage: { getItem: () => null, setItem() {} },
})
dual.feed({ type: "status", rings: [{ address: "A", connected: true }, { address: "B", connected: true }] })
function dualFrame(address, time, sequence) {
  dual.feed({ type: "imu", address, timestamp: time, sequence, acc: [0, 0, 9.81], gyr: [0.28, -0.76, -0.08] })
}
for (let i = 0; i < 120; i += 1) {
  dualFrame("A", rightSeq * 0.005, rightSeq++)
  dualFrame("B", leftSeq * 0.005, leftSeq++)
  dualClock += 0.005
}
dual.startAutomaticCalibration()
for (let i = 0; i < 170; i += 1) {
  dualFrame("A", rightSeq * 0.005, rightSeq++)
  if (i % 40 === 0) leftSeq += 11
  dualFrame("B", leftSeq * 0.005, leftSeq++)
  dualClock += 0.005
}
assert.equal(dual.snapshot().direction.pending, "down", "left-hand data gaps do not block right-hand calibration")

// Two consistent waves and one outlier must still yield a usable direction: with only three
// samples and no outlier rejection, one slip drags the centroid and fails the good samples too.
{
  const cal = createDirectionCalibration()
  const good = [0, 0, 1]
  const outlier = [0, 1, 0]
  cal.arm("down", "AA", 0); cal.capture(good, "AA", 0.1)
  cal.arm("down", "AA", 1); cal.capture(good, "AA", 1.1)
  cal.arm("down", "AA", 2); cal.capture(outlier, "AA", 2.1)
  assert.equal(cal.status(3).perDirection.down.valid, true, "two agreeing samples must survive one outlier")
}

// Three mutually inconsistent waves have no majority and must still be rejected.
{
  const cal = createDirectionCalibration()
  const samples = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  samples.forEach((sample, i) => { cal.arm("down", "AA", i); cal.capture(sample, "AA", i + 0.1) })
  assert.equal(cal.status(4).perDirection.down.valid, false, "three disagreeing samples must not pass")
}

console.log("Direction: outlier tolerance pass")

// A round trip restores a working calibration, so a refresh or reconnect does not cost one.
{
  const cal = createDirectionCalibration()
  const vecs = { down: [0, 0, 1], left: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] }
  for (const [dir, vec] of Object.entries(vecs)) {
    for (let i = 0; i < 3; i += 1) { cal.arm(dir, "AA", i); cal.capture(vec, "AA", i + 0.1, i + 0.1, 2) }
  }
  const saved = cal.serialise("right")
  const fresh = createDirectionCalibration()
  assert.deepEqual(fresh.restore(saved, "AA", "right"), { ok: true, gyroBias: null })
  assert.equal(fresh.status(0).ready, true, fresh.status(0).message)
  assert.equal(fresh.classify([0, 0, 1], "AA"), "down", "a restored calibration must classify")
}

// The gyro bias travels with the calibration. Templates are built from bias-corrected readings, so
// restoring them without it compares corrected templates against uncorrected features - and the
// panel would say 校准完成 while direction detection quietly degraded. Measured on recordings/方向
// the bias is ~0.78 rad/s, which tilts a 1.5 rad/s stroke's feature by up to 27 degrees, against a
// 36.9 degree accept threshold and only 39 degrees between `up` and `right`.
{
  const cal = createDirectionCalibration()
  const vecs = { down: [0, 0, 1], left: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] }
  for (const [dir, vec] of Object.entries(vecs)) {
    for (let i = 0; i < 3; i += 1) { cal.arm(dir, "AA", i); cal.capture(vec, "AA", i + 0.1, i + 0.1, 2) }
  }
  const bias = [0.26, -0.72, -0.09]
  const fresh = createDirectionCalibration()
  assert.deepEqual(fresh.restore(cal.serialise("right", bias), "AA", "right"), { ok: true, gyroBias: bias })
  // A stored calibration from before the bias was saved restores without one rather than failing:
  // the templates are still usable, and the next calibration will supply it.
  const older = cal.serialise("right")
  delete older.gyroBias
  assert.deepEqual(createDirectionCalibration().restore(older, "AA", "right"), { ok: true, gyroBias: null })
  // A malformed bias is ignored, never applied.
  assert.deepEqual(createDirectionCalibration().restore({ ...cal.serialise("right"), gyroBias: [1, 2] }, "AA", "right"), { ok: true, gyroBias: null })
  assert.deepEqual(createDirectionCalibration().restore({ ...cal.serialise("right"), gyroBias: "x" }, "AA", "right"), { ok: true, gyroBias: null })
}

// Malformed, stale or mismatched stored calibration must be refused, not loaded.
{
  const cal = createDirectionCalibration()
  const body = { version: CALIBRATION_VERSION, address: "AA", hand: "right", samples: {}, speeds: {} }
  const refused = (data, why) => assert.equal(cal.restore(data, "AA", "right").ok, false, why)
  refused({ ...body, version: 99 }, "wrong version")
  // Version 1 predates the stored gyro bias. Loading it would restore templates built from
  // bias-corrected readings with no bias to correct the live feed by, which is the failure this
  // version bump exists to prevent - so it is refused and the player recalibrates once.
  refused({ ...body, version: 1 }, "calibration from before the bias was stored")
  refused({ ...body, address: "BB" }, "wrong ring")
  refused({ ...body, hand: "left" }, "wrong hand")
  refused(null, "missing")
  refused({ ...body, samples: "garbage" }, "malformed samples")
  refused({ ...body, samples: { down: [[1, 0]] } }, "malformed vector")
  assert.equal(cal.status(0).ready, false, "a refused restore must leave the calibration empty")
}

console.log("Direction: persistence pass")

// End to end: a calibration completed in one session is still there after a reload, and a
// deliberate reset clears it for good.
{
  const store = {}
  const storage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v }, removeItem: (k) => { delete store[k] } }
  const session = () => {
    let wall = 200
    let device = 0
    let seq = 0
    const input = createRingInput({ now: () => wall, onEvent: () => {}, onPreview: () => {}, WebSocketImpl: null, storage })
    input.feed({ type: "status", rings: [{ address: "G", connected: true }] })
    const frame = (gyr = [0, 0, 0]) => {
      input.feed({ type: "imu", address: "G", timestamp: device, sequence: seq++, acc: [0, 0, 9.81], gyr })
      wall += 0.005
      device += 0.005
    }
    const still = () => { for (let i = 0; i < 100; i += 1) frame() }
    const stroke = (v) => { for (let i = 0; i <= 60; i += 1) frame(v.map((x) => x * 1.25 * Math.sin(Math.PI * i / 60))) }
    return { input, still, stroke }
  }
  const vecs = { down: [0, 0, 1], left: [0, 1, 0], right: [1, 0, 0], up: [0, -1, 0] }
  const first = session()
  first.still()
  for (const [dir, vec] of Object.entries(vecs)) {
    for (let i = 0; i < 3; i += 1) { first.input.calibrate(dir); first.stroke(vec); first.still() }
  }
  assert.equal(first.input.snapshot().direction.ready, true, first.input.snapshot().direction.message)

  const second = session()
  second.still()
  assert.equal(second.input.snapshot().direction.ready, true, "calibration must survive a reload")

  second.input.resetDirection()
  const third = session()
  third.still()
  assert.equal(third.input.snapshot().direction.ready, false, "resetting must clear the stored calibration")
}

console.log("Direction: calibration survives a reload")


// Up and down are near-perfect opposites (about 166 degrees apart in the recordings), so a real
// down-stroke and the return of an up-stroke are the same motion to the gyroscope. Geometry
// cannot separate them; timing can, because a real stroke lands on a cue and a return does not.
{
  const filter = createReturnFilter()
  const up = [0, 0, 1]
  const down = [0, 0, -1]
  assert.equal(filter.accept(up, 1), true, "the first stroke is always taken")
  assert.equal(filter.accept(down, 1.2), false, "a reversal soon after, with no cue due, is a return")

  const onCue = createReturnFilter()
  assert.equal(onCue.accept(up, 1), true)
  assert.equal(onCue.accept(down, 1.2, true), true, "a reversal that lands on a cue is a real stroke")
  // Having accepted it, the stroke after it is judged against the down stroke, not the up one.
  assert.equal(onCue.accept(up, 1.4), false, "its own return is still suppressed")
}

console.log("Direction: cue-backed reversals pass")

// Conducting up-down-up-down on the beat is the case that breaks without cue knowledge: each
// stroke is the geometric opposite of the one before and lands inside RETURN_WINDOW, so every
// second one was suppressed as a return and the player saw half their strokes vanish.
{
  const up = [0, 0, 1]
  const down = [0, 0, -1]
  const run = (onCue) => {
    const filter = createReturnFilter()
    let taken = 0
    for (let i = 0; i < 8; i += 1) {
      if (filter.accept(i % 2 === 0 ? up : down, i * 0.375, onCue)) taken += 1
    }
    return taken
  }
  assert.equal(run(false), 4, "without cue knowledge every second vertical stroke is lost")
  assert.equal(run(true), 8, "strokes the chart asked for all count")
}

console.log("Direction: alternating vertical strokes on the beat pass")

// A level must not open with a Miss the player did nothing to earn: whatever the hands were
// doing beforehand — the last calibration wave, settling the ring — is still the return filter's
// reference stroke, and a first beat that happens to reverse it would be suppressed.
{
  const stale = [0, 0, -1]
  const firstBeat = [0, 0, 1]
  const filter = createReturnFilter()
  filter.accept(stale, 10)
  assert.equal(filter.accept(firstBeat, 10.3), false, "stale state would eat the first beat")
  filter.reset()
  assert.equal(filter.accept(firstBeat, 10.3), true, "resetting at level start lets it through")
}

console.log("Direction: level start clears stale gesture state")
