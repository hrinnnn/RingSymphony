import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createBeatDetector, createGravity } from "../src/ring/detectors.js"
import { AXIS_FLOOR, REVERSAL_WINDOW, classifyAbsolute, createReversalFilter, gravityFrame } from "../src/ring/absolute.js"

const G = 9.81

// --- unit level -------------------------------------------------------------------------------

// Hand held level, ring's +y pointing at the floor: gravity reads as [0, -1, 0] in device axes,
// so "up" in the gravity sense is -y. A rotation about that axis is a horizontal sweep.
const down = [0, -1, 0]
const frame = (rotation, linear) => ({ gravity: down, rotation, linear })

assert.equal(classifyAbsolute(frame([0, -1, 0], [0, 0, 0])).direction, "left",
  "rotation along gravity is a leftward sweep")
assert.equal(classifyAbsolute(frame([0, 1, 0], [0, 0, 0])).direction, "right",
  "rotation against gravity is a rightward sweep")
assert.equal(classifyAbsolute(frame([1, 0, 0], [0, -1, 0])).direction, "up",
  "no yaw, hand accelerating along gravity is an up-stroke")
assert.equal(classifyAbsolute(frame([1, 0, 0], [0, 1, 0])).direction, "down",
  "no yaw, hand accelerating against gravity is a down-stroke")

// A motion committed to neither axis is declined rather than guessed at.
const vague = classifyAbsolute(frame([1, 0, 0], [1, 0, 0]))
assert.equal(vague.direction, null)
assert.equal(vague.reason, "动作方向不明确")
assert.equal(classifyAbsolute(null).direction, null, "a missing frame is not a crash")
assert.equal(classifyAbsolute(null).reason, "数据不足或断帧")

// The bar is a real bar: just under it declines, just over it classifies.
const under = AXIS_FLOOR - 0.02
const over = AXIS_FLOOR + 0.02
const tilt = (y) => [Math.sqrt(Math.max(0, 1 - y * y)), -y, 0]
assert.equal(classifyAbsolute(frame(tilt(under), [0, 0, 0])).direction, null, "below the floor is declined")
assert.equal(classifyAbsolute(frame(tilt(over), [0, 0, 0])).direction, "left", "above the floor classifies")

// --- reversal filter --------------------------------------------------------------------------

const filter = createReversalFilter()
assert.equal(filter.accept("left", 1), true, "the first stroke has nothing to reverse")
assert.equal(filter.accept("right", 1.2), false, "the opposite direction soon after is the arm coming back")
assert.equal(filter.accept("right", 1 + REVERSAL_WINDOW + 0.01), true,
  "a reversal beyond the window is a stroke in its own right")

const cued = createReversalFilter()
assert.equal(cued.accept("left", 1), true)
assert.equal(cued.accept("right", 1.2, true), true, "a reversal the chart asked for is a stroke")
assert.equal(cued.accept("left", 1.4), false, "and it becomes the reference, so its own return is caught")

const sideways = createReversalFilter()
assert.equal(sideways.accept("left", 1), true)
assert.equal(sideways.accept("up", 1.1), true, "only the exact opposite is a return")
assert.equal(createReversalFilter().isReversal(null, 1), false, "no direction, no reversal")

const resettable = createReversalFilter()
resettable.accept("left", 1)
resettable.reset()
assert.equal(resettable.accept("right", 1.2), true, "reset forgets the predecessor")

// --- against the labelled recordings ------------------------------------------------------------

// The real claim this module makes is that it classifies strokes without calibration, so the test
// that matters replays the recordings rather than synthetic vectors. recordings/方向 holds
// single-direction captures from three wearers; the file name is the label.
const FILES = {
  down: ["down_ash", "down_ash2", "down_alex", "下"],
  left: ["left_ash", "left_ash2", "left_alex", "左"],
  right: ["right_ash", "right_ash2", "right_alex", "右"],
  up: ["up_ash", "up_ash2", "up_alex", "up_alex2", "上"],
}

async function load(name) {
  const raw = JSON.parse(await readFile(new URL(`../recordings/方向/${name}.json`, import.meta.url), "utf8"))
  return raw.t.map((t, i) => ({ t, acc: raw.acc[i], gyr: raw.gyr[i] }))
}

// Every peak in a recording, with the gravity frame reconstructed the way input.js does it.
async function peaks(name) {
  const frames = await load(name)
  // The recordings are raw device output, so the resting gyro offset is still in them. input.js
  // estimates this during calibration; here the first still second stands in for it.
  const still = frames.filter((f) => f.t < 1)
  const bias = [0, 1, 2].map((axis) => still.reduce((sum, f) => sum + f.gyr[axis], 0) / still.length)
  const gravity = createGravity()
  const detector = createBeatDetector({ beatFloor: 0.65, adaptiveFloor: false })
  const history = []
  const found = []
  let lastT = null
  for (const f of frames) {
    const gyr = f.gyr.map((value, axis) => value - bias[axis])
    const dt = lastT === null ? 0.005 : Math.min(0.05, Math.max(0.001, f.t - lastT))
    lastT = f.t
    const up = gravity.update(f.acc, gyr, dt)
    history.push({ t: f.t, gyr, acc: f.acc, up: [...up] })
    while (history.length && history[0].t < f.t - 0.8) history.shift()
    const beat = detector.push(f.t, Math.hypot(...gyr))
    if (beat) {
      // The mean rotation axis in device axes, for the labeller below. Deliberately not taken from
      // gravityFrame: the labeller must not share a frame of reference with the code under test.
      const window = history.filter((h) => h.t >= beat.t - 0.15 && h.t <= beat.t)
      const sum = window.reduce((acc, h) => acc.map((v, i) => v + h.gyr[i] / window.length), [0, 0, 0])
      const length = Math.hypot(...sum)
      found.push({
        t: beat.t,
        speed: beat.peakSpeed,
        frame: gravityFrame(history, beat.t),
        axis: length > 1e-6 ? sum.map((v) => v / length) : null,
      })
    }
  }
  return found
}

