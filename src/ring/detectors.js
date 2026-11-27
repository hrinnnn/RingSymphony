// Streaming IMU gesture detectors for one Ringo (200 Hz, acc m/s², gyr rad/s, device axes).
// Pure functions, no DOM: the same code runs in the browser and in the Node replay tests.
// Frame: { t: seconds (device clock), acc: [x,y,z], gyr: [x,y,z] }

import { createCircleDetector } from "./circle.js"

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
  beatTravel: 0,
  earlyBeat: false,
  sharpBeatSpeed: 4,
  // The floor tracks how hard this player actually conducts, so a gentle conductor is not
  // judged against an energetic one's bar. `floorRest` sets how far above the resting level
  // the floor sits; the clamp keeps it between a safe minimum and the old fixed value.
  adaptiveFloor: true,
  restTau: 4,
  floorRest: 2.2,
  floorMin: 0.65,
  floorMax: 1.6,
  // Seconds of signal a fresh detector watches before it will report a beat. The resting estimate
  // seeds low so a gentle first stroke is not lost, which also means a hand already in motion
  // would briefly report noise; this covers that window. Short enough to finish well inside a
  // count-in, and the ring is streaming from the moment it connects, so in practice the detector
  // has been watching long before a level starts.
  warmup: 0.3,
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
    update(acc, gyr, dt, sparse = false) {
      const a = norm(acc)
      if (a < 1e-6) return up
      const ad = [acc[0] / a, acc[1] / a, acc[2] / a]
      if (!up) {
        up = ad
        return up
      }
      const d = cross(gyr, up)
      let next = [up[0] - d[0] * dt, up[1] - d[1] * dt, up[2] - d[2] * dt]
      const trust = (sparse ? 0.06 : 0.03) * Math.exp(-(((a - G) / 3) ** 2))
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
  // Frames seen since the detector was built or a gap reset it. The resting estimate seeds low so
  // a gentle first stroke is not lost, but a low bar on a hand that is already moving reports
  // noise as beats. Reporting is held off until the estimate has had time to rise into the
  // player's real resting level — the hand is settling or the count-in is running during this.
  let settled = 0
  let lastT = null
  let rising = false
  let onsetT = 0
  let peak = 0
  let peakT = 0
  let travel = 0
  let sparseThrough = -Infinity
  let lastGap = -Infinity
  let lastBeat = -Infinity
  let lastPeak = 0
  let lastTier = null
  let previousSpeed = 0
  let falling = 0
  let mutedUntil = -Infinity
  function floor() {
    if (!o.adaptiveFloor || rest === null) return o.beatFloor
    return Math.min(o.floorMax, Math.max(o.floorMin, o.floorRest * rest))
  }
  function resetCandidate() {
    rising = false
    peak = 0
    falling = 0
  }
  return {
    get floor() { return floor() },
    get candidate() {
      if (!rising || (peakT - lastBeat < o.beatGap && lastTier !== "weak") || (o.adaptiveFloor && settled < o.warmup)) return null
      return { onsetT, travel, peakSpeed: peak }
    },
    resetCandidate,
    push(t, w) {
      // Avoid measuring travel from a window with missing samples.
      if (sparseThrough === null || (lastT !== null && t - lastT > 0.025)) {
        lastGap = t
        sparseThrough = t + 0.18
        falling = 0
      }
      const dt = lastT === null ? 0.005 : Math.min(0.02, Math.max(0.001, t - lastT))
      lastT = t
      settled += dt
      const k = dt / o.beatTau
      mean = mean === null ? w : mean + k * (w - mean)
      // A burst of frames after missing samples is weak evidence about the
      // resting level. Give it less weight so one forceful stroke cannot
      // push the adaptive floor above the next light stroke.
      const restK = dt / o.restTau * (t <= sparseThrough ? 0.4 : 1)
      // Track the quiet level of the signal. It falls faster than it rises so that a conductor
      // who settles into gentle strokes is quickly judged on their own scale, while a hand that
      // is genuinely in sustained motion keeps a higher bar.
      //
      // A fresh detector seeds at the lowest bar and rises into the player's real resting level
      // over the first second or so. Seeding high instead cost the first stroke of every level:
      // the estimate needed about three seconds to come down — the whole count-in — so a player
      // who calibrated firmly and then conducted gently had their opening beat judged against a
      // bar it could not clear. Erring low can only admit an extra candidate at the start, which
      // the direction classifier and the cue windows still have to agree with; erring high
      // silently deletes a beat the player made.
      rest = rest === null
        ? o.floorMin / o.floorRest
        : rest + (w > rest ? restK : restK * 3) * (w - rest)
      // Triggering uses the low bar, so soft strokes are seen at all; the tier on the emitted
      // event says whether it cleared the high one.
      const level = Math.max(floor(), o.weakRise * mean)
      const strongLevel = Math.max(floor(), o.beatRise * mean)
      falling = rising && w < previousSpeed ? falling + 1 : 0
      previousSpeed = w
      const enoughMotion = peak >= o.sharpBeatSpeed || travel >= o.beatTravel || peakT <= sparseThrough
      // After a gap, require two falling samples and a fresh run of frames.
      const continuous = t > sparseThrough
      const earlyDrop = falling >= 2 && t - lastGap > 0.015
      const maturePeak = t - onsetT >= 0.025 || peak >= strongLevel * 1.5
      const early = o.earlyBeat && enoughMotion && maturePeak && w < 0.90 * peak &&
        (earlyDrop || (continuous && t - peakT >= 0.015))
      if (rising && (early || w < o.beatDrop * peak || w < level * 0.6)) {
        rising = false
        const strength = peak / Math.max(mean, 0.3)
        const tier = peak >= strongLevel ? "strong" : "weak"
        const interval = peakT - lastBeat
        const afterPrep = o.earlyBeat && lastTier === "weak" && tier === "strong" &&
          interval >= 0.08 && interval <= 0.34 && peak >= lastPeak * 1.5
        const accepted = (interval >= o.beatGap || afterPrep) && enoughMotion
        const p = peakT
        const peakSpeed = peak
        peak = 0
        if (accepted && (!o.adaptiveFloor || settled >= o.warmup)) {
          lastBeat = p
          lastPeak = peakSpeed
          lastTier = tier
          return { type: "beat", t: p, onsetT, strength, peakSpeed, tier, sparse: !continuous }
        }
      } else if (w > level && t >= mutedUntil) {
        if (!rising) onsetT = t
        travel = (rising ? travel : 0) + w * dt
        if (!rising || w > peak) { peak = w; peakT = t }
        rising = true
      }
      return null
    },
    mute(until) {
      mutedUntil = until
      resetCandidate()
    },
    gap() {
      // With missing samples, the observed rotation only bounds the true travel from below.
      sparseThrough = null
      mean = null
      rest = null
      lastT = null
      resetCandidate()
    },
    get mean() { return mean ?? 0 },
  }
}

