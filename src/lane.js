// Maestro-style note lane drawn over the 3D hall: cues start small near the vanishing point, grow as they come at
// the player and land on a hit ring. Directional cues generally travel along the stroke they ask for;
// down beats approach from the lower right to keep them separate from cues coming from above.
// Left column = left hand (section entrances, swell / fade); centre = right hand (directional beats).
import { GOOD } from "./judge.js"

export const DIRECTION_COLOR = { up: "#f8eee0", down: "#e6c98a", left: "#f8eee0", right: "#f8eee0" }
const PART_COLOR = { violin: "#e6c98a", flute: "#b7c4c9", horn: "#c4a15a", cello: "#8d3a45", piano: "#d9cbb6" }
const PART_NAME = { violin: "小提琴", cello: "大提琴", flute: "长笛", piano: "钢琴" }
const PART_BADGE = { violin: "VN", cello: "VC", flute: "FL", piano: "PF" }
const GRADE = { perfect: { text: "PERFECT", color: "#e6c98a" }, good: { text: "GOOD", color: "#d9cbb6" }, miss: { text: "MISS", color: "#7b8299" } }
const FONT = '"Segoe UI", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
const VECTOR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const ROTATION = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const lerp = (a, b, t) => a + (b - a) * t
const alpha = (hex, a) => `${hex}${Math.round(clamp01(a) * 255).toString(16).padStart(2, "0")}`

