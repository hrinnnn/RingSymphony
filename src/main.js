import { endFree, partLevels, queuePart, setDynamics, setPart, setPartGain, setTempo, startFree, startLevel, stopLevel, transportBeats, transportSeconds } from "./audio.js"
import { buildChart } from "./chart.js"
import { createMixerHud } from "./hud.js"
import { GOOD, PERFECT } from "./judge.js"
import { lassoParts, pathLength } from "./lasso.js"
import { createMixer, PART_INFO, PARTS } from "./mixer.js"
import { LOOP_BARS } from "./score.js"
import { createTempo } from "./tempo.js"
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
const starsEl = document.querySelector("#stars")
const toolsEl = document.querySelector("#tools")
const toastEl = document.querySelector("#toast")
const exitEl = document.querySelector("#exit")
const lassoPath = document.querySelector("#lasso path")
const sessionTitle = document.querySelector("#session-title")
const sessionSub = document.querySelector("#session-sub")
const tallyLabel = document.querySelector("#tally-label")

const world = createWorld(view)
const beatDots = [...document.querySelectorAll(".beat-dot")]
const progressEl = document.querySelector("#progress-fill")
const cueHintEl = document.querySelector("#cue-hint")
const tallyEl = document.querySelector("#tally")
const hud = createMixerHud(document.querySelector("#mixer"), pickCard)

let chart = null
let cues = []
let counts = { perfect: 0, good: 0, miss: 0 }
let mode = "home"
let spawned = new Set()
let dynamics = 1
let pointer = null
let gradeFlip = false
let toastTimer = 0
const mixer = createMixer()
const tempo = createTempo(96)
let ending = false

function levelButton(icon, tone, title, detail, tag, onClick) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "level"
  button.dataset.icon = icon
  button.style.setProperty?.("--tone", tone)
  button.innerHTML = `<span>${title}</span><small>${detail}</small>${tag ? `<i class="tag">${tag}</i>` : ""}`
  button.addEventListener("click", onClick)
  levelList.append(button)
}
levelButton("♪", "var(--pink)", "练习曲 · 四拍 · 96", "右手跟着飞来的音符打拍<br>左手点名小提琴、长笛，抬手渐强", "节奏关卡", begin)
levelButton("♫", "var(--mint)", "自由指挥 · 分声部", "点选或画圈选中声部，起奏、停止、独奏<br>挥拍的快慢就是乐队的速度", "自由模式", beginFree)

function setMode(next) {
  mode = next
  homeEl.hidden = next !== "home"
  playEl.hidden = next === "home"
  resultEl.hidden = next !== "result"
  hintEl.hidden = next === "home" || next === "result"
  toolsEl.hidden = next !== "free"
  exitEl.hidden = next === "home"
  document.body.dataset.mode = next
  if (next === "home") { statusEl.textContent = "选关"; world.resize() }
}

function toast(text) {
  toastEl.textContent = text
  toastEl.classList.toggle("show", true)
  window.clearTimeout?.(toastTimer)
  toastTimer = window.setTimeout(() => toastEl.classList.toggle("show", false), 1600)
}

function showGrade(kind) {
  const label = kind === "perfect" ? "Perfect!" : kind === "good" ? "Good!" : "Miss"
  gradeFlip = !gradeFlip
  gradeEl.textContent = label
  gradeEl.className = gradeFlip ? `${kind} pop2` : kind
  gradeEl.hidden = false
  window.setTimeout(() => {
    if (gradeEl.textContent === label) gradeEl.hidden = true
  }, 480)
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
  if (mode === "free") return freeBeat(direction)
  if (mode !== "playing" && mode !== "count-in") return
  world.pose("right", direction)
  const found = nearest(transportSeconds(), "right")
  if (!found || found.cue.kind !== "beat") return
  const kind = found.cue.direction === direction ? gradeDistance(found.distance) : "miss"
  scoreCue(found.cue, kind)
}

function playPalm(direction) {
  if (mode === "free") return freeNudge(direction)
  if (mode !== "playing" && mode !== "count-in") return
  world.pose("left", direction)
  const found = nearest(transportSeconds(), "left")
  if (!found || found.cue.kind !== "dynamics" || found.cue.direction !== direction) return
  scoreCue(found.cue, gradeDistance(found.distance))
}

