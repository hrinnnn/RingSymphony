import { setDynamics, setPart, startLevel, stopLevel, transportSeconds } from "./audio.js"
import { buildChart } from "./chart.js"
import { GOOD, PERFECT } from "./judge.js"
import { createWorld } from "./world.js"

const statusEl = document.querySelector("#status")
const homeEl = document.querySelector("#home")
const playEl = document.querySelector("#play")
const resultEl = document.querySelector("#result")
const hintEl = document.querySelector("#hint")
const gradeEl = document.querySelector("#grade")
const view = document.querySelector("#view")
const levelList = document.querySelector("#level-list")
const accuracyEl = document.querySelector("#accuracy")
const countsEl = document.querySelector("#counts")

const world = createWorld(view)
const beatDots = [...document.querySelectorAll(".beat-dot")]
const progressEl = document.querySelector("#progress-fill")
const cueHintEl = document.querySelector("#cue-hint")
const tallyEl = document.querySelector("#tally")

let chart = null
let cues = []
let counts = { perfect: 0, good: 0, miss: 0 }
let mode = "home"
let spawned = new Set()
let dynamics = 1
let pointer = null

const button = document.createElement("button")
button.type = "button"
button.className = "level"
button.innerHTML = "<span>练习曲 · 四拍 · 96</span><small>右手打拍，左手点人、抬手、放手</small>"
button.addEventListener("click", begin)
levelList.append(button)

function setMode(next) {
  mode = next
  homeEl.hidden = next !== "home"
  playEl.hidden = next === "home"
  resultEl.hidden = next !== "result"
  hintEl.hidden = next === "home" || next === "result"
  document.body.dataset.mode = next
  if (next === "home") { statusEl.textContent = "选关"; world.resize() }
}

function showGrade(kind) {
  const label = kind === "perfect" ? "Perfect" : kind === "good" ? "Good" : "Miss"
  gradeEl.textContent = label
  gradeEl.className = kind
  gradeEl.hidden = false
  window.setTimeout(() => {
    if (gradeEl.textContent === label) gradeEl.hidden = true
  }, 420)
}

function scoreCue(cue, kind) {
  if (cue.result) return
  cue.result = kind
  counts[kind] += 1
  tallyEl.textContent = String(counts.perfect * 100 + counts.good * 50).padStart(4, "0")
  showGrade(kind)
  if (kind === "miss") return
  if (cue.kind === "cue") { setPart(cue.part, true); world.pose("left", "point", cue.part) }
  if (cue.kind === "dynamics") {
    dynamics = cue.direction === "up" ? 1.6 : 0.7
    setDynamics(dynamics)
    world.pose("left", cue.direction)
  }
  if (cue.kind === "beat") world.pose("right", cue.direction)
}

function nearest(now, hand) {
  let best = null
  let distance = Infinity
  for (const cue of cues) {
    if (cue.result || cue.hand !== hand) continue
    const gap = Math.abs(now - cue.time)
    if (gap < distance) {
      distance = gap
      best = cue
    }
  }
  if (!best || distance > chart.beat / 2) return null
  return { cue: best, distance }
}

function gradeDistance(distance) {
  if (distance <= PERFECT) return "perfect"
  if (distance <= GOOD) return "good"
  return "miss"
}

function playBeat(direction) {
  if (mode !== "playing" && mode !== "count-in") return
  world.pose("right", direction)
  const found = nearest(transportSeconds(), "right")
  if (!found || found.cue.kind !== "beat") return
  const kind = found.cue.direction === direction ? gradeDistance(found.distance) : "miss"
  scoreCue(found.cue, kind)
}

function playPalm(direction) {
  if (mode !== "playing" && mode !== "count-in") return
  world.pose("left", direction)
  const found = nearest(transportSeconds(), "left")
  if (!found || found.cue.kind !== "dynamics" || found.cue.direction !== direction) return
  scoreCue(found.cue, gradeDistance(found.distance))
}

function playPoint(part) {
  if (!part || (mode !== "playing" && mode !== "count-in")) return
  world.pose("left", "point", part)
  const found = nearest(transportSeconds(), "left")
  if (!found || found.cue.kind !== "cue" || found.cue.part !== part) return
  scoreCue(found.cue, gradeDistance(found.distance))
}

function finish() {
  if (mode === "result") return
  stopLevel()
  const total = cues.length
  const percent = Math.round(((counts.perfect + counts.good * 0.5) / total) * 100)
  accuracyEl.textContent = `${percent}%`
  countsEl.textContent = `Perfect ${counts.perfect}    Good ${counts.good}    Miss ${counts.miss}`
  setMode("result")
  statusEl.textContent = "结果"
}

