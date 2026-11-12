const KEY = "ringsymphony.latency"
const LIMIT = 400
const STEP = 5

function load(storage) {
  try {
    const value = Number(storage?.getItem(KEY))
    return Number.isFinite(value) ? Math.max(-LIMIT, Math.min(LIMIT, value)) : 0
  } catch {
    return 0
  }
}

// Settings popover. `latency` is the user's input delay in seconds: a gesture is judged `latency` earlier than it
// arrived, so a player who is always late (the result screen says "偏晚") raises it, an early one lowers it.
export function createSettings({ button, panel, storage = globalThis.localStorage }) {
  let ms = load(storage)
  let suggestion = null
  let open = false

  panel.innerHTML = `
    <div class="panel-head"><h3>设置</h3><button type="button" class="panel-close" data-act="close" aria-label="关闭">×</button></div>
    <label class="setting-row" for="latency-slider"><span>判定延迟</span><b class="latency-value"></b></label>
    <div class="latency-controls">
      <button type="button" data-act="down">−</button>
      <input id="latency-slider" type="range" min="${-LIMIT}" max="${LIMIT}" step="${STEP}">
      <button type="button" data-act="up">+</button>
    </div>
    <p class="setting-note">总是偏晚就把它调大，总是偏早就调小。每局结束后会统计偏早 / 偏晚，并给出建议值。</p>
    <p class="setting-suggest" hidden><span></span><button type="button" data-act="apply">采用</button></p>
    <button type="button" data-act="reset">归零</button>`
  const valueEl = panel.querySelector(".latency-value")
  const slider = panel.querySelector("#latency-slider")
  const suggestEl = panel.querySelector(".setting-suggest")
  const suggestText = suggestEl.querySelector("span")

  function render() {
    valueEl.textContent = `${ms > 0 ? "+" : ""}${ms} ms`
    slider.value = String(ms)
    suggestEl.hidden = suggestion === null
    if (suggestion !== null) suggestText.textContent = `上一局平均${suggestion.bias >= 0 ? "偏晚" : "偏早"} ${Math.abs(suggestion.bias)} ms，建议 ${suggestion.target > 0 ? "+" : ""}${suggestion.target} ms`
  }
  function set(value) {
    ms = Math.max(-LIMIT, Math.min(LIMIT, Math.round(value / STEP) * STEP))
    try { storage?.setItem(KEY, String(ms)) } catch { /* storage can be unavailable; the value then lasts for the session */ }
    render()
  }
  function toggle(next) {
    open = next
    panel.hidden = !open
  }

  button.addEventListener("click", () => toggle(!open))
  slider.addEventListener("input", () => set(Number(slider.value)))
  panel.addEventListener("click", (event) => {
    const act = event.target.closest?.("[data-act]")?.dataset.act
    if (act === "down") set(ms - STEP)
    else if (act === "up") set(ms + STEP)
    else if (act === "reset") set(0)
    else if (act === "apply" && suggestion) set(suggestion.target)
    else if (act === "close") toggle(false)
  })
  document.addEventListener("pointerdown", (event) => {
    if (open && !panel.contains(event.target) && !button.contains(event.target)) toggle(false)
  })
  render()

  return {
    get latency() { return ms / 1000 },
    close() { toggle(false) },
    // `bias` is the mean signed timing error of the last run in ms, positive = late.
    suggest(bias) {
      suggestion = bias === null ? null : { bias, target: Math.max(-LIMIT, Math.min(LIMIT, Math.round((ms + bias) / STEP) * STEP)) }
      render()
    },
  }
}
