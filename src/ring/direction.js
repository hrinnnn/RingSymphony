export const DIRECTIONS = ["down", "left", "right", "up"]
export const DIRECTION_NAMES = { down: "下", left: "左", right: "右", up: "上" }
export const SAMPLES_PER_DIRECTION = 3
export const MAX_SHORT_GAP = 0.065

function unit(vector) {
  const length = Math.hypot(...vector)
  return length > 0.3 ? vector.map((value) => value / length) : null
}

// Average signed angular velocity leading up to the detected peak, in the ring's own axes.
export function directionFeature(frames, peakTime) {
  return directionFeatureResult(frames, peakTime).feature
}

export function directionFeatureResult(frames, peakTime) {
  const window = frames.filter((frame) => frame.t >= peakTime - 0.15 && frame.t <= peakTime)
  if (window.length < 10 || window[0].t > peakTime - 0.1) return { feature: null, reason: "数据不足或断帧" }
  let observed = 0
  let gaps = 0
  for (let i = 1; i < window.length; i += 1) {
    const dt = window[i].t - window[i - 1].t
    if (dt <= 0 || dt > MAX_SHORT_GAP) return { feature: null, reason: "数据不足或断帧" }
    if (dt > 0.03) gaps += 1
    else observed += dt
  }
  if (gaps > 1 || observed < 0.08) return { feature: null, reason: "数据不足或断帧" }
  const mean = [0, 0, 0]
  for (const frame of window) {
    for (let axis = 0; axis < 3; axis += 1) mean[axis] += frame.gyr[axis] / window.length
  }
  const feature = unit(mean)
  // How hard the hand was driven into this peak: the climb from the quietest moment in the window
  // up to the fastest, over the time between them. A stroke the player drives ramps hard; a return
  // is the arm relaxing back and barely ramps at all.
  //
  // Measured between the extremes rather than the window's endpoints. The window is the 150 ms
  // *before* the peak, but `peakTime` is when |ω| was highest, not when the detector emitted —
  // frames after the turn are in history by then, so the last frame in the window is often already
  // past the crest. Differencing the endpoints then reports a near-flat ramp for a stroke that
  // plainly had one (1.05 → 1.30 on a wave peaking at 9.4).
  let low = Infinity
  let lowAt = null
  let high = -Infinity
  let highAt = null
  for (const frame of window) {
    const speed = Math.hypot(...frame.gyr)
    if (speed < low) { low = speed; lowAt = frame.t }
    if (speed > high) { high = speed; highAt = frame.t }
  }
  const span = highAt === null || lowAt === null ? 0 : highAt - lowAt
  const rise = span > 0 ? (high - low) / span : null
  return { feature, rise, reason: feature ? null : "方向信号过弱或相互抵消", hasGap: gaps > 0 }
}

// A near-opposite rotation shortly after an accepted beat is likely the return stroke.
//
// Up and down sit about 166 degrees apart in practice, so a real down-stroke and the return of an
// up-stroke are the same motion as far as the gyroscope is concerned — no cosine threshold can
// separate them. Left and right sit about 95 degrees apart and their returns travel a different
// arc, which is why only the vertical pair suffers. What does separate a stroke from a return is
// when it happens: a stroke the player intends lands on a beat the music asked for, and a return
// falls between them. `onCue` carries that knowledge in from the caller, which keeps this module
// chart-agnostic.
export const RETURN_WINDOW = 0.46

// How fast |ω| is still climbing over the 150 ms into the peak, in rad/s². A stroke the player
// drives ramps hard into its peak; a return is the arm relaxing back and barely ramps at all.
// Measured on the left/right recordings, where gravity labels each peak independently of anything
// being tested here (53 strokes, 59 returns):
//
//     real strokes     rise p10 20.5, median 33.9
//     returns          rise p10 -11.2, median -1.1
//
// Those populations barely overlap, which is why this catches returns the geometry misses: a
// return only looks like a reversal if the stroke before it was seen and classified, so the first
// return after any gap, suppression or unclassified stroke sails straight through as a phantom
// beat. Of 17 such escapes in the recordings, a bar at 4 removes 5 and costs nothing — no real
// stroke in the set ramps that slowly. Higher bars catch more but start deleting real strokes, and
// a deleted stroke is a Miss the player did not earn, which is strictly worse than a phantom one
// the cue windows may well discard anyway.
export const RETURN_RISE = 4

