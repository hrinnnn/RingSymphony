import { createRingInput } from "./input.js"
import { createRingPanel } from "./panel.js"

// Wires the ring input into the page. `onGesture` receives { type, hand, age, ... } with age already latency-compensated.
export function startRing({ onGesture, onPreview }) {
  const url = new URLSearchParams(globalThis.location?.search).get("ring") || `ws://${globalThis.location?.hostname || "127.0.0.1"}:8787`
  const input = createRingInput({ url, onEvent: onGesture, onPreview })
  const panel = createRingPanel({
    button: document.querySelector("#ring-btn"),
    panel: document.querySelector("#ring-panel"),
    input,
  })
  input.connect()
  return { input, reportError: panel.report, clearTiming: panel.clearTiming, openPanel: panel.open, closePanel: panel.close }
}
