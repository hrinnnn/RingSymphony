// Streaming IMU gesture detectors for one Ringo (200 Hz, acc m/s², gyr rad/s, device axes).
// Pure functions, no DOM: the same code runs in the browser and in the Node replay tests.
// Frame: { t: seconds (device clock), acc: [x,y,z], gyr: [x,y,z] }

const G = 9.81

const norm = (v) => Math.hypot(v[0], v[1], v[2])
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export const DEFAULTS = {
  // beat: |ω| peak above weakRise × running mean registers at all; above beatRise × mean it is
  // unambiguous. Between the two the motion is deliberate-but-soft or incidental, and the
  // consumer decides (main.js asks whether it landed near a real cue).
  // beatRise stays close to the historical 1.15 trigger: raising it demotes ordinary strokes
  // into the weak tier, where anything not near a cue is dropped. The weak band is meant to
  // reach *below* what used to register, not to reclassify what already worked.
  beatRise: 1.2,
  weakRise: 0.85,
  beatFloor: 1.6,
  beatDrop: 0.8,
  beatGap: 0.34,
  beatTau: 1.0,
  // The floor tracks how hard this player actually conducts, so a gentle conductor is not
  // judged against an energetic one's bar. `floorRest` sets how far above the resting level
  // the floor sits; the clamp keeps it between a safe minimum and the old fixed value.
  adaptiveFloor: true,
  restTau: 4,
  floorRest: 2.2,
  floorMin: 0.65,
  floorMax: 1.6,
  // fist: angular-acceleration shock (§6.1 ⑤). Measured over 3 samples; the data set separates at ≈4×10⁴ °/s²
  fistJerk: 40000,
  fistLockout: 1.0,
  // strike: sharp linear-acceleration impulse (§6.1 ⑦)
  strikeAcc: 10,
  strikeGap: 0.5,
  // palm: vertical velocity (§6.1 ⑥), sign decided shortly after the hand starts to move
  palmSpeed: 0.35,
  palmMin: 0.6,
  palmWindow: 0.45,
  palmLockout: 1.0,
}

// Tracks the "up" direction in the sensor frame with a complementary filter:
// the gyroscope rotates it, the accelerometer slowly pulls it back when the reading looks like 1 g.
export function createGravity() {
  let up = null
  return {
    get up() { return up },
    update(acc, gyr, dt) {
      const a = norm(acc)
      if (a < 1e-6) return up
      const ad = [acc[0] / a, acc[1] / a, acc[2] / a]
      if (!up) {
        up = ad
        return up
      }
      const d = cross(gyr, up)
      let next = [up[0] - d[0] * dt, up[1] - d[1] * dt, up[2] - d[2] * dt]
      const trust = 0.03 * Math.exp(-(((a - G) / 3) ** 2))
      next = [next[0] + trust * (ad[0] - next[0]), next[1] + trust * (ad[1] - next[1]), next[2] + trust * (ad[2] - next[2])]
      const n = norm(next)
      up = [next[0] / n, next[1] / n, next[2] / n]
      return up
    },
    reset() { up = null },
  }
}

export function createBeatDetector(options = {}) {
  const o = { ...DEFAULTS, ...options }
  let mean = null
  // Resting level: the quiet baseline of the signal, tracked so the trigger can scale to it.
  let rest = null
  let lastT = null
  let rising = false
  let peak = 0
  let peakT = 0
  let lastBeat = -Infinity
  let mutedUntil = -Infinity
  function floor() {
    if (!o.adaptiveFloor || rest === null) return o.beatFloor
    return Math.min(o.floorMax, Math.max(o.floorMin, o.floorRest * rest))
  }
  return {
    get floor() { return floor() },
    push(t, w) {
      const dt = lastT === null ? 0.005 : Math.min(0.05, Math.max(0.001, t - lastT))
      lastT = t
      const k = dt / o.beatTau
      mean = mean === null ? w : mean + k * (w - mean)
      const restK = dt / o.restTau
      // Track the quiet level of the signal. It falls faster than it rises so that a conductor
      // who settles into gentle strokes is quickly judged on their own scale, while a hand that
      // is genuinely in sustained motion keeps a higher bar. A fresh detector starts from the
      // fixed floor and converges down, because input.js rebuilds it mid-session and a low seed
      // would let the next stroke's lead-in through before the estimate caught up.
      rest = rest === null
        ? o.beatFloor / o.floorRest
        : rest + (w > rest ? restK : restK * 3) * (w - rest)
      // Triggering uses the low bar, so soft strokes are seen at all; the tier on the emitted
      // event says whether it cleared the high one.
      const level = Math.max(floor(), o.weakRise * mean)
      const strongLevel = Math.max(floor(), o.beatRise * mean)
      if (rising && (w < o.beatDrop * peak || w < level * 0.6)) {
        rising = false
        const accepted = peakT - lastBeat >= o.beatGap
        const strength = peak / Math.max(mean, 0.3)
        const tier = peak >= strongLevel ? "strong" : "weak"
        const p = peakT
        const peakSpeed = peak
        peak = 0
        if (accepted) {
          lastBeat = p
          return { type: "beat", t: p, strength, peakSpeed, tier }
        }
      } else if (w > level && t >= mutedUntil) {
        if (!rising || w > peak) { peak = w; peakT = t }
        rising = true
      }
      return null
    },
    mute(until) {
      mutedUntil = until
      rising = false
      peak = 0
    },
    gap() {
      mean = null
      rest = null
      lastT = null
      rising = false
      peak = 0
    },
    get mean() { return mean ?? 0 },
  }
}

