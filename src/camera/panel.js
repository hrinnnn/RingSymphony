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
        <div class="camera-frame"></div>
        <p class="camera-hint">把双手放进框内，并试着完整地挥一次下拍：如果手挥到框外，把屏幕往后仰一点。</p>
      </div>
      <p class="camera-mismatch" hidden>左右手似乎反了：画面里的左右与戒指的左右不一致，请检查戒指戴在哪只手上，或点「交换左右」。</p>
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
  const logNote = host.querySelector(".camera-log-note")

  function render() {
    const status = tracker.status()
    chip.dataset.state = status.state === "on" ? (status.hands.right ? "on" : "wait") : "off"
    chip.textContent = status.state === "on" && !status.hands.right ? "摄像头 · 手不在画面内" : STATE_LABEL[status.state]
    chip.hidden = false
    toggle.textContent = status.state === "on" || status.state === "starting" ? "关闭摄像头" : "开启摄像头"
    statusEl.textContent = status.state === "on"
      ? `已开启 · ${status.fps} fps · ${status.hands.right ? "右手在画面内" : "右手不在画面内"}${status.hands.left ? "，左手在画面内" : ""}`
      : status.state === "denied" ? "浏览器拒绝了摄像头权限。游戏仍可正常进行。"
      : status.state === "error" ? `无法启动：${status.error ?? "未知错误"}。游戏仍可正常进行。`
      : status.state === "starting" ? "正在启动…" : "未开启。开启后上下挥拍的识别会更准。"
    preview.hidden = status.state !== "on"
    mismatchEl.hidden = !status.mismatch
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
      const url = URL.createObjectURL(new Blob([log.toJSON()], { type: "application/json" }))
      const link = document.createElement("a")
      link.href = url
      link.download = `camera-log-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
    } else if (act === "camera-clear") {
      log.clear()
      render()
    }
  })

  tracker.onStatus(render)

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