function playPoint(part) {
  if (mode === "free") return freeSelect(part)
  if (!part || (mode !== "playing" && mode !== "count-in")) return
  world.pose("left", "point", part)
  const found = nearest(transportSeconds(), "left")
  if (!found || found.cue.kind !== "cue" || found.cue.part !== part) return
  scoreCue(found.cue, gradeDistance(found.distance))
}

function pickCard(part) {
  playPoint(part)
}

function finish() {
  if (mode === "result") return
  stopLevel()
  const total = cues.length
  const percent = Math.round(((counts.perfect + counts.good * 0.5) / total) * 100)
  const stars = percent >= 90 ? 3 : percent >= 70 ? 2 : percent >= 40 ? 1 : 0
  accuracyEl.textContent = `${percent}%`
  countsEl.innerHTML = `<span class="perfect">Perfect ${counts.perfect}</span><span class="good">Good ${counts.good}</span><span class="miss">Miss ${counts.miss}</span>`
  starsEl.innerHTML = [0, 1, 2].map((i) => `<i class="${i < stars ? "lit" : ""}">★</i>`).join("")
  setMode("result")
  statusEl.textContent = "结果"
}

async function begin() {
  stopLevel()
  world.reset()
  mixer.reset()
  chart = buildChart()
  cues = chart.cues.map((cue) => ({ ...cue, result: null }))
  counts = { perfect: 0, good: 0, miss: 0 }
  spawned = new Set()
  dynamics = 1
  gradeEl.hidden = true
  tallyEl.textContent = "0000"
  tallyLabel.textContent = "SCORE"
  sessionTitle.textContent = "练习曲"
  sessionSub.textContent = "ÉTUDE I　/　4:4　/　96 BPM"
  progressEl.style.width = "0%"
  setMode("count-in")
  statusEl.textContent = "预备"
  hintEl.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 或右半屏滑动 · 打拍</span><span>点击乐手 · 声部进入</span><span><kbd>E</kbd> 左侧上划 · 渐强</span><span><kbd>D</kbd> 左侧下划 · 渐弱</span>'
  world.resize()
  await startLevel(chart, {
    onVoice: (part) => world.emit?.(part),
    onDone: finish,
  })
  setDynamics(1)
}

// ---------- Free conducting: per-section entries, exits, dynamics and solo ----------

async function beginFree() {
  stopLevel()
  world.reset()
  mixer.reset()
  tempo.reset(96)
  chart = null
  dynamics = 1
  ending = false
  gradeEl.hidden = true
  sessionTitle.textContent = "自由指挥"
  sessionSub.textContent = "FREE　/　4:4　/　C · G · Am · F"
  tallyLabel.textContent = "BPM"
  tallyEl.textContent = "96"
  progressEl.style.width = "0%"
  setMode("free")
  statusEl.textContent = "等待起奏"
  hintEl.innerHTML = '<span>点乐手 / <kbd>1</kbd>–<kbd>4</kbd> · 选声部</span><span>拖动画圈 · 圈选</span><span><kbd>F</kbd> 起奏　<kbd>G</kbd> 停止</span><span><kbd>E</kbd><kbd>D</kbd> 渐强渐弱　<kbd>S</kbd> 独奏</span><span><kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> 打拍控速</span>'
  world.resize()
  await startFree({ onVoice: (part) => world.emit?.(part) })
  setDynamics(1)
  toast("先选一个声部，再按 F 起奏")
}

const names = (list) => list.map((part) => PART_INFO[part].name).join("、")

function freeSelect(part) {
  if (!part) {
    if (mixer.selected.size) toast("取消选择")
    mixer.clearSelection()
    return
  }
  mixer.toggle(part)
  if (mixer.selected.has(part)) world.pose("left", "point", part)
}

function freeLasso(list) {
  if (!list.length) return
  mixer.selectOnly(list)
  world.pose("left", "point", list[0])
  toast(`圈选 · ${names(list)}`)
}

function applyGains() {
  PARTS.forEach((part) => { if (mixer.parts[part].on) setPartGain(part, mixer.gainOf(part)) })
}