async function begin() {
  stopLevel()
  world.reset()
  chart = buildChart()
  cues = chart.cues.map((cue) => ({ ...cue, result: null }))
  counts = { perfect: 0, good: 0, miss: 0 }
  spawned = new Set()
  dynamics = 1
  gradeEl.hidden = true
  tallyEl.textContent = "0000"
  progressEl.style.width = "0%"
  setMode("count-in")
  statusEl.textContent = "预备"
  hintEl.innerHTML = '<span><kbd>↑ ↓ ← →</kbd> / 右半屏滑动 · 打拍</span><span>点击乐手 · 声部进入</span><span><kbd>E</kbd> / 左侧上划 · 渐强　<kbd>D</kbd> / 左侧下划 · 渐弱</span>'
  world.resize()
  await startLevel(chart, {
    onVoice: () => {},
    onDone: finish,
  })
  setDynamics(1)
}

function loop() {
  requestAnimationFrame(loop)
  if (!chart || mode === "home" || mode === "result") {
    return
  }
  const now = transportSeconds()
  if (mode === "count-in" && now >= chart.countIn) {
    mode = "playing"
    statusEl.textContent = "演奏"
  }
  progressEl.style.width = `${Math.min(100, now / chart.duration * 100)}%`
  beatDots.forEach((dot, i) => dot.classList.toggle("active", Math.floor(now / chart.beat) % 4 === i))
  const nextLeft = cues.find(cue => cue.hand === "left" && !cue.result && cue.time >= now - GOOD)
  if (now < chart.countIn) cueHintEl.textContent = `预备 · ${4 - Math.min(3, Math.floor(now / chart.beat))}`
  else if (nextLeft && nextLeft.time - now < 2) {
    cueHintEl.textContent = nextLeft.kind === "cue" ? `指向光圈 · ${nextLeft.part === "violin" ? "小提琴" : "长笛"}进入` : nextLeft.direction === "up" ? "抬起左手 · 渐强  E" : "放低左手 · 渐弱  D"
  } else cueHintEl.textContent = "右手跟随箭头 · 穿过金线时打拍"
  if (mode === "playing") {
    const bar = Math.min(chart.bars, Math.floor((now - chart.countIn) / (chart.meter * chart.beat)) + 1)
    if (bar > 0) statusEl.textContent = `第 ${bar} / ${chart.bars} 小节`
  }
  cues.forEach((cue, index) => {
    if (!spawned.has(index) && cue.time - now < 2.05) {
      spawned.add(index)
      world.spawn(cue)
    }
    if (!cue.result && now > cue.time + GOOD) scoreCue(cue, "miss")
  })
  if (now >= chart.duration) finish()
  const playing = new Set(["piano", "cello"])
  if (cues.some((cue) => cue.kind === "cue" && cue.part === "violin" && cue.result && cue.result !== "miss")) playing.add("violin")
  if (cues.some((cue) => cue.kind === "cue" && cue.part === "flute" && cue.result && cue.result !== "miss")) playing.add("flute")
  world.update(now, playing)
}

window.addEventListener("keydown", (event) => {
  const beat = { ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up" }[event.key]
  if (beat) {
    event.preventDefault()
    playBeat(beat)
  }
  if (event.key === "e" || event.key === "E") playPalm("up")
  if (event.key === "d" || event.key === "D") playPalm("down")
})

view.addEventListener("pointerdown", (event) => {
  view.setPointerCapture(event.pointerId)
  pointer = { x: event.clientX, y: event.clientY, left: event.offsetX < view.clientWidth / 2 }
})

view.addEventListener("pointercancel", () => { pointer = null })

view.addEventListener("pointerup", (event) => {
  if (!pointer) return
  const dx = event.clientX - pointer.x
  const dy = event.clientY - pointer.y
  const fromLeft = pointer.left
  pointer = null
  if (Math.hypot(dx, dy) < 36) {
    playPoint(world.pick(event.clientX, event.clientY))
    return
  }
  const direction = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? "right" : "left")
    : (dy > 0 ? "down" : "up")
  if (fromLeft && (direction === "up" || direction === "down")) playPalm(direction)
  else if (!fromLeft) playBeat(direction)
})

document.querySelector("#retry").addEventListener("click", begin)
document.querySelector("#back").addEventListener("click", () => {
  stopLevel()
  setMode("home")
})

window.addEventListener("resize", () => world.resize())
setMode("home")
world.resize()
loop()