export function createFistDetector(options = {}) {
  const o = { ...DEFAULTS, ...options }
  const hist = []
  let last = -Infinity
  let lastShort = -Infinity
  let shortShock = null
  let shock = null
  let sparseThrough = -Infinity
  return {
    push(t, gyr, confirmShortFist, linearAcc = 0, verticalAcc = 0) {
      const previous = hist.at(-1)
      if (previous && t - previous.t > 0.025) sparseThrough = t + 0.12
      const speed = norm(gyr)
      while (hist.length && t - hist[0].t > 0.15) hist.shift()
      const samples = hist.filter(frame => t - frame.t <= 0.080001)
      hist.push({ t, gyr, speed, linearAcc, verticalAcc })
      const a = samples.at(-3)
      const dt = a ? t - a.t : 0
      const jerk = dt > 0 && dt <= 0.05 ? norm(gyr.map((value, i) => value - a.gyr[i])) / dt * (180 / Math.PI) : 0
      if (jerk > o.fistJerk && (t > sparseThrough || linearAcc <= 8) && t - last > o.fistLockout) {
        last = t
        shock = null
        shortShock = null
        return { type: "fist", t, jerk }
      }
      // Sparse streams can miss the impulse outright. Accept a weaker recovery
      // only at a written cutoff, where a rapid rise, impact and stop must agree.
      if (shock && (t - shock.t > 0.13 || linearAcc > 10)) shock = null
      if (shock && speed <= shock.speed * 0.55) {
        const candidate = shock
        shock = null
        if (t - Math.max(last, lastShort) > o.fistLockout && confirmShortFist?.(candidate.t)) {
          lastShort = t
          shortShock = null
          return { type: "fist", t: candidate.t, jerk: candidate.jerk, tier: "sparse" }
        }
      }
      const handImpact = linearAcc >= 0.8 && linearAcc <= 8 && Math.abs(verticalAcc) <= 4.25 &&
        samples.every(frame => frame.linearAcc <= 10 && (t - frame.t > 0.025 || Math.abs(frame.verticalAcc) <= 4.25))
      if (confirmShortFist && t <= sparseThrough && speed >= 4 && speed <= 11 && handImpact) {
        // A fist produces an isolated rise. Repeated wrist motion and a moving
        // arm can both produce a large difference across a missing packet.
        const leadIn = hist.filter(frame => t - frame.t >= 0.025)
        const quietLeadIn = leadIn.length >= 2 &&
          leadIn.every(frame => frame.speed <= speed * 0.55) &&
          leadIn.reduce((sum, frame) => sum + frame.linearAcc, 0) <= 1.9 * leadIn.length
        const start = samples.find(frame => t - frame.t >= 0.0049 && speed - frame.speed >= 2.5 && frame.speed <= speed * 0.65)
        if (quietLeadIn && start && (!shock || speed > shock.speed)) {
          shock = { t, speed, jerk: (speed - start.speed) / (t - start.t) * (180 / Math.PI) }
        }
      }
      // A short impulse can disappear in the longer average. Keep it separate so it
      // can only confirm a written cutoff and cannot mute beats or end free conducting.
      if (shortShock && t - shortShock.t > 0.075) shortShock = null
      if (confirmShortFist && (t > sparseThrough || linearAcc <= 10) && t - Math.max(last, lastShort) > o.fistLockout) {
        const short = samples.length >= 3 ? samples.at(-2) : null
        const span = short ? t - short.t : 0
        if (span > 0 && span <= 0.025) {
          const change = norm(gyr.map((value, i) => value - short.gyr[i]))
          const jerk = change / span * (180 / Math.PI)
          if (change >= 4 && jerk > o.fistJerk && !shortShock && confirmShortFist(t)) {
            const peak = Math.max(speed, ...samples.filter(frame => t - frame.t <= 0.055).map(frame => frame.speed))
            shortShock = { t, peak, jerk }
          }
        }
      }
      if (shortShock) {
        shortShock.peak = Math.max(speed, shortShock.peak)
        if (speed <= Math.min(1.8, shortShock.peak * 0.4) && shortShock.peak - speed >= 4) {
          const candidate = shortShock
          shortShock = null
          if (t - Math.max(last, lastShort) > o.fistLockout && confirmShortFist?.(candidate.t)) {
            lastShort = t
            shock = null
            return { type: "fist", t: candidate.t, jerk: candidate.jerk, tier: "short" }
          }
        }
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
      const gap = lastT === null ? 0.005 : t - lastT
      const dt = Math.min(0.02, Math.max(0.001, gap))
      lastT = t
      const up = frame.up ?? gravity.update(acc, gyr, dt, gap > 0.025) ?? [0, 1, 0]
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
          // A pronounced peak that has already backed off in the same direction
          // can confirm early. Keep the full window for gentler or mixed motions.
          const peakSpeed = Math.abs(candidate.peak)
          const settledPeak = t - candidate.start >= 0.28 && t - candidate.peakT >= 0.04 &&
            peakSpeed >= 1.1 && candidate.peak * vUp > 0 && Math.abs(vUp) <= peakSpeed * 0.8
          if (settledPeak || t - candidate.start >= o.palmWindow) {
            if (Math.abs(candidate.peak) >= o.palmMin) {
              lastPalm = candidate.peakT
              out.push({ type: "palm", t: candidate.peakT, onsetT: candidate.start,
                dir: candidate.peak > 0 ? "up" : "down", speed: peakSpeed })
            }
            candidate = null
          }
        }
      } else candidate = null
      return out
    },
  }
}

