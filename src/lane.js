// Beat arrows travel from far to near onto one gold judgment line. Direction is the arrow
// itself. Section entrances, swells and cuts are shown on the players, not on this line.
export const DIRECTION_COLOR = { up: "#ffe3a8", down: "#ffe3a8", left: "#ffe3a8", right: "#ffe3a8" }
const GRADE = { perfect: { text: "PERFECT", color: "#e6c98a" }, good: { text: "GOOD", color: "#d9cbb6" }, miss: { text: "MISS", color: "#7b8299" } }
const FONT = '"Segoe UI", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const alpha = (hex, a) => `${hex}${Math.round(clamp01(a) * 255).toString(16).padStart(2, "0")}`

export function laneLayout(width, height) {
  const r = Math.max(24, Math.min(46, Math.min(width, height) * 0.058))
  const shift = width > 760 ? width * 0.05 : 0
  const leftX = (width <= 760 ? width * 0.25 : Math.max(width * 0.2, 300)) + shift
  const rightX = width * 0.56 + shift
  return {
    r,
    reach: r * 3.4,
    right: { target: { x: rightX, y: height * 0.62 }, far: { x: rightX, y: height * 0.22 } },
    left: { target: { x: leftX, y: height * 0.62 }, far: { x: leftX, y: height * 0.22 } },
  }
}

// Camera-space flight. Every direction leaves the same point deep in the hall and grows
// as it comes toward the judgment line; left and right only separate near the line.
export function beatFlight(hand, remain, lead) {
  const p = Math.min(1.08, Math.max(0, 1 - remain / lead))
  const farZ = -6.4
  const nearZ = -1.58
  const z = farZ + (nearZ - farZ) * Math.min(1, p)
  const closeness = Math.min(1, Math.max(0, (z - farZ) / (nearZ - farZ)))
  const spread = closeness ** 2.15
  return {
    x: (hand === "left" ? -0.55 : 0.52) * spread,
    y: 0.62 * (1 - closeness ** 1.05) - 0.32,
    z,
    scale: (0.58 / Math.abs(z)) * 1.15,
  }
}

export function createLane(canvas) {
  const g = canvas.getContext("2d")
  let width = 0
  let height = 0
  let ratio = 1
  let layout = null
  const fx = []

  function resize() {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    ratio = 1
    width = rect.width
    height = rect.height
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    layout = laneLayout(width, height)
  }

  function reset() { fx.length = 0 }

  function text(value, x, y, size, color, weight = 600, spacing = 0) {
    g.font = `${weight} ${size}px ${FONT}`
    g.textAlign = "center"
    g.textBaseline = "middle"
    if (spacing) g.letterSpacing = `${spacing}px`
    g.fillStyle = color
    g.fillText(value, x, y)
    if (spacing) g.letterSpacing = "0px"
  }

  function effects(chart) {
    const nowMs = performance.now()
    const lit = { left: {}, right: {} }
    for (let i = fx.length - 1; i >= 0; i -= 1) {
      const item = fx[i]
      const age = (nowMs - item.born) / 1000
      if (age > 0.8) { fx.splice(i, 1); continue }
      const lane = layout[item.cue.hand === "both" ? "right" : item.cue.hand] || layout.right
      const { x, y } = lane.target
      const grade = GRADE[item.kind]
      const t = age / 0.8
      const side = item.cue.hand === "left" ? "left" : "right"
      if (item.cue.direction && item.kind !== "miss" && age < 0.25) lit[side][item.cue.direction] = 1
      g.lineWidth = 3 * (1 - t)
      g.strokeStyle = alpha(grade.color, 1 - t)
      g.beginPath()
      g.arc(x, y, layout.r * (1 + t * 1.8), 0, Math.PI * 2)
      g.stroke()
      const lift = y - layout.r * 1.7 - t * 20
      g.save()
      g.globalAlpha = 1 - Math.max(0, t - 0.5) / 0.5
      text(grade.text, x, lift, 17, grade.color, 700, 3)
      if (item.timing) text(item.timing.text, x, lift + 19, 12, item.timing.color, 600, 1)
      g.restore()
    }
    return lit
  }

  function frame(now, chart, cues) {
    if (!width) resize()
    if (!width) return
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.clearRect(0, 0, width, height)
    if (!chart) return
    effects(chart)
  }

  // `delta` is the signed gesture error in seconds, negative = early.
  function hit(cue, kind, delta) {
    const sec = Math.abs(delta ?? 0)
    const timing = kind !== "miss" && sec >= 0.025
      ? { text: `${delta < 0 ? "偏早" : "偏晚"} ${Math.round(sec * 1000)}ms`, color: delta < 0 ? "#b7c4c9" : "#e6c98a" }
      : null
    fx.push({ cue, kind, timing, born: performance.now() })
  }

  return { resize, reset, update: frame, hit }
}
