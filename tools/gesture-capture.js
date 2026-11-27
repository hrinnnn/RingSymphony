import { createCaptureHealth, MAX_GAP_MS, MIN_RATE_HZ, summarizeCapture } from "./capture-quality.js"
import { timedTrials, renderMetronome } from "./capture-metronome.js"
import { validRingButton } from "../src/ring/buttons.js"

const exercises = [
  { id: "transition-4beat", label: "节拍器 · 四拍连续变向", hand: "both", pattern: ["down", "left", "right", "up"], count: 32, hint: "下、左、右、上循环 8 小节。让每次挥拍落在滴答上，自然衔接下一拍。" },
  { id: "transition-3beat", label: "节拍器 · 三拍连续变向", hand: "both", pattern: ["down", "right", "up"], count: 24, hint: "下、右、上循环 8 小节。让每次挥拍落在滴答上，自然衔接下一拍。" },
  { id: "metronome-single-dirs", label: "节拍器 · 随机间隔单方向", hand: "both", pattern: ["down", "left", "right", "up"], count: 40, single: true, hint: "看清下一次方向，只在滴答声响时挥一拍。每个方向 10 次，拍与拍之间有随机休息。" },
  { id: "hard-negatives", label: "强负样本 · 60 秒", hand: "both", count: 1, action: 60000, hint: "按屏幕提示，每 10 秒换一种日常动作。" },
  { id: "rest", label: "静止对照", hand: "both", count: 1, action: 12000, hint: "双手自然放在桌上，整个提示期间保持静止。" },
  { id: "beat-light", label: "右手轻拍", hand: "right", count: 10, hint: "每次亮起时做一次轻拍，然后自然收回。" },
  { id: "beat-natural", label: "右手自然打拍", hand: "right", count: 10, hint: "用平时玩游戏的力度出一拍，回到原位。" },
  { id: "beat-strong", label: "右手重拍", hand: "right", count: 10, hint: "用力打一拍，保留自然回程。这组用于检查是否误判为握拳。" },
  { id: "beat-continuous", label: "右手连续打拍", hand: "right", count: 1, action: 16000, hint: "连续自然打拍。保持大约每秒一拍，左手放松。" },
  { id: "beat-left", label: "左手连续打拍", hand: "left", count: 1, action: 16000, hint: "用左手连续自然打拍，大约每秒一拍。保持手掌放松，不刻意前指。" },
  { id: "point", label: "左手向前一指", hand: "left", count: 10, hint: "每次向前指向屏幕一次，手腕放松，再收回。" },
  { id: "palm-up", label: "左手抬掌", hand: "left", count: 10, hint: "用舒适幅度抬掌，到顶略停一下，再回原位。" },
  { id: "palm-down", label: "左手压掌", hand: "left", count: 10, hint: "用舒适幅度压掌，到底略停一下，再回原位。" },
  { id: "fist-left", label: "左手握拳", hand: "left", count: 10, hint: "五指自然张开，提示亮起时握拳一次，停一下再松开。尽量避免挥腕。" },
  { id: "fist-right", label: "右手握拳", hand: "right", count: 10, hint: "用右手重复同样的握拳动作。另一只手自然放着。" },
  { id: "circle-cw", label: "左手顺时针画圈", hand: "left", count: 10, action: 2600, hint: "面对屏幕，用左手食指在屏幕平行面画一整圈。从上方起笔，沿右侧下画，闭合即停。" },
  { id: "circle-ccw", label: "左手逆时针画圈", hand: "left", count: 10, action: 2600, hint: "从上方起笔，沿左侧下画一整圈，闭合即停。" },
  { id: "arc", label: "左手半圈对照", hand: "left", count: 10, hint: "像画圈一样起手，只画到一半就停住，然后慢慢回位。" },
  { id: "ordinary", label: "日常动作对照", hand: "both", count: 1, action: 18000, hint: "随手调整坐姿、摸鼠标或轻扶戒指。避免刻意打拍、握拳或画整圈。" },
  { id: "beat-up", label: "右手向上打拍 ↑", hand: "right", direction: "up", count: 10, hint: "用游戏中的力度向上挥一拍。提示结束后慢慢回到起始位置。" },
  { id: "beat-down", label: "右手向下打拍 ↓", hand: "right", direction: "down", count: 10, hint: "用游戏中的力度向下挥一拍。提示结束后慢慢回到起始位置。" },
  { id: "beat-to-left", label: "右手向左打拍 ←", hand: "right", direction: "left", count: 10, hint: "面对屏幕，向你自己的左边挥一拍。提示结束后慢慢回到起始位置。" },
  { id: "beat-to-right", label: "右手向右打拍 →", hand: "right", direction: "right", count: 10, hint: "面对屏幕，向你自己的右边挥一拍。提示结束后慢慢回到起始位置。" },
  { id: "left-beat-up", label: "左手向上打拍 ↑", hand: "left", direction: "up", count: 10, hint: "用左手按游戏中的力度向上挥一拍。提示结束后慢慢回到起始位置。" },
  { id: "left-beat-down", label: "左手向下打拍 ↓", hand: "left", direction: "down", count: 10, hint: "用左手按游戏中的力度向下挥一拍。提示结束后慢慢回到起始位置。" },
  { id: "left-beat-left", label: "左手向左打拍 ←", hand: "left", direction: "left", count: 10, hint: "面对屏幕，用左手向你自己的左边挥一拍。提示结束后慢慢回到起始位置。" },
  { id: "left-beat-right", label: "左手向右打拍 →", hand: "left", direction: "right", count: 10, hint: "面对屏幕，用左手向你自己的右边挥一拍。提示结束后慢慢回到起始位置。" },
]

