// Watches both hands through the webcam and answers what direction a stroke went.
//
// The only file in the camera layer that touches the DOM, MediaPipe or the network. Everything it
// learns goes through camera/direction.js, which is pure — so the verdict logic is testable under
// Node and this file is not imported by the tests except for the two pure helpers below.
//
// MediaPipe is imported lazily inside enable(), for two reasons: importing it eagerly would pull
// 14MB of wasm into the page for players who never turn the camera on, and it would make this
// module unimportable under Node, which the helper tests need.
import { cameraDirection } from "./direction.js"

// MediaPipe landmark indices. The wrist and the base of the middle finger straddle the palm, so
// their midpoint tracks the hand as a whole rather than a finger that happens to be extended.
const WRIST = 0
const MIDDLE_MCP = 9

// How much history to keep per hand. The verdict window is 300ms; a second leaves room for a late
// beat to still find its frames without the buffer growing without bound.
const BUFFER_SECONDS = 1

// Frames of sustained contradiction before the role mismatch is reported. One frame is a tracking
// blip, especially when hands cross; a run of them is a setup problem.
const MISMATCH_FRAMES = 30

// MediaPipe reports the *subject's* anatomical hand. The game's roles are separate and mutable —
// setRole, 交换左右 and silent auto-allocation can all put the "right" role on the ring worn on
// the left hand — so these are two different questions and this only answers the first.
export function handedToRole(label) {
  if (label === "Right") return "right"
  if (label === "Left") return "left"
  return null
}

// Facing the camera unmirrored, the subject's right hand appears on the left of the image. If the
// hand we believe is "right" is consistently on the right of the image instead, either the pixels
// are mirrored (handedness inverts, so every verdict would be attributed to the wrong hand) or the
// rings are worn opposite to their roles. Both are real setup problems worth surfacing.
export function rolesContradicted(positions) {
  const right = positions?.right
  const left = positions?.left
  if (!right || !left) return false
  return right.x > left.x
}

