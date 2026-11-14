import { endFree, partLevels, queuePart, setDynamics, setPart, setPartGain, setTempo, songSeconds, startFree, startLevel, stopLevel, transportBeats } from "./audio.js"
import { buildChart, STUDIES } from "./chart.js"
import { createMixerHud } from "./hud.js"
import { GOOD, PERFECT } from "./judge.js"
import { lassoParts, pathLength } from "./lasso.js"
import { createMixer, PART_INFO, PARTS } from "./mixer.js"
import { createLane } from "./lane.js"
import { startRing } from "./ring/index.js"
import { createCameraTracker } from "./camera/tracker.js"
import { createCameraLog } from "./camera/log.js"
import { createCameraPanel } from "./camera/panel.js"
import { LOOP_BARS } from "./score.js"
import { createSettings } from "./settings.js"
import { createTempo } from "./tempo.js"
import { createWorld } from "./world.js"

const statusEl = document.querySelector("#status")
const homeEl = document.querySelector("#home")
const playEl = document.querySelector("#play")
const resultEl = document.querySelector("#result")
const hintEl = document.querySelector("#hint")
const view = document.querySelector("#view")
const levelList = document.querySelector("#level-list")
const accuracyEl = document.querySelector("#accuracy")
const countsEl = document.querySelector("#counts")
const timingEl = document.querySelector("#timing")
const starsEl = document.querySelector("#stars")
const toolsEl = document.querySelector("#tools")
const toastEl = document.querySelector("#toast")
const exitEl = document.querySelector("#exit")
const lassoPath = document.querySelector("#lasso path")
const sessionTitle = document.querySelector("#session-title")
const sessionSub = document.querySelector("#session-sub")
const tallyLabel = document.querySelector("#tally-label")

const laneCanvas = document.querySelector("#lane")
const world = createWorld(view, laneCanvas)
const lane = createLane(laneCanvas)
const settings = createSettings({ button: document.querySelector("#settings-btn"), panel: document.querySelector("#settings-panel") })
const beatDots = [...document.querySelectorAll(".beat-dot")]
const progressEl = document.querySelector("#progress-fill")
const cueHintEl = document.querySelector("#cue-hint")
const tallyEl = document.querySelector("#tally")
const hud = createMixerHud(document.querySelector("#mixer"), pickCard)
// The camera is optional and additive. With it off, verdict() returns null and every beat takes
// exactly the path it took before the camera existed.
const camera = createCameraTracker()
const cameraLog = createCameraLog()

let chart = null
let cues = []
let counts = { perfect: 0, good: 0, miss: 0 }
// Signed timing error (s, negative = early) of every cue that scored, for the early / late summary.
let deltas = []
// Right-hand ring beats only, for the automatic 延迟补偿 adjustment: keyboard and mouse hits go
// through a different path and must not steer a correction meant for the ring pipeline.
let ringDeltas = []
let mode = "home"
let spawned = new Set()
let dynamics = 1
let pointer = null
let toastTimer = 0
// 方向不确定 fires per unrecognised stroke, which during a level means it never leaves the
// screen. Showing it occasionally is a hint; showing it constantly is just noise over the stage.
let unclearAt = -Infinity
let unclearRun = 0
const mixer = createMixer()
const tempo = createTempo(96)
let ending = false
let lastStudy = STUDIES[0]
// A ring gesture reaches the page a little after it happened; keep a cue open that long past its Good window.
const LATE_GRACE = 0.12
// The user's input delay (Settings) is subtracted from every gesture time: a gesture is judged that much earlier than it arrived.
const inputNow = () => songSeconds() - settings.latency
const TIMING_EDGE = 0.03

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
STUDIES.forEach((study, i) => levelButton(["♪", "♩", "♬"][i], ["var(--pink)", "var(--sky)", "var(--butter)"][i], study.title, study.blurb, study.tag, () => begin(study)))
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

function scoreCue(cue, kind, delta) {
  if (cue.result) return
  cue.result = kind
  counts[kind] += 1
  if (kind !== "miss" && delta !== undefined) deltas.push(delta)
  tallyEl.textContent = String(counts.perfect * 100 + counts.good * 50).padStart(4, "0")
  lane.hit(cue, kind, delta)
  if (kind === "miss") return
  if (cue.kind === "cue") { setPart(cue.part, true); world.pose("left", "point", cue.part) }
  if (cue.kind === "dynamics") {
    dynamics = cue.direction === "up" ? 1.6 : 0.7
    setDynamics(dynamics)
    world.pose("left", cue.direction)
  }
}