export function createReturnFilter() {
  let previous = null
  // Read-only check, also usable for unclassified beats and live previews (which pass a looser cosine).
  // `rise` is optional: callers without it (the preview path, tests) get the geometric test alone.
  function isReturn(feature, time, cosine = -0.8, rise = null) {
    if (!feature) return false
    // Too limp to have been driven, whatever came before it. This stands on its own because the
    // geometric test needs a classified predecessor and a return often has none.
    if (rise !== null && rise < RETURN_RISE) return true
    return Boolean(previous && time > previous.time && time - previous.time < RETURN_WINDOW &&
      feature.reduce((sum, value, axis) => sum + value * previous.feature[axis], 0) < cosine)
  }
  return {
    reset() { previous = null },
    isReturn,
    accept(feature, time, onCue = false, rise = null) {
      if (!feature) return true
      // A reversal the music asked for is a stroke, not a return. It still becomes the reference
      // for what follows, so its own return is suppressed in turn. The cue overrides the geometry
      // but not the ramp: a limp motion where a cue happens to fall is not the stroke that cue
      // asked for, and admitting it would score the player for relaxing their arm.
      if (rise !== null && rise < RETURN_RISE) return false
      if (!onCue && isReturn(feature, time)) return false
      previous = { feature, time }
      return true
    },
  }
}

// All ways to choose `size` items, used to find the largest agreeing subset of calibration samples.
function combinations(list, size) {
  if (size >= list.length) return [list]
  if (size <= 0) return [[]]
  const seen = new Set()
  const out = []
  for (let skip = 0; skip < list.length; skip += 1) {
    const subset = list.filter((_, i) => i !== skip)
    for (const result of combinations(subset, size)) {
      const key = result.map((item) => list.indexOf(item)).join(",")
      if (seen.has(key)) continue
      seen.add(key)
      out.push(result)
    }
  }
  return out
}

// The largest subset of samples that all agree with their own centroid, so one sloppy wave does
// not invalidate the rest. With only three samples a single outlier drags a plain average about a
// third of the way toward itself, which can push the two good samples outside tolerance.
// Dropping a sample demands a tighter agreement among those kept: any two vectors less than 90°
// apart satisfy the normal tolerance against their own midpoint, so without this a direction with
// three mutually inconsistent waves would still find a passing pair.
function agreeing(list) {
  for (let size = list.length; size >= 2; size -= 1) {
    const tolerance = size === list.length ? 0.7 : 0.94
    for (const subset of combinations(list, size)) {
      const centroid = unit(subset.reduce((sum, sample) => sum.map((value, i) => value + sample[i]), [0, 0, 0]))
      if (centroid && subset.every((sample) => sample.reduce((sum, value, axis) => sum + value * centroid[axis], 0) >= tolerance)) {
        return { kept: subset, centroid }
      }
    }
  }
  return { kept: [], centroid: null }
}

export const CALIBRATION_VERSION = 2

// How well a finished calibration can be expected to work, scored the way it will actually be used.
//
// The geometric checks below answer "are these waves self-consistent and distinct?", which turns
// out to say little about play. Measured over 34 candidate calibrations drawn from recordings/方向,
// their verdict barely tracked the accuracy that followed, while this score correlates at 0.90.
//
// The method is leave-one-out: take each captured sample out, rebuild the templates from what is
// left, and ask whether the classifier — the real one, same accept bar and same margin — recovers
// the direction it was recorded for. A calibration whose own samples cannot classify each other
// will not classify the player's strokes either, and that is knowable before they play a note.
//
// No extra waving: it reuses the samples already captured.
export function calibrationFit(samples) {
  let correct = 0
  let total = 0
  for (const direction of DIRECTIONS) {
    for (let held = 0; held < samples[direction].length; held += 1) {
      const centroids = {}
      for (const other of DIRECTIONS) {
        const list = other === direction ? samples[other].filter((_, i) => i !== held) : samples[other]
        centroids[other] = agreeing(list).centroid
      }
      if (!DIRECTIONS.every((d) => centroids[d])) continue
      const feature = samples[direction][held]
      const scores = DIRECTIONS
        .map((d) => ({ direction: d, score: feature.reduce((sum, value, i) => sum + value * centroids[d][i], 0) }))
        .sort((a, b) => b.score - a.score)
      total += 1
      if (scores[0].score >= 0.8 && scores[0].score - scores[1].score >= 0.08 && scores[0].direction === direction) {
        correct += 1
      }
    }
  }
  return total ? correct / total : 0
}

