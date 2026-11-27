export const FEATURE_VERSION = 2
export const FEATURE_COUNT = 24
export const SEQUENCE_VERSION = 1
export const SEQUENCE_STEPS = 10
export const SEQUENCE_CHANNELS = 6
const SAMPLE_STEP = 0.02
const MAX_INTERPOLATION_GAP = 0.06

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0)

function channels(samples) {
  let previous = null
  return samples.map(({ t, up, acc, gyr }) => {
    const aVertical = dot(acc, up)
    const aHorizMag = Math.hypot(...acc.map((a, i) => a - aVertical * up[i]))
    const wYaw = dot(gyr, up)
    const wTiltMag = Math.hypot(...gyr.map((w, i) => w - wYaw * up[i]))
    const wNorm = Math.hypot(...gyr)
    const dt = previous ? t - previous.t : 0
    // Compare the invariant angular components, even when the gravity estimate
    // changes between samples. Skip intervals where the rate of change is unknown.
    const angJerk = dt > 0 && dt <= 0.025
      ? Math.hypot(wYaw - previous.wYaw, wTiltMag - previous.wTiltMag) / Math.max(0.001, dt)
      : 0
    previous = { t, wYaw, wTiltMag }
    return [aVertical - 9.81, aHorizMag, wYaw, wTiltMag, wNorm, angJerk]
  })
}

// t can be the current frame or a previously observed peak. Future frames
// always stay outside the feature window, even if the caller has a longer history.
export function causalFeatures(history, t, previous) {
  const samples = history.filter(frame => frame.up && frame.t <= t && frame.t >= t - 0.18)
  if (samples.length < 3) return null
  const values = channels(samples)
  let yawEnergy = 0
  let tiltEnergy = 0
  let firstEnergy = 0
  let lastEnergy = 0
  let firstWeight = 0
  let lastWeight = 0
  const weights = samples.map((frame, i) => Math.max(0.001,
    Math.min(0.02, i > 0 ? frame.t - samples[i - 1].t : samples[1].t - frame.t)))
  const total = weights.reduce((sum, dt) => sum + dt, 0)
  for (const [i, sample] of values.entries()) {
    const dt = weights[i]
    const [aUp, aHorizMag, wYaw, wTiltMag, speed] = sample
    yawEnergy += wYaw ** 2 * dt
    tiltEnergy += wTiltMag ** 2 * dt
    const energy = ((aUp ** 2 + aHorizMag ** 2) / 9.81 ** 2 + speed ** 2) * dt
    if (samples[i].t < t - 0.08) { firstEnergy += energy; firstWeight += dt }
    else { lastEnergy += energy; lastWeight += dt }
  }
  const result = []
  for (let axis = 0; axis < 6; axis++) {
    const mean = values.reduce((sum, row, i) => sum + row[axis] * weights[i], 0) / total
    const second = values.reduce((sum, row, i) => sum + (row[axis] - mean) ** 2 * weights[i], 0) / total
    const fourth = values.reduce((sum, row, i) => sum + (row[axis] - mean) ** 4 * weights[i], 0) / total
    result.push(mean, Math.sqrt(second), second > 1e-5 ? Math.min(30, fourth / second ** 2) : 0)
  }
  const start = values[0]
  const end = values.at(-1)
  const rotationEnergy = yawEnergy + tiltEnergy || 1
  const speed = end[4]
  const direction = speed > 1e-6 ? [end[2] / speed, end[3] / speed] : [0, 0]
  const preceding = previous?.t < t ? previous : null
  result.push(Math.log((0.01 + lastEnergy / (lastWeight || 1)) / (0.01 + firstEnergy / (firstWeight || 1))),
    (speed - start[4]) / Math.max(0.02, samples.at(-1).t - samples[0].t),
    yawEnergy / rotationEnergy, tiltEnergy / rotationEnergy,
    preceding ? Math.min(3, t - preceding.t) : 3, preceding ? dot(preceding.direction, direction) : 0)
  return { values: result, direction }
}

// Ten 20 ms bins ending at t. Ignore all data after t, even when the
// caller is classifying a past peak using the current frame's history.
export function causalSequence(history, t) {
  const first = t - (SEQUENCE_STEPS - 1) * SAMPLE_STEP
  const frames = history.filter(frame => frame.up && frame.t >= first - MAX_INTERPOLATION_GAP && frame.t <= t)
  if (frames.length < 2) return null
  const values = channels(frames)
  let next = 0
  return Array.from({ length: SEQUENCE_STEPS }, (_, i) => {
    const time = i === SEQUENCE_STEPS - 1 ? t : first + i * SAMPLE_STEP
    while (next < frames.length && frames[next].t < time) next++
    const before = frames[next - 1]
    const after = frames[next]
    if (before && after && after.t - before.t <= MAX_INTERPOLATION_GAP) {
      const ratio = (time - before.t) / (after.t - before.t)
      return values[next - 1].map((value, axis) => value + (values[next][axis] - value) * ratio)
    }
    const gapBefore = before ? time - before.t : Infinity
    const gapAfter = after ? after.t - time : Infinity
    const closest = gapBefore <= gapAfter ? next - 1 : next
    return Math.min(gapBefore, gapAfter) <= 0.03 ? [...values[closest]] : Array(SEQUENCE_CHANNELS).fill(0)
  })
}