function nearest(now, hand, kind) {
  let best = null
  let distance = Infinity
  for (const cue of cues) {
    if (cue.result || cue.hand !== hand || (kind && cue.kind !== kind)) continue
    const gap = Math.abs(now - cue.time)
    if (gap < distance) {
      distance = gap
      best = cue
    }
  }
  // Reach at least as far as the sweep that marks a cue missed, or a gesture can fall between
  // the two: too far from the cue to be matched here, not yet old enough to be swept, so the
  // player gets no judgement at all. The first cue of a level is the likeliest to land there.
  const reach = Math.max(chart.beat / 2, GOOD + LATE_GRACE)
  if (!best || distance > reach) return null
  return { cue: best, distance, delta: now - best.time }
}

function gradeDistance(distance) {
  if (distance <= PERFECT) return "perfect"
  if (distance <= GOOD) return "good"
  return "miss"
}

// `at` is the gesture time on the song clock; rings supply it back-dated by their transmission delay.
// A "weak" beat cleared the low trigger but not the high one: it is only taken as a beat when it
// lands near a cue the player was due to hit, so incidental motion is dropped instead of scored.
function playBeat(direction, at = inputNow(), fromRing = false, tier = "strong") {
  if (mode === "free") return freeBeat(direction)
  if (mode !== "playing" && mode !== "count-in") return
  if (!direction) {
    if (fromRing && tier === "strong") {
      const now = inputNow()
      unclearRun = now - unclearAt < 6 ? unclearRun + 1 : 1
      unclearAt = now
      // Say it once, then stay quiet unless it keeps happening — at which point the advice
      // changes, because by the fourth miss in a row the problem is the calibration, not the wave.
      if (unclearRun === 1) toast("方向不确定")
      else if (unclearRun === 4) toast("方向总是认不出，建议到「指环」面板补录该方向")
    }
    return
  }
  const found = nearest(at, "right", "beat")
  // A weak beat still moves the hand: the player made a motion and the stage should answer it.
  // It simply does not score when there is no cue it could plausibly belong to.
  world.pose("right", direction)
  if (tier === "weak" && !(found && found.distance <= GOOD * 2)) return
  if (!found) return
  if (fromRing && found.cue.direction === direction && found.distance <= GOOD) {
    ring?.reportError(at - found.cue.time)
    ringDeltas.push(at - found.cue.time)
  }
  const kind = found.cue.direction === direction ? gradeDistance(found.distance) : "miss"
  scoreCue(found.cue, kind, found.delta)
}

function playPalm(direction, at = inputNow()) {
  if (mode === "free") return freeNudge(direction)
  if (mode !== "playing" && mode !== "count-in") return
  world.pose("left", direction)
  const found = nearest(at, "left")
  if (!found || found.cue.kind !== "dynamics" || found.cue.direction !== direction) return
  scoreCue(found.cue, gradeDistance(found.distance), found.delta)
}

function playPoint(part, at = inputNow()) {
  if (mode === "free") return freeSelect(part)
  if (!part || (mode !== "playing" && mode !== "count-in")) return
  world.pose("left", "point", part)
  const found = nearest(at, "left")
  if (!found || found.cue.kind !== "cue" || found.cue.part !== part) return
  scoreCue(found.cue, gradeDistance(found.distance), found.delta)
}

function pickCard(part) {
  if (manual("left")) playPoint(part)
}

// ---------- Rings ----------

function onRing(event) {
  if (mode === "free") {
    if (event.hand !== "left") return
    const calibration = ring.input.snapshot().palmCalibration
    if (calibration.active) return
    if (event.type === "strike") freeStart()
    else if (event.type === "palm") {
      if (calibration.ready) playPalm(event.dir)
      else toast("请先校准左手抬掌/压掌")
    }
    return
  }
  if (mode !== "playing" && mode !== "count-in") return
  const at = inputNow() - event.age
  // The fist belongs to free mode, where it winds the orchestra down over the bar. In a rhythm
  // level it was an irreversible kill switch that either hand could trip on a single spike —
  // a sharp conducting stroke makes much the same angular jerk as a clench.
  if (event.type === "fist") return
  if (event.hand === "right" && event.type === "beat") playBeat(event.dir, at, true, event.tier)
  else if (event.hand === "left" && event.type === "palm") playPalm(event.dir, at)
  else if (event.hand === "left" && event.type === "strike") {
    // Without a camera the strike cannot say who is pointed at, so it answers whichever entrance is due.
    const found = nearest(at, "left", "cue")
    if (found) playPoint(found.cue.part, at)
    else world.pose("left", "point")
  }
}