const byId = (id) => document.getElementById(id)
const left = byId("left")
const right = byId("right")
const handControls = { left, right }
const rates = { left: byId("left-rate"), right: byId("right-rate") }
const swapHands = byId("swap-hands")
const scope = byId("capture-scope")
const exercise = byId("exercise")
const start = byId("start")
const stop = byId("stop")
const retry = byId("retry-save")
const phase = byId("phase")
const progress = byId("progress")
const status = byId("status")
const buttonStatus = byId("button-status")
const gameButtonStatus = byId("game-button-status")
const result = byId("result")
const time = byId("time")
const playerId = byId("player-id")
const wearNote = byId("wear-note")
const dominantHand = byId("dominant-hand")
const forceHealth = byId("force-health")
const healthMessage = byId("health-message")
const checkStill = byId("check-still")
const timedHand = byId("timed-hand")
const bpm = byId("bpm")
const beatRing = byId("beat-ring")
const quality = byId("quality")
const openGame = byId("open-game")
const closeGame = byId("close-game")
const gamePanel = byId("game-panel")
const gameStatus = byId("game-status")
const gameSave = byId("save-game")
const retryGame = byId("retry-game-save")
const LIVE_MS = 1500
const HANDS_KEY = "ringsymphony.capture.hands.v1"
const SCOPE_KEY = "ringsymphony.capture.scope.v1"
const nowMs = () => performance.timeOrigin + performance.now()
const devices = new Map()
const completedGroups = { both: new Set(), left: new Set(), right: new Set() }
const pending = []
const hands = loadHands()
let lastDeviceList = ""
let socket
let recording
let frame
let gameHands
let closeTimer
let storageReady = false
let saving = false
let audio
const scheduledTones = new Set()
let healthPassed = false

for (const [i, item] of exercises.entries()) exercise.add(new Option(item.label, i))
try {
  const savedScope = localStorage.getItem(SCOPE_KEY)
  if (Object.hasOwn(completedGroups, savedScope)) scope.value = savedScope
} catch { /* Session-only preference. */ }

