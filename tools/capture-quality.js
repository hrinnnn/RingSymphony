export const MIN_RATE_HZ = 150
export const MAX_GAP_MS = 50

export const QUALITY_CONCLUSIONS = {
  realtime: "适用于训练与实时低延迟评估",
  offline: "适用于离线训练，不建议用于实时延迟评估",
  retry: "建议重录",
}

export function deviceContinuous(stream) {
  return stream.deviceRateHz >= MIN_RATE_HZ && !stream.deviceGaps && !stream.missing && !stream.clockResets
}

export function receiveSmooth(stream) {
  return stream.receiveRateHz >= MIN_RATE_HZ && !stream.receiveGaps
}

const deviceTime = frame => frame.timestamp ?? frame.local_timestamp
const overGap = ms => ms > MAX_GAP_MS + 1e-6

function measure(frames, start, end) {
  let deviceSpan = 0
  let deviceIntervals = 0
  const stats = { frames: frames.length, deviceRateHz: 0, deviceMaxGapMs: 0, deviceGaps: 0,
    missing: 0, clockResets: 0, receiveRateHz: 0, receiveMaxGapMs: 0, receiveGaps: 0 }
  const addReceiveGap = (gap) => {
    stats.receiveMaxGapMs = Math.max(stats.receiveMaxGapMs, gap)
    if (overGap(gap)) stats.receiveGaps++
  }
  let previous
  for (const frame of frames) {
    addReceiveGap(frame.receivedMs - (previous?.receivedMs ?? start))
    if (previous) {
      const dt = (deviceTime(frame) - deviceTime(previous)) * 1000
      if (dt > 0) {
        deviceSpan += dt
        deviceIntervals++
        stats.deviceMaxGapMs = Math.max(stats.deviceMaxGapMs, dt)
        if (overGap(dt)) stats.deviceGaps++
        // For BLE, sequence is an inferred sample index, not the packet counter.
        stats.missing += Math.max(0, frame.sequence - previous.sequence - 1) || 0
      } else {
        stats.clockResets++
      }
    }
    previous = frame
  }
  addReceiveGap(end - (previous?.receivedMs ?? start))
  stats.deviceRateHz = deviceSpan ? deviceIntervals * 1000 / deviceSpan : 0
  stats.receiveRateHz = end > start ? Math.max(0, frames.length - 1) * 1000 / (end - start) : 0
  return stats
}

export function createCaptureHealth() {
  const frames = []
  let still = []
  let bias = null
  return {
    push(frame, receivedMs) {
      const t = deviceTime(frame)
      if (!Number.isFinite(t)) return
      const previous = frames.at(-1)
      const dt = previous ? (t - previous.timestamp) * 1000 : 0
      if (previous && dt <= 0) bias = null
      frames.push({ timestamp: t, receivedMs, sequence: frame.sequence })
      if (Math.abs(Math.hypot(...frame.acc) - 9.81) >= 0.8 || overGap(dt) || (previous && dt <= 0)) still = []
      else {
        while (still.length > 1 && still[1].t <= t - 3) still.shift()
        still.push({ t, gyr: frame.gyr })
        if (!bias && t - still[0].t >= 3) {
          const mean = [0, 1, 2].map(axis => still.reduce((sum, sample) => sum + sample.gyr[axis], 0) / still.length)
          const deviation = Math.sqrt(still.reduce((sum, sample) => sum +
            sample.gyr.reduce((v, component, i) => v + (component - mean[i]) ** 2, 0), 0) / still.length)
          if (deviation < 0.15 && Math.hypot(...mean) < 1.25) bias = mean
        }
      }
      while (frames.length && frames[0].receivedMs < receivedMs - 5000) frames.shift()
    },
    status(now) {
      const first = frames[0]
      const last = frames.at(-1)
      const span = first ? last.receivedMs - first.receivedMs : 0
      return { ...measure(frames, first?.receivedMs ?? now, now), ready: span >= 4500, bias }
    },
    resetStill() { still = []; bias = null },
  }
}

export function summarizeCapture(frames, hands, durationMs) {
  const byHand = Object.fromEntries(Object.values(hands).map(hand => [hand, []]))
  for (const frame of frames) {
    if (Number.isFinite(deviceTime(frame))) byHand[frame.hand]?.push(frame)
  }
  const streams = Object.fromEntries(Object.entries(byHand).map(([hand, rows]) => [hand, measure(rows, 0, durationMs)]))
  const active = Object.values(streams)
  const tier = !active.every(deviceContinuous) ? "retry" : !active.every(receiveSmooth) ? "offline" : "realtime"
  return { streams, tier, recommendRetry: tier === "retry" }
}