const vector = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite)
const layer = (value, inputs, outputs) => value && Array.isArray(value.weights) && value.weights.length === outputs &&
  value.weights.every(row => vector(row, inputs)) && vector(value.bias, outputs)
const standardize = (value, mean, scale) => Math.max(-12, Math.min(12, (value - mean) / scale))
const affine = (x, { weights, bias }) => weights.map((row, i) =>
  row.reduce((sum, weight, j) => sum + weight * x[j], bias[i]))

function softmax(labels, logits) {
  if (!logits.every(Number.isFinite)) return null
  const max = Math.max(...logits)
  const exp = logits.map(value => Math.exp(value - max))
  const sum = exp.reduce((total, value) => total + value, 0)
  return Object.fromEntries(labels.map((label, i) => [label, exp[i] / sum]))
}

function convolution(input, inputs, { weights, bias }, dilation) {
  const outputs = bias.length
  const result = new Float64Array(SEQUENCE_STEPS * outputs)
  for (let t = 0; t < SEQUENCE_STEPS; t++) {
    for (let out = 0; out < outputs; out++) {
      const row = weights[out]
      let sum = bias[out]
      for (let tap = 0; tap < 3 && t >= tap * dilation; tap++) {
        const at = (t - tap * dilation) * inputs
        const start = tap * inputs
        for (let channel = 0; channel < inputs; channel++) sum += input[at + channel] * row[start + channel]
      }
      result[t * outputs + out] = Math.max(0, sum)
    }
  }
  return result
}

function createCnn({ sequenceVersion, labels, mean, scale, convolutions, output }) {
  if (sequenceVersion !== SEQUENCE_VERSION || !vector(mean, SEQUENCE_CHANNELS) ||
      !vector(scale, SEQUENCE_CHANNELS) || scale.some(n => n <= 0) ||
      !Array.isArray(convolutions) || convolutions.length !== 2) return null
  const [first, second] = convolutions
  const hidden = first?.bias?.length
  const width = second?.bias?.length
  if (!hidden || !width || hidden > 32 || width > 32 ||
      !layer(first, 3 * SEQUENCE_CHANNELS, hidden) || !layer(second, 3 * hidden, width) ||
      !layer(output, 2 * width, labels.length)) return null
  return {
    arch: "cnn",
    predict(sequence) {
      if (!Array.isArray(sequence) || sequence.length !== SEQUENCE_STEPS ||
          !sequence.every(row => vector(row, SEQUENCE_CHANNELS))) return null
      const input = new Float64Array(SEQUENCE_STEPS * SEQUENCE_CHANNELS)
      for (let t = 0; t < SEQUENCE_STEPS; t++) {
        for (let i = 0; i < SEQUENCE_CHANNELS; i++) {
          input[t * SEQUENCE_CHANNELS + i] = standardize(sequence[t][i], mean[i], scale[i])
        }
      }
      const features = convolution(convolution(input, SEQUENCE_CHANNELS, first, 1), hidden, second, 2)
      const pooled = Array(2 * width).fill(0)
      for (let channel = 0; channel < width; channel++) {
        for (let t = 0; t < SEQUENCE_STEPS; t++) pooled[channel] += features[t * width + channel]
        pooled[channel] /= SEQUENCE_STEPS
        pooled[width + channel] = features[(SEQUENCE_STEPS - 1) * width + channel]
      }
      return softmax(labels, affine(pooled, output))
    },
  }
}

export function createCausalClassifier(model) {
  if (!model || !Array.isArray(model.labels)) return null
  const { labels, mean, scale, hidden = null, output } = model
  if (labels.length < 2 || new Set(labels).size !== labels.length ||
      labels.some(label => !["ordinary", "up", "down", "left", "right", "fist", "beat"].includes(label))) return null
  const arch = model.arch ?? (hidden ? "mlp" : "linear")
  if (arch === "cnn") return createCnn(model)
  if (model.featureVersion !== FEATURE_VERSION || (arch !== "linear" && arch !== "mlp") ||
      (arch === "mlp") !== Boolean(hidden) ||
      !vector(mean, FEATURE_COUNT) || !vector(scale, FEATURE_COUNT) || scale.some(n => n <= 0)) return null
  const width = hidden ? hidden.bias?.length : FEATURE_COUNT
  if (!width || width > 64 || (hidden && !layer(hidden, FEATURE_COUNT, width)) || !layer(output, width, labels.length)) return null
  return {
    arch,
    predict(features) {
      if (!vector(features, FEATURE_COUNT)) return null
      let x = features.map((value, i) => standardize(value, mean[i], scale[i]))
      if (hidden) x = affine(x, hidden).map(Math.tanh)
      return softmax(labels, affine(x, output))
    },
  }
}