function freeStart() {
  if (ending) return
  const list = [...mixer.selected]
  if (!list.length) { toast("先点一个乐手，或画圈圈选几个声部"); return }
  const changed = mixer.request(list, true)
  if (!changed.length) { toast(`${names(list)} 已经在演奏`); return }
  world.pose("left", "point", changed[0])
  changed.forEach((part) => queuePart(part, mixer.gainOf(part, true), "4n", () => mixer.commit(part)))
  toast(`${names(changed)} · 下一拍进入`)
  mixer.clearSelection()
}

function freeStop() {
  if (ending) return
  const list = [...mixer.selected]
  if (list.length) {
    const changed = mixer.request(list, false)
    world.pose("left", "down")
    changed.forEach((part) => queuePart(part, 0, "4n", () => mixer.commit(part)))
    toast(changed.length ? `${names(changed)} · 下一拍停下` : "它们本来就在休息")
    mixer.clearSelection()
    return
  }
  if (!mixer.anyOn()) { toast("乐队还没开始呢"); return }
  ending = true
  mixer.request(PARTS, false)
  world.pose("left", "down")
  toast("握拳收束 · 这一小节后谢幕")
  endFree(() => {
    PARTS.forEach((part) => mixer.commit(part))
    mixer.toggleSolo([])
    tempo.reset(96)
    setTempo(96)
    tallyEl.textContent = "96"
    ending = false
    statusEl.textContent = "等待起奏"
    toast("已谢幕 · 再选声部可以开始新的一段")
  })
}

function freeNudge(direction) {
  world.pose("left", direction)
  const list = [...mixer.selected]
  if (list.length) {
    mixer.nudge(list, direction)
    applyGains()
    toast(`${names(list)} · ${direction === "up" ? "渐强" : "渐弱"} ${Math.round(mixer.parts[list[0]].local * 100)}%`)
    return
  }
  dynamics = Math.max(0.4, Math.min(1.6, dynamics + (direction === "up" ? 0.2 : -0.2)))
  setDynamics(dynamics)
  toast(`全体 · ${direction === "up" ? "渐强" : "渐弱"} ${Math.round(dynamics * 100)}%`)
}

function freeSolo() {
  const list = [...mixer.selected]
  const solo = mixer.toggleSolo(list)
  applyGains()
  toast(solo ? `${names([...solo])} 独奏 · 其他声部变轻` : "恢复合奏")
}

function freeBeat(direction) {
  world.pose("right", direction)
  if (!mixer.anyOn() || ending) return
  const bpm = tempo.tap(performance.now() / 1000)
  setTempo(bpm)
  tallyEl.textContent = String(Math.round(bpm))
}

function freeAction(act) {
  if (mode !== "free") return
  if (act === "start") freeStart()
  else if (act === "stop") freeStop()
  else if (act === "up" || act === "down") freeNudge(act)
  else if (act === "solo") freeSolo()
  else if (act === "all") { mixer.selectOnly(PARTS); toast("全体乐队") }
}

function freeView(levels) {
  const view = {}
  for (const part of PARTS) {
    const p = mixer.parts[part]
    const soloing = mixer.solo?.has(part)
    const ducked = p.on && mixer.solo && !soloing
    const label = p.pending === "in" ? "下一拍进入" : p.pending === "out" ? "下一拍停" : !p.on ? "休息中" : soloing ? "独奏" : ducked ? "伴奏" : `演奏 ${Math.round(p.local * 100)}%`
    view[part] = { label, on: p.on, selected: mixer.selected.has(part), pending: Boolean(p.pending), solo: soloing, ducked, level: levels[part] }
  }
  return view
}

function levelView(playing, levels) {
  const view = {}
  const waiting = new Set(cues.filter((cue) => cue.kind === "cue" && !cue.result).map((cue) => cue.part))
  for (const part of PARTS) {
    const on = playing.has(part)
    view[part] = { label: on ? "演奏中" : waiting.has(part) ? "等你点名" : "休息中", on, pending: !on && waiting.has(part), level: levels[part] }
  }
  return view
}

