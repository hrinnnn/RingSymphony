import { currentDynamics, endFree, partLevels, queuePart, queueSolo, setDynamics, setFreeEnergy, setPart, setPartDynamics, setPartGain, setTempo, songSeconds, startFree, startLevel, startPiece, stopLevel, transportBeats } from "./audio.js"
import { buildChart, STUDIES } from "./chart.js"
import { createMixerHud } from "./hud.js"
import { FREE_BARS, FREE_BED, FREE_BPM, FREE_PARTS, FREE_TRACKS } from "./free-music.js"
import { GOOD, PERFECT } from "./judge.js"
import { lassoParts, pathLength } from "./lasso.js"
import { createMixer, DUCK, PART_INFO, PARTS } from "./mixer.js"
import { createLane } from "./lane.js"
import { startRing } from "./ring/index.js"
import { createCameraTracker } from "./camera/tracker.js"
import { createCameraLog } from "./camera/log.js"
import { createCameraPanel } from "./camera/panel.js"
import { createGestureLog } from "./ring/gesture-log.js"
import { buildPieceChart, PIECES } from "./repertoire.js"
import { createSwingEar } from "./ring/detectors.js"
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
const reportEl = document.querySelector("#gesture-report")
const DIR_LABEL = { up: "上", down: "下", left: "左", right: "右" }

const laneCanvas = document.querySelector("#lane")
const world = createWorld(view, laneCanvas)
const lane = createLane(laneCanvas)
const settings = createSettings({ button: document.querySelector("#settings-btn"), panel: document.querySelector("#settings-panel") })
const beatDots = [...document.querySelectorAll(".beat-dot")]
const progressEl = document.querySelector("#progress-fill")
const cueHintEl = document.querySelector("#cue-hint")
const tallyEl = document.querySelector("#tally")
const conductEl = document.querySelector("#conduct")
const conductTitle = document.querySelector("#conduct-title")
const conductMarks = document.querySelector("#conduct-marks")
const hud = createMixerHud(document.querySelector("#mixer"), pickCard)
// The camera is optional and additive. With it off, verdict() returns null and every beat takes
// exactly the path it took before the camera existed.
const camera = createCameraTracker()
const cameraLog = createCameraLog()
// What each sensor said versus what the chart asked for. The chart is ground truth only while the
// player conducts what it requested, which the export states alongside the data.
const gestureLog = createGestureLog()

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
const tempo = createTempo(FREE_BPM, { min: 78, max: 145 })
let ending = false
let freeReady = false
let bandEnergy = 1
let swingEar = null
const bandNames = (list) => list.map((part) => FREE_TRACKS[part].name).join("、")
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
levelButton("♫", "var(--mint)", "自由指挥 · Neon", "挥拍带动电子乐的速度<br>点选主奏、和弦、贝斯或鼓组，自由编排", "自由模式", beginFree)
PIECES.forEach((piece) => levelButton("♪", "var(--gold, #e6c98a)", piece.title, piece.sub, piece.tag, () => beginPiece(piece)))

function setMode(next) {
  mode = next
  homeEl.hidden = next !== "home"
  playEl.hidden = next === "home"
  resultEl.hidden = next !== "result"
  hintEl.hidden = next === "home" || next === "result"
  toolsEl.hidden = next !== "free"
  exitEl.hidden = next === "home"
  if (conductEl && next !== "playing" && next !== "count-in") conductEl.hidden = true
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
  if (cue.kind === "cue") setPart(cue.part, true)
  if (cue.kind === "circle") {
    cue.parts.forEach((part) => setPart(part, true))
    world.pose("left", "circle")
  }
  if (cue.kind === "dynamics") {
    const duration = cue.until === undefined
      ? chart.beat * 3
      : Math.max(chart.beat, cue.until - Math.max(cue.time, songSeconds()))
    setDynamics(cue.direction === "up" ? 1.6 : 0.7, duration)
  }
}