// Below this a calibration is refused outright. Chosen from the same 34 candidates: every
// calibration scoring at or above it went on to classify at 57-86%, while those below reached as
// low as 0%. It is deliberately not set higher — at 0.9 only the very best five survive, and a
// player who must re-wave until they hit that is back to the cost this work exists to remove.
const FIT_FLOOR = 0.6
// Between the floor and here the calibration works but has little headroom, so the panel says so
// rather than reporting an unqualified 校准完成.
const FIT_GOOD = 0.9

const vectorList = (value) => Array.isArray(value) &&
  value.every((item) => Array.isArray(item) && item.length === 3 && item.every((n) => Number.isFinite(n)))

export function createDirectionCalibration() {
  let samples = Object.fromEntries(DIRECTIONS.map((direction) => [direction, []]))
  let speeds = Object.fromEntries(DIRECTIONS.map((direction) => [direction, []]))
  // Peak time of each direction's most recent capture, so the next one can be told from its return.
  let lastCaptureAt = Object.fromEntries(DIRECTIONS.map((direction) => [direction, null]))
  let pending = null
  let message = "请先校准右手方向"
  let address = null

  function reset() {
    samples = Object.fromEntries(DIRECTIONS.map((direction) => [direction, []]))
    speeds = Object.fromEntries(DIRECTIONS.map((direction) => [direction, []]))
    lastCaptureAt = Object.fromEntries(DIRECTIONS.map((direction) => [direction, null]))
    pending = null
    address = null
    message = "请先校准右手方向"
  }

  function status(now) {
    if (pending && now > pending.deadline) {
      pending = null
      message = "未检测到足够清晰的挥动；请确认右手指环在线，再重试当前方向"
    }
    const complete = DIRECTIONS.every((direction) => samples[direction].length >= SAMPLES_PER_DIRECTION)
    // Each direction is judged on its own: a majority of its samples must agree, and the centroid
    // used for classification comes from those alone so an outlier cannot skew it.
    const consensus = Object.fromEntries(DIRECTIONS.map((direction) => [direction, agreeing(samples[direction])]))
    const centroids = DIRECTIONS.map((direction) => consensus[direction].centroid)
    const perDirection = {}
    for (let i = 0; i < DIRECTIONS.length; i += 1) {
      const direction = DIRECTIONS[i]
      const count = samples[direction].length
      let dirIssue = ""
      if (count < SAMPLES_PER_DIRECTION) dirIssue = `${DIRECTION_NAMES[direction]}还需采集 ${SAMPLES_PER_DIRECTION - count} 次`
      else if (!centroids[i]) dirIssue = `${DIRECTION_NAMES[direction]}的动作差异过大，请重新采集`
      perDirection[direction] = { count, valid: count >= SAMPLES_PER_DIRECTION && Boolean(centroids[i]), issue: dirIssue }
    }
    let issue = ""
    if (complete) {
      for (let i = 0; i < DIRECTIONS.length; i += 1) {
        if (!centroids[i]) {
          issue = perDirection[DIRECTIONS[i]].issue
          break
        }
        for (let j = 0; j < i; j += 1) {
          if (centroids[j] && centroids[i].reduce((sum, value, axis) => sum + value * centroids[j][axis], 0) > 0.92) {
            issue = `${DIRECTION_NAMES[DIRECTIONS[i]]}和${DIRECTION_NAMES[DIRECTIONS[j]]}的动作过于相似，请重新采集`
            break
          }
        }
        if (issue) break
      }
    }
    // Only worth computing once the waves are all in and self-consistent; before that the missing
    // directions have no centroid to score against.
    const fit = complete && !issue ? calibrationFit(samples) : null
    // A calibration that cannot classify its own samples will not classify the player's strokes.
    // Stated here, at the end of calibration, instead of being discovered as silent refusals
    // during a level — which is how a 36% session happened with the panel showing 校准完成.
    const fitIssue = fit !== null && fit < FIT_FLOOR
      ? `这组校准动作区分度不足（${Math.round(fit * 100)}%），请重新采集：每个方向挥得更干脆，方向之间差别更明显`
      : ""
    const blocking = issue || fitIssue
    return {
      ready: complete && !blocking,
      perDirection,
      // How well the calibration classifies its own samples, and whether that leaves any headroom.
      // Carried out so the panel can distinguish "finished" from "finished and reliable".
      fit,
      fitLevel: fit === null ? null : fit >= FIT_GOOD ? "good" : fit >= FIT_FLOOR ? "marginal" : "poor",
      // 70% of the player's softest calibration wave. This seeds the detector's adaptive floor,
      // so it is the bar the very first stroke of a level is judged against — there is no history
      // yet for the floor to have learned from. It is only clamped from below: capping it at the
      // old fixed 1.6 meant anyone who calibrated with a firm wave started at the ceiling, and
      // their first beat had to exceed 1.6 rad/s to register at all.
      beatFloor: complete && !blocking && DIRECTIONS.every((direction) => speeds[direction].length === SAMPLES_PER_DIRECTION)
        ? Math.max(0.65, Math.min(...DIRECTIONS.flatMap((direction) => speeds[direction])) * 0.7)
        : 1.6,
      counts: Object.fromEntries(DIRECTIONS.map((direction) => [direction, samples[direction].length])),
      pending: pending?.direction ?? null,
      message: pending ? `请向${DIRECTION_NAMES[pending.direction]}挥动一次，随后慢慢回位` : blocking || message,
      address,
    }
  }

  return {
    reset,
    status,
    serialise(hand, gyroBias = null) {
      if (!address) return null
      return { version: CALIBRATION_VERSION, address, hand, samples, speeds, gyroBias, savedAt: Date.now() }
    },
    // Keyed by ring address *and* hand: the same ring worn on the other hand has different axes,
    // and assign()/swap in input.js can move a ring between hands between sessions.
    restore(data, ringAddress, hand) {
      const no = { ok: false, gyroBias: null }
      if (!data || typeof data !== "object") return no
      if (data.version !== CALIBRATION_VERSION) return no
      if (data.address !== ringAddress || data.hand !== hand) return no
      if (!data.samples || typeof data.samples !== "object") return no
      if (!data.speeds || typeof data.speeds !== "object") return no
      const restored = {}
      const restoredSpeeds = {}
      for (const direction of DIRECTIONS) {
        const list = data.samples[direction] ?? []
        const speedList = data.speeds[direction] ?? []
        if (!vectorList(list)) return no
        if (!Array.isArray(speedList) || !speedList.every((n) => Number.isFinite(n))) return no
        restored[direction] = list.map((sample) => [...sample])
        restoredSpeeds[direction] = [...speedList]
      }
      samples = restored
      speeds = restoredSpeeds
      // Restored samples have no live peak times, and none are needed: the return check only ever
      // compares captures made in this session.
      lastCaptureAt = Object.fromEntries(DIRECTIONS.map((direction) => [direction, null]))
      pending = null
      address = ringAddress
      message = ""
      // The gyro bias is part of the calibration, not an extra. The templates were built from
      // bias-corrected readings, so restoring them without it compares corrected templates against
      // uncorrected features. Measured on recordings/方向 the bias is ~0.78 rad/s, which tilts a
      // 1.5 rad/s stroke's feature by up to 27 degrees - against a 36.9 degree accept threshold
      // and only 39 degrees between `up` and `right`. Returned rather than applied here because
      // the bias belongs to the ring, which this module does not own.
      return Array.isArray(data.gyroBias) && data.gyroBias.length === 3 && data.gyroBias.every(Number.isFinite)
        ? { ok: true, gyroBias: [...data.gyroBias] }
        : { ok: true, gyroBias: null }
    },
    clearDirection(direction) {
      if (!DIRECTIONS.includes(direction)) throw new Error("无效的方向")
      if (pending) throw new Error("请先停止正在进行的校准")
      samples[direction] = []
      speeds[direction] = []
      lastCaptureAt[direction] = null
      message = `请重新采集${DIRECTION_NAMES[direction]}方向`
    },
    cancel(text = "已取消校准") {
      pending = null
      message = text
    },
    arm(direction, ringAddress, now) {
      if (!DIRECTIONS.includes(direction)) throw new Error("无效的方向")
      if (!ringAddress) throw new Error("右手指环未连接")
      if (address && address !== ringAddress) reset()
      address = ringAddress
      if (samples[direction].length >= SAMPLES_PER_DIRECTION) {
        samples[direction] = []
        speeds[direction] = []
        lastCaptureAt[direction] = null
      }
      pending = { direction, start: now, deadline: now + 15 }
      message = ""
    },
    capture(feature, ringAddress, now, peakTime = now, peakSpeed = null, rise = null) {
      status(now)
      if (!pending || peakTime < pending.start || ringAddress !== address) return false
      if (!feature) {
        message = "数据不足或存在断帧，请重新采集"
        pending = null
        return false
      }
      const direction = pending.direction
      // Too limp to have been driven. A sample taken from the swing back describes the opposite of
      // the direction being recorded, and this catches it whether or not the stroke it returns from
      // was itself captured — which the geometric check below cannot do.
      if (rise !== null && rise < RETURN_RISE) {
        message = `这次动作太轻，像是回程或收手，已跳过；请回位停稳后再挥一次`
        pending = null
        return false
      }
      // A wave and the swing back are the same rotation reversed, so the return is a candidate peak
      // in its own right. Captured as a sample it describes the opposite of the direction being
      // recorded, and three samples pointing two ways produce a template pointing nowhere useful —
      // which is how "左右过于相似" arises from waves that were nothing of the sort.
      //
      // The automatic flow waits for the hand to settle before arming, so this mostly guards manual
      // re-records and a player who swings back briskly into the next capture.
      const previous = samples[direction].length ? samples[direction][samples[direction].length - 1] : null
      const previousAt = lastCaptureAt[direction]
      if (previous && previousAt !== null && peakTime > previousAt && peakTime - previousAt < RETURN_WINDOW &&
          feature.reduce((sum, value, axis) => sum + value * previous[axis], 0) < -0.8) {
        message = `这次动作像是${DIRECTION_NAMES[direction]}的回程，已跳过；请回位停稳后再挥一次`
        pending = null
        return false
      }
      samples[direction].push(feature)
      lastCaptureAt[direction] = peakTime
      if (Number.isFinite(peakSpeed) && peakSpeed > 0) speeds[direction].push(peakSpeed)
      pending = null
      message = `已采集${DIRECTION_NAMES[direction]} ${samples[direction].length}/${SAMPLES_PER_DIRECTION} 次，请回到起始姿势`
      return true
    },
    classifyDetailed(feature, ringAddress) {
      if (!feature) return { direction: null, reason: "方向特征不足" }
      if (ringAddress !== address || !status(0).ready) return { direction: null, reason: "右手尚未完成校准" }
      const scores = DIRECTIONS.map((direction) => {
        // The centroid comes from the agreeing samples only, matching what status() validated.
        const centroid = agreeing(samples[direction]).centroid
        return { direction, score: centroid ? feature.reduce((sum, value, i) => sum + value * centroid[i], 0) : -1 }
      }).sort((a, b) => b.score - a.score)
      if (scores[0].score < 0.8) return { direction: null, reason: "与校准动作差异过大" }
      if (scores[0].score - scores[1].score < 0.08) return { direction: null, reason: "方向相近，无法区分" }
      return { direction: scores[0].direction, reason: null }
    },
    classify(feature, ringAddress) {
      return this.classifyDetailed(feature, ringAddress).direction
    },
  }
}