function setInstructions() {
  const item = exercises[Number(exercise.value)]
  byId("instructions").textContent = `${item.hint} 共 ${item.count} 次，按屏幕提示出手。`
  byId("metronome-controls").hidden = !item.pattern
  if (scope.value !== "both") timedHand.value = scope.value
}

function selectedBindings() {
  return scope.value === "both" ? hands : { [scope.value]: hands[scope.value] }
}

function allowsExercise(item) {
  return Boolean(item && (scope.value === "both" || item.hand === "both" || item.hand === scope.value))
}

function groupDone(item) {
  return completedGroups.both.has(item.id) || completedGroups[scope.value].has(item.id)
}

function updateExercises(advance = false) {
  let availableCount = 0
  let doneCount = 0
  for (const [i, item] of exercises.entries()) {
    const option = exercise.options[i]
    const available = allowsExercise(item)
    const done = groupDone(item)
    option.disabled = option.hidden = !available
    option.textContent = done ? `✓ ${item.label}` : item.label
    if (available) {
      availableCount++
      if (done) doneCount++
    }
  }
  if (advance || !allowsExercise(exercises[exercise.selectedIndex])) {
    const next = exercises.findIndex(item => allowsExercise(item) && !groupDone(item))
    if (next >= 0) exercise.selectedIndex = next
    else if (!allowsExercise(exercises[exercise.selectedIndex])) exercise.selectedIndex = exercises.findIndex(allowsExercise)
  }
  byId("group-count").textContent = `已保存 ${doneCount} / ${availableCount} 组`
  setInstructions()
}

async function checkStorage() {
  try {
    const response = await fetch("/api/capture")
    if (!response.ok) throw new Error()
    const { directory, completed, completedByMode = { both: completed, left: [], right: [] } } = await response.json()
    byId("directory").textContent = `保存目录  ${directory}`
    for (const mode of Object.keys(completedGroups)) {
      for (const id of completedByMode[mode]) completedGroups[mode].add(id)
    }
    updateExercises(true)
    storageReady = true
    retry.hidden = true
  } catch {
    byId("directory").textContent = "无法连接本机保存服务。"
    retry.hidden = false
  }
}

function loadHands() {
  let saved
  try { saved = JSON.parse(localStorage.getItem(HANDS_KEY)) } catch { /* Session-only bindings. */ }
  const left = typeof saved?.left === "string" ? saved.left : ""
  const right = typeof saved?.right === "string" && saved.right !== left ? saved.right : ""
  return { left, right }
}

function saveHands() {
  try { localStorage.setItem(HANDS_KEY, JSON.stringify(hands)) } catch { /* Session-only bindings. */ }
  renderDevices(nowMs())
}