// Both hands detect beats, palms and fists. The left hand also reports strikes and loops.
export function createHandDetector(hand, options = {}) {
  let fist = createFistDetector(options)
  const beat = createBeatDetector(options)
  let motion = createLeftDetector(options)
  let circle = hand === "left" ? createCircleDetector() : null
  function resetCircle() { if (circle) circle = createCircleDetector() }
  return {
    hand,
    get beatCandidate() { return beat.candidate },
    resetBeatCandidate: beat.resetCandidate,
    resetCircle,
    gap() {
      fist = createFistDetector(options)
      beat.gap()
      motion = createLeftDetector(options)
      resetCircle()
    },
    push(frame, confirmShortFist) {
      const out = []
      const w = norm(frame.gyr)
      const linear = frame.up ? frame.acc.map((value, i) => value - G * frame.up[i]) : null
      const linearAcc = linear ? norm(linear) : Math.abs(norm(frame.acc) - G)
      const f = fist.push(frame.t, frame.gyr, confirmShortFist, linearAcc, linear ? dot(linear, frame.up) : 0)
      if (f) {
        out.push(f)
        if (!f.tier) beat.mute(frame.t + 0.6)
      }
      const loop = circle?.push(frame)
      if (loop) out.push(loop)
      const b = beat.push(frame.t, w)
      if (b) out.push(b)
      out.push(...motion.push(frame).filter((event) => hand === "left" || event.type === "palm"))
      return out.map((event) => ({ ...event, hand }))
    },
  }
}

