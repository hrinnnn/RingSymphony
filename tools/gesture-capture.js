const exercises = [
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
]

const byId = (id) => document.getElementById(id)
const left = byId("left")
const right = byId("right")
const rates = [byId("left-rate"), byId("right-rate")]
const exercise = byId("exercise")
const start = byId("start")
const stop = byId("stop")
const download = byId("download")
const phase = byId("phase")
const progress = byId("progress")
const status = byId("status")
const result = byId("result")
const time = byId("time")
const devices = new Map()
let online = []
let socket
let recording
let lastRecording
let audio

for (const [i, item] of exercises.entries()) exercise.add(new Option(item.label, i))

function setInstructions() {
  const item = exercises[Number(exercise.value)]
  byId("instructions").textContent = `${item.hint} 共 ${item.count} 次，按屏幕提示出手。`
}

function renderDevices(now) {
  const live = [...devices.values()].filter((device) => now - device.seen < 1500)
  if (live.map((device) => device.address).join() !== online.map((device) => device.address).join()) {
    online = live
    const oldLeft = left.value
    const oldRight = right.value
    for (const control of [left, right]) {
      control.replaceChildren(...live.map(({ name, address }) => new Option(`${name} · ${address}`, address)))
    }
    left.value = live.some((d) => d.address === oldLeft) ? oldLeft : live[0]?.address ?? ""
    right.value = live.some((d) => d.address === oldRight) ? oldRight : live.find((d) => d.address !== left.value)?.address ?? ""
  }
  const bridge = socket?.readyState === WebSocket.OPEN
  status.textContent = bridge ? `${live.length} 枚戒指正在发数据` : "等待本机桥接 · 端口 8787"
  for (const [i, control] of [left, right].entries()) {
    const device = live.find((entry) => entry.address === control.value)
    rates[i].textContent = device ? `${device.motion.toFixed(2)} rad/s` : ""
  }
  start.disabled = Boolean(recording || lastRecording) || !left.value || !right.value || left.value === right.value
  return live
}

function connect() {
  socket = new WebSocket("ws://127.0.0.1:8787")
  socket.addEventListener("close", () => setTimeout(connect, 1200))
  socket.addEventListener("message", ({ data }) => {
    const now = performance.now()
    for (const line of data.split("\n")) {
      let frame
      try { frame = JSON.parse(line) } catch { continue }
      if (frame.type !== "imu" || !frame.address || frame.acc?.length !== 3 || frame.gyr?.length !== 3) continue
      const previous = devices.get(frame.address)?.motion ?? 0
      const motion = Math.max(Math.hypot(...frame.gyr), previous * 0.992)
      devices.set(frame.address, { name: frame.name || "Ringo", address: frame.address, seen: now, motion })
      const hand = recording?.hands[frame.address]
      if (hand) recording.frames.push({ ...frame, hand, receivedMs: Math.round(now - recording.start) })
    }
  })
}

function beep() {
  if (audio?.state !== "running") return
  const tone = audio.createOscillator()
  const volume = audio.createGain()
  const at = audio.currentTime
  tone.frequency.value = 720
  volume.gain.setValueAtTime(0.1, at)
  volume.gain.exponentialRampToValueAtTime(0.001, at + 0.12)
  tone.connect(volume).connect(audio.destination)
  tone.start(at)
  tone.stop(at + 0.13)
}

function finish(reason) {
  if (!recording) return
  if (recording.openTrial) recording.openTrial.endedAtMs = Math.round(performance.now() - recording.start)
  const { start, openTrial, ...completed } = recording
  lastRecording = { ...completed, durationMs: Math.round(performance.now() - start), finishReason: reason }
  recording = null
  phase.textContent = reason === "complete" ? "本组完成" : "本组提前结束"
  phase.dataset.action = "false"
  time.textContent = ""
  result.textContent = `已录 ${lastRecording.trials.length} 个提示窗口、${lastRecording.frames.length} 帧。请下载本组。`
  stop.disabled = true
  download.disabled = false
}

byId("setup").addEventListener("submit", (event) => {
  event.preventDefault()
  renderDevices(performance.now())
  if (start.disabled) return
  if (window.AudioContext) {
    audio ??= new AudioContext()
    audio.resume().catch(() => {})
  }
  const item = exercises[Number(exercise.value)]
  recording = {
    version: 1,
    startedAt: new Date().toISOString(),
    exercise: item.id,
    performingHand: item.hand,
    hands: { [left.value]: "left", [right.value]: "right" },
    plannedCount: item.count,
    start: performance.now(),
    trials: [],
    frames: [],
    openTrial: null,
  }
  for (const control of [left, right, exercise, start]) control.disabled = true
  stop.disabled = false
  result.textContent = ""
})

function tick() {
  const now = performance.now()
  const live = renderDevices(now)
  if (!recording) return
  if (Object.keys(recording.hands).some((address) => !live.some((d) => d.address === address))) {
    finish("lost-ring")
    result.textContent += " 有戒指断流，重连后重录这一组。"
    return
  }
  const item = exercises[Number(exercise.value)]
  const action = item.action ?? 1450
  const interval = action + 1500
  const elapsed = now - recording.start
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
  phase.textContent = moving ? item.label : elapsed < 3000 ? "准备" : "回到原位，等下一次提示"
  phase.dataset.action = String(moving)
  time.textContent = elapsed < 3000 ? `${Math.ceil((3000 - elapsed) / 1000)} 秒后开始` : `第 ${trial + 1} / ${item.count} 次`
}

stop.addEventListener("click", () => finish("stopped"))
download.addEventListener("click", () => {
  if (!lastRecording) return
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastRecording)], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `ring-${lastRecording.exercise}-${lastRecording.startedAt.replace(/[:.]/g, "-")}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  if (lastRecording.finishReason === "complete" && exercise.selectedIndex < exercises.length - 1) exercise.selectedIndex++
  lastRecording = null
  download.disabled = true
  for (const control of [left, right, exercise]) control.disabled = false
  result.textContent = "已触发下载。可以录制下一组。"
  setInstructions()
  tick()
})

left.addEventListener("change", () => renderDevices(performance.now()))
right.addEventListener("change", () => renderDevices(performance.now()))
exercise.addEventListener("change", setInstructions)
document.addEventListener("visibilitychange", () => {
  if (document.hidden) finish("page-hidden")
})
setInstructions()
connect()
setInterval(tick, 60)
