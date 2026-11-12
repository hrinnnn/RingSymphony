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
  return { feature, reason: feature ? null : "方向信号过弱或相互抵消", hasGap: gaps > 0 }
}

// A near-opposite rotation shortly after an accepted beat is likely the return stroke.
export const RETURN_WINDOW = 0.46

export function createReturnFilter() {
  let previous = null
  // Read-only check, also usable for unclassified beats and live previews (which pass a looser cosine).
  function isReturn(feature, time, cosine = -0.8) {
    return Boolean(feature && previous && time > previous.time && time - previous.time < RETURN_WINDOW &&
      feature.reduce((sum, value, axis) => sum + value * previous.feature[axis], 0) < cosine)
  }
  return {
    reset() { previous = null },
    isReturn,
    accept(feature, time) {
      if (!feature) return true
      if (isReturn(feature, time)) return false
      previous = { feature, time }
      return true
    },
  }
}

export function createDirectionCalibration() {
  let samples = Object.fromEntries(DIRECTIONS.map((direction) => [direction, []]))
  let speeds = Object.fromEntries(DIRECTIONS.map((direction) => [direction, []]))
  let pending = null
  let message = "请先校准右手方向"
  let address = null

  function reset() {
    samples = Object.fromEntries(DIRECTIONS.map((direction) => [direction, []]))
    speeds = Object.fromEntries(DIRECTIONS.map((direction) => [direction, []]))
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
    const centroids = DIRECTIONS.map((direction) => unit(samples[direction].reduce(
      (sum, sample) => sum.map((value, i) => value + sample[i]), [0, 0, 0],
    )))
    let issue = ""
    if (complete) {
      for (let i = 0; i < DIRECTIONS.length; i += 1) {
        if (!centroids[i] || samples[DIRECTIONS[i]].some((sample) => sample.reduce((sum, value, axis) => sum + value * centroids[i][axis], 0) < 0.7)) {
          issue = `${DIRECTION_NAMES[DIRECTIONS[i]]}的三次动作差异过大，请重新采集`
          break
        }
        for (let j = 0; j < i; j += 1) {
          if (centroids[i].reduce((sum, value, axis) => sum + value * centroids[j][axis], 0) > 0.92) {
            issue = `${DIRECTION_NAMES[DIRECTIONS[i]]}和${DIRECTION_NAMES[DIRECTIONS[j]]}的动作过于相似，请重新采集`
            break
          }
        }
        if (issue) break
      }
    }
    return {
      ready: complete && !issue,
      beatFloor: complete && !issue && DIRECTIONS.every((direction) => speeds[direction].length === SAMPLES_PER_DIRECTION)
        ? Math.max(0.65, Math.min(1.6, Math.min(...DIRECTIONS.flatMap((direction) => speeds[direction])) * 0.7))
        : 1.6,
      counts: Object.fromEntries(DIRECTIONS.map((direction) => [direction, samples[direction].length])),
      pending: pending?.direction ?? null,
      message: pending ? `请向${DIRECTION_NAMES[pending.direction]}挥动一次，随后慢慢回位` : issue || message,
      address,
    }
  }

  return {
    reset,
    status,
    clearDirection(direction) {
      if (!DIRECTIONS.includes(direction)) throw new Error("无效的方向")
      if (pending) throw new Error("请先停止正在进行的校准")
      samples[direction] = []
      speeds[direction] = []
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
      }
      pending = { direction, start: now, deadline: now + 15 }
      message = ""
    },
    capture(feature, ringAddress, now, peakTime = now, peakSpeed = null) {
      status(now)
      if (!pending || peakTime < pending.start || ringAddress !== address) return false
      if (!feature) {
        message = "数据不足或存在断帧，请重新采集"
        pending = null
        return false
      }
      const direction = pending.direction
      samples[direction].push(feature)
      if (Number.isFinite(peakSpeed) && peakSpeed > 0) speeds[direction].push(peakSpeed)
      pending = null
      message = `已采集${DIRECTION_NAMES[direction]} ${samples[direction].length}/${SAMPLES_PER_DIRECTION} 次，请回到起始姿势`
      return true
    },
    classifyDetailed(feature, ringAddress) {
      if (!feature) return { direction: null, reason: "方向特征不足" }
      if (ringAddress !== address || !status(0).ready) return { direction: null, reason: "右手尚未完成校准" }
      const scores = DIRECTIONS.map((direction) => {
        const centroid = unit(samples[direction].reduce(
          (sum, sample) => sum.map((value, i) => value + sample[i]), [0, 0, 0],
        ))
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