export function laneLayout(width, height) {
  const r = Math.max(24, Math.min(46, Math.min(width, height) * 0.058))
  const shift = width > 760 ? width * 0.05 : 0
  const leftX = (width <= 760 ? width * 0.25 : Math.max(width * 0.2, 300)) + shift
  const rightX = width * 0.56 + shift
  return {
    r,
    reach: r * 3.4,
    right: { target: { x: rightX, y: height * 0.62 }, far: { x: rightX, y: height * 0.34 } },
    left: { target: { x: leftX, y: height * 0.62 }, far: { x: leftX + width * 0.05, y: height * 0.34 } },
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
    ratio = Math.min(window.devicePixelRatio || 1, 2)
    width = rect.width
    height = rect.height
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    layout = laneLayout(width, height)
  }

  function reset() { fx.length = 0 }

  // remain: seconds until the cue's time. Past the hit time a late cue keeps travelling a little.
  function place(cue, remain, lead) {
    const lane = layout[cue.hand]
    const p = Math.min(1.18, 1 - remain / lead)
    const e = Math.max(0, p) ** 1.5
    const swing = cue.direction ? VECTOR[cue.direction] : [0, 0]
    const drift = layout.reach * (1 - Math.min(1, e))
    if (cue.hand === "right" && cue.direction === "down") {
      return {
        x: lane.target.x + layout.reach * 0.8 * (1 - e),
        y: lane.target.y + layout.reach * 0.65 * (1 - e),
        scale: p >= 1 ? 1 : 0.22 + 0.78 * e,
        p,
      }
    }
    return {
      x: lerp(lane.far.x, lane.target.x, e) - swing[0] * drift,
      y: lerp(lane.far.y, lane.target.y, e) - swing[1] * drift,
      scale: p >= 1 ? 1 : 0.22 + 0.78 * e,
      p,
    }
  }

  function text(value, x, y, size, color, weight = 600, spacing = 0) {
    g.font = `${weight} ${size}px ${FONT}`
    g.textAlign = "center"
    g.textBaseline = "middle"
    if (spacing) g.letterSpacing = `${spacing}px`
    g.fillStyle = color
    g.fillText(value, x, y)
    if (spacing) g.letterSpacing = "0px"
  }

  function arrow(x, y, size, direction, color, nudge = 0) {
    g.save()
    g.translate(x, y)
    g.rotate(ROTATION[direction])
    g.translate(0, -nudge)
    g.strokeStyle = color
    g.lineWidth = Math.max(2, size * 0.13)
    g.lineCap = "square"
    g.lineJoin = "miter"
    g.beginPath()
    g.moveTo(0, size * 0.5)
    g.lineTo(0, -size * 0.5)
    g.moveTo(-size * 0.36, -size * 0.14)
    g.lineTo(0, -size * 0.5)
    g.lineTo(size * 0.36, -size * 0.14)
    g.stroke()
    g.restore()
  }

  function disc(x, y, r, color, fade) {
    g.save()
    g.shadowColor = alpha(color, 0.9 * fade)
    g.shadowBlur = 18
    g.lineWidth = 2.5
    g.strokeStyle = alpha(color, fade)
    g.fillStyle = alpha("#070b16", 0.7 * fade)
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.stroke()
    g.restore()
    g.fillStyle = alpha(color, 0.2 * fade)
    g.beginPath()
    g.arc(x, y, r * 0.82, 0, Math.PI * 2)
    g.fill()
    g.lineWidth = 1
    g.strokeStyle = alpha("#ffffff", 0.55 * fade)
    g.beginPath()
    g.arc(x, y, r * 0.92, 0, Math.PI * 2)
    g.stroke()
  }

  function leftNote(x, y, r, color, fade) {
    g.save()
    g.translate(x, y)
    g.shadowColor = alpha(color, 0.9 * fade)
    g.shadowBlur = 18
    g.lineWidth = 2.5
    g.strokeStyle = alpha(color, fade)
    g.fillStyle = alpha("#070b16", 0.9 * fade)
    g.beginPath()
    g.moveTo(-r * 0.7, -r * 0.8)
    g.lineTo(r * 0.7, -r * 0.8)
    g.lineTo(r, 0)
    g.lineTo(r * 0.7, r * 0.8)
    g.lineTo(-r * 0.7, r * 0.8)
    g.lineTo(-r, 0)
    g.closePath()
    g.fill()
    g.stroke()
    g.restore()
  }

  function dynamicsMark(x, y, r, direction, fade) {
    const opening = direction === "up"
    g.save()
    g.strokeStyle = alpha("#ffffff", fade)
    g.lineWidth = Math.max(2, r * 0.09)
    g.lineCap = "round"
    g.lineJoin = "round"
    g.beginPath()
    g.moveTo(x - r * 0.65, y + (opening ? 0 : -r * 0.38))
    g.lineTo(x + r * 0.4, y + (opening ? -r * 0.38 : 0))
    g.moveTo(x - r * 0.65, y + (opening ? 0 : r * 0.38))
    g.lineTo(x + r * 0.4, y + (opening ? r * 0.38 : 0))
    g.stroke()
    arrow(x + r * 0.68, y, r * 0.5, direction, alpha("#ffffff", fade))
    g.restore()
  }

  function tail(cue, remain, lead, color, fade) {
    const a = place(cue, remain, lead)
    const b = place(cue, remain + lead * 0.16, lead)
    const line = g.createLinearGradient(b.x, b.y, a.x, a.y)
    line.addColorStop(0, alpha(color, 0))
    line.addColorStop(1, alpha(color, 0.55 * fade))
    g.strokeStyle = line
    g.lineWidth = layout.r * 0.5 * a.scale
    g.lineCap = "round"
    g.beginPath()
    g.moveTo(b.x, b.y)
    g.lineTo(a.x, a.y)
    g.stroke()
  }

  function note(cue, now, chart) {
    const lead = chart.beat * 3
    const remain = cue.time - now
    const missed = cue.result === "miss"
    const fade = clamp01((lead - remain) / (lead * 0.18)) * (missed ? clamp01(1 - (now - cue.time - GOOD) / 0.45) * 0.5 : 1)
    if (fade <= 0.01) return
    const { x, y, scale } = place(cue, remain, lead)
    const r = layout.r * scale * (cue.hand === "left" ? 1.1 : 1)
    const color = missed ? "#7b8299" : cue.kind === "cue" ? PART_COLOR[cue.part] : cue.kind === "dynamics" ? (cue.direction === "up" ? "#e6c98a" : "#b7c4c9") : DIRECTION_COLOR[cue.direction]
    if (cue.direction && !missed) tail(cue, remain, lead, color, fade)
    if (cue.hand === "left") leftNote(x, y, r, color, fade)
    else disc(x, y, r, color, fade)
    if (cue.kind === "cue") {
      text(PART_BADGE[cue.part], x, y + 1, r * 0.8, alpha("#ffffff", fade), 700, 1)
      if (scale > 0.55) text(`${PART_NAME[cue.part]} 进入`, x, y + r + 16, 13, alpha("#e8f1ff", fade), 600, 1)
      return
    }
    if (cue.kind === "dynamics") {
      dynamicsMark(x, y, r, cue.direction, fade)
      if (scale > 0.55) text(cue.direction === "up" ? "渐强 CRESC" : "渐弱 DIM", x, y + r + 16, 13, alpha("#e8f1ff", fade), 600, 1)
    } else {
      arrow(x, y, r * 1.1, cue.direction, alpha("#ffffff", fade), Math.sin(now * 9) * r * 0.04)
    }
  }

  function target(lane, now, chart, title, flash, directions) {
    const { x, y } = lane.target
    const r = layout.r
    const phase = ((now / chart.beat) % 1 + 1) % 1
    const pulse = Math.exp(-phase * 5)
    g.save()
    g.shadowColor = "#e6c98a"
    g.shadowBlur = 8 + 18 * pulse
    g.lineWidth = 2
    g.strokeStyle = alpha("#e8f1ff", 0.85)
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.stroke()
    g.restore()
    g.lineWidth = 1
    g.strokeStyle = "rgba(232,241,255,0.28)"
    g.setLineDash([3, 6])
    g.beginPath()
    g.arc(x, y, r * 1.38, 0, Math.PI * 2)
    g.stroke()
    g.setLineDash([])
    for (const direction of directions) {
      const [vx, vy] = VECTOR[direction]
      const lit = flash[direction] ?? 0
      g.save()
      g.translate(x + vx * r * 1.95, y + vy * r * 1.95)
      g.scale(0.34, 0.34)
      arrow(0, 0, r * 0.9, direction, alpha(lit > 0 ? DIRECTION_COLOR[direction] : "#e8f1ff", lit > 0 ? 1 : 0.3))
      g.restore()
    }
    text(title, x, y - r * 2.7, 11, "rgba(232,241,255,0.6)", 600, 3)
  }

  function effects(chart) {
    const nowMs = performance.now()
    const lit = { left: {}, right: {} }
    for (let i = fx.length - 1; i >= 0; i -= 1) {
      const item = fx[i]
      const age = (nowMs - item.born) / 1000
      if (age > 0.8) { fx.splice(i, 1); continue }
      const lane = layout[item.cue.hand]
      const { x, y } = lane.target
      const grade = GRADE[item.kind]
      const t = age / 0.8
      if (item.cue.direction && item.kind !== "miss" && age < 0.25) lit[item.cue.hand][item.cue.direction] = 1
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
    const visible = cues
      .filter((cue) => cue.time - now < chart.beat * 3 && now - cue.time < 0.9 && (!cue.result || cue.result === "miss"))
      .sort((a, b) => b.time - a.time)
    const lit = effects(chart)
    target(layout.right, now, chart, "RIGHT HAND", lit.right, Object.keys(VECTOR))
    target(layout.left, now, chart, "LEFT HAND", lit.left, ["up", "down"])
    visible.forEach((cue) => note(cue, now, chart))
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