const ring = startRing({
  onGesture: onRing,
  // The camera answers where the ring is blind: up and down sit about 166 degrees apart in the
  // ring's own axes, so no threshold separates a down-stroke from the return of an up-stroke.
  // Synchronous and cheap — nothing in the beat path waits for a frame.
  cameraVerdict: (hand, at) => camera.verdict(hand, at),
  onDisagreement: (entry) => cameraLog.record({ ...entry, frames: camera.framesFor(entry.hand, entry.t) }),
  onPreview: (event) => {
    if (mode === "playing" || mode === "count-in") world.previewRight(event.dir)
  },
  // A reversal is only rescued from return-suppression when the chart actually wants that
  // direction then, so a slow return cannot be excused by a cue for the opposite stroke.
  cueDue: (at, direction) => {
    if (mode !== "playing" && mode !== "count-in") return false
    const found = nearest(at, "right", "beat")
    return Boolean(found && found.cue.direction === direction && found.distance <= GOOD)
  },
})

const cameraPanel = createCameraPanel({
  tracker: camera,
  log: cameraLog,
  chip: document.querySelector("#camera-btn"),
  host: ring.cameraHost,
  offer: document.querySelector("#camera-offer"),
})
// A stored "on" is honoured without asking again; anything else leaves getUserMedia uncalled.
cameraPanel.resume()
cameraPanel.offerIfUnasked()

function timingSummary() {
  if (!deltas.length) { timingEl.innerHTML = ""; settings.suggest(null); return }
  const early = deltas.filter((d) => d < -TIMING_EDGE).length
  const late = deltas.filter((d) => d > TIMING_EDGE).length
  const mean = Math.round(deltas.reduce((sum, d) => sum + d, 0) / deltas.length * 1000)
  const bias = mean === 0 ? "平均 刚好" : `平均${mean < 0 ? "偏早" : "偏晚"} ${Math.abs(mean)} ms`
  timingEl.innerHTML = `<span class="early">偏早 ${early}</span><span>准 ${deltas.length - early - late}</span><span class="late">偏晚 ${late}</span><span>${bias}</span>`
  settings.suggest(deltas.length >= 6 && Math.abs(mean) >= 15 ? mean : null)
}

// After a level, nudge 延迟补偿 toward the offset the player's ring beats actually showed.
//
// Only after a level, never during one: adjusting mid-play moves the judgement window while the
// player is adapting to it, and two identical strokes in the same level would be judged
// differently. Only the ring's compensation, never 设置's 判定延迟 — both are fed by the same
// measurement, so applying to both would correct the same error twice.
//
// The measurement is biased: reportError only records beats that landed within GOOD, so strokes
// far enough out to miss are never sampled and the mean understates the true offset, more so the
// worse the timing is. Hence a partial step rather than the full correction, and a cap: the
// estimate is a direction to move in, not a value to trust outright.
const AUTO_COMP_MIN_SAMPLES = 6
const AUTO_COMP_DEADZONE = 0.02
const AUTO_COMP_STEP = 0.6
const AUTO_COMP_MAX_MOVE = 0.08

function autoCompensate() {
  if (!ring?.input || ringDeltas.length < AUTO_COMP_MIN_SAMPLES) return
  const mean = ringDeltas.reduce((sum, d) => sum + d, 0) / ringDeltas.length
  if (Math.abs(mean) < AUTO_COMP_DEADZONE) return
  const move = Math.max(-AUTO_COMP_MAX_MOVE, Math.min(AUTO_COMP_MAX_MOVE, mean * AUTO_COMP_STEP))
  const before = ring.input.compensation
  ring.input.compensation += move
  const applied = Math.round((ring.input.compensation - before) * 1000)
  if (applied) toast(`已自动调整延迟补偿 ${applied > 0 ? "+" : ""}${applied} ms（指环面板可改）`)
}

function finish() {
  if (mode === "result") return
  stopLevel()
  const total = cues.length
  const percent = Math.round(((counts.perfect + counts.good * 0.5) / total) * 100)
  const stars = percent >= 90 ? 3 : percent >= 70 ? 2 : percent >= 40 ? 1 : 0
  accuracyEl.textContent = `${percent}%`
  countsEl.innerHTML = `<span class="perfect">Perfect ${counts.perfect}</span><span class="good">Good ${counts.good}</span><span class="miss">Miss ${counts.miss}</span>`
  timingSummary()
  autoCompensate()
  starsEl.innerHTML = [0, 1, 2].map((i) => `<i class="${i < stars ? "lit" : ""}">★</i>`).join("")
  setMode("result")
  statusEl.textContent = "结果"
}

