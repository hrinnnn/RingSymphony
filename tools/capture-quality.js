export const MIN_RATE_HZ = 150
export const MAX_GAP_MS = 50

const deviceTime = frame => frame.timestamp ?? frame.local_timestamp

export function createCaptureHealth() {
  const frames = []
  let still = []
  let bias = null
  return {
    push(frame, receivedMs) {
      const t = deviceTime(frame)
      if (!Number.isFinite(t)) return
      const previous = frames.at(-1)
      const gap = previous ? Math.max((t - previous.t) * 1000, receivedMs - previous.receivedMs) : 0
      if (previous && t <= previous.t) {
        frames.length = 0
        bias = null
      }
      frames.push({ t, receivedMs, gap })
      if (Math.abs(Math.hypot(...frame.acc) - 9.81) >= 0.8 || gap > 50 || (previous && t <= previous.t)) still = []
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
      const span = first ? Math.min(now - first.receivedMs, (last.t - first.t) * 1000) : 0
      const rate = first ? (frames.length - 1) / Math.max((now - first.receivedMs) / 1000, 0.001) : 0
      const maxGapMs = first ? Math.max(now - last.receivedMs, ...frames.map(frame => frame.gap)) : 0
      return { rate, maxGapMs, ready: span >= 4500, bias }
    },
    resetStill() { still = []; bias = null },
  }
}

export function summarizeCapture(frames, hands, durationMs) {
  const streams = Object.fromEntries(Object.values(hands).map(hand => [hand, {
    frames: 0, missing: 0, gaps: 0, maxGapMs: 0, clockResets: 0,
  }]))
  const last = {}
  for (const frame of frames) {
    const stream = streams[frame.hand]
    if (!stream) continue
    const previous = last[frame.hand]
    const dt = previous ? (deviceTime(frame) - deviceTime(previous)) * 1000 : 0
    const gap = Math.max(dt || 0, frame.receivedMs - (previous?.receivedMs ?? 0))
    if (previous && dt <= 0) stream.clockResets++
    if (gap > MAX_GAP_MS) stream.gaps++
    stream.maxGapMs = Math.max(stream.maxGapMs, gap)
    stream.missing += Math.max(0, (frame.sequence - previous?.sequence) - 1) || 0
    stream.frames++
    last[frame.hand] = frame
  }
  for (const [hand, stream] of Object.entries(streams)) {
    const trailing = Math.max(0, durationMs - (last[hand]?.receivedMs ?? 0))
    if (trailing > MAX_GAP_MS) stream.gaps++
    stream.maxGapMs = Math.round(Math.max(stream.maxGapMs, trailing))
    stream.rateHz = Math.round(stream.frames / Math.max(durationMs / 1000, 0.001))
  }
  const recommendRetry = Object.values(streams).some(stream =>
    stream.rateHz < MIN_RATE_HZ || stream.gaps || stream.missing || stream.clockResets)
  return { streams, recommendRetry }
}