export function createCameraTracker({
  now = () => performance.now() / 1000,
  modelPath = "/models/hand_landmarker.task",
  wasmPath = "/mediapipe",
} = {}) {
  const buffers = { left: [], right: [] }
  const listeners = new Set()
  const state = { state: "off", fps: 0, hands: { left: false, right: false }, mismatch: false, error: null }

  let video = null
  let stream = null
  let landmarker = null
  let running = false
  let frameTimes = []
  let contradicted = 0
  let lastSignature = ""
  let lastEmit = 0
  let failures = 0
  const reasons = new Map()

  function emit() {
    for (const listener of listeners) listener({ ...state, hands: { ...state.hands } })
  }

  function setState(next, error = null) {
    if (state.state === next && state.error === error) return
    state.state = next
    state.error = error
    emit()
  }

  // Every failure path ends here: the buffers empty, so cameraDirection declines on frame count
  // and the ring decides, exactly as it would with no camera at all.
  function forget() {
    buffers.left = []
    buffers.right = []
    state.hands.left = false
    state.hands.right = false
    state.mismatch = false
    contradicted = 0
    frameTimes = []
    state.fps = 0
  }

  function observe(result, t) {
    const seen = { left: null, right: null }
    const hands = result?.handedness ?? []
    for (let i = 0; i < hands.length; i += 1) {
      const role = handedToRole(hands[i][0]?.categoryName)
      const points = result.landmarks?.[i]
      if (!role || !points) continue
      const wrist = points[WRIST]
      const middle = points[MIDDLE_MCP]
      if (!wrist || !middle) continue
      const x = (wrist.x + middle.x) / 2
      const y = (wrist.y + middle.y) / 2
      // MediaPipe extrapolates landmarks beyond the image rather than clamping them, so a hand
      // half out of frame reports coordinates outside 0-1. That is the signal, not an error.
      const inFrame = x >= 0 && x <= 1 && y >= 0 && y <= 1
      seen[role] = { x, y }
      buffers[role].push({ t, x, y, inFrame, w: [wrist.x, wrist.y], m: [middle.x, middle.y] })
    }

    for (const role of ["left", "right"]) {
      const buffer = buffers[role]
      while (buffer.length && buffer[0].t < t - BUFFER_SECONDS) buffer.shift()
      state.hands[role] = Boolean(seen[role])
    }

    contradicted = rolesContradicted(seen) ? contradicted + 1 : 0
    state.mismatch = contradicted >= MISMATCH_FRAMES

    frameTimes.push(t)
    while (frameTimes.length && frameTimes[0] < t - 1) frameTimes.shift()
    state.fps = frameTimes.length

    // Tell the page when a hand appears or disappears, and otherwise about twice a second so the
    // frame rate reading stays honest. Emitting on every frame would re-render the panel 30 times
    // a second for nothing; emitting only on the mismatch flag — which is what this did at first —
    // left the chip frozen on whatever it said when the camera was switched on, so a player with
    // their hands up in plain view still read 手不在画面内.
    const signature = `${state.hands.left}|${state.hands.right}|${state.mismatch}`
    if (signature !== lastSignature || t - lastEmit > 0.5) {
      lastSignature = signature
      lastEmit = t
      emit()
    }
  }

  function loop() {
    if (!running || !video || !landmarker) return
    const schedule = () => {
      if (!running) return
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => loop())
      else requestAnimationFrame(() => loop())
    }
    // A hidden tab stops delivering frames; whatever is buffered goes stale, and
    // cameraDirection's own staleness check is what stops a stale verdict being trusted.
    if (video.readyState < 2) return schedule()
    try {
      const t = now()
      // detectForVideo wants a monotonically increasing millisecond timestamp of its own; the
      // page-clock time is what the buffers are stamped with, since that is the clock ring events
      // are comparable on.
      observe(landmarker.detectForVideo(video, performance.now()), t)
      failures = 0
    } catch (error) {
      // A single bad frame is not worth tearing the tracker down for. A persistent failure is a
      // different thing and must not stay silent: swallowing it would look identical to "your
      // hands are not in frame", and send the player hunting for a problem that is not theirs.
      failures += 1
      if (failures === 30) setState("error", `识别失败：${error?.message ?? error}`)
    }
    schedule()
  }

  return {
    get video() { return video },
    status: () => ({ ...state, hands: { ...state.hands } }),
    onStatus(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async enable() {
      if (running) return true
      setState("starting")
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      } catch (error) {
        setState(error?.name === "NotAllowedError" ? "denied" : "error", error?.message ?? String(error))
        return false
      }
      try {
        const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision")
        const fileset = await FilesetResolver.forVisionTasks(wasmPath)
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
          // Below MediaPipe's 0.5 defaults. A conducting hand is moving, often motion-blurred,
          // and lit by whatever the room has, so the default thresholds drop it on exactly the
          // frames that matter. A false hand costs little here — cameraDirection still demands
          // real displacement before it will overrule anything — while a missed hand costs the
          // verdict entirely.
          minHandDetectionConfidence: 0.3,
          minHandPresenceConfidence: 0.3,
          minTrackingConfidence: 0.3,
        })
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop())
        stream = null
        setState("error", error?.message ?? String(error))
        return false
      }

      video = document.createElement("video")
      video.playsInline = true
      video.muted = true
      video.srcObject = stream
      await video.play().catch(() => {})
      // Permission can be revoked from the browser UI mid-level. The track ending is how that
      // arrives, and it must land as "no camera" rather than as an exception during a beat.
      for (const track of stream.getTracks()) track.addEventListener("ended", () => this.disable("denied"))

      running = true
      forget()
      setState("on")
      loop()
      return true
    },

    disable(reason = "off") {
      running = false
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      landmarker?.close?.()
      landmarker = null
      if (video) video.srcObject = null
      video = null
      forget()
      setState(reason)
    },

    // The one method the ring pipeline calls, on every right-hand beat and left-hand palm event.
    // Synchronous and cheap: nothing in the beat path may wait for a frame.
    verdict(hand, pageTime) {
      if (!running) return null
      const result = cameraDirection(buffers[hand], pageTime)
      // Why the camera did or did not answer, for the panel. Without this, a declining camera is
      // indistinguishable from no camera at all, and the player has nothing to act on.
      const key = result.dir ? result.dir : result.reason
      reasons.set(key, (reasons.get(key) ?? 0) + 1)
      return result
    },

    // Counts of what the camera concluded, newest-first, for 诊断信息.
    reasons: () => [...reasons.entries()].sort((a, b) => b[1] - a[1]),
    clearReasons: () => reasons.clear(),

    // Test seam: the frame loop needs a camera, but what it does with a result does not. This is
    // how the "a hand appeared" notification is exercised without hardware.
    __observe: observe,

    // The frames behind a verdict, trimmed to what the log stores.
    framesFor(hand, pageTime, window = 0.3) {
      return buffers[hand]
        .filter((frame) => frame.t > pageTime - window && frame.t <= pageTime)
        .map((frame) => ({ t: Number(frame.t.toFixed(3)), w: frame.w.map((v) => Number(v.toFixed(3))), m: frame.m.map((v) => Number(v.toFixed(3))) }))
    },
  }
}