function renderDevices(now) {
  const live = new Set([...devices.values()].filter(device => now - device.seen < LIVE_MS).map(device => device.address))
  const addresses = [...new Set([...devices.keys(), hands.left, hands.right].filter(Boolean))]
  const options = addresses.map(address => ({
    address, name: devices.get(address)?.name, live: live.has(address),
  }))
  const deviceList = JSON.stringify([options, hands])
  if (deviceList !== lastDeviceList) {
    lastDeviceList = deviceList
    for (const hand of ["left", "right"]) {
      const control = handControls[hand]
      const other = hands[hand === "left" ? "right" : "left"]
      control.replaceChildren(new Option("请选择戒指", ""), ...options.map(({ address, name, live }) => {
        const option = new Option(`${name ? name + " · " : ""}${address}${live ? "" : "（离线）"}`, address)
        option.disabled = address === other
        return option
      }))
      control.value = hands[hand]
    }
  }
  const bridge = socket?.readyState === WebSocket.OPEN
  status.textContent = bridge ? `${live.size} 枚戒指正在发数据` : "等待本机桥接 · 端口 8787"
  const bindings = selectedBindings()
  healthPassed = true
  let failed = false
  for (const hand of ["left", "right"]) {
    const address = hands[hand]
    const device = devices.get(address)
    const health = live.has(address) ? device.health.status(now) : null
    const goodStream = health?.ready && health.rate >= MIN_RATE_HZ && health.maxGapMs <= MAX_GAP_MS
    const healthy = goodStream && health.bias
    rates[hand].dataset.health = healthy ? "green" : health && (!health.ready || goodStream) ? "yellow" : "red"
    rates[hand].textContent = health
      ? `${health.rate.toFixed(0)} Hz · 最大间隔 ${health.maxGapMs.toFixed(0)} ms · ${health.bias ? `静置通过 ${Math.hypot(...health.bias).toFixed(2)} rad/s` : `静置待通过 · 当前 ${device.motion.toFixed(2)} rad/s`}`
      : address ? "等待指定戒指上线" : "未指定"
    if (Object.hasOwn(bindings, hand)) {
      healthPassed &&= Boolean(healthy)
      failed ||= Boolean(health?.ready && !goodStream)
    }
  }
  const locked = Boolean(recording || pending.length || frame)
  for (const control of [left, right, exercise, scope, playerId, wearNote, dominantHand, forceHealth, checkStill, bpm]) control.disabled = locked
  timedHand.disabled = locked || scope.value !== "both"
  swapHands.disabled = locked || !hands.left || !hands.right
  const ready = !locked && storageReady && playerId.value.trim() && Object.values(bindings).every(address => live.has(address)) &&
    (healthPassed || forceHealth.checked)
  healthMessage.dataset.health = healthPassed ? "green" : failed ? "red" : "yellow"
  healthMessage.textContent = healthPassed ? "已选戒指通过检查"
    : failed ? "采样率低于 150 Hz 或帧间隔大于 50 ms。请检查电量、缩短蓝牙距离，或重启该戒指。"
    : "等待已选戒指完成采样和静置检查。"
  start.disabled = !ready || !allowsExercise(exercises[exercise.selectedIndex])
  openGame.disabled = !ready
  if (phase.dataset.action === undefined) phase.textContent = start.disabled ? "等待选定戒指就绪" : "可以开始采集"
  return live
}

function connect() {
  socket = new WebSocket("ws://127.0.0.1:8787")
  socket.addEventListener("close", () => setTimeout(connect, 1200))
  socket.addEventListener("message", ({ data }) => {
    const now = nowMs()
    for (const line of data.split("\n")) {
      let frame
      try { frame = JSON.parse(line) } catch { continue }
      if (frame.type === "button") {
        if (!validRingButton(frame)) continue
        const bound = Object.keys(hands).find(hand => hands[hand] === frame.address)
        const side = bound === "left" ? "左手" : bound === "right" ? "右手" : (frame.name || frame.address)
        buttonStatus.textContent = gameButtonStatus.textContent = `${side}按钮：${frame.label}`
        buttonStatus.hidden = gameButtonStatus.hidden = false
        const hand = recording?.hands[frame.address]
        if (hand) {
          const { address, timestamp, seq, event, action, label } = frame
          recording.buttons.push({ hand, address, timestamp, receivedMs: Math.round(now - recording.startAtMs),
            seq, event, action, label })
        }
        continue
      }
      if (frame.type !== "imu" || !frame.address || frame.acc?.length !== 3 || frame.gyr?.length !== 3) continue
      let device = devices.get(frame.address)
      if (!device) {
        device = { address: frame.address, health: createCaptureHealth() }
        devices.set(frame.address, device)
      }
      Object.assign(device, { name: frame.name || "Ringo", seen: now, motion: Math.hypot(...frame.gyr) })
      device.health.push(frame, now)
      const hand = recording?.hands[frame.address]
      if (hand) {
        const receivedMs = Math.round(now - recording.startAtMs)
        recording.frames.push({ ...frame, hand, receivedMs })
        const gap = recording.openGaps?.get(frame.address)
        if (gap) {
          gap.endedAtMs = receivedMs
          recording.openGaps.delete(frame.address)
        }
      }
    }
  })
}