function median(values) {
  const mid = Math.floor(values.length / 2)
  if (values.length % 2) return values[mid]
  return (values[mid - 1] + values[mid]) / 2
}

// Free-mode ear. Over the last few seconds, split swings into a taller half and a shorter half.
// A new peak closer to the tall group is a beat. Tempo and loudness only move on those.
// If every recent swing is about the same size, they all count, so a gentle conductor is not erased.
// This does not replace createBeatDetector. Levels keep that one.
export function createSwingEar() {
  const swings = []
  return {
    hear(t, peak) {
      const speed = Number(peak)
      if (!Number.isFinite(speed) || speed <= 0) return { accept: true, energy: null }
      const recent = swings.filter((swing) => t - swing.t <= 8)
      let result
      if (recent.length < 4) result = { accept: true, energy: 1 }
      else {
        const sorted = recent.map((swing) => swing.peak).sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        const small = median(sorted.slice(0, mid))
        const big = median(sorted.slice(mid))
        if (!(big > small * 1.35)) {
          const middle = median(sorted) || speed
          result = { accept: true, energy: Math.max(0.55, Math.min(1.7, speed / middle)) }
        } else if (Math.abs(speed - big) <= Math.abs(speed - small)) {
          result = { accept: true, energy: Math.max(0.55, Math.min(1.7, speed / big)) }
        } else result = { accept: false, energy: null }
      }
      swings.push({ t, peak: speed })
      while (swings.length && t - swings[0].t > 8) swings.shift()
      return result
    },
    reset() { swings.length = 0 },
  }
}
