// Beat arrows travel from far to near onto one gold judgment line. Direction is the arrow
// itself. Section entrances, swells and cuts are shown on the players, not on this line.
export const DIRECTION_COLOR = { up: "#ffe3a8", down: "#ffe3a8", left: "#ffe3a8", right: "#ffe3a8" }
const GRADE = {
  perfect: { text: "PERFECT", color: "#ffd98a", ink: "#2a1c05" },
  good: { text: "GOOD", color: "#8fd8c4", ink: "#07211b" },
  miss: { text: "MISS", color: "#e08878", ink: "#2a0d08" },
}
const FONT = '"Segoe UI", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const alpha = (hex, a) => `${hex}${Math.round(clamp01(a) * 255).toString(16).padStart(2, "0")}`
const HANDS = ["left", "right"]
const FLASH_MS = 180
const FEEDBACK_MS = 540

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

// Camera-space flight. Interpolate projected positions so the two paths stay
// separate and upcoming arrows are spaced evenly on screen.
export function beatFlight(hand, remain, lead) {
  const p = Math.min(1.08, Math.max(0, 1 - remain / lead))
  const farZ = -6.4
  const nearZ = -1.58
  const z = farZ + (nearZ - farZ) * Math.min(1, p)
  const closeness = Math.min(1, Math.max(0, (z - farZ) / (nearZ - farZ)))
  const depth = -z
  return {
    x: (hand === "left" ? -0.55 : 0.52) * (0.28 + 0.72 * closeness) * depth / -nearZ,
    y: ((1 - closeness) * 0.16 - closeness * 0.32 / -nearZ) * depth,
    z,
    scale: (0.58 / Math.abs(z)) * 1.15,
  }
}

export function stageFovRadians(aspect) {
  return 2 * Math.atan(Math.tan(53 * Math.PI / 360) * Math.max(1, 1.4 / aspect))
}

export function beatLandings(width, height) {
  const pixelsPerUnit = height / (2 * Math.tan(stageFovRadians(width / height) / 2))
  return Object.fromEntries(HANDS.map((hand) => {
    const { x, y, z } = beatFlight(hand, 0, 1)
    return [hand, { x: width / 2 + (x / -z) * pixelsPerUnit, y: height / 2 - (y / -z) * pixelsPerUnit }]
  }))
}

export function createLane(canvas) {
  const g = canvas.getContext("2d")
  let width = 0
  let height = 0
  let ratio = 1
  let landings
  const flashes = new Map()
  const feedback = new Map()

  function resize() {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    ratio = Math.min(window.devicePixelRatio || 1, 2)
    width = rect.width
    height = rect.height
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    landings = beatLandings(width, height)
  }

  function reset() {
    flashes.clear()
    feedback.clear()
    g.clearRect(0, 0, width, height)
  }

  function text(value, x, y, size, color, weight = 600, spacing = 0, outline = null, shadow = 0) {
    g.font = `${weight} ${size}px ${FONT}`
    g.textAlign = "center"
    g.textBaseline = "middle"
    if (spacing) g.letterSpacing = `${spacing}px`
    if (shadow) {
      g.shadowColor = "rgba(0,0,0,0.55)"
      g.shadowBlur = shadow
      g.shadowOffsetY = Math.round(shadow * 0.18)
    }
    // Stroke under fill, round-joined: the outline carries the glyph over both
    // the lit stage and the dark hall without a plate behind the text.
    if (outline) {
      g.lineJoin = "round"
      g.miterLimit = 2
      g.lineWidth = Math.max(3, size * 0.2)
      g.strokeStyle = outline
      g.strokeText(value, x, y)
    }
    g.shadowColor = "transparent"
    g.shadowBlur = 0
    g.shadowOffsetY = 0
    g.fillStyle = color
    g.fillText(value, x, y)
    if (spacing) g.letterSpacing = "0px"
  }

  function drawReceptor(hand, nowMs) {
    const { x, y } = landings[hand]
    const flash = flashes.get(hand)
    const intensity = flash ? clamp01(1 - (nowMs - flash.born) / FLASH_MS) : 0
    g.beginPath()
    g.moveTo(x, y - 7)
    g.lineTo(x, y + 8)
    g.lineWidth = 5
    g.strokeStyle = "#1d1510"
    g.stroke()
    g.lineWidth = 2
    g.strokeStyle = hand === "left" ? "#c0baa6" : "#e6cc94"
    g.stroke()
    if (intensity > 0) {
      const halfWidth = 10 + 22 * (1 - intensity)
      g.beginPath()
      g.moveTo(x - halfWidth, y)
      g.lineTo(x + halfWidth, y)
      g.lineWidth = 1 + intensity * 3
      g.strokeStyle = alpha(flash.color, intensity)
      g.stroke()
    }
  }

  function drawFeedback(nowMs) {
    const offset = Math.max(42, Math.min(76, width * 0.065))
    for (const [hand, item] of feedback) {
      const progress = (nowMs - item.born) / FEEDBACK_MS
      if (progress >= 1) { feedback.delete(hand); continue }
      const target = landings[hand]
      const x = target ? target.x + (hand === "left" ? -offset : offset) : width / 2
      const y = landings.right.y + (target ? -26 : 28) - progress * 8
      g.save()
      g.globalAlpha = 1 - clamp01((progress - 0.6) / 0.4)
      text(item.grade.text, x, y, width < 600 ? 13 : 16, item.grade.color, 800, 1, item.grade.ink, 6)
      if (item.detail) text(item.detail, x, y + 17, 11, "#f5e4c6", 700, 0, "#160f06", 4)
      g.restore()
    }
  }

  function frame(now, chart) {
    if (!width) resize()
    if (!width) return
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.clearRect(0, 0, width, height)
    if (!chart) return
    const nowMs = performance.now()
    for (const hand of HANDS) drawReceptor(hand, nowMs)
    drawFeedback(nowMs)
  }

  function pulse(hand, kind) {
    flashes.set(hand, { color: GRADE[kind].color, born: performance.now() })
  }

  // `delta` is the signed gesture error in seconds, negative = early.
  function hit(cue, kind, delta, reason) {
    const ms = Math.round(Math.abs(delta ?? 0) * 1000)
    const timing = kind !== "miss" && ms >= 25 ? `${delta < 0 ? "偏早" : "偏晚"} ${ms} ms` : null
    feedback.set(cue.hand, { grade: GRADE[kind], detail: reason || timing, born: performance.now() })
    if (cue.kind === "beat" && cue.hand !== "both" && kind !== "miss") pulse(cue.hand, kind)
  }

  return { resize, reset, update: frame, hit, pulse }
}