function beep(delay = 0, accent = false) {
  if (audio?.state !== "running") return
  const tone = audio.createOscillator()
  const volume = audio.createGain()
  const clock = audio.getOutputTimestamp?.()
  const computed = clock?.performanceTime > 0
    ? clock.contextTime + (performance.now() + delay * 1000 - clock.performanceTime) / 1000
    : audio.currentTime + delay
  const at = Math.max(audio.currentTime, computed)
  tone.frequency.value = accent ? 960 : 720
  volume.gain.setValueAtTime(0.1, at)
  volume.gain.exponentialRampToValueAtTime(0.001, at + 0.12)
  tone.connect(volume).connect(audio.destination)
  tone.start(at)
  tone.stop(at + 0.13)
  scheduledTones.add(tone)
  tone.onended = () => scheduledTones.delete(tone)
  return true
}

function selectedHands() {
  return Object.fromEntries(Object.entries(selectedBindings()).map(([hand, address]) => [address, hand]))
}

function beginRecording(kind, hands, at = nowMs(), id = crypto.randomUUID()) {
  const preflight = Object.fromEntries(Object.entries(hands).map(([address, hand]) =>
    [hand, devices.get(address)?.health.status(nowMs()) ?? null]))
  recording = { version: 1, kind, id, startedAt: new Date(at).toISOString(), startAtMs: at, hands, frames: [], buttons: [],
    playerId: playerId.value.trim(), wearNote: wearNote.value.trim(), dominantHand: dominantHand.value || null,
    preflight, forcedHealth: !healthPassed && forceHealth.checked }
  return recording
}

function finish(reason, game) {
  if (!recording) return
  const durationMs = Math.round(nowMs() - recording.startAtMs)
  if (recording.openTrial) recording.openTrial.endedAtMs = durationMs
  for (const gap of recording.openGaps?.values() ?? []) gap.endedAtMs = durationMs
  const { openTrial, openGaps, audioQueued, ...completed } = recording
  if (completed.bpm && reason !== "complete") {
    completed.trials = completed.trials.filter(trial => trial.beatAtMs <= durationMs)
      .map(trial => ({ ...trial, endedAtMs: Math.min(trial.endedAtMs, durationMs) }))
  }
  recording = null
  for (const tone of scheduledTones) tone.stop()
  scheduledTones.clear()
  const stats = summarizeCapture(completed.frames, completed.hands, durationMs)
  const streamSummary = Object.entries(stats.streams).map(([hand, stream]) =>
    `${hand === "left" ? "左手" : "右手"} ${stream.rateHz} Hz，最大间隔 ${stream.maxGapMs} ms，丢包 ${stream.missing}，断流 ${stream.gaps}`).join(" · ")
  const qualitySummary = `${streamSummary} · ${reason !== "complete" || stats.recommendRetry ? "建议重录" : "质量通过"}`
  quality.dataset.health = reason !== "complete" || stats.recommendRetry ? "yellow" : "green"
  quality.textContent = qualitySummary
  beatRing.hidden = true
  if (completed.kind === "group") {
    phase.textContent = reason === "complete" ? "本组完成" : "本组提前结束"
    phase.dataset.action = "false"
    time.textContent = ""
    stop.disabled = true
  } else {
    if (game) completed.game = game
    gameStatus.textContent = reason === "complete" ? "本局结束" : "已停止录制"
  }
  pending.push({ ...completed, durationMs, finishReason: reason, quality: stats })
  void savePending()
}

function showSaveStatus(text, failed = false) {
  result.textContent = gameSave.textContent = text
  retry.hidden = retryGame.hidden = !failed
}

