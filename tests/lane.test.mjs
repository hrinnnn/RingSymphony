import assert from "node:assert/strict"
import { createLane } from "../src/lane.js"

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

const arcs = (calls) => calls.filter(([name]) => name === "arc")
const noteAt = (calls) => calls.filter(([name, x]) => name === "translate" && x > 20).at(-1)
const down = { hand: "right", kind: "beat", direction: "down", time: 1.5 }
const approaching = noteAt(render(1200, 800, [down]))
const landed = noteAt(render(1200, 800, [{ ...down, time: 0 }]))
assert.ok(approaching[1] > landed[1] && approaching[2] > landed[2], "down beat approaches diagonally upward from the right")
assert.equal(landed[1], 1200 * 0.56 + 1200 * 0.05)
assert.equal(landed[2], 800 * 0.62)
const desktopLine = arcs(render(1200, 800, []))
assert.equal(desktopLine[0][1], 300 + 1200 * 0.05, "left mark sits on the judgment line")
assert.ok(render(1200, 800, []).some(([name]) => name === "lineTo"), "a judgment line is drawn")

for (const [direction, label] of [["up", "渐强 CRESC"], ["down", "渐弱 DIM"]]) {
  const calls = render(1200, 800, [{ hand: "left", kind: "dynamics", direction, time: 0.6 }])
  assert.equal(arcs(calls).length, 2, "left-hand notes do not add circles of their own")
  assert.ok(calls.some(([name]) => name === "closePath"), "left-hand note has a closed outline")
  assert.ok(calls.some(([name, value]) => name === "fillText" && value === label))
  const outlineEnd = calls.findIndex(([name]) => name === "closePath")
  const mark = calls.slice(outlineEnd).filter(([name]) => name === "lineTo").slice(0, 2)
  assert.equal(mark.length, 2)
  assert.equal(mark[0][1], mark[1][1])
  if (direction === "up") assert.notEqual(mark[0][2], mark[1][2])
  else assert.equal(mark[0][2], mark[1][2])
}

const entryCalls = render(1200, 800, [{ hand: "left", kind: "cue", part: "violin", time: 0.6 }])
assert.ok(entryCalls.some(([name, value]) => name === "fillText" && value === "VN"))
const mobileTargets = arcs(render(375, 667, []))
assert.ok(mobileTargets[0][1] < mobileTargets[1][1], "left mark stays left of the right mark on narrow screens")

console.log("Lane: down-beat approach, left-hand symbols, and narrow-screen targets pass")
