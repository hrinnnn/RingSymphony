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
  const progress = clamp01(1 - remain / lead)
  const farZ = -6.4
  const nearZ = -1.58
  const z = farZ + (nearZ - farZ) * progress
  const depth = -z
  const projectedX = (hand === "left" ? -0.55 : 0.52) / -nearZ
  const projectedY = -0.32 / -nearZ
  return {
    x: projectedX * (0.28 + 0.72 * progress) * depth,
    y: (0.16 + (projectedY - 0.16) * progress) * depth,
    z,
    scale: (0.58 / Math.abs(z)) * 1.15,
  }
}

export function stageHalfFovTangent(aspect) {
  return Math.tan(53 * Math.PI / 360) * Math.max(1, 1.4 / aspect)
}

export function beatLanding(hand, width, height) {
  const { x, y, z } = beatFlight(hand, 0, 1)
  const pixelsPerUnit = height / (2 * -z * stageHalfFovTangent(width / height))
  return { x: width / 2 + x * pixelsPerUnit, y: height / 2 - y * pixelsPerUnit }
}

export function createLane(canvas) {
  const g = canvas.getContext("2d")
  let width = 0
  let height = 0
  let ratio = 1
  let radius = 0
  let landings = null
  const fx = []

  function resize() {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    ratio = Math.min(window.devicePixelRatio || 1, 2)
    width = rect.width
    height = rect.height
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    radius = laneLayout(width, height).r * 0.62
    landings = { left: beatLanding("left", width, height), right: beatLanding("right", width, height) }
  }

  function reset() { fx.length = 0 }

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

  function effects(now) {
    const nowMs = performance.now()
    const drawn = new Set()
    for (let i = fx.length - 1; i >= 0; i -= 1) {
      const item = fx[i]
      if (now < item.time) continue
      item.born ??= nowMs
      const age = (nowMs - item.born) / 1000
      if (age >= 0.72) { fx.splice(i, 1); continue }
      if (drawn.has(item.hand)) continue
      drawn.add(item.hand)
      const { x, y } = landings[item.hand]
      const grade = GRADE[item.kind]
      const t = age / 0.72
      const ringRadius = radius * (0.65 + t * 1.4)
      g.lineWidth = 5 * (1 - t)
      g.strokeStyle = alpha(grade.ink, (1 - t) * 0.5)
      g.beginPath()
      g.arc(x, y, ringRadius, 0, Math.PI * 2)
      g.stroke()
      g.lineWidth = 3 * (1 - t)
      g.strokeStyle = alpha(grade.color, 1 - t)
      g.beginPath()
      g.arc(x, y, ringRadius, 0, Math.PI * 2)
      g.stroke()
      const lift = y - radius - 12 - t * 12
      g.save()
      g.globalAlpha = 1 - Math.max(0, t - 0.55) / 0.45
      // Overshoot to 1.14 in the first 90ms, settle by 260ms, then hold.
      const pop = t < 0.1125 ? 0.86 + (t / 0.1125) * 0.28 : t < 0.325 ? 1.14 - ((t - 0.1125) / 0.2125) * 0.14 : 1
      g.translate(x, lift)
      g.scale(pop, pop)
      text(grade.text, 0, 0, 19, grade.color, 800, 3, grade.ink, 10)
      g.restore()
      g.save()
      g.globalAlpha = 1 - Math.max(0, t - 0.55) / 0.45
      if (item.timing) text(item.timing.text, x, lift + 21, 12, item.timing.color, 700, 1, "#160f06", 6)
      g.restore()
    }
  }

  function frame(now, chart) {
    if (!width) resize()
    if (!width) return
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.clearRect(0, 0, width, height)
    if (!chart) return
    effects(now)
  }

  // `delta` is the signed gesture error in seconds, negative = early.
  function hit(cue, kind, delta, reason) {
    if (cue.kind !== "beat") return
    const sec = Math.abs(delta ?? 0)
    const timing = reason ? { text: reason, color: "#f2dcae" } : kind !== "miss" && sec >= 0.025
      ? { text: `${delta < 0 ? "偏早" : "偏晚"} ${Math.round(sec * 1000)}ms`, color: delta < 0 ? "#cfe4dc" : "#f2dcae" }
      : null
    const hands = cue.hand === "both" ? ["left", "right"] : [cue.hand]
    for (const hand of hands) {
      const handGrade = cue.hits?.[hand]?.kind ?? (cue.hits ? "miss" : kind)
      fx.push({ hand, kind: handGrade, timing: handGrade === "miss" ? null : timing, time: cue.time })
    }
  }

  return { resize, reset, update: frame, hit }
}
