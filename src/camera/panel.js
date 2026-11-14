// The camera's face: a one-time offer, a framing preview, a header chip, and a way to get the
// disagreement log out.
//
// Two surfaces because the player asks two different questions. At setup: "is my framing right?",
// which cannot be answered without seeing yourself. During play: "did my hand just leave frame?",
// where a preview is the wrong answer — this is a rhythm game, eyes are on the notes, and a
// preview is ignored when things are fine and costs score when looked at.
export const CAMERA_PREF_KEY = "ringsymphony.camera.v1"

const STATE_LABEL = {
  off: "摄像头 · 未开启",
  starting: "摄像头 · 启动中",
  on: "摄像头 · 已开启",
  denied: "摄像头 · 已拒绝",
  error: "摄像头 · 无法启动",
}

function readPref(storage) {
  try {
    return storage?.getItem(CAMERA_PREF_KEY) ?? null
  } catch {
    return null
  }
}

function writePref(storage, value) {
  try {
    storage?.setItem(CAMERA_PREF_KEY, value)
  } catch {
    // Without storage the choice lasts for the session, as with roles and compensation.
  }
}

export function createCameraPanel({ tracker, log, chip, host, offer, storage = globalThis.localStorage }) {
  host.innerHTML = `
    <div class="ring-calibration ring-camera">
      <strong>摄像头（可选）</strong>
      <p>戒指分不清手是上挥还是下挥——两者的旋转几乎相同。摄像头看的是手在画面里的移动，上就是上，可以补上这一点。不开也能正常游玩。</p>
      <button type="button" data-act="camera-toggle">开启摄像头</button>
      <p class="ring-camera-status" aria-live="polite"></p>
      <div class="camera-preview" hidden>
        <div class="camera-frame"><canvas class="camera-overlay"></canvas></div>
        <p class="camera-hint">把双手放进框内，并试着完整地挥一次下拍：如果手挥到框外，把屏幕往后仰一点。</p>
      </div>
      <p class="camera-mismatch" hidden>左右手似乎反了：画面里的左右与戒指的左右不一致，请检查戒指戴在哪只手上，或点「交换左右」。</p>
      <details class="camera-debug">
        <summary>摄像头判断统计</summary>
        <p class="camera-reasons">还没有击拍</p>
        <button type="button" data-act="camera-clear-reasons">清零</button>
      </details>
      <div class="camera-log-actions">
        <button type="button" data-act="camera-export">导出对比记录</button>
        <button type="button" data-act="camera-clear">清除记录</button>
      </div>
      <p class="camera-log-note"></p>
    </div>`

  const toggle = host.querySelector("[data-act='camera-toggle']")
  const statusEl = host.querySelector(".ring-camera-status")
  const preview = host.querySelector(".camera-preview")
  const frame = host.querySelector(".camera-frame")
  const mismatchEl = host.querySelector(".camera-mismatch")
  const reasonsEl = host.querySelector(".camera-reasons")
  const overlay = host.querySelector(".camera-overlay")
  const logNote = host.querySelector(".camera-log-note")

  function render() {
    const status = tracker.status()
    const count = (status.hands.left ? 1 : 0) + (status.hands.right ? 1 : 0)
    // The chip reports what the camera can see, not what the ring roles expect. A player with one
    // hand up is being tracked, and saying otherwise would send them hunting for a problem that is
    // not there.
    chip.dataset.state = status.state === "on" ? (count ? "on" : "wait") : "off"
    chip.textContent = status.state === "on"
      ? (count ? `摄像头 · 看到 ${count} 只手` : "摄像头 · 没看到手")
      : STATE_LABEL[status.state]
    chip.hidden = false
    toggle.textContent = status.state === "on" || status.state === "starting" ? "关闭摄像头" : "开启摄像头"
    const hands = count === 2 ? "双手都在画面内" : status.hands.right ? "只看到右手" : status.hands.left ? "只看到左手" : "没看到手，请把手抬进画面"
    statusEl.textContent = status.state === "on"
      ? `已开启 · ${status.fps} fps · ${hands}`
      : status.state === "denied" ? "浏览器拒绝了摄像头权限。游戏仍可正常进行。"
      : status.state === "error" ? `无法启动：${status.error ?? "未知错误"}。游戏仍可正常进行。`
      : status.state === "starting" ? "正在启动…" : "未开启。开启后上下挥拍的识别会更准。"
    preview.hidden = status.state !== "on"
    mismatchEl.hidden = !status.mismatch
    // What the camera concluded on recent beats. A declining camera looks exactly like no camera
    // from the outside, so without this the player has nothing to act on: 手在画面边缘 means move
    // back, 画面帧数不足 means more light, and a direction name means it is working.
    const reasons = tracker.reasons?.() ?? []
    reasonsEl.textContent = reasons.length ? reasons.map(([k, n]) => `${k} ${n}`).join(" · ") : "还没有击拍"
    logNote.textContent = log.entries().length ? `已记录 ${log.entries().length} 次戒指与摄像头判断不一致` : ""
    // Mirroring is CSS only, and must stay that way: MediaPipe inverts its handedness output on a
    // horizontally mirrored image, so mirroring the pixels fed to inference would silently swap
    // the hands while everything still appeared to work.
    if (status.state === "on" && tracker.video && !frame.contains(tracker.video)) frame.append(tracker.video)
  }

  async function enable() {
    writePref(storage, "on")
    await tracker.enable()
    render()
  }

  function disable() {
    writePref(storage, "off")
    tracker.disable()
    render()
  }

  host.addEventListener("click", async (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act
    if (act === "camera-toggle") {
      const status = tracker.status()
      if (status.state === "on" || status.state === "starting") disable()
      else await enable()
    } else if (act === "camera-export") {
      const entries = log.entries().length
      if (!entries) { logNote.textContent = "还没有可导出的记录：需要戒指和摄像头判断不一致时才会记录"; return }
      const url = URL.createObjectURL(new Blob([log.toJSON()], { type: "application/json" }))
      const link = document.createElement("a")
      link.href = url
      link.download = `camera-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`
      // The link has to be in the document for the download attribute to be honoured, and the
      // object URL has to outlive the click. Revoking it immediately — which is what this did at
      // first — leaves the browser saving a UUID-named empty file, since by the time it reads the
      // blob the blob is gone.
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      logNote.textContent = `已导出 ${entries} 条记录`
    } else if (act === "camera-clear") {
      log.clear()
      render()
    } else if (act === "camera-clear-reasons") {
      tracker.clearReasons?.()
      render()
    }
  })

  // Boxes over the preview, so the player can see which hand the tracker thinks is which.
  //
  // This is not decoration. The tracker maps MediaPipe's anatomical label onto the game's ring
  // roles, and when that mapping is wrong one hand's strokes land in the other's buffer - which
  // showed up in the logs as a camera answering "down" nine times in a row on a chart cycling
  // through four directions. A label the player can read catches that in a second.
  const ROLE_TEXT = { right: "右手 RIGHT", left: "左手 LEFT" }
  const ROLE_COLOUR = { right: "#35e0ff", left: "#ffd98a" }

  function drawOverlay() {
    if (!overlay || !tracker.video) return
    const frame = overlay.parentElement
    const width = frame.clientWidth
    const height = frame.clientHeight
    if (!width || !height) return
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width
      overlay.height = height
    }
    const context = overlay.getContext("2d")
    context.clearRect(0, 0, width, height)
    for (const box of tracker.status().boxes ?? []) {
      // The video is mirrored by CSS for display while inference runs on unmirrored pixels, so the
      // box has to be mirrored here to land on the hand the player sees. Mirroring the pixels
      // instead would invert MediaPipe's handedness and cause the very bug this is meant to show.
      const left = (1 - box.x1) * width
      const top = box.y0 * height
      const w = (box.x1 - box.x0) * width
      const h = (box.y1 - box.y0) * height
      const colour = ROLE_COLOUR[box.role] ?? "#ffffff"
      context.strokeStyle = colour
      context.lineWidth = 2
      context.setLineDash(box.inFrame ? [] : [4, 3])
      context.strokeRect(left, top, w, h)
      const label = `${ROLE_TEXT[box.role] ?? box.role}${box.confidence ? ` ${Math.round(box.confidence * 100)}%` : ""}`
      context.font = "600 11px system-ui, sans-serif"
      const textWidth = context.measureText(label).width
      const labelTop = Math.max(0, top - 16)
      context.fillStyle = colour
      context.fillRect(left, labelTop, textWidth + 8, 15)
      context.fillStyle = "#05070f"
      context.fillText(label, left + 4, labelTop + 11)
    }
  }

  // Driven on its own frame loop rather than from onStatus: boxes move every frame, while status
  // changes only when a hand appears or leaves.
  let overlayFrame = 0
  function overlayLoop() {
    if (tracker.status().state === "on" && !host.closest("[hidden]")) drawOverlay()
    overlayFrame = requestAnimationFrame(overlayLoop)
  }
  overlayLoop()

  tracker.onStatus(render)
  // Verdicts happen on beats, which produce no status change, so the counts would otherwise sit
  // stale while the player watched them. Cheap: text in an open panel, twice a second.
  setInterval(() => { if (!host.closest("[hidden]")) render() }, 500)

  return {
    render,
    // Shown once, on the home screen, because a camera that is "recommended" but only reachable
    // through a panel is not discoverable. getUserMedia is never called before this is answered:
    // asking the browser for permission before explaining why is the nagging the design forbids.
    offerIfUnasked() {
      if (!offer || readPref(storage) !== null) return
      offer.hidden = false
      offer.innerHTML = `
        <div class="camera-offer-card">
          <strong>要用摄像头吗？（可选）</strong>
          <p>戒指分不清上挥和下挥——两者的旋转几乎一样。摄像头能看出手往哪儿动，补上这一点。<br>只在本机运行，画面不会离开这台电脑，随时可以在「指环」面板里关掉。</p>
          <div class="camera-offer-actions">
            <button type="button" data-act="camera-yes" class="candy mint">开启摄像头</button>
            <button type="button" data-act="camera-no" class="candy plain">先不用</button>
          </div>
        </div>`
      offer.addEventListener("click", async (event) => {
        const act = event.target.closest("[data-act]")?.dataset.act
        if (act === "camera-yes") { offer.hidden = true; await enable() }
        else if (act === "camera-no") { offer.hidden = true; writePref(storage, "off"); render() }
      })
    },
    // On a later visit the stored choice is honoured without asking again.
    async resume() {
      if (readPref(storage) === "on") await tracker.enable()
      render()
    },
  }
}
