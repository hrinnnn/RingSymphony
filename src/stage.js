const GOLD = "#e6c98a"
const MISS = "#9c4a3c"
const GOOD = "#8aa394"
const INK = "#12110f"

function pointAt(points, index) {
  const count = points.length
  const from = points[((index % count) + count) % count]
  const to = points[(((index + 1) % count) + count) % count]
  return { from, to }
}

export function createStage(canvas) {
  const ctx = canvas.getContext("2d")

  function resize() {
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.floor(rect.width * ratio))
    canvas.height = Math.max(1, Math.floor(rect.height * ratio))
  }

  function xy(point) {
    return { x: point.x * canvas.width, y: point.y * canvas.height }
  }

  function draw(state) {
    const { points, seconds, beatSec, flash } = state
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!points?.length) return
    const beatFloat = seconds / beatSec
    const segment = Math.floor(beatFloat)
    const phase = beatFloat - segment
    const { from, to } = pointAt(points, segment)
    const a = xy(from)
    const b = xy(to)
    const upcoming = (segment + 1) % points.length
    const glow = (1 - phase) * beatSec <= 0.2

    ctx.lineWidth = Math.max(1.25, canvas.width / 700)
    ctx.strokeStyle = "rgba(230, 201, 138, 0.55)"
    ctx.beginPath()
    points.forEach((point, index) => {
      const p = xy(point)
      if (index === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
    ctx.stroke()

    const radius = Math.max(7, canvas.width / 90)
    points.forEach((point, index) => {
      const p = xy(point)
      const lit = glow && index === upcoming
      const flashed = flash && flash.index === index && performance.now() < flash.until
      ctx.beginPath()
      ctx.arc(p.x, p.y, lit ? radius * 1.35 : radius, 0, Math.PI * 2)
      if (flashed) {
        ctx.fillStyle = flash.kind === "miss" ? MISS : flash.kind === "good" ? GOOD : GOLD
        ctx.fill()
      } else if (lit) {
        ctx.fillStyle = GOLD
        ctx.fill()
      } else {
        ctx.strokeStyle = GOLD
        ctx.stroke()
      }
    })

    ctx.beginPath()
    ctx.arc(a.x + (b.x - a.x) * phase, a.y + (b.y - a.y) * phase, radius * 0.55, 0, Math.PI * 2)
    ctx.fillStyle = INK
    ctx.fill()
    ctx.lineWidth = Math.max(2, canvas.width / 500)
    ctx.strokeStyle = GOLD
    ctx.stroke()
  }

  return { resize, draw }
}

export function pathMarkup(points) {
  const w = 160
  const h = 96
  const pad = 14
  const mapped = points.map((point) => [
    pad + point.x * (w - pad * 2),
    pad + point.y * (h - pad * 2),
  ])
  const d = mapped.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") + " Z"
  const dots = mapped.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" />`).join("")
  return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" />${dots}</svg>`
}