async function savePending() {
  if (saving || !pending.length) return
  saving = true
  showSaveStatus("正在保存到本机…")
  try {
    while (pending.length) {
      const data = pending[0]
      const response = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const { error } = await response.json()
        throw new Error(error)
      }
      const { saved } = await response.json()
      pending.shift()
      let detail = `${data.frames.length} 帧`
      if (data.kind === "group") {
        if (data.finishReason === "complete" && !data.quality.recommendRetry) {
          const hands = Object.values(data.hands)
          completedGroups[hands.length === 2 ? "both" : hands[0]].add(data.exercise)
          updateExercises(true)
        } else if (data.finishReason === "complete") detail += " · 建议重录本组"
        else if (data.finishReason === "lost-ring") detail += " · 戒指断流，请重录本组"
        else detail += " · 部分记录，请重录本组"
      } else {
        if (data.finishReason !== "complete") detail += " · 部分记录"
        if (data.gaps.length) detail += ` · ${data.gaps.length} 次戒指断流`
      }
      showSaveStatus(`已保存 ${saved}（${detail}）`)
    }
  } catch (error) {
    showSaveStatus(`保存失败，记录仍在当前页面。请重试。 ${error.message}`, true)
  } finally {
    saving = false
  }
}

function confirmHealth() {
  return healthPassed || window.confirm("已选戒指尚未通过采样或静置检查。确定保存这次带质量警告的录制？")
}

checkStill.addEventListener("click", () => {
  for (const address of Object.values(selectedBindings())) devices.get(address)?.health.resetStill()
  renderDevices(nowMs())
})

byId("setup").addEventListener("submit", (event) => {
  event.preventDefault()
  renderDevices(nowMs())
  if (start.disabled || !confirmHealth()) return
  if (window.AudioContext) {
    audio ??= new AudioContext()
    audio.resume().catch(() => {})
  }
  const item = exercises[Number(exercise.value)]
  Object.assign(beginRecording("group", selectedHands()), {
    exercise: item.id,
    performingHand: item.pattern ? timedHand.value : item.hand,
    direction: item.direction,
    plannedCount: item.count,
    trials: [],
  })
  if (item.pattern) {
    recording.bpm = Number(bpm.value)
    recording.trials = timedTrials(item, recording.bpm)
    recording.audioQueued = 0
  }
  renderDevices(nowMs())
  stop.disabled = false
  result.textContent = ""
  quality.textContent = ""
})

function tick() {
  const now = nowMs()
  if (now - lastHealthRender > 120) {
    renderDevices(now)
    lastHealthRender = now
  }
  if (!recording) return
  const offline = Object.keys(recording.hands).filter(address => now - (devices.get(address)?.seen ?? 0) >= LIVE_MS)
  if (recording.kind === "game") {
    for (const address of offline) {
      if (recording.openGaps.has(address)) continue
      const gap = {
        address, hand: recording.hands[address],
        startedAtMs: Math.max(0, Math.round((devices.get(address)?.seen ?? now) - recording.startAtMs)),
      }
      recording.gaps.push(gap)
      recording.openGaps.set(address, gap)
    }
    gameStatus.textContent = offline.length ? `录制中 · ${offline.length} 枚戒指断流` : `录制中 · ${recording.game.level.title}`
    return
  }
  if (offline.length) return finish("lost-ring")
  const item = exercises[Number(exercise.value)]
  const elapsed = now - recording.startAtMs
  if (item.pattern) {
    const ended = renderMetronome(recording, item, elapsed, { phase, progress, time, beatRing, beep })
    if (ended) finish("complete")
    return
  }
  const action = item.action ?? 1450
  const interval = action + 1500
  const trial = Math.floor(Math.max(0, elapsed - 3000) / interval)
  const moving = elapsed >= 3000 && trial < item.count && (elapsed - 3000) % interval < action
  progress.value = Math.min(1, elapsed / (3000 + item.count * interval))
  if (recording.openTrial && (!moving || recording.openTrial.number !== trial + 1)) {
    recording.openTrial.endedAtMs = Math.round(elapsed)
    recording.openTrial = null
  }
  if (elapsed >= 3000 + item.count * interval) return finish("complete")
  if (moving && !recording.openTrial) {
    const marker = { number: trial + 1, shownAtMs: Math.round(elapsed) }
    recording.trials.push(marker)
    recording.openTrial = marker
    beep()
  }
  const daily = ["扶眼镜", "摸鼠标", "喝水", "打字", "手臂自然放下和抬起", "说话并比划"]
  phase.textContent = moving ? (item.id === "hard-negatives" ? daily[Math.min(5, Math.floor((elapsed - 3000) / 10000))] : item.label)
    : elapsed < 3000 ? "准备" : "回到原位，等下一次提示"
  phase.dataset.action = String(moving)
  time.textContent = elapsed < 3000 ? `${Math.ceil((3000 - elapsed) / 1000)} 秒后开始` : `第 ${trial + 1} / ${item.count} 次`
}