// A wave is a stroke out and an arm coming back, so a single-direction recording contains both,
// and only the strokes carry the file's label. Splitting them on speed does not work: for some
// wearers the return is as brisk as the stroke (up_alex2 returns at 6.6-7.2 rad/s against strokes
// at 6.2-6.5), so a speed split keeps returns and then counts them as misclassifications.
//
// The two halves are separated instead by rotation axis, which is what actually distinguishes
// them — a return is the same rotation reversed, so the peaks fall into two clusters about 180
// degrees apart. The axis is read in the ring's own device axes, deliberately: the thing under
// test reads direction off gravity, so a labeller built on gravity would be marking its own
// homework. The faster cluster is the driven stroke.
//
// The split is checked rather than assumed, by the one property a wave must have: strokes and
// returns alternate in time. Measured at 79% adjacent alternation against 50% for a coin flip.
function strokesOnly(found) {
  const peaks = found.filter((p) => p.axis && p.frame)
  if (peaks.length < 4) return []
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const unit = (v) => {
    const length = Math.hypot(...v)
    return length > 1e-6 ? v.map((x) => x / length) : null
  }
  let a = peaks[0].axis
  let b = peaks.reduce((best, p) => (dot(p.axis, a) < best.d ? { d: dot(p.axis, a), axis: p.axis } : best), { d: 2, axis: null }).axis
  if (!b) return peaks
  const partition = () => {
    const A = []
    const B = []
    for (const p of peaks) (dot(p.axis, a) >= dot(p.axis, b) ? A : B).push(p)
    return [A, B]
  }
  for (let i = 0; i < 40; i += 1) {
    const [A, B] = partition()
    if (!A.length || !B.length) break
    a = unit(A.reduce((sum, p) => sum.map((v, k) => v + p.axis[k]), [0, 0, 0]))
    b = unit(B.reduce((sum, p) => sum.map((v, k) => v + p.axis[k]), [0, 0, 0]))
  }
  const [A, B] = partition()
  if (!A.length || !B.length) return peaks
  const mean = (list) => list.reduce((sum, p) => sum + p.speed, 0) / list.length
  return mean(A) >= mean(B) ? A : B
}

let correct = 0
let wrong = 0
let declined = 0
const confusion = {}
for (const [direction, names] of Object.entries(FILES)) {
  for (const name of names) {
    for (const peak of strokesOnly(await peaks(name))) {
      const got = classifyAbsolute(peak.frame).direction
      if (!got) declined += 1
      else if (got === direction) correct += 1
      else {
        wrong += 1
        confusion[`${direction}->${got}`] = (confusion[`${direction}->${got}`] ?? 0) + 1
      }
    }
  }
}

const total = correct + wrong + declined
// Measured at 99% correct with 1 misclassification and 1 decline over 164 strokes once the
// vertical reading was confined to the drive phase (absolute.js, DRIVE_END). The bars sit below
// that so ordinary variation in how the halves split does not fail the suite, but high enough that
// a regression to the pre-drive-window behaviour (96%, 5 declines) would be caught.
assert.ok(total > 140, `expected the recordings to yield a useful number of strokes, got ${total}`)
assert.ok(correct / total >= 0.95,
  `absolute classification fell to ${(100 * correct / total).toFixed(0)}% (${correct}/${total}); confusion ${JSON.stringify(confusion)}`)
assert.ok(wrong / total <= 0.03,
  `too many strokes classified as the wrong direction: ${wrong}/${total}, ${JSON.stringify(confusion)}`)
// Declines are the failure mode the drive window exists to remove, and the one the played sessions
// showed most of (13 of 23 up-cues). Guarded separately so it cannot creep back unnoticed.
assert.ok(declined / total <= 0.04,
  `too many strokes declined as 动作方向不明确: ${declined}/${total}`)

// The specific claim the camera exists to cover: up and down are separable without it. Both must
// be present and distinct, or "97% correct" could hide the vertical pair collapsing into one.
const vertical = Object.keys(confusion).filter((key) => key === "up->down" || key === "down->up")
assert.ok(vertical.every((key) => confusion[key] <= 2),
  `up and down are not separating: ${JSON.stringify(confusion)}`)

console.log(`absolute: ${correct}/${total} correct (${(100 * correct / total).toFixed(0)}%), ${wrong} wrong, ${declined} declined`)
console.log("ok - absolute direction")