function nearest(now, hand, kind) {
  let best = null
  let distance = Infinity
  for (const cue of cues) {
    if (cue.result || (cue.hand !== hand && cue.hand !== "both") || (kind && cue.kind !== kind)) continue
    const gap = cue.until ? (now < cue.time - 0.15 || now > cue.until ? Infinity : 0) : Math.abs(now - cue.time)
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
function playBeat(direction, at = inputNow(), fromRing = false, tier = "strong", which = "right") {
  if (mode === "free") return freeBeat(direction, which)
  if (mode !== "playing" && mode !== "count-in") return
  const hand = which
  if (!direction) {
    const found = nearest(at, hand, "beat")
    if (found && tier !== "weak") scoreBeat(found, hand, gradeDistance(found.distance), at)
    else if (fromRing && tier === "strong") {
      const now = inputNow()
      unclearRun = now - unclearAt < 6 ? unclearRun + 1 : 1
      unclearAt = now
      if (unclearRun === 1) toast("方向不确定，这一拍按时间算")
      else if (unclearRun === 4) toast("方向总是认不出，建议到「指环」面板补录该方向")
    }
    return
  }
  const found = nearest(at, hand, "beat")
  world.pose(hand, "beat", direction)
  if (tier === "weak" && !(found && found.distance <= GOOD * 2)) return
  if (!found) return
  if (fromRing && found.cue.direction === direction && found.distance <= GOOD) {
    ring?.reportError(at - found.cue.time)
    ringDeltas.push(at - found.cue.time)
  }
  let kind = gradeDistance(found.distance)
  // A wrong direction still counts when the time is right; it just cannot be Perfect.
  if (found.cue.direction && found.cue.direction !== direction && kind === "perfect") kind = "good"
  scoreBeat(found, hand, kind, at)
}

function scoreBeat(found, hand, kind, at) {
  if (kind !== "miss") palmQuietUntil[hand] = at + 0.5
  if (found.cue.hand === "both") {
    if (kind === "miss") return
    const hits = found.cue.hits ??= {}
    hits[hand] ??= { kind, delta: found.delta }
    if (!hits.left || !hits.right) return
    kind = hits.left.kind === "perfect" && hits.right.kind === "perfect" ? "perfect" : "good"
  }
  scoreCue(found.cue, kind, found.delta)
}

const palmQuietUntil = { left: -Infinity, right: -Infinity }
function resetHandInput() {
  palmQuietUntil.left = palmQuietUntil.right = -Infinity
  ring.resetGestureState?.()
}

function playPalm(direction, at = inputNow(), hand = "left", fromRing = false) {
  if (at < palmQuietUntil[hand]) return
  if (mode === "free") return freeNudge(direction, hand)
  if (mode !== "playing" && mode !== "count-in") return
  const found = nearest(at, hand, "dynamics")
  const matches = found && found.cue.direction === direction
  if (matches || !fromRing) world.pose(hand, "palm", direction)
  if (matches) scoreCue(found.cue, gradeDistance(found.distance), found.delta)
}

function playCut(at = inputNow(), hand) {
  if (mode !== "playing" && mode !== "count-in") return
  const found = nearest(at, hand ?? "left", "cut")
  if (!found || found.distance > GOOD) return
  for (const side of hand ? [hand] : ["left", "right"]) world.pose(side, "fist")
  scoreCue(found.cue, gradeDistance(found.distance), found.delta)
}

function playPoint(part, at = inputNow()) {
  if (mode === "free") return freeSelect(part)
  if (!part || (mode !== "playing" && mode !== "count-in")) return
  world.pose("left", "point", part)
  const found = nearest(at, "left", "cue")
  if (!found || found.cue.part !== part) return
  scoreCue(found.cue, gradeDistance(found.distance), found.delta)
}

function pickCard(part) {
  if (manual("left")) playPoint(part)
}

// ---------- Rings ----------

function onRing(event) {
  if (mode === "free") {
    if (!freeReady || ending) return
    const snapshot = ring.input.snapshot()
    const calibration = snapshot.palmCalibration
    if (calibration.active) return
    if (event.type === "beat") {
      const strokeAt = performance.now() / 1000 - event.age
      const heard = swingEar.hear(strokeAt, event.peakSpeed)
      if (!heard.accept) return
      palmQuietUntil[event.hand] = inputNow() - event.age + 0.5
      freeBeat(event.dir || "down", event.hand, strokeAt)
      if (Number.isFinite(heard.energy)) {
        bandEnergy = bandEnergy * 0.7 + heard.energy * 0.3
        setFreeEnergy(bandEnergy)
      }
      return
    }
    if (event.type === "fist") return freeStop(event.hand)
    if (event.type === "strike" && event.hand === "left") freeStart()
    else if (event.type === "palm") {
      if (event.hand === "right" || calibration.ready || snapshot.directionMode === "absolute") {
        playPalm(event.dir, inputNow() - event.age, event.hand, true)
      }
      else toast("请先校准左手抬掌/压掌")
    }
    return
  }
  if (mode !== "playing" && mode !== "count-in") return
  const at = inputNow() - event.age
  // A fist only scores at a written cutoff. It never interrupts the backing track.
  if (event.type === "fist") return playCut(at, event.hand)
  if (event.type === "beat") {
    gestureLog.record({
      at, fused: event.dir, ring: event.ringDir, ringReason: event.ringReason, camera: event.cameraDir,
      cameraReason: event.cameraReason, displacement: event.cameraDisplacement,
      angle: event.cameraAngle, margin: event.cameraMargin,
      source: event.directionSource, tier: event.tier,
      // What the absolute classifier measured, and which classifier it was. Carried so an exported
      // log can say why a stroke failed, not only that it did.
      yaw: event.ringYaw, vertical: event.ringVertical, peakSpeed: event.peakSpeed,
      mode: event.directionMode,
    })
    playBeat(event.dir, at, true, event.tier, event.hand)
  }
  else if (event.type === "palm") playPalm(event.dir, at, event.hand, true)
  else if (event.hand === "left" && event.type === "strike") {
    // Without a camera the strike cannot say who is pointed at, so it answers whichever entrance is due.
    const target = chart?.entries ? aimedSection() : null
    const found = target ? null : nearest(at, "left", "cue")
    if (target) playPoint(target, at)
    else if (found) playPoint(found.cue.part, at)
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
  world.syncBeats?.(0)
  const total = cues.length
  const percent = Math.round(((counts.perfect + counts.good * 0.5) / total) * 100)
  const stars = percent >= 90 ? 3 : percent >= 70 ? 2 : percent >= 40 ? 1 : 0
  accuracyEl.textContent = `${percent}%`
  countsEl.innerHTML = `<span class="perfect">Perfect ${counts.perfect}</span><span class="good">Good ${counts.good}</span><span class="miss">Miss ${counts.miss}</span>`
  timingSummary()
  showGestureReport()
  autoCompensate()
  starsEl.innerHTML = [0, 1, 2].map((i) => `<i class="${i < stars ? "lit" : ""}">★</i>`).join("")
  setMode("result")
  statusEl.textContent = "结果"
}

// The per-sensor report on the result screen. Scoring tells the player how they did; this tells
// them whether the equipment agreed with them, which is a different question and the one that
// matters while the detection is still being tuned.
// The transitions detection does worst on. A conductor shapes each stroke from where the last
// one left their hand, so failures often cluster on specific pairs rather than on a direction —
// "up after left" cuts back toward centre and arrives diagonal, while "up after up" does not.
function worstTransitions(summary) {
  const rows = Object.entries(summary.transitions ?? {})
    .map(([key, row]) => ({ key, ...row, wrong: row.n - row.ringRight }))
    .filter((row) => row.n >= 2 && row.wrong)
    .sort((a, b) => b.wrong / b.n - a.wrong / a.n)
    .slice(0, 3)
  if (!rows.length) return ""
  const label = (key) => key.split("->").map((d) => DIR_LABEL[d] ?? d).join("→")
  const detail = (row) => `${label(row.key)} ${row.ringRight}/${row.n}${row.meanAngle != null ? ` <small>(${row.meanAngle}°)</small>` : ""}`
  return `<p class="report-confusion">最难的转换：${rows.map(detail).join(" · ")}</p>`
}

function showGestureReport() {
  const summary = gestureLog.summary()
  if (!reportEl) return
  if (!summary.matched) {
    reportEl.innerHTML = '<p class="report-empty">这一关没有可对照的击拍</p>'
    return
  }
  const pct = (part) => part.answered ? Math.round((part.right / part.answered) * 100) + "%" : "—"
  const line = (label, part) => `<span><b>${label}</b> ${pct(part)} <small>(${part.right}/${part.answered}${part.silent ? `，${part.silent} 次未作答` : ""})</small></span>`
  const timing = summary.timing
  // Spread, not just the mean: a consistent offset is one slider away from fixed, a wide spread is
  // not correctable by any single number, and only the second means the player should keep practising.
  const timingText = timing
    ? `平均${timing.mean >= 0 ? "偏晚" : "偏早"} ${Math.abs(Math.round(timing.mean * 1000))} ms · 波动 ${Math.round(timing.spread * 1000)} ms`
    : "—"
  const worst = Object.entries(summary.confusion)
    .flatMap(([want, got]) => Object.entries(got).filter(([g, n]) => g !== want && n).map(([g, n]) => ({ want, got: g, n })))
    .sort((a, b) => b.n - a.n).slice(0, 3)
  reportEl.innerHTML = `
    <div class="report-row">${line("戒指方向", summary.ring)}${line("摄像头", summary.camera)}${line("最终采用", summary.fused)}</div>
    <div class="report-row"><span><b>时间</b> ${timingText}</span><span><b>击拍</b> ${summary.matched}/${summary.cues}</span></div>
    ${worst.length ? `<p class="report-confusion">常见误判：${worst.map((w) => `${DIR_LABEL[w.want]}→${DIR_LABEL[w.got]} ${w.n} 次`).join(" · ")}</p>` : ""}
    ${worstTransitions(summary)}
    ${Object.keys(summary.ringSilence).length ? `<p class="report-confusion">戒指未作答：${Object.entries(summary.ringSilence).map(([k, n]) => `${k} ${n}`).join(" · ")}</p>` : ""}
    ${Object.keys(summary.cameraSilence).length ? `<p class="report-confusion">摄像头未作答：${Object.entries(summary.cameraSilence).map(([k, n]) => `${k} ${n}`).join(" · ")}</p>` : ""}
    <button type="button" id="export-gestures" class="candy plain">导出本关记录</button>`
  // The stub DOM in the controller tests has no element-level querySelector; the report is a
  // diagnostic, so it degrades to not binding rather than taking the level down with it.
  const exportButton = reportEl.querySelector?.("#export-gestures")
  exportButton?.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([gestureLog.toJSON()], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `gestures-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`
    // In the document and revoked late: an anchor outside the document has its download attribute
    // ignored, and revoking straight after click() leaves the browser saving an empty file.
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  })
}

async function begin(study = lastStudy) {
  const ringSnapshot = ring.input?.snapshot()
  // Only the template classifier needs calibration; the absolute one has nothing to be ready for,
  // so gating on it would make the no-calibration mode impossible to actually start a level in.
  if (ring.input?.live("right") && ringSnapshot.directionMode !== "absolute" && !ringSnapshot.direction.ready) {
    ring.openPanel()
    toast("请先完成右手四个方向的校准")
    return
  }
  // Neither hand needs calibration in absolute mode: the right hand reads direction off gravity,
  // and the left hand's palm detector already integrates along gravity, so its calibration was
  // only ever learning a sign that does not vary between wearers.
  if (ring.input?.live("left") && ringSnapshot.directionMode !== "absolute" && !ringSnapshot.palmCalibration.ready) {
    ring.openPanel()
    toast("请先完成左手抬掌/压掌校准")
    return
  }
  lastStudy = study
  ring.clearTiming()
  // Forget whatever the hands were doing before the level: otherwise the first beat can be
  // suppressed as the return of a stroke the player made on their way to starting.
  resetHandInput()
  ring.closePanel?.()
  settings.close()
  stopLevel()
  world.reset()
  lane.reset()
  mixer.reset()
  chart = buildChart(study)
  cues = chart.cues.map((cue) => ({ ...cue, result: null }))
  gestureLog.begin(study, cues)
  counts = { perfect: 0, good: 0, miss: 0 }
  deltas = []
  ringDeltas = []
  spawned = new Set()
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
  ].join("")
  world.setLevelHands(true)
  world.resize()
  lane.resize()
  await startLevel(chart, {
    onVoice: (part) => world.emit?.(part),
    onNote: (note) => world.note?.(note.part, note),
    onDone: () => { if (cues.every((cue) => cue.result)) finish() },
  })
  setDynamics(1)
}

async function beginPiece(piece) {
  lastStudy = piece
  ring.clearTiming()
  resetHandInput()
  ring.closePanel?.()
  settings.close()
  stopLevel()
  world.reset()
  lane.reset()
  mixer.reset()
  chart = buildPieceChart(piece)
  cues = chart.cues.map((cue) => ({ ...cue, result: null }))
  gestureLog.begin(piece, cues)
  ringDeltas = []
  counts = { perfect: 0, good: 0, miss: 0 }
  deltas = []
  spawned = new Set()
  tallyEl.textContent = "0000"
  tallyLabel.textContent = "SCORE"
  sessionTitle.textContent = piece.title
  sessionSub.textContent = piece.sub
  beatDots.forEach((dot, i) => { dot.hidden = i >= chart.meter })
  progressEl.style.width = "0%"
  setMode("count-in")
  statusEl.textContent = "预备"
  hintEl.innerHTML = "<span>方向键打拍 · I/J/K/L 左手</span><span>E/D 左手抬压 · R/V 右手抬压</span><span>拖画闭合圈选声部 · G 或握拳收束</span>"
  world.setLevelHands(true)
  world.resize()
  lane.resize()
  const clock = await startPiece(chart, {
    onVoice: (part) => world.emit?.(part),
    onNote: (note) => world.note?.(note.part, note),
    onDone: () => { if (cues.every((cue) => cue.result)) finish() },
  })
  chart.duration = clock.duration
  chart.countIn = clock.countIn
  setDynamics(1)
}

// ---------- Free conducting: per-section entries, exits, dynamics and solo ----------

async function beginFree() {
  stopLevel()
  resetHandInput()
  world.reset()
  mixer.reset()
  tempo.reset()
  chart = null
  dynamics = 1
  ending = false
  freeReady = false
  bandEnergy = 1
  swingEar = createSwingEar()
  const sessionEar = swingEar
  sessionTitle.textContent = "自由指挥"
  sessionSub.textContent = "Rust — Neon Loop · Oğuzhan Girgin"
  tallyLabel.textContent = "BPM"
  tallyEl.textContent = String(FREE_BPM)
  progressEl.style.width = "0%"
  setMode("free")
  beatDots.forEach((dot) => { dot.hidden = false })
  statusEl.textContent = "加载音轨"
  hintEl.innerHTML = '<span>方向键或戒指挥拍 · 速度</span><span>点选或圈选 · <kbd>F</kbd> 起奏 / <kbd>G</kbd> 停止</span><span><kbd>S</kbd> 独奏 · <kbd>E</kbd>/<kbd>D</kbd> 渐强 / 渐弱</span>'
  world.setLevelHands(false)
  world.showCombo?.(true)
  world.resize()
  lane.resize()
  lane.update(0, null, [])
  try {
    if (await startFree() === false || mode !== "free" || swingEar !== sessionEar) return
    FREE_BED.forEach((part) => { mixer.parts[part].on = true })
    freeReady = true
  } catch (error) {
    if (mode !== "free" || swingEar !== sessionEar) return
    console.error(error)
    goHome()
    toast("音乐加载失败，请重新进入自由指挥")
  }
}

const names = (list) => list.map((part) => PART_INFO[part].name).join("、")

function freeSelect(part) {
  if (!part) {
    if (mixer.selected.size) toast("取消选择")
    mixer.clearSelection()
    return
  }
  if (!FREE_TRACKS[part]) return
  mixer.toggle(part)
  if (mixer.selected.has(part)) world.pose("left", "point", part)
}

function freeLasso(list) {
  list = list.filter((part) => FREE_TRACKS[part])
  if (!list.length) return
  mixer.selectOnly(list)
  world.pose("left", "circle")
  toast(`圈选 · ${names(list)}`)
}

function freeGain(part) {
  if (!mixer.solo || mixer.solo.has(part)) return 1
  return FREE_BED.includes(part) ? 0.55 : 1 - DUCK
}

function applyGains() {
  for (const part of FREE_PARTS) {
    if (mixer.parts[part].on) setPartGain(part, freeGain(part))
  }
}

function freeStart() {
  if (!freeReady || ending) return
  const selected = [...mixer.selected]
  const list = selected.length ? selected : mixer.anyOn() ? [] : FREE_BED
  if (!list.length) { toast("先点选或圈选要起奏的声部"); return }
  const changed = mixer.request(list, true)
  if (!changed.length) { toast("声部已在演奏"); return }
  world.pose("left", "point", changed[0])
  changed.forEach((part) => queuePart(part, freeGain(part), () => {
    if (ending) return
    mixer.commit(part)
  }))
  toast(`${bandNames(changed)} · 下一拍加入`)
  mixer.clearSelection()
}

function freeStop(hand = "left") {
  if (!freeReady || ending) return
  const list = [...mixer.selected]
  if (list.length) {
    const changed = mixer.request(list, false)
    if (!changed.length) { toast("声部已停止"); return }
    world.pose(hand, "fist")
    changed.forEach((part) => queuePart(part, 0, () => {
      if (ending) return
      const solo = mixer.solo
      mixer.commit(part)
      if (solo && !mixer.solo) applyGains()
    }))
    toast(`${bandNames(changed)} · 下一拍停下`)
    mixer.clearSelection()
    return
  }
  if (!mixer.anyOn()) return
  ending = true
  world.pose(hand, "fist")
  toast("小节结束后谢幕")
  endFree(() => {
    mixer.request(FREE_PARTS, false)
    FREE_PARTS.forEach((part) => mixer.commit(part))
    mixer.toggleSolo([])
    tempo.reset()
    setTempo(FREE_BPM)
    tallyEl.textContent = String(FREE_BPM)
    ending = false
    toast("已谢幕 · 按 F 重新起奏")
  })
}

function freeNudge(direction, hand = "left") {
  if (!freeReady || ending) return
  world.pose(hand, "palm", direction)
  const duration = 60 / tempo.bpm * 4
  const list = [...mixer.selected]
  if (list.length) {
    mixer.nudge(list, direction)
    list.forEach((part) => setPartDynamics(part, mixer.parts[part].local, duration))
    toast(`${bandNames(list)} · ${direction === "up" ? "渐强" : "渐弱"} ${Math.round(mixer.parts[list[0]].local * 100)}%`)
    return
  }
  dynamics = Math.max(0.4, Math.min(1.6, dynamics + (direction === "up" ? 0.2 : -0.2)))
  setDynamics(dynamics, duration)
  toast(`全体 · ${direction === "up" ? "渐强" : "渐弱"} ${Math.round(dynamics * 100)}%`)
}

function freeSolo() {
  if (!freeReady || ending) return
  const selected = [...mixer.selected].filter((part) => mixer.parts[part].on)
  if (!selected.length && !mixer.solo) { toast("先选中正在演奏的声部"); return }
  queueSolo(() => {
    const active = selected.filter((part) => mixer.parts[part].on)
    const solo = mixer.toggleSolo(active)
    applyGains()
    toast(solo ? `${bandNames([...solo])} · 独奏` : "回到合奏")
  })
  toast("下个小节切换独奏")
}

function freeBeat(direction, hand = "right", at = performance.now() / 1000) {
  if (!freeReady || ending) return
  world.pose(hand, "beat", direction || "down")
  const previous = tempo.bpm
  const bpm = tempo.tap(at)
  if (bpm !== previous) setTempo(bpm)
  tallyEl.textContent = String(Math.round(bpm))
}

function freeAction(act) {
  if (mode !== "free") return
  if (act === "start") freeStart()
  else if (act === "stop") freeStop()
  else if (act === "up" || act === "down") freeNudge(act)
  else if (act === "solo") freeSolo()
  else if (act === "all") { mixer.selectOnly(FREE_PARTS); toast("全体乐队") }
}

function freeView(levels) {
  return Object.fromEntries(FREE_PARTS.map((part, index) => {
    const state = mixer.parts[part]
    const solo = mixer.solo?.has(part)
    const label = state.pending === "in" ? "下一拍加入" : state.pending === "out" ? "下一拍停下"
      : solo ? "独奏" : state.on ? "演奏中" : "休息"
    return [part, {
      ...FREE_TRACKS[part], key: String(index + 1), label, on: state.on,
      selected: mixer.selected.has(part), pending: Boolean(state.pending),
      solo, ducked: Boolean(state.on && mixer.solo && !solo), level: levels[part],
    }]
  }))
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
  const beats = freeReady ? transportBeats() : 0
  const bar = Math.floor(beats / 4) % FREE_BARS
  const playing = mixer.playing()
  const audible = playing.size > 0
  progressEl.style.width = `${audible ? ((beats % (FREE_BARS * 4)) / (FREE_BARS * 4)) * 100 : 0}%`
  beatDots.forEach((dot, i) => dot.classList.toggle("active", audible && Math.floor(beats) % 4 === i))
  if (freeReady && !ending) statusEl.textContent = audible ? `第 ${bar + 1} / ${FREE_BARS} 小节` : "等待起奏"
  const selected = [...mixer.selected]
  if (!freeReady) cueHintEl.textContent = "正在加载四条音轨"
  else if (ending) cueHintEl.textContent = "谢幕中"
  else if (selected.length) cueHintEl.textContent = `已选 ${bandNames(selected)}`
  else cueHintEl.textContent = audible ? "连续挥拍改变速度" : "按 F 让鼓和贝斯重新起奏"
  const pending = new Map(FREE_PARTS.filter((part) => mixer.parts[part].pending).map((part) => [part, mixer.parts[part].pending]))
  hud.update(freeView(partLevels?.() || {}))
  world.update(beats * 60 / FREE_BPM, playing, {
    selected: mixer.selected, pending, solo: mixer.solo, dynamics: currentDynamics(), beatPhase: beats % 1, beatHz: FREE_BPM / 60,
  })
}

function loop() {
  requestAnimationFrame(loop)
  if (mode === "free") return freeLoop()
  if (!chart || mode === "home" || mode === "result") {
    return
  }
  const now = Math.max(0, songSeconds())
  const warn = chart.meter * chart.beat * 2
  if (mode === "count-in" && now >= chart.countIn) {
    mode = "playing"
    statusEl.textContent = "演奏"
  }
  progressEl.style.width = `${Math.min(100, now / chart.duration * 100)}%`
  const beatStep = chart.beatStep ?? chart.beat
  const conductingBeat = now < chart.countIn
    ? now / chart.beat
    : (now - chart.countIn) / beatStep
  beatDots.forEach((dot, i) => dot.classList.toggle("active", Math.floor(conductingBeat) % chart.meter === i))
  const nextGesture = cues.find((cue) => cue.kind !== "beat" && !cue.result && now <= (cue.until ?? cue.time + GOOD))
  const leftRing = !manual("left")
  const rightRing = !manual("right")
  let hint
  const gestureLead = (cue) => cue.kind === "cut" ? chart.beat * 2 : cue.kind === "dynamics" ? chart.beat * 1.25 : warn
  if (now < chart.countIn) hint = `预备 · ${chart.meter - Math.min(chart.meter - 1, Math.floor(now / chart.beat))}`
  else if (nextGesture && nextGesture.time - now < gestureLead(nextGesture)) {
    if (nextGesture.kind === "cue") hint = `指${PART_INFO[nextGesture.part].name}`
    else if (nextGesture.kind === "circle") hint = `圈住${names(nextGesture.parts)}`
    else if (nextGesture.kind === "cut") hint = "收束"
    else if (nextGesture.direction === "up") hint = "渐强"
    else hint = "渐弱"
  } else if (chart.musicEnd !== undefined && now >= chart.musicEnd) hint = "余音"
  else hint = rightRing ? "箭头落到判定线时，按箭头的方向打拍" : "箭头落到判定线时，按同方向打拍"
  if (cueHintEl.textContent !== hint) cueHintEl.textContent = hint
  if (mode === "playing") {
    const bar = Math.min(chart.bars, Math.floor((now - chart.countIn) / (chart.meter * chart.beat)) + 1)
    if (bar > 0) statusEl.textContent = `第 ${bar} / ${chart.bars} 小节`
  }
  // A positive input delay judges gestures earlier, so a cue must stay open that much longer.
  const delay = Math.max(0, settings.latency)
  cues.forEach((cue, index) => {
    if (!spawned.has(index) && cue.time - now < warn + 0.05) {
      spawned.add(index)
      if (cue.kind === "cue") world.spawn(cue)
    }
    const ringCue = (cue.hand !== "left" && rightRing) || (cue.hand !== "right" && leftRing)
    const grace = (ringCue ? 0.5 : LATE_GRACE) + delay
    const openUntil = (cue.until ?? cue.time + GOOD) + grace
    if (!cue.result && now > openUntil) {
      const single = cue.hits?.left || cue.hits?.right
      if (single) scoreCue(cue, "good", single.delta)
      else scoreCue(cue, "miss")
    }
  })
  if (now >= chart.duration && cues.every((cue) => cue.result)) return finish()
  const playing = new Set(chart.entries ? chart.entries.on : ["piano", "cello"])
  if (!chart.entries) {
    if (cues.some((cue) => cue.kind === "cue" && cue.part === "violin" && cue.result && cue.result !== "miss")) playing.add("violin")
    if (cues.some((cue) => cue.kind === "cue" && cue.part === "flute" && cue.result && cue.result !== "miss")) playing.add("flute")
  } else {
    const barNow = Math.max(0, Math.floor((now - chart.countIn) / (chart.meter * chart.beat)))
    for (const [part, starts] of Object.entries(chart.entries)) {
      if (typeof starts === "number" && barNow >= starts) playing.add(part)
    }
  }
  hud.update(levelView(playing, partLevels?.() || {}))
  const gestureParts = (cue) => {
    if (cue.kind === "cut") return [...playing]
    if (cue.parts === "all") return [...PARTS]
    if (Array.isArray(cue.parts)) return cue.parts
    return cue.part ? [cue.part] : []
  }
  const pending = new Map()
  for (const cue of cues) {
    if (cue.result || cue.kind === "beat") continue
    const early = gestureLead(cue)
    if (now < cue.time - early || now > (cue.until ?? cue.time + 0.4)) continue
    for (const part of gestureParts(cue)) pending.set(part, "in")
  }
  const soon = cues.find((cue) => {
    if (cue.result || cue.kind === "beat") return false
    const early = gestureLead(cue)
    return now >= cue.time - early && now <= (cue.until ?? cue.time + 0.4)
  })
  const hand = handLift()
  const early = soon ? gestureLead(soon) : warn
  const clock = soon && soon.until ? Math.min(1, Math.max(0, (now - soon.time) / Math.max(0.001, soon.until - soon.time))) : 1
  const shownLift = !soon ? 0 : soon.direction === "down" ? (hand == null ? 1 - clock : 1 - hand) : (hand == null ? clock : hand)
  const arrive = soon ? Math.min(1, Math.max(0, (now - (soon.time - early)) / early)) : 0
  const prompt = soon && {
    kind: soon.kind === "cue" ? "point" : soon.kind === "dynamics" ? "swell" : soon.kind,
    part: soon.part,
    parts: soon.kind === "cut" ? [...playing] : (soon.parts || (soon.part ? [soon.part] : "all")),
    dir: soon.direction,
    progress: clock,
    lift: shownLift,
  }
  const scoreLine = conductLine(now)
  lane.update(now, chart, cues)
  const aimed = aimedSection()
  const selected = new Set()
  if (aimed) selected.add(aimed)
  const beatPhase = conductingBeat % 1
  world.syncBeats?.(now, cues, beatStep)
  world.update(now, playing, { selected, pending, solo: null, prompt, score: scoreLine, dynamics: currentDynamics(), beatPhase, arrive })
}

// In the levels, a hand that has a streaming ring is driven by the ring only; keyboard and mouse take over otherwise.
const manual = (hand) => mode === "free" || !ring?.input?.live?.(hand)

let mouseX = null
function aimedSection() {
  const seen = camera.hand?.("left")
  const x = seen ? (1 - seen.x) * view.clientWidth : mouseX
  if (x == null) return null
  return world.sectionAt?.(x) || null
}

// Camera y grows downward. A raised hand is the filled part of a swell; without a camera the band follows the clock.
function handLift() {
  const seen = camera.hand?.("left")
  if (!seen) return null
  return Math.min(1, Math.max(0, (0.72 - seen.y) / 0.4))
}

const HAND_WORD = { right: "右手打拍", left: "左手打拍", both: "双手重音", free: "放手", cut: "收束" }
const HAND_MARK = { right: "右", left: "左", both: "双", free: "—", cut: "收" }
function conductLine(now) {
  if (!conductEl) return ""
  const phrases = chart?.phrases
  if (!phrases) { conductEl.hidden = true; return "" }
  const bar = Math.max(0, Math.min(chart.bars - 1, Math.floor((now - chart.countIn) / (chart.meter * chart.beat))))
  const phrase = phrases.find((item) => bar >= item.bar && bar < item.bar + item.bars) || phrases[0]
  const note = (phrase.cues || []).map((cue) => cue.kind === "point" ? `指${PART_INFO[cue.part].name}` : cue.kind === "circle" ? "画圈" : cue.dir === "up" ? "渐强" : "渐弱").join(" · ")
  const title = `第 ${bar + 1} 小节 · ${HAND_WORD[phrase.hand]}${note ? ` · ${note}` : ""}`
  conductEl.hidden = false
  if (conductTitle.textContent !== title) {
    conductTitle.textContent = title
    conductMarks.innerHTML = Array.from({ length: Math.min(8, chart.bars - bar) }, (_, i) => {
      const at = bar + i
      const here = phrases.find((item) => at >= item.bar && at < item.bar + item.bars)
      return `<i class="${i === 0 ? "now" : ""}">${HAND_MARK[here?.hand] || ""}</i>`
    }).join("")
  }
  return title
}

window.addEventListener("keydown", (event) => {
  if (document.querySelector(".ring-rerecord")?.open) return
  if (event.repeat) return
  const beat = { ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up" }[event.key]
  if (beat) {
    event.preventDefault()
    const at = inputNow()
    let which = "right"
    if (mode === "playing" || mode === "count-in") {
      const left = nearest(at, "left", "beat")
      const right = nearest(at, "right", "beat")
      if (left && (!right || left.distance < right.distance)) which = "left"
    }
    if (manual(which)) playBeat(beat, at, false, "strong", which)
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (key === "e" && manual("left")) playPalm("up")
  if (key === "d" && manual("left")) playPalm("down")
  const leftBeat = { i: "up", j: "left", k: "down", l: "right" }[key]
  if (leftBeat && manual("left")) playBeat(leftBeat, inputNow(), false, "strong", "left")
  if (key === "r" && manual("right")) playPalm("up", inputNow(), "right")
  if (key === "v" && manual("right")) playPalm("down", inputNow(), "right")
  if (mode !== "free") {
    if (key === "g") playCut()
    return
  }
  const part = FREE_PARTS[Number(key) - 1]
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
  const circle = chart?.entries && (mode === "playing" || mode === "count-in") && nearest(inputNow(), "left", "circle")
  pointer = { x: event.clientX, y: event.clientY, left: event.offsetX < view.clientWidth / 2, trail: mode === "free" || circle ? [local(event)] : null }
  mouseX = event.offsetX
})

function swipeDirection(dx, dy) {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up")
}

function swipe(fromLeft, dx, dy) {
  const direction = swipeDirection(dx, dy)
  const hand = fromLeft ? "left" : "right"
  if (!manual(hand)) return
  const at = inputNow()
  if (fromLeft && (direction === "up" || direction === "down")) {
    const beat = chart?.entries && nearest(at, hand, "beat")
    if (!beat || beat.distance > GOOD) return playPalm(direction, at, hand)
  }
  if (!fromLeft || chart?.entries) playBeat(direction, at, false, "strong", hand)
}

view.addEventListener("pointermove", (event) => {
  if (!pointer) return
  mouseX = event.offsetX
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
    if (Math.hypot(dx, dy) <= 36 && pathLength(trail) > 60) {
      const parts = lassoParts(trail, world.screenPositions())
      if (mode === "free") freeLasso(parts)
      else {
        const found = nearest(inputNow(), "left", "circle")
        if (found && found.cue.parts.every((part) => parts.includes(part))) scoreCue(found.cue, "perfect", 0)
      }
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
  world.showCombo?.(false)
  mixer.reset()
  ending = false
  setMode("home")
}

document.querySelector("#retry").addEventListener("click", () => PIECES.includes(lastStudy) ? beginPiece(lastStudy) : begin())
document.querySelector("#back").addEventListener("click", goHome)
exitEl.addEventListener("click", goHome)

window.addEventListener("resize", () => { world.resize(); lane.resize() })
setMode("home")
world.resize()
lane.resize()
loop()