export function createFistDetector(options = {}) {
  const o = { ...DEFAULTS, ...options }
  const hist = []
  let last = -Infinity
  return {
    push(t, gyr) {
      hist.push({ t, gyr })
      if (hist.length > 4) hist.shift()
      if (hist.length < 4) return null
      const a = hist[0]
      const dt = t - a.t
      if (dt <= 0 || dt > 0.05) return null
      const jerk = (norm([gyr[0] - a.gyr[0], gyr[1] - a.gyr[1], gyr[2] - a.gyr[2]]) / dt) * (180 / Math.PI)
      if (jerk > o.fistJerk && t - last > o.fistLockout) {
        last = t
        return { type: "fist", t, jerk }
      }
      return null
    },
  }
}

// Linear acceleration (gravity removed) → strike impulse and vertical velocity → palm up/down.
export function createLeftDetector(options = {}) {
  const o = { ...DEFAULTS, ...options }
  const gravity = createGravity()
  const smooth = []
  let vUp = 0
  let lastT = null
  let lastStrike = -Infinity
  let lastPalm = -Infinity
  let strikeRising = false
  let strikePeak = 0
  let strikeT = 0
  let candidate = null
  let still = 0
  return {
    get vUp() { return vUp },
    push(frame) {
      const { t, acc, gyr } = frame
      const dt = lastT === null ? 0.005 : Math.min(0.05, Math.max(0.001, t - lastT))
      lastT = t
      const up = gravity.update(acc, gyr, dt)
      const lin = [acc[0] - G * up[0], acc[1] - G * up[1], acc[2] - G * up[2]]
      const mag = norm(lin)
      const aUp = dot(lin, up)
      const out = []

      smooth.push(mag)
      if (smooth.length > 5) smooth.shift()
      const m = smooth.reduce((s, x) => s + x, 0) / smooth.length
      if (m > o.strikeAcc && t - lastStrike > o.strikeGap) {
        if (!strikeRising || m > strikePeak) { strikePeak = m; strikeT = t }
        strikeRising = true
      } else if (strikeRising && m < 0.8 * strikePeak) {
        strikeRising = false
        if (strikeT - lastStrike > o.strikeGap) {
          lastStrike = strikeT
          out.push({ type: "strike", t: strikeT, strength: strikePeak })
        }
        strikePeak = 0
      }

      // Leaky integration; reset when the hand is clearly at rest so drift does not build up.
      vUp += aUp * dt
      vUp *= Math.exp(-dt / 0.7)
      if (mag < 0.5 && norm(gyr) < 0.4) {
        still += dt
        if (still > 0.15) vUp = 0
      } else still = 0

      if (t - lastPalm > o.palmLockout) {
        if (!candidate && Math.abs(vUp) > o.palmSpeed) candidate = { start: t, peak: vUp, peakT: t }
        else if (candidate) {
          if (Math.abs(vUp) > Math.abs(candidate.peak)) { candidate.peak = vUp; candidate.peakT = t }
          // The strongest excursion in the window is the stroke; a small preparatory lift before a drop is outvoted.
          if (t - candidate.start >= o.palmWindow) {
            if (Math.abs(candidate.peak) >= o.palmMin) {
              lastPalm = candidate.peakT
              out.push({ type: "palm", t: candidate.peakT, dir: candidate.peak > 0 ? "up" : "down", speed: Math.abs(candidate.peak) })
            }
            candidate = null
          }
        }
      } else candidate = null
      return out
    },
  }
}

// Right hand: beats + fist. Left hand: palm + strike + fist.
export function createHandDetector(hand, options = {}) {
  let fist = createFistDetector(options)
  const beat = createBeatDetector(options)
  let left = hand === "left" ? createLeftDetector(options) : null
  return {
    hand,
    gap() {
      fist = createFistDetector(options)
      beat.gap()
      if (left) left = createLeftDetector(options)
    },
    push(frame) {
      const out = []
      const w = norm(frame.gyr)
      const f = fist.push(frame.t, frame.gyr)
      if (f) {
        out.push(f)
        beat.mute(frame.t + 0.6)
      }
      if (left) out.push(...left.push(frame))
      else {
        const b = beat.push(frame.t, w)
        if (b) out.push(b)
      }
      return out.map((event) => ({ ...event, hand }))
    },
  }
}