async function begin(study = lastStudy) {
  const ringSnapshot = ring.input?.snapshot()
  if (ring.input?.live("right") && !ringSnapshot.direction.ready) {
    ring.openPanel()
    toast("请先完成右手四个方向的校准")
    return
  }
  if (ring.input?.live("left") && !ringSnapshot.palmCalibration.ready) {
    ring.openPanel()
    toast("请先完成左手抬掌/压掌校准")
    return
  }
  lastStudy = study
  ring.clearTiming()
  // Forget whatever the hands were doing before the level: otherwise the first beat can be
  // suppressed as the return of a stroke the player made on their way to starting.
  ring.resetGestureState?.()
  ring.closePanel?.()
  settings.close()
  stopLevel()
  world.reset()
  lane.reset()
  mixer.reset()
  chart = buildChart(study)
  cues = chart.cues.map((cue) => ({ ...cue, result: null }))
  counts = { perfect: 0, good: 0, miss: 0 }
  deltas = []
  ringDeltas = []
  spawned = new Set()
  dynamics = 1
  tallyEl.textContent = "0000"
  tallyLabel.textContent = "SCORE"
  sessionTitle.textContent = study.title
  sessionSub.textContent = study.sub
  beatDots.forEach((dot, i) => { dot.hidden = i >= chart.meter })
  progressEl.style.width = "0%"
  setMode("count-in")
  statusEl.textContent = "预备"
  hintEl.innerHTML = [
    manual("right") ? "<span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 或右半屏滑动 · 打拍（右手戒指未连接）</span>" : "<span>右手戒指 · 按箭头方向和节拍挥动</span>",
    manual("left") ? "<span>点击乐手 · 声部进入</span><span><kbd>E</kbd> 左侧上划 · 渐强</span><span><kbd>D</kbd> 左侧下划 · 渐弱</span>" : "<span>左手戒指 · 向前一指进入，掌心抬 / 压 = 渐强 / 渐弱</span>",
    "<span>握拳 · 停止</span>",
  ].join("")
  world.setLevelHands(true)
  world.resize()
  lane.resize()
  await startLevel(chart, {
    onVoice: (part) => world.emit?.(part),
    onDone: () => { if (cues.every((cue) => cue.result)) finish() },
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
  sessionTitle.textContent = "自由指挥"
  sessionSub.textContent = "FREE　/　4:4　/　C · G · Am · F"
  tallyLabel.textContent = "BPM"
  tallyEl.textContent = "96"
  progressEl.style.width = "0%"
  setMode("free")
  beatDots.forEach((dot) => { dot.hidden = false })
  statusEl.textContent = "等待起奏"
  hintEl.innerHTML = '<span>点乐手 / <kbd>1</kbd>–<kbd>4</kbd> · 选声部</span><span>拖动画圈 · 圈选</span><span>左手指环前指 / <kbd>F</kbd> 起奏　<kbd>G</kbd> 停止</span><span>左手抬/压掌 / <kbd>E</kbd><kbd>D</kbd> 渐强渐弱　<kbd>S</kbd> 独奏</span><span><kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> 打拍控速</span>'
  world.setLevelHands(false)
  world.resize()
  lane.resize()
  lane.update(0, null, [])
  await startFree({ onVoice: (part) => world.emit?.(part) })
  setDynamics(1)
  toast("先选声部，再前指或按 F 起奏")
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
  else if (selected.length) cueHintEl.textContent = `已选 ${names(selected)} · 前指 / F 起奏 · G 停止 / S 独奏`
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
  const now = Math.max(0, songSeconds())
  if (mode === "count-in" && now >= chart.countIn) {
    mode = "playing"
    statusEl.textContent = "演奏"
  }
  progressEl.style.width = `${Math.min(100, now / chart.duration * 100)}%`
  beatDots.forEach((dot, i) => dot.classList.toggle("active", Math.floor(now / chart.beat) % chart.meter === i))
  const nextLeft = cues.find(cue => cue.hand === "left" && !cue.result && cue.time >= now - GOOD)
  const leftRing = !manual("left")
  const rightRing = !manual("right")
  if (now < chart.countIn) cueHintEl.textContent = `预备 · ${chart.meter - Math.min(chart.meter - 1, Math.floor(now / chart.beat))}`
  else if (nextLeft && nextLeft.time - now < 2) {
    if (nextLeft.kind === "cue") cueHintEl.textContent = leftRing ? `左手向前一指 · ${PART_INFO[nextLeft.part].name}进入` : `点一下发光的圈 · ${PART_INFO[nextLeft.part].name}进入`
    else if (nextLeft.direction === "up") cueHintEl.textContent = leftRing ? "左手掌心向上抬 · 渐强" : "抬起左手 · 渐强  E"
    else cueHintEl.textContent = leftRing ? "左手压下去 · 渐弱" : "放低左手 · 渐弱  D"
  } else cueHintEl.textContent = rightRing ? "音符落到判定圈时 · 按箭头方向挥动右手" : "音符落到判定圈时 · 按同方向打拍"
  if (mode === "playing") {
    const bar = Math.min(chart.bars, Math.floor((now - chart.countIn) / (chart.meter * chart.beat)) + 1)
    if (bar > 0) statusEl.textContent = `第 ${bar} / ${chart.bars} 小节`
  }
  // A positive input delay judges gestures earlier, so a cue must stay open that much longer.
  const delay = Math.max(0, settings.latency)
  cues.forEach((cue, index) => {
    if (!spawned.has(index) && cue.time - now < 2.05) {
      spawned.add(index)
      if (cue.kind === "cue") world.spawn(cue)
    }
    const grace = ((cue.hand === "right" && rightRing) || (cue.hand === "left" && leftRing) ? 0.5 : LATE_GRACE) + delay
    if (!cue.result && now > cue.time + GOOD + grace) scoreCue(cue, "miss")
  })
  if (now >= chart.duration && cues.every((cue) => cue.result)) finish()
  const playing = new Set(["piano", "cello"])
  if (cues.some((cue) => cue.kind === "cue" && cue.part === "violin" && cue.result && cue.result !== "miss")) playing.add("violin")
  if (cues.some((cue) => cue.kind === "cue" && cue.part === "flute" && cue.result && cue.result !== "miss")) playing.add("flute")
  hud.update(levelView(playing, partLevels?.() || {}))
  const pending = new Map(cues.filter((cue) => cue.kind === "cue" && !cue.result && cue.time - now < 2).map((cue) => [cue.part, "in"]))
  lane.update(now, chart, cues)
  world.update(now, playing, { selected: new Set(), pending, solo: null })
}

// In the levels, a hand that has a streaming ring is driven by the ring only; keyboard and mouse take over otherwise.
const manual = (hand) => mode === "free" || !ring?.input?.live?.(hand)

window.addEventListener("keydown", (event) => {
  if (document.querySelector(".ring-rerecord")?.open) return
  if (event.repeat) return
  const beat = { ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up" }[event.key]
  if (beat) {
    event.preventDefault()
    if (manual("right")) playBeat(beat)
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (key === "e" && manual("left")) playPalm("up")
  if (key === "d" && manual("left")) playPalm("down")
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

function swipeDirection(dx, dy) {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up")
}

function swipe(fromLeft, dx, dy) {
  const direction = swipeDirection(dx, dy)
  if (fromLeft && (direction === "up" || direction === "down")) { if (manual("left")) playPalm(direction) }
  else if (!fromLeft && manual("right")) playBeat(direction)
}

view.addEventListener("pointermove", (event) => {
  if (!pointer) return
  if (pointer.trail) {
    pointer.trail.push(local(event))
    if (pathLength(pointer.trail) > 36) {
      lassoPath.setAttribute("d", "M" + pointer.trail.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L") + " Z")
    }
    return
  }
  // A beat lands as soon as the stroke is clearly a swipe, not when the finger lifts.
  const dx = event.clientX - pointer.x
  const dy = event.clientY - pointer.y
  if (mode !== "free" && !pointer.fired && Math.hypot(dx, dy) >= 36) {
    pointer.fired = true
    swipe(pointer.left, dx, dy)
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
  const fired = pointer.fired
  const trail = pointer.trail
  pointer = null
  if (trail) {
    lassoPath.setAttribute("d", "")
    if (pathLength(trail) > 60) {
      freeLasso(lassoParts(trail, world.screenPositions()))
      return
    }
  }
  if (fired) return
  if (Math.hypot(dx, dy) < 36) {
    if (manual("left")) playPoint(world.pick(event.clientX, event.clientY))
    return
  }
  if (mode === "free") return
  swipe(fromLeft, dx, dy)
})

function goHome() {
  stopLevel()
  mixer.reset()
  ending = false
  setMode("home")
}

document.querySelector("#retry").addEventListener("click", () => begin())
document.querySelector("#back").addEventListener("click", goHome)
exitEl.addEventListener("click", goHome)

window.addEventListener("resize", () => { world.resize(); lane.resize() })
setMode("home")
world.resize()
lane.resize()
loop()
