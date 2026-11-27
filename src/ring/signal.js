// Collect only quiet windows. A constant rotation can also have low variance,
// so limit the initial estimate and later deviations to plausible sensor bias.
export function createGyroBias(initial = [0, 0, 0]) {
  let value = initial
  let ready = initial.some(component => component !== 0)
  let frames = []
  return {
    get value() { return value },
    get ready() { return ready },
    update(t, acc, gyr, dt) {
      if (dt > 0.15 || Math.abs(Math.hypot(...acc) - 9.81) >= 0.8 ||
          Math.hypot(...gyr.map((component, i) => component - value[i])) > (ready ? 0.4 : 1.25)) {
        frames = []
        return value
      }
      while (frames.length > 1 && frames[1].t <= t - 0.25) frames.shift()
      frames.push({ t, gyr })
      if (frames.length < 4 || t - frames[0].t < 0.25) return value
      const mean = [0, 1, 2].map(axis => frames.reduce((sum, frame) => sum + frame.gyr[axis], 0) / frames.length)
      const variance = frames.reduce((sum, frame) => sum +
        frame.gyr.reduce((total, component, axis) => total + (component - mean[axis]) ** 2, 0), 0) / frames.length
      if (variance < 0.15 ** 2) {
        const alpha = 1 - Math.exp(-Math.min(0.02, dt) / 20)
        value = ready ? value.map((component, i) => component + alpha * (mean[i] - component)) : mean
        ready = true
      }
      return value
    },
  }
}

// A monotone queue retains the best observed clock offset in the last five seconds.
export function createClockOffset() {
  const candidates = []
  return {
    push(arrival, t) {
      const offset = arrival - t
      while (candidates.length && candidates.at(-1).offset >= offset) candidates.pop()
      candidates.push({ arrival, offset })
      while (candidates[0].arrival < arrival - 5) candidates.shift()
      return candidates[0].offset
    },
    reset() { candidates.length = 0 },
  }
}
