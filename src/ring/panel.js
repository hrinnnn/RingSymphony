import { DIRECTIONS, DIRECTION_NAMES, SAMPLES_PER_DIRECTION } from "./direction.js"
import { PERFECT } from "../judge.js"

// Header button + popover for ring status, left/right assignment and latency compensation.
const HAND_LABEL = { left: "左手", right: "右手" }

export function createRingPanel({ button, panel, input }) {
  const errors = []
  let open = false

  panel.innerHTML = `
    <div class="panel-head"><h3>指环</h3><button type="button" class="panel-close" data-act="close-panel" aria-label="关闭">×</button></div>
    <p class="ring-link"></p>
    <ul class="ring-list"></ul>
    <div class="ring-actions"><button type="button" data-act="swap">交换左右</button></div>
    <div class="ring-calibration">
      <strong>右手方向校准</strong>
      <p>按提示向各方向挥动，每个方向 3 次。</p>
      <button type="button" data-act="auto-calibrate">开始校准</button>
      <div class="ring-directions"></div>
      <p class="ring-calibration-status" aria-live="polite"></p>
      <button type="button" data-act="open-rerecord">补录方向</button>
      <button type="button" data-act="reset-direction">重来</button>
      <dialog class="ring-rerecord" aria-labelledby="ring-rerecord-title">
        <h3 id="ring-rerecord-title">补录方向</h3>
        <p>选一个方向重录，其他方向不变。</p>
        <div class="ring-rerecord-directions"></div>
        <p class="ring-rerecord-status" aria-live="polite"></p>
        <button type="button" data-act="stop-rerecord">停止补录</button>
        <button type="button" data-act="close-rerecord">关闭</button>
      </dialog>
    </div>
    <div class="ring-calibration ring-palm-calibration">
      <strong>左手抬掌/压掌校准</strong>
      <p>按提示分别上抬、下压手掌，各 3 次；不需要先完成右手校准。</p>
      <button type="button" data-act="palm-calibrate">开始左手校准</button>
      <span class="ring-palm-counts"></span>
      <p class="ring-palm-status" aria-live="polite"></p>
      <button type="button" data-act="reset-palm-calibration">重来</button>
    </div>
    <div class="ring-camera-host"></div>
    <div class="ring-comp">
      <span>延迟补偿</span>
      <button type="button" data-act="comp-down">−</button>
      <b class="ring-comp-value">0 ms</b>
      <button type="button" data-act="comp-up">+</button>
      <button type="button" data-act="comp-reset">归零</button>
    </div>
    <p class="ring-error"><span class="ring-error-text">还没有可用于补偿的击拍</span><button type="button" data-act="apply" hidden>采用</button></p>
    <details class="ring-debug">
      <summary>诊断信息</summary>
      <p class="ring-last">最近手势：—</p>
      <p class="ring-direction-stats"></p>
      <button type="button" data-act="clear-direction-stats">清零统计</button>
    </details>
    <p class="ring-note">右手击拍，左手抬/压掌，握拳停止。</p>`
  const linkEl = panel.querySelector(".ring-link")
  const listEl = panel.querySelector(".ring-list")
  const compEl = panel.querySelector(".ring-comp-value")
  const errorEl = panel.querySelector(".ring-error-text")
  const applyEl = panel.querySelector('[data-act="apply"]')
  const lastEl = panel.querySelector(".ring-last")
  const statsEl = panel.querySelector(".ring-direction-stats")
  const directionsEl = panel.querySelector(".ring-directions")
  const calibrationEl = panel.querySelector(".ring-calibration-status")
  const autoEl = panel.querySelector('[data-act="auto-calibrate"]')
  const resetEl = panel.querySelector('[data-act="reset-direction"]')
  const openRerecordEl = panel.querySelector('[data-act="open-rerecord"]')
  const rerecordDialog = panel.querySelector(".ring-rerecord")
  const rerecordDirections = panel.querySelector(".ring-rerecord-directions")
  const rerecordStatus = panel.querySelector(".ring-rerecord-status")
  const stopRerecordEl = panel.querySelector('[data-act="stop-rerecord"]')
  const palmCalibrationEl = panel.querySelector(".ring-palm-status")
  const palmCountsEl = panel.querySelector(".ring-palm-counts")
  const palmAutoEl = panel.querySelector('[data-act="palm-calibrate"]')
  const palmResetEl = panel.querySelector('[data-act="reset-palm-calibration"]')
  let calibrationError = ""
  let palmCalibrationError = ""
  const GESTURE = { beat: "击拍", fist: "握拳", strike: "向前一指", palm: "掌" }

  const meanError = () => (errors.length ? errors.reduce((s, x) => s + x, 0) / errors.length : null)

  const directionButtons = DIRECTIONS.map((direction) => {
    const item = document.createElement("button")
    item.type = "button"
    item.dataset.act = "rerecord"
    item.dataset.direction = direction
    item.textContent = `补录${DIRECTION_NAMES[direction]}`
    rerecordDirections.append(item)
    return item
  })

  function closeRerecord() {
    if (input.snapshot().automaticCalibration.target) input.stopAutomaticCalibration()
    rerecordDialog.close()
  }
  rerecordDialog.addEventListener("cancel", (event) => {
    event.preventDefault()
    closeRerecord()
    render()
  })
  function setOpen(next) {
    open = next
    panel.hidden = !open
  }
  button.addEventListener("click", () => setOpen(!open))
  // The panel must never linger over the stage: it closes on any outside click.
  document.addEventListener("pointerdown", (event) => {
    if (open && !panel.contains(event.target) && !button.contains(event.target) && !rerecordDialog.open) setOpen(false)
  })
  panel.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-act]")
    if (!target) return
    const act = target.dataset.act
    if (act === "close-panel") return setOpen(false)
    if (act === "swap") { input.swap(); errors.length = 0 }
    else if (act === "auto-calibrate") {
      try {
        if (input.snapshot().automaticCalibration.active) input.stopAutomaticCalibration()
        else input.startAutomaticCalibration()
        calibrationError = ""
      } catch (error) {
        calibrationError = error.message
      }
    }
    else if (act === "open-rerecord") {
      calibrationError = ""
      rerecordDialog.showModal()
    } else if (act === "close-rerecord") {
      closeRerecord()
    } else if (act === "stop-rerecord") {
      input.stopAutomaticCalibration()
    } else if (act === "rerecord") {
      try {
        input.startDirectionRerecord(target.dataset.direction)
        errors.length = 0
        calibrationError = ""
      } catch (error) {
        calibrationError = error.message
      }
    } else if (act === "reset-direction") {
      input.resetDirection()
      errors.length = 0
      calibrationError = ""
    } else if (act === "palm-calibrate") {
      try {
        if (input.snapshot().palmCalibration.active) input.stopPalmCalibration()
        else input.startPalmCalibration()
        palmCalibrationError = ""
      } catch (error) {
        palmCalibrationError = error.message
      }
    } else if (act === "reset-palm-calibration") {
      input.resetPalmCalibration()
      palmCalibrationError = ""
    }
    else if (act === "comp-down") { input.compensation -= 0.01; errors.length = 0 }
    else if (act === "comp-up") { input.compensation += 0.01; errors.length = 0 }
    else if (act === "comp-reset") { input.compensation = 0; errors.length = 0 }
    else if (act === "apply") {
      const mean = meanError()
      if (mean !== null) input.compensation += mean
      errors.length = 0
    } else if (act === "clear-direction-stats") input.clearDirectionStats()
    else if (act === "role") { input.setRole(target.dataset.address, target.dataset.hand || null); errors.length = 0 }
    render()
  })

  function render() {
    const snap = input.snapshot()
    const live = snap.rings.filter((ring) => ring.connected)
    button.dataset.state = !snap.link.open ? "off" : live.length ? "on" : "wait"
    button.textContent = !snap.link.open ? "指环 · 桥接未连接" : live.length ? `指环 · ${live.length} 枚在线` : "指环 · 等待数据"
    linkEl.textContent = !snap.link.open
      ? "未连接到桥接服务：请运行 npm run ring"
      : snap.link.studio ? "桥接已连接 Ring Studio" : "桥接已启动，等待 Ring Studio (127.0.0.1:17888)"
    listEl.replaceChildren(...snap.rings.map((ring) => {
      const li = document.createElement("li")
      li.dataset.live = ring.connected ? "1" : "0"
      const bar = Math.min(100, Math.round(ring.activity * 8))
      li.innerHTML = `<b>${HAND_LABEL[ring.hand] ?? "未分配"}</b><span>${ring.name ?? ring.address}</span><em>${ring.connected ? `${Math.round(ring.rate)} Hz` : "离线"}${ring.gaps ? ` · 丢 ${ring.gaps}` : ""}</em><i style="width:${bar}%"></i>`
      for (const hand of ["right", "left"]) {
        if (ring.hand === hand) continue
        const set = document.createElement("button")
        set.type = "button"
        set.dataset.act = "role"
        set.dataset.address = ring.address
        set.dataset.hand = hand
        set.textContent = `设为${HAND_LABEL[hand]}`
        li.append(set)
      }
      return li
    }))
    if (!snap.rings.length) listEl.innerHTML = "<li class=\"empty\">还没有收到戒指数据</li>"
    const calibration = snap.direction
    const hasRight = snap.rings.some((ring) => ring.connected && ring.hand === "right")
    const hasLeft = snap.rings.some((ring) => ring.connected && ring.hand === "left")
    const automatic = snap.automaticCalibration
    const palm = snap.palmCalibration
    directionsEl.textContent = DIRECTIONS.map((direction) => `${DIRECTION_NAMES[direction]} ${calibration.counts[direction]}/${SAMPLES_PER_DIRECTION}`).join(" · ")
    for (const item of directionButtons) item.disabled = !hasRight || automatic.active
    autoEl.disabled = (!hasRight && !automatic.active) || Boolean(automatic.target)
    autoEl.textContent = automatic.active && !automatic.target ? "停止校准" : "开始校准"
    openRerecordEl.disabled = automatic.active || !hasRight
    resetEl.disabled = automatic.active
    palmAutoEl.disabled = !hasLeft && !palm.active
    palmAutoEl.textContent = palm.active ? "停止左手校准" : "开始左手校准"
    palmResetEl.disabled = palm.active
    palmCountsEl.textContent = `上抬 ${palm.counts.up}/3 · 下压 ${palm.counts.down}/3`
    palmCalibrationEl.textContent = palmCalibrationError || palm.message
    stopRerecordEl.hidden = !automatic.target
    rerecordStatus.textContent = calibrationError || (automatic.target ? automatic.message : automatic.message || calibration.message)
    // 校准完成 on its own told the player nothing about whether the calibration would actually
    // work — a set that goes on to refuse most strokes reported exactly the same words as a good
    // one. The fit says how well these waves classify each other, which is what predicts play.
    const fitNote = calibration.fitLevel === "marginal"
      ? `校准完成（区分度一般 ${Math.round(calibration.fit * 100)}%，如常被判「方向不确定」可重新采集）`
      : "校准完成"
    calibrationEl.textContent = calibrationError || (automatic.active ? automatic.message : calibration.ready ? fitNote : automatic.message || calibration.message)
    compEl.textContent = `${Math.round(input.compensation * 1000)} ms`
    const stats = snap.directionStats
    statsEl.textContent = `右手候选：有方向 ${stats.accepted} · 数据不足或断帧 ${stats.data} · 信号弱 ${stats.weak} · 校准差异大（无明显间断 ${stats.mismatch}，有间断 ${stats.mismatchGap}） · 方向相近 ${stats.ambiguous} · 未校准 ${stats.uncalibrated} · 回程抑制 ${stats.suppressed}`
    const mean = meanError()
    // Past half the Perfect window the offset is costing the player real judgements, not just
    // polish, so say so rather than leaving 采用 looking like a refinement they can ignore.
    const large = mean !== null && Math.abs(mean) > PERFECT / 2
    errorEl.textContent = mean === null
      ? "还没有可用于补偿的击拍"
      : `平均${mean >= 0 ? "偏晚" : "偏早"} ${Math.abs(Math.round(mean * 1000))} ms${large ? "：差得较多，建议点「采用」" : ""}`
    errorEl.classList.toggle("ring-error-large", large && errors.length >= 4)
    applyEl.hidden = mean === null || errors.length < 4
  }

  function renderGestures() {
    const gestures = input.snapshot().lastByHand
    lastEl.textContent = ["right", "left"].map((hand) => {
      const gesture = gestures[hand]
      if (!gesture) return `${HAND_LABEL[hand]}：—`
      const name = gesture.type === "beat" ? `击拍 · ${DIRECTION_NAMES[gesture.dir] ?? `方向不确定${gesture.directionReason ? `（${gesture.directionReason}）` : ""}`}` : gesture.type === "palm" ? (gesture.dir === "up" ? "抬掌" : "压掌") : GESTURE[gesture.type] ?? gesture.type
      return `${HAND_LABEL[hand]}：${name} #${gesture.count}（峰后 ${Math.round(gesture.detectionDelay * 1000)} ms）`
    }).join("；")
  }

  render()
  renderGestures()
  const timer = setInterval(render, 300)
  const gestureTimer = setInterval(renderGestures, 100)
  return {
    open() { setOpen(true); render() },
    close() { setOpen(false) },
    // Where the camera section mounts. The camera layer owns its own markup; the ring panel only
    // lends it a place to live, so the two stay separable.
    cameraHost: panel.querySelector(".ring-camera-host"),
    // Signed timing error of an accepted ring beat, seconds; positive = late.
    report(error) {
      errors.push(error)
      if (errors.length > 8) errors.shift()
    },
    clearTiming() { errors.length = 0 },
    dispose() { clearInterval(timer); clearInterval(gestureTimer) },
  }
}
