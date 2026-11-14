// Connects to the Ring Studio bridge (WebSocket), keeps per-ring clock/role state and turns IMU frames into gestures.
// Gesture events carry `age`: seconds between the gesture happening and "now", so the game can place it on its own clock.
import { createBeatDetector, createHandDetector } from "./detectors.js"
import { DIRECTIONS, DIRECTION_NAMES, SAMPLES_PER_DIRECTION, MAX_SHORT_GAP, createDirectionCalibration, createReturnFilter, directionFeature, directionFeatureResult } from "./direction.js"
import { fuseDirection } from "../camera/fuse.js"

const ROLE_KEY = "ringsymphony.roles.v2"
const COMP_KEY = "ringsymphony.compensation"
const CAL_KEY = "ringsymphony.calibration.v1"

function readJson(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function createRingInput({
  url = "ws://127.0.0.1:8787",
  onEvent = () => {},
  onPreview = () => {},
  now = () => performance.now() / 1000,
  WebSocketImpl = globalThis.WebSocket,
  storage = globalThis.localStorage,
  // Asked whether a right-hand cue is due near a gesture time, so a reversal the music called for
  // is not mistaken for a return stroke. Kept as a callback to leave this module chart-agnostic.
  cueDue = () => false,
  // Asked what the camera saw for a hand at a page-clock time, returning a verdict or null.
  // A callback for the same reason as cueDue: this module stays free of the DOM and of MediaPipe,
  // so it still runs under Node for the replay tests.
  cameraVerdict = () => null,
  // Called when the two sensors contradicted each other, so the page can record it for later
  // labelling. Injected rather than imported to keep storage out of this module.
  onDisagreement = () => {},
} = {}) {
  const rings = new Map()
  // Only roles the player chose explicitly are stored; automatic ones are re-derived from who is online.
  const roles = readJson(storage, ROLE_KEY, {})
  let compensation = Number(readJson(storage, COMP_KEY, 0)) || 0
  let socket = null
  let timer = 0
  let closed = false
  let allocatedAt = -Infinity
  let statusSeen = false
  let last = null
  const lastByHand = { left: null, right: null }
  const eventCounts = { left: 0, right: 0 }
  const directionStats = { accepted: 0, data: 0, weak: 0, mismatch: 0, mismatchGap: 0, ambiguous: 0, uncalibrated: 0, suppressed: 0 }
  // How often the camera contributed. `fills` is the common case — the ring had no answer and the
  // camera supplied one. `overrides` is the camera contradicting a ring classification, which only
  // happens on the vertical pair. `disagreements` counts every contradiction, including the ones
  // the ring won, which is what the exported log is built from.
  const cameraStats = { fills: 0, overrides: 0, disagreements: 0 }
  const link = { open: false, studio: false }
  const errors = []
  const direction = createDirectionCalibration()
  let palmCalibration = { samples: { up: [], down: [] }, ready: false, upObserved: null, message: "请先校准左手抬掌/压掌" }
  let palmAutomatic = null
  let automatic = null
  let autoMessage = ""

  function nextAutomaticStep(status, target = null) {
    for (let step = 0; step < DIRECTIONS.length * SAMPLES_PER_DIRECTION; step += 1) {
      const direction = DIRECTIONS[Math.floor(step / SAMPLES_PER_DIRECTION)]
      if ((!target || target === direction) && status.counts[direction] <= step % SAMPLES_PER_DIRECTION) return step
    }
    return DIRECTIONS.length * SAMPLES_PER_DIRECTION
  }

  function stopAutomatic(message) {
    automatic = null
    direction.cancel(message)
    autoMessage = message
  }

  function clearPalmCalibration(message = "请先校准左手抬掌/压掌") {
    palmAutomatic = null
    palmCalibration = { samples: { up: [], down: [] }, ready: false, upObserved: null, message }
  }

  function palmStatus() {
    if (palmAutomatic) {
      const ring = rings.get(palmAutomatic.address)
      if (!ring || !present(ring)) clearPalmCalibration("左手指环断开，校准已停止")
    }
    return {
      ready: palmCalibration.ready,
      counts: Object.fromEntries(["up", "down"].map((direction) => [direction, palmCalibration.samples[direction].length])),
      active: Boolean(palmAutomatic),
      message: palmAutomatic
        ? `请向${palmAutomatic.target === "up" ? "上抬掌" : "下压掌"}（${palmCalibration.samples[palmAutomatic.target].length}/${SAMPLES_PER_DIRECTION}）`
        : palmCalibration.message,
    }
  }

  function capturePalmCalibration(event, ring) {
    if (!palmAutomatic || palmAutomatic.address !== ring.address || event.type !== "palm") return false
    palmCalibration.samples[palmAutomatic.target].push(event.dir)
    if (palmCalibration.samples[palmAutomatic.target].length < SAMPLES_PER_DIRECTION) return true
    if (palmAutomatic.target === "up") {
      palmAutomatic.target = "down"
      return true
    }
    const observed = (target) => {
      const samples = palmCalibration.samples[target]
      return samples.filter((direction) => direction === "up").length >= 2 ? "up" : "down"
    }
    const upObserved = observed("up")
    const downObserved = observed("down")
    palmAutomatic = null
    if (upObserved === downObserved) {
      palmCalibration.message = "上下动作无法区分，请重新校准"
      return true
    }
    palmCalibration.ready = true
    palmCalibration.upObserved = upObserved
    palmCalibration.message = "左手抬掌/压掌校准完成"
    return true
  }

  function armRing(ring, handDirection, time) {
    direction.arm(handDirection, ring.address, time)
    ring.returnFilter.reset()
    ring.calibrationStart = ring.lastT
    ring.calibrationDetector = createBeatDetector({ beatFloor: 0.65, adaptiveFloor: false })
  }

  function autoStatus(time) {
    if (automatic) {
      const ring = rings.get(automatic.address)
      if (!ring || ring.hand !== "right" || !present(ring)) {
        stopAutomatic("右手指环断开，连续校准已停止")
      } else if (automatic.state === "armed" && !direction.status(time).pending) {
        stopAutomatic(direction.status(time).message)
      }
    }
    if (!automatic) return { active: false, message: autoMessage }
    const name = DIRECTION_NAMES[DIRECTIONS[Math.floor(automatic.step / SAMPLES_PER_DIRECTION)]]
    const number = automatic.step % SAMPLES_PER_DIRECTION + 1
    return {
      active: true,
      target: automatic.target,
      message: automatic.state === "settle"
        ? `${automatic.notice || "准备"}：回位并短暂停稳，接下来是${name} ${number}/${SAMPLES_PER_DIRECTION}`
        : `现在向${name}挥动并快速回位（${number}/${SAMPLES_PER_DIRECTION}）`,
    }
  }

  function save() {
    try {
      storage?.setItem(ROLE_KEY, JSON.stringify(roles))
      storage?.setItem(COMP_KEY, JSON.stringify(compensation))
    } catch {
      // storage can be unavailable (private mode); roles then last for the session only
    }
  }

  // Calibration is stored per ring address and hand, so a refresh or reconnect does not cost one.
  // The gyro bias goes with it: the templates were built from bias-corrected readings, so storing
  // them without it would restore a calibration that silently no longer matches the live feed.
  function saveCalibration(hand = "right") {
    const ring = [...rings.values()].find((candidate) => candidate.hand === hand)
    const body = direction.serialise(hand, ring?.gyroBias ?? null)
    if (!body) return
    try {
      storage?.setItem(CAL_KEY, JSON.stringify(body))
    } catch {
      // as above: without storage the calibration lasts for the session only
    }
  }

  function loadCalibration(ring, hand) {
    const result = direction.restore(readJson(storage, CAL_KEY, null), ring.address, hand)
    // Restoring templates without their bias is worse than not restoring at all: the panel would
    // show 校准完成 while every direction feature carried an offset the templates do not expect.
    if (result.ok) ring.gyroBias = result.gyroBias
    return result.ok
  }

  // Ring Studio lists every ring it has ever seen; only one that is connected and streaming counts.
  const present = (ring) => ring.connected && ring.lastSeen > 0 && now() - ring.lastSeen < 2

  // The camera is optional and may fail at any moment — permission revoked, the tracker crashing,
  // the model never loading. A throw here would take the beat with it, so every failure becomes
  // "no verdict", which is the same path as having no camera at all.
  function askCamera(hand, pageTime) {
    try {
      return cameraVerdict(hand, pageTime)
    } catch {
      return null
    }
  }

  function assign(ring, hand) {
    if (ring.hand === hand) return
    if (automatic && (ring.hand === "right" || hand === "right")) stopAutomatic("右手指环改变，连续校准已停止")
    const palmHandChanged = ring.hand === "left" || hand === "left"
    if (palmHandChanged) clearPalmCalibration(palmAutomatic ? "左手指环改变，校准已停止" : undefined)
    if (ring.hand === "right" || hand === "right") direction.reset()
    if (ring.hand) lastByHand[ring.hand] = null
    if (hand) lastByHand[hand] = null
    ring.hand = hand
    ring.detector = hand ? createHandDetector(hand) : null
    ring.calibrationDetector = null
    ring.calibrationStart = null
    ring.returnFilter.reset()
    ring.gyroBias = null
    ring.history = []
    // After the reset, not before: a restored calibration brings its own bias, and clearing it
    // here would leave the panel showing 校准完成 while the live feed carried an offset the
    // templates were never built against.
    if (hand === "right") loadCalibration(ring, "right")
  }

  function allocate() {
    allocatedAt = now()
    const all = [...rings.values()]
    const online = all.filter(present).sort((a, b) => (a.address < b.address ? -1 : 1))
    for (const ring of all) if (!present(ring)) assign(ring, null)
    const held = new Set()
    for (const ring of online) {
      if (ring.hand && !held.has(ring.hand)) held.add(ring.hand)
      else assign(ring, null)
    }
    for (const ring of online) {
      const want = roles[ring.address]
      if (!ring.hand && want && !held.has(want)) {
        assign(ring, want)
        held.add(want)
      }
    }
    // Automatic roles wait until every ring Ring Studio reports as connected has started streaming (or 0.5 s),
    // so the same two rings get the same hands on every page load instead of "whoever sent first".
    const expected = all.filter((ring) => ring.connected).length
    const waited = now() - Math.min(...online.map((ring) => ring.firstSeen))
    if ((!statusSeen || online.length < expected) && waited < 0.5) return
    for (const ring of online) {
      if (ring.hand) continue
      const free = ["right", "left"].find((hand) => !held.has(hand))
      if (!free) break
      assign(ring, free)
      held.add(free)
    }
  }

  function ensure(address, name) {
    let ring = rings.get(address)
    if (!ring) {
      ring = { address, name, hand: null, detector: null, calibrationDetector: null, calibrationStart: null, returnFilter: createReturnFilter(), gyroBias: null, history: [], offset: null, frames: 0, rate: 0, rateFrames: 0, rateAt: now(), activity: 0, lastSeen: 0, firstSeen: now(), gaps: 0, lastSeq: null, lastT: null, connected: true, previewAt: -Infinity }
      rings.set(address, ring)
    }
    if (name) ring.name = name
    return ring
  }

  function frame(message) {
    const ring = ensure(message.address, message.name)
    const t = message.timestamp ?? message.local_timestamp
    const arrival = now()
    if (ring.lastSeen === 0) ring.firstSeen = arrival
    ring.lastSeen = arrival
    ring.frames += 1
    ring.rateFrames += 1
    if (arrival - ring.rateAt >= 1) {
      ring.rate = ring.rateFrames / (arrival - ring.rateAt)
      ring.rateFrames = 0
      ring.rateAt = arrival
    }
    if (ring.lastSeq !== null && message.sequence - ring.lastSeq > 1) ring.gaps += message.sequence - ring.lastSeq - 1
    ring.lastSeq = message.sequence
    // A device restart rewinds the clock; start over instead of mixing two time bases.
    if (ring.lastT !== null && (t <= ring.lastT || t - ring.lastT > (ring.hand === "right" ? MAX_SHORT_GAP : 0.05))) {
      if (t <= ring.lastT) {
        ring.offset = null
        if (ring.hand === "right") {
          if (automatic) stopAutomatic("右手指环时钟重置，连续校准已停止")
          direction.reset()
          ring.gyroBias = null
          ring.calibrationDetector = null
          ring.calibrationStart = null
        }
        if (ring.hand === "left") clearPalmCalibration("左手指环时钟重置，请重新校准")
      }
      const restarted = t <= ring.lastT
      const calibration = direction.status(arrival)
      if (restarted) ring.returnFilter.reset()
      if (automatic && automatic.address === ring.address && automatic.state === "settle" &&
          (t <= ring.lastT || t - ring.lastT > 0.12)) automatic.stillFrames = []
      if (restarted) {
        ring.detector = ring.hand ? createHandDetector(ring.hand, ring.hand === "right" && calibration.ready ? { beatFloor: calibration.beatFloor } : {}) : null
        if (ring.calibrationDetector) ring.calibrationDetector = createBeatDetector({ beatFloor: 0.65, adaptiveFloor: false })
      } else {
        ring.detector?.gap()
        ring.calibrationDetector?.gap()
      }
      ring.history = []
    }
    ring.lastT = t
    if (!ring.hand || arrival - allocatedAt > 0.5) allocate()

    // Offset between device and page clocks: the smallest (arrival − t) is the least delayed frame.
    const sample = arrival - t
    ring.offset = ring.offset === null || sample < ring.offset ? sample : ring.offset + (sample - ring.offset) * 0.0002

    ring.activity += (Math.hypot(...message.gyr) - ring.activity) * 0.05
    if (!ring.detector) return
    autoStatus(arrival)
    if (automatic && automatic.address === ring.address && automatic.state === "settle") {
      automatic.stillFrames.push({ t, gyr: message.gyr })
      while (automatic.stillFrames.length && automatic.stillFrames[0].t < t - 0.5) automatic.stillFrames.shift()
      const frames = automatic.stillFrames
      if (frames.length >= 40 && t - frames[0].t >= 0.35 && arrival - automatic.settleAt >= 0.55) {
        const mean = [0, 1, 2].map((axis) => frames.reduce((sum, frame) => sum + frame.gyr[axis], 0) / frames.length)
        const deviation = Math.sqrt(frames.reduce((sum, frame) => sum + frame.gyr.reduce((value, component, axis) => value + (component - mean[axis]) ** 2, 0), 0) / frames.length)
        if (deviation < 0.35) {
          if (automatic.estimateBias) {
            ring.gyroBias = mean
            ring.history = []
            ring.detector = createHandDetector("right")
            automatic.estimateBias = false
          }
          armRing(ring, DIRECTIONS[Math.floor(automatic.step / SAMPLES_PER_DIRECTION)], arrival)
          automatic.state = "armed"
          automatic.notice = ""
        }
      }
    }
    const gyr = ring.hand === "right" && ring.gyroBias
      ? message.gyr.map((value, axis) => value - ring.gyroBias[axis])
      : message.gyr
    const w = Math.hypot(...gyr)
    if (ring.hand === "right") {
      ring.history.push({ t, gyr })
      while (ring.history.length && ring.history[0].t < t - 0.8) ring.history.shift()
    }
    const capturing = ring.hand === "right" && direction.status(arrival).pending
    if (ring.hand === "right" && !capturing && !automatic && arrival - ring.previewAt >= 0.03) {
      const calibration = direction.status(arrival)
      if (calibration.ready && w >= Math.max(0.65, calibration.beatFloor * 0.7)) {
        const feature = gyr.map((value) => value / w)
        const predicted = direction.classify(feature, ring.address)
        if (predicted && !ring.returnFilter.isReturn(feature, t, -0.5)) {
          ring.previewAt = arrival
          onPreview({ hand: "right", dir: predicted })
        }
      }
    }
    if (capturing && ring.calibrationDetector) {
      const candidate = ring.calibrationDetector.push(t, w)
      if (candidate && candidate.t > ring.calibrationStart) {
        const feature = directionFeature(ring.history, candidate.t)
        const captured = direction.capture(feature, ring.address, arrival, arrival, candidate.peakSpeed)
        const calibration = direction.status(arrival)
        if (captured) saveCalibration("right")
        if (captured && calibration.ready) {
          ring.detector = createHandDetector("right", { beatFloor: calibration.beatFloor })
        }
        if (automatic && automatic.address === ring.address) {
          if (!captured) {
            automatic.state = "settle"
            automatic.notice = `${calibration.message}，将重试本次`
            automatic.stillFrames = []
            automatic.settleAt = arrival
          } else if ((automatic.step = nextAutomaticStep(calibration, automatic.target)) === DIRECTIONS.length * SAMPLES_PER_DIRECTION) {
            const target = automatic.target
            automatic = null
            autoMessage = calibration.ready ? (target ? `${DIRECTION_NAMES[target]}方向补录完成，方向校准完成` : "连续校准完成") : calibration.message
          } else {
            automatic.state = "settle"
            automatic.notice = ""
            automatic.stillFrames = []
            automatic.settleAt = arrival
          }
        }
      }
    }
    for (const event of ring.detector.push({ t, acc: message.acc, gyr })) {
      const age = Math.max(0, arrival - (event.t + ring.offset)) + compensation
      if (event.hand === "left" && event.type === "palm") {
        if (capturePalmCalibration(event, ring)) continue
        if (palmCalibration.ready) event.dir = event.dir === palmCalibration.upObserved ? "up" : "down"
        // The left hand's 渐强/渐弱 has its own wearer-dependent sign, learned from its own
        // calibration, and a wrong sign scores nothing and says nothing (main.js playPalm simply
        // returns). The camera sees both hands, so it corrects this one too.
        const ringPalm = palmCalibration.ready ? event.dir : null
        const fusedPalm = fuseDirection(ringPalm, askCamera("left", event.t + ring.offset))
        if (fusedPalm.dir) event.dir = fusedPalm.dir
        event.directionSource = fusedPalm.source
        if (fusedPalm.source === "camera") cameraStats[ringPalm ? "overrides" : "fills"] += 1
        if (fusedPalm.disagreed) {
          cameraStats.disagreements += 1
          onDisagreement({ t: event.t + ring.offset, hand: "left", ring: ringPalm, source: fusedPalm.source })
        }
      }
      if (event.type === "beat" && ring.hand === "right") {
        if (capturing) continue
        const { feature, reason, hasGap } = directionFeatureResult(ring.history, event.t)
        const classified = direction.classifyDetailed(feature, ring.address)
        // The camera decides vertical direction, because the ring cannot: up and down sit about
        // 166 degrees apart in its own axes (direction.js:37). Asked on the uncompensated page
        // clock — compensation is a judgement offset, not a measure of when the hand moved, and at
        // its ±300ms clamp it would slide the camera's window onto the return stroke.
        //
        // This runs *before* the return filter deliberately. Vertical confusion and return-stroke
        // confusion are one phenomenon with one cause: a down-stroke and the return of an
        // up-stroke are the same rotation. Fusing afterwards would leave the filter reading the
        // ring's blind guess and suppressing beats on a direction already overruled.
        const verdict = askCamera("right", event.t + ring.offset)
        const fused = fuseDirection(classified.direction, verdict)
        event.dir = fused.dir
        event.directionSource = fused.source
        // Both sensors' raw answers ride along with the event, so the game can record what each
        // one said against what the chart actually asked for. Without this the only observable is
        // the fused answer, which cannot tell "the ring was wrong and the camera saved it" from
        // "both were right" — and those call for opposite fixes.
        event.ringDir = classified.direction
        event.cameraDir = verdict?.dir ?? null
        event.cameraReason = verdict?.dir ? null : verdict?.reason ?? "摄像头未开启"
        event.cameraDisplacement = verdict?.displacement ?? null
        event.peakSpeed = event.peakSpeed ?? null
        if (fused.source === "camera") cameraStats[classified.direction ? "overrides" : "fills"] += 1
        if (fused.disagreed) {
          cameraStats.disagreements += 1
          onDisagreement({ t: event.t + ring.offset, hand: "right", ring: classified.direction, source: fused.source })
        }
        event.directionReason = event.dir ? null : (reason || classified.reason)
        // Why the *ring* declined, kept separately from directionReason, which goes null once the
        // camera fills in. Without it a declined stroke is indistinguishable from a classified one
        // in the log, and the four declines measured so far could not be explained at all.
        event.ringReason = classified.direction ? null : (reason || classified.reason)
        // An unclassified beat is not recorded as a stroke, but it can still be the return of one.
        // A reversal that lands where a cue is due is a real stroke: up and down are near-opposites,
        // so geometry alone cannot tell a down-beat from the return of an up-beat.
        const onCue = Boolean(event.dir) && cueDue(arrival - age, event.dir)
        if (event.dir ? !ring.returnFilter.accept(feature, event.t, onCue) : ring.returnFilter.isReturn(feature, event.t)) {
          directionStats.suppressed += 1
          continue
        }
        if (event.dir) directionStats.accepted += 1
        else if (reason === "数据不足或断帧") directionStats.data += 1
        else if (reason) directionStats.weak += 1
        else if (classified.reason === "与校准动作差异过大") directionStats[hasGap ? "mismatchGap" : "mismatch"] += 1
        else if (classified.reason === "方向相近，无法区分") directionStats.ambiguous += 1
        else directionStats.uncalibrated += 1
      }
      eventCounts[event.hand] += 1
      last = { type: event.type, hand: event.hand, dir: event.dir, directionReason: event.directionReason, at: arrival, count: eventCounts[event.hand], detectionDelay: Math.max(0, t - event.t) }
      lastByHand[event.hand] = last
      onEvent({ ...event, age, address: ring.address, name: ring.name })
    }
  }

  function feed(message) {
    if (message.type === "imu") frame(message)
    else if (message.type === "status") {
      statusSeen = true
      const seen = new Set()
      for (const item of message.rings ?? []) {
        seen.add(item.address)
        ensure(item.address, item.name).connected = Boolean(item.connected)
      }
      for (const ring of rings.values()) if (!seen.has(ring.address)) ring.connected = false
      allocate()
    } else if (message.type === "bridge") link.studio = Boolean(message.tcp)
  }

  function connect() {
    if (closed || !WebSocketImpl) return
    try {
      socket = new WebSocketImpl(url)
    } catch {
      timer = setTimeout(connect, 1500)
      return
    }
    socket.onopen = () => { link.open = true }
    socket.onmessage = (event) => {
      const lines = String(event.data).split("\n")
      for (const line of lines) {
        if (!line) continue
        try {
          feed(JSON.parse(line))
        } catch (error) {
          errors.push(String(error))
          if (errors.length > 5) errors.shift()
        }
      }
    }
    socket.onclose = () => {
      link.open = false
      link.studio = false
      for (const ring of rings.values()) {
        ring.connected = false
        assign(ring, null)
      }
      if (!closed) timer = setTimeout(connect, 1500)
    }
    socket.onerror = () => socket.close()
  }

  function setRole(address, hand) {
    const ring = rings.get(address)
    if (!ring) return
    for (const other of rings.values()) {
      if (other !== ring && hand && other.hand === hand) {
        assign(other, null)
        delete roles[other.address]
      }
    }
    assign(ring, hand)
    if (hand) roles[address] = hand
    else delete roles[address]
    save()
    allocate()
  }

  return {
    connect,
    close() {
      closed = true
      clearTimeout(timer)
      socket?.close()
    },
    feed,
    setRole,
    swap() {
      const left = [...rings.values()].find((ring) => ring.hand === "left")
      const right = [...rings.values()].find((ring) => ring.hand === "right")
      if (left) assign(left, null)
      if (right) assign(right, null)
      if (left) { assign(left, "right"); roles[left.address] = "right" }
      if (right) { assign(right, "left"); roles[right.address] = "left" }
      save()
    },
    // True while a ring on that hand is streaming; the game then ignores the keyboard/mouse for that hand.
    live(hand) {
      return [...rings.values()].some((ring) => ring.hand === hand && present(ring))
    },
    calibrate(handDirection) {
      const ring = [...rings.values()].find((item) => item.hand === "right" && present(item))
      if (!ring) throw new Error("右手指环未连接")
      if (automatic) throw new Error("请先停止连续校准")
      autoMessage = ""
      armRing(ring, handDirection, now())
    },
    startAutomaticCalibration() {
      const ring = [...rings.values()].find((item) => item.hand === "right" && present(item))
      if (!ring) throw new Error("右手指环未连接")
      if (automatic) throw new Error("请先停止正在进行的校准")
      const status = direction.status(now())
      const step = nextAutomaticStep(status)
      if (step === DIRECTIONS.length * SAMPLES_PER_DIRECTION) throw new Error("方向样本已采满；请打开补录窗口或重新校准")
      ring.detector = createHandDetector("right")
      ring.returnFilter.reset()
      ring.calibrationDetector = null
      autoMessage = ""
      automatic = { address: ring.address, target: null, step, state: "settle", settleAt: now(), stillFrames: [], notice: "", estimateBias: step === 0 && !ring.gyroBias }
    },
    startDirectionRerecord(handDirection) {
      if (!DIRECTIONS.includes(handDirection)) throw new Error("无效的方向")
      const ring = [...rings.values()].find((item) => item.hand === "right" && present(item))
      if (!ring) throw new Error("右手指环未连接")
      if (automatic || direction.status(now()).pending) throw new Error("请先停止正在进行的校准")
      direction.clearDirection(handDirection)
      saveCalibration("right")
      const step = nextAutomaticStep(direction.status(now()), handDirection)
      ring.detector = createHandDetector("right")
      ring.returnFilter.reset()
      ring.calibrationDetector = null
      autoMessage = ""
      const noSamples = Object.values(direction.status(now()).counts).every((count) => count === 0)
      automatic = { address: ring.address, target: handDirection, step, state: "settle", settleAt: now(), stillFrames: [], notice: "", estimateBias: noSamples && !ring.gyroBias }
    },
    startPalmCalibration() {
      const ring = [...rings.values()].find((item) => item.hand === "left" && present(item))
      if (!ring) throw new Error("左手指环未连接")
      if (palmAutomatic) throw new Error("请先停止正在进行的左手校准")
      clearPalmCalibration("")
      palmAutomatic = { address: ring.address, target: "up" }
    },
    stopPalmCalibration() {
      if (palmAutomatic) {
        palmAutomatic = null
        palmCalibration.message = "左手校准已停止；重新开始会清除本次样本"
      }
    },
    resetPalmCalibration() {
      clearPalmCalibration()
    },
    stopAutomaticCalibration() {
      if (automatic) stopAutomatic("采集已停止，已采样本保留；可在主面板继续连续校准")
    },
    resetDirection() {
      automatic = null
      autoMessage = ""
      direction.reset()
      // Starting over must also forget what was stored, or a refresh would bring it back.
      try {
        storage?.removeItem(CAL_KEY)
      } catch {
        // no storage: nothing was persisted to forget
      }
      for (const ring of rings.values()) {
        if (ring.hand === "right") {
          ring.detector = createHandDetector("right")
          ring.returnFilter.reset()
          ring.gyroBias = null
        }
      }
    },
    // Called when a level starts. Whatever the player did beforehand — the last calibration
    // wave, settling the ring, reaching for the mouse — is still the return filter's reference
    // stroke, so a first beat that happens to reverse it is suppressed and the level opens with
    // a Miss the player did nothing to earn.
    //
    // Only the return filter. The beat detector keeps its learned resting level: gap() clears it,
    // and it re-seeds from the fixed floor and takes about three seconds to come back down — the
    // whole count-in — so the first beat would be judged against the highest bar instead of the
    // player's own.
    resetGestureState() {
      for (const ring of rings.values()) ring.returnFilter.reset()
    },
    get compensation() { return compensation },
    set compensation(value) {
      compensation = Math.max(-0.3, Math.min(0.3, value))
      save()
    },
    clearDirectionStats() {
      for (const key of Object.keys(directionStats)) directionStats[key] = 0
    },
    snapshot() {
      const t = now()
      return {
        link: { ...link },
        errors: [...errors],
        direction: direction.status(t),
        directionStats: { ...directionStats },
        cameraStats: { ...cameraStats },
        automaticCalibration: autoStatus(t),
        palmCalibration: palmStatus(),
        last: last && t - last.at < 2 ? { ...last } : null,
        lastByHand: Object.fromEntries(["left", "right"].map((hand) => [hand,
          lastByHand[hand] && t - lastByHand[hand].at < 2 ? { ...lastByHand[hand] } : null,
        ])),
        rings: [...rings.values()]
          .filter((ring) => ring.connected || ring.lastSeen > 0)
          .map((ring) => ({
            address: ring.address,
            name: ring.name,
            hand: ring.hand,
            // The camera stamps its frames on the page clock, so it needs this to compare them
            // against ring events, which carry device time.
            offset: ring.offset,
            connected: present(ring),
            rate: present(ring) ? ring.rate : 0,
            activity: ring.activity,
            gaps: ring.gaps,
          })),
      }
    },
  }
}
