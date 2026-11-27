import { createRingInput } from "./input.js"
import { createRingPanel } from "./panel.js"

// Wires the ring input into the page. `onGesture` receives { type, hand, age, ... } with age already latency-compensated.
// `cueDue(hand, age, direction)` is asked whether the chart expects that stroke then, which is how a real
// down-beat is told apart from the return of an up-beat.
export function startRing({ onGesture, onMotion, motionActive, onPreview, previewDue, cueDue, cutoffDue, cameraVerdict, onDisagreement, boundHands }) {
  const url = new URLSearchParams(globalThis.location?.search).get("ring") || `ws://${globalThis.location?.hostname || "127.0.0.1"}:8787`
  const input = createRingInput({ url, onEvent: onGesture, onMotion, motionActive, onPreview, previewDue, cueDue, cutoffDue, cameraVerdict, onDisagreement, boundHands })
  fetch(`${import.meta.env?.BASE_URL ?? "/"}causal-model.json`)
    .then(response => response.ok && response.headers.get("content-type")?.includes("json") ? response.json() : null)
    .then(model => { if (model) input.setCausalModel(model) })
    .catch(() => {})
  const panel = createRingPanel({
    button: document.querySelector("#ring-btn"),
    panel: document.querySelector("#ring-panel"),
    input,
  })
  input.connect()
  return { input, reportError: panel.report, clearTiming: panel.clearTiming, resetGestureState: input.resetGestureState, openPanel: panel.open, closePanel: panel.close, cameraHost: panel.cameraHost, renderPanel: panel.open }
}
