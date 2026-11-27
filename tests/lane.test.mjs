import assert from "node:assert/strict"
import { beatFlight, beatLanding, createLane, laneLayout } from "../src/lane.js"

globalThis.window = { devicePixelRatio: 1 }

function render(width, height, cues, now = 0, results = []) {
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
  for (const [cue, grade] of results) lane.hit(cue, grade)
  lane.update(now, { beat: 1 }, cues)
  return calls
}

const far = beatFlight("right", 3, 3)
const near = beatFlight("right", 0, 3)
assert.ok(Math.abs(far.z) > Math.abs(near.z) + 2, "a beat starts deep in the hall")
assert.ok(near.scale > far.scale * 2, "it grows as it flies toward the line")
const projectedX = (point) => point.x / -point.z
for (const hand of ["left", "right"]) {
  const steps = [3, 2, 1, 0].map(remain => {
    const { x, y, z } = beatFlight(hand, remain, 3)
    return [x / -z, y / -z]
  })
  for (const axis of [0, 1]) {
    const velocity = steps[1][axis] - steps[0][axis]
    for (let i = 2; i < steps.length; i++) {
      assert.ok(Math.abs(steps[i][axis] - steps[i - 1][axis] - velocity) < 1e-8, 'screen velocity stays constant through landing')
    }
  }
}
assert.ok(projectedX(far) > 0.07 && projectedX(far) < projectedX(near), "the right arrow has its own track from the far end")
const left = beatFlight("left", 0, 3)
assert.ok(left.x < -0.4 && near.x > 0.4, "left and right land on opposite sides of the line")
assert.deepEqual(beatFlight("right", 1.2, 3), beatFlight("right", 1.2, 3))
for (const direction of ["up", "down", "left", "right"]) {
  assert.ok(direction)
  assert.ok(projectedX(beatFlight("right", 2.4, 3)) < projectedX(near), "an approaching beat moves toward the right end of its track")
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

const struck = { hand: "right", kind: "beat", direction: "down", time: 2 }
assert.ok(!render(1200, 800, [struck], 1.9, [[struck, "perfect"]]).some(([name]) => name === "arc"),
  "an early hit waits for the arrow to land")
for (const [hand, grade, time] of [["right", "perfect", 2], ["left", "miss", 2.5]]) {
  const calls = render(1200, 800, [], time, [[{ ...struck, hand }, grade]])
  const { x, y } = beatLanding(hand, 1200, 800)
  assert.deepEqual(calls.find(([name]) => name === "arc").slice(1, 3), [x, y])
  assert.ok(calls.some(([name, label]) => name === "fillText" && label === grade.toUpperCase()))
}

console.log("Lane: depth flight, opposite hands, and a quiet page pass")
