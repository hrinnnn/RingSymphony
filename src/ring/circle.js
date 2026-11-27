// IMU-only recognition of a complete wrist loop. The sensor can see the motion,
// while the game supplies which sections are available to select.
const SAMPLE_STEP = 0.04
const WINDOWS = [1.15, 1.45, 1.75, 2.05, 2.35, 2.65]
// After zero-bias correction genuine loops need less total rotation to count.
// Compensate with tighter closure and two-axis checks to reject half circles.
const MIN_SPEED = 0.52
const MIN_TRAVEL = 2.3
const MIN_TURN = 5.7
const MIN_COHERENCE = 0.8
const MAX_OPENNESS = 0.45
const MIN_BALANCE = 0.91

const norm = v => Math.hypot(...v)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

function loopEvidence(samples) {
  let travel = 0
  let signedMotion = [0, 0, 0]
  let axis = [0, 0, 0]
  let totalTurn = 0
  let previous = null
  let first = 0
  let last = 0
  for (const sample of samples) {
    const { t, vector, speed } = sample
    travel += speed
    signedMotion = signedMotion.map((value, i) => value + vector[i])
    if (speed < MIN_SPEED) continue
    if (previous && t - previous.t < 0.19) {
      const normal = cross(previous.vector, vector)
      const size = norm(normal)
      const angle = Math.atan2(size, dot(previous.vector, vector))
      if (size > 1e-6) {
        axis = axis.map((value, i) => value + normal[i] * angle / size)
        totalTurn += angle
      }
    } else if (previous === null) first = t
    previous = sample
    last = t
  }
  const turn = norm(axis)
  if (last - first < 0.9 || travel * SAMPLE_STEP < MIN_TRAVEL ||
      norm(signedMotion) > travel * MAX_OPENNESS ||
      turn < MIN_TURN || turn < totalTurn * MIN_COHERENCE) return null
  // The loop needs motion along two axes. A swing and its return can accumulate turns,
  // but usually put most of their angular motion along a single line.
  const normal = axis.map(value => value / turn)
  const seed = samples.reduce((a, b) => a.speed > b.speed ? a : b).vector
  const projection = dot(seed, normal)
  const tangent = seed.map((value, i) => value - projection * normal[i])
  const length = norm(tangent)
  if (length < 1e-6) return null
  const x = tangent.map(value => value / length)
  const y = cross(normal, x)
  let xx = 0
  let xy = 0
  let yy = 0
  for (const { vector } of samples) {
    const a = dot(vector, x)
    const b = dot(vector, y)
    xx += a * a
    xy += a * b
    yy += b * b
  }
  const balance = 2 * Math.sqrt(Math.max(0, xx * yy - xy * xy)) / (xx + yy)
  if (balance < MIN_BALANCE) return null
  return { turn, travel: travel * SAMPLE_STEP, duration: last - first }
}

export function createCircleDetector() {
  const samples = []
  let bucketStart = null
  let bucket = [0, 0, 0]
  let count = 0
  let smooth = null
  let lastFrame = null
  let lastCircle = -Infinity

  return {
    push(frame) {
      const { t, gyr } = frame
      if (lastFrame !== null && t - lastFrame > 0.075) {
        bucketStart = null
        bucket = [0, 0, 0]
        count = 0
        smooth = null
      }
      lastFrame = t
      bucketStart ??= t
      for (let i = 0; i < 3; i++) bucket[i] += gyr[i]
      count++
      if (t - bucketStart < SAMPLE_STEP) return null

      const mean = bucket.map(value => value / count)
      smooth = smooth ? smooth.map((value, i) => (value + mean[i]) / 2) : mean
      bucketStart = t
      bucket = [0, 0, 0]
      count = 0
      const speed = norm(smooth)
      samples.push({ t, vector: smooth, speed })
      while (samples.length && samples[0].t < t - WINDOWS.at(-1)) samples.shift()
      if (speed < MIN_SPEED || t - lastCircle < 1.4) return null

      for (const window of WINDOWS) {
        const evidence = loopEvidence(samples.filter(sample => sample.t >= t - window))
        if (evidence) {
          lastCircle = t
          samples.length = 0
          return { type: "circle", t, ...evidence }
        }
      }
      return null
    },
  }
}