stop.addEventListener("click", () => finish("stopped"))
retry.addEventListener("click", () => pending.length ? savePending() : checkStorage())
retryGame.addEventListener("click", savePending)

openGame.addEventListener("click", () => {
  renderDevices(nowMs())
  if (openGame.disabled || !confirmHealth()) return
  gameHands = selectedHands()
  const params = new URLSearchParams({ capture: "1", ...selectedBindings() })
  frame = document.createElement("iframe")
  frame.id = "game-frame"
  frame.title = "RingSymphony 关卡录制"
  frame.src = `/?${params}`
  gamePanel.append(frame)
  gamePanel.hidden = false
  gameStatus.textContent = "正在打开游戏…"
  gameSave.textContent = ""
  closeGame.focus()
  renderDevices(nowMs())
})

function unloadGame() {
  clearTimeout(closeTimer)
  frame?.remove()
  frame = null
  gamePanel.hidden = true
  closeGame.disabled = false
  renderDevices(nowMs())
  openGame.focus()
}

closeGame.addEventListener("click", () => {
  if (!recording) return unloadGame()
  closeGame.disabled = true
  frame.contentWindow.postMessage({ type: "ringsymphony-capture:stop" }, location.origin)
  closeTimer = setTimeout(() => {
    finish("stopped")
    unloadGame()
  }, 1500)
})

window.addEventListener("message", (event) => {
  if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin) return
  const data = event.data
  if (data?.type === "ringsymphony-capture:ready") {
    gameStatus.textContent = "选一个关卡，录制会自动开始"
  } else if (data?.type === "ringsymphony-capture:start" && !recording) {
    Object.assign(beginRecording("game", gameHands, data.atMs, data.id), {
      game: { level: data.level }, gaps: [], openGaps: new Map(),
    })
    gameSave.textContent = ""
    gameStatus.textContent = "录制中"
  } else if (data?.type === "ringsymphony-capture:finish" && recording?.id === data.id) {
    finish(data.reason, data.game)
  } else if (data?.type === "ringsymphony-capture:closed") {
    unloadGame()
  }
})

for (const hand of ["left", "right"]) {
  const control = handControls[hand]
  control.addEventListener("change", () => {
    hands[hand] = control.value
    saveHands()
  })
}
swapHands.addEventListener("click", () => {
  const previousLeft = hands.left
  hands.left = hands.right
  hands.right = previousLeft
  saveHands()
})
exercise.addEventListener("change", setInstructions)
scope.addEventListener("change", () => {
  try { localStorage.setItem(SCOPE_KEY, scope.value) } catch { /* Session-only preference. */ }
  updateExercises(true)
  renderDevices(nowMs())
})
document.addEventListener("visibilitychange", () => {
  if (document.hidden && recording?.kind === "group") finish("page-hidden")
})
window.addEventListener("beforeunload", event => {
  if (!recording && !pending.length) return
  event.preventDefault()
  event.returnValue = ""
})
updateExercises()
checkStorage()
connect()
let lastHealthRender = 0
function animate() {
  tick()
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)
