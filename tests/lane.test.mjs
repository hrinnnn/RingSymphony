import assert from "node:assert/strict"
import { beatFlight, createLane, laneLayout } from "../src/lane.js"

globalThis.window = { devicePixelRatio: 1 }

function render(width, height, cues, now = 0) {
  const calls = []
  const g = new Proxy({}, {
    get(target, key) {
      if (key === "createLinearGradient") return () => ({ addColorStop() {} })
      if (!(key in target)) target[key] = (...args) => calls.push([key, ...args])
      return target[key]
    },
  })
  const canvas = { getContext: () => g, getBoundingClientRect: () => ({ width, height }) }
  const lane = createLane(canvas)
  lane.resize()
  lane.update(now, { beat: 1 }, cues)
  return calls
}

const far = beatFlight("right", 3, 3)
const near = beatFlight("right", 0, 3)
assert.ok(Math.abs(far.z) > Math.abs(near.z) + 2, "a beat starts deep in the hall")
assert.ok(near.scale > far.scale * 2, "it grows as it flies toward the line")
assert.ok(Math.abs(far.x) < 0.08 && Math.abs(near.x) > 0.4, "it leaves the center of the hall and lands on one hand")
const left = beatFlight("left", 0, 3)
assert.ok(left.x < -0.4 && near.x > 0.4, "left and right land on opposite sides of the line")
assert.deepEqual(beatFlight("right", 1.2, 3), beatFlight("right", 1.2, 3))
for (const direction of ["up", "down", "left", "right"]) {
  assert.ok(direction)
  assert.ok(Math.abs(beatFlight("right", 2.4, 3).x) < Math.abs(near.x), "direction does not change the flight")
}

const layout = laneLayout(1200, 800)
assert.ok(layout.left.target.x < layout.right.target.x, "left mark stays left of the right mark")
assert.ok(laneLayout(375, 667).left.target.x < laneLayout(375, 667).right.target.x, "left mark stays left on a narrow screen")

for (const cue of [
  { hand: "right", kind: "beat", direction: "down", time: 1.5 },
  { hand: "left", kind: "dynamics", direction: "up", time: 0.6 },
  { hand: "left", kind: "cue", part: "violin", time: 0.6 },
  { hand: "both", kind: "cut", time: 0.6 },
]) {
  const calls = render(1200, 800, [cue])
  assert.equal(calls.filter(([name]) => name === "fillText").length, 0, "the lane does not label the cue")
  assert.equal(calls.filter(([name]) => name === "closePath").length, 0, "beat arrows are not drawn flat on the page")
}

console.log("Lane: depth flight, opposite hands, and a quiet page pass")