function freeLoop() {
  const beats = transportBeats()
  const bar = Math.floor(beats / 4) % LOOP_BARS
  progressEl.style.width = `${((beats % (LOOP_BARS * 4)) / (LOOP_BARS * 4)) * 100}%`
  beatDots.forEach((dot, i) => dot.classList.toggle("active", mixer.anyOn() && Math.floor(beats) % 4 === i))
  const playing = mixer.playing()
  if (playing.size && !ending) statusEl.textContent = `第 ${bar + 1} / ${LOOP_BARS} 小节`
  const selected = [...mixer.selected]
  if (ending) cueHintEl.textContent = "谢幕中…"
  else if (selected.length) cueHintEl.textContent = `已选 ${names(selected)} · F 起奏 / G 停止 / S 独奏`
  else if (!playing.size) cueHintEl.textContent = "点一位乐手，或拖动鼠标画个圈"
  else cueHintEl.textContent = "挥拍控制速度 · 没选人时 G 全体收束"
  const pending = new Map(PARTS.filter((part) => mixer.parts[part].pending).map((part) => [part, mixer.parts[part].pending]))
  const levels = partLevels?.() || {}
  hud.update(freeView(levels))
  world.update(beats * 60 / 96, playing, { selected: mixer.selected, pending, solo: mixer.solo })
}

function loop() {
  requestAnimationFrame(loop)
  if (mode === "free") return freeLoop()
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
    cueHintEl.textContent = nextLeft.kind === "cue" ? `点一下发光的圈 · ${nextLeft.part === "violin" ? "小提琴" : "长笛"}进入` : nextLeft.direction === "up" ? "抬起左手 · 渐强  E" : "放低左手 · 渐弱  D"
  } else cueHintEl.textContent = "音符落到判定线时 · 按同方向打拍"
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
  hud.update(levelView(playing, partLevels?.() || {}))
  const pending = new Map(cues.filter((cue) => cue.kind === "cue" && !cue.result && cue.time - now < 2).map((cue) => [cue.part, "in"]))
  world.update(now, playing, { selected: new Set(), pending, solo: null })
}

window.addEventListener("keydown", (event) => {
  if (event.repeat) return
  const beat = { ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up" }[event.key]
  if (beat) {
    event.preventDefault()
    playBeat(beat)
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (key === "e") playPalm("up")
  if (key === "d") playPalm("down")
  if (mode !== "free") return
  const part = PARTS.find((name) => PART_INFO[name].key === key)
  if (part) freeSelect(part)
  if (key === "f") freeStart()
  if (key === "g") freeStop()
  if (key === "s") freeSolo()
  if (key === "a") freeAction("all")
  if (key === "Escape") mixer.clearSelection()
})

toolsEl.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-act]")
  if (button) freeAction(button.dataset.act)
})

function local(event) {
  const rect = view.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

view.addEventListener("pointerdown", (event) => {
  view.setPointerCapture(event.pointerId)
  pointer = { x: event.clientX, y: event.clientY, left: event.offsetX < view.clientWidth / 2, trail: mode === "free" ? [local(event)] : null }
})

view.addEventListener("pointermove", (event) => {
  if (!pointer?.trail) return
  pointer.trail.push(local(event))
  if (pathLength(pointer.trail) > 36) {
    lassoPath.setAttribute("d", "M" + pointer.trail.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L") + " Z")
  }
})

view.addEventListener("pointercancel", () => {
  pointer = null
  lassoPath?.setAttribute("d", "")
})

view.addEventListener("pointerup", (event) => {
  if (!pointer) return
  const dx = event.clientX - pointer.x
  const dy = event.clientY - pointer.y
  const fromLeft = pointer.left
  const trail = pointer.trail
  pointer = null
  if (trail) {
    lassoPath.setAttribute("d", "")
    if (pathLength(trail) > 60) {
      freeLasso(lassoParts(trail, world.screenPositions()))
      return
    }
  }
  if (Math.hypot(dx, dy) < 36) {
    playPoint(world.pick(event.clientX, event.clientY))
    return
  }
  if (mode === "free") return
  const direction = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? "right" : "left")
    : (dy > 0 ? "down" : "up")
  if (fromLeft && (direction === "up" || direction === "down")) playPalm(direction)
  else if (!fromLeft) playBeat(direction)
})

function goHome() {
  stopLevel()
  mixer.reset()
  ending = false
  setMode("home")
}

document.querySelector("#retry").addEventListener("click", begin)
document.querySelector("#back").addEventListener("click", goHome)
exitEl.addEventListener("click", goHome)

window.addEventListener("resize", () => world.resize())
setMode("home")
world.resize()
loop()
