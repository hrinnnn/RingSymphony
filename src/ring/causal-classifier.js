export const FEATURE_VERSION = 1
export const FEATURE_COUNT = 26

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

function axes({ up, acc, gyr }) {
  const reference = Math.abs(up[0]) < 0.85 ? [1, 0, 0] : [0, 0, 1]
  const right = cross(reference, up)
  const scale = Math.hypot(...right)
  for (let i = 0; i < 3; i++) right[i] /= scale
  const forward = cross(up, right)
  return [dot(acc, up) - 9.81, dot(acc, right), dot(acc, forward),
    dot(gyr, up), dot(gyr, right), dot(gyr, forward)]
}

// t can be the current frame or a previously observed peak. Future frames
// always stay outside the feature window, even if the caller has a longer history.
export function causalFeatures(history, t, previous) {
  const samples = history.filter(frame => frame.up && frame.t <= t && frame.t >= t - 0.18)
  if (samples.length < 3) return null
  const values = samples.map(axes)
  const sums = [0, 0, 0]
  let firstEnergy = 0
  let lastEnergy = 0
  let firstWeight = 0
  let lastWeight = 0
  const weights = samples.map((frame, i) => Math.max(0.001,
    Math.min(0.02, i > 0 ? frame.t - samples[i - 1].t : samples[1].t - frame.t)))
  const total = weights.reduce((sum, dt) => sum + dt, 0)
  for (const [i, sample] of values.entries()) {
    const dt = weights[i]
    let energy = 0
    for (let axis = 0; axis < 3; axis++) {
      sums[axis] += sample[axis + 3] ** 2 * dt
      energy += (sample[axis] ** 2 / 9.81 ** 2 + sample[axis + 3] ** 2) * dt
    }
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
  const rotationEnergy = sums.reduce((sum, value) => sum + value, 0) || 1
  const vector = end.slice(3)
  const speed = Math.hypot(...vector)
  const direction = speed > 1e-6 ? vector.map(value => value / speed) : [0, 0, 0]
  const preceding = previous?.t < t ? previous : null
  result.push(Math.log((0.01 + lastEnergy / (lastWeight || 1)) / (0.01 + firstEnergy / (firstWeight || 1))),
    (speed - Math.hypot(...start.slice(3))) / Math.max(0.02, samples.at(-1).t - samples[0].t), result[0],
    ...sums.map(energy => energy / rotationEnergy),
    preceding ? Math.min(3, t - preceding.t) : 3, preceding ? dot(preceding.direction, direction) : 0)
  return { values: result, direction }
}

const vector = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite)
const layer = (value, inputs, outputs) => value && Array.isArray(value.weights) && value.weights.length === outputs &&
  value.weights.every(row => vector(row, inputs)) && vector(value.bias, outputs)

export function createCausalClassifier(model) {
  if (!model || model.featureVersion !== FEATURE_VERSION || !Array.isArray(model.labels)) return null
  const { labels, mean, scale, hidden = null, output } = model
  if (labels.length < 2 || new Set(labels).size !== labels.length ||
      labels.some(label => !["ordinary", "up", "down", "left", "right", "fist", "beat"].includes(label)) ||
      !vector(mean, FEATURE_COUNT) || !vector(scale, FEATURE_COUNT) || scale.some(n => n <= 0)) return null
  const width = hidden ? hidden.bias?.length : FEATURE_COUNT
  if (!width || width > 64 || (hidden && !layer(hidden, FEATURE_COUNT, width)) || !layer(output, width, labels.length)) return null
  const affine = (x, weights, bias) => weights.map((row, i) =>
    row.reduce((sum, weight, j) => sum + weight * x[j], bias[i]))
  return {
    predict(features) {
      if (!vector(features, FEATURE_COUNT)) return null
      let x = features.map((value, i) => Math.max(-12, Math.min(12, (value - mean[i]) / scale[i])))
      if (hidden) x = affine(x, hidden.weights, hidden.bias).map(Math.tanh)
      const logits = affine(x, output.weights, output.bias)
      if (!logits.every(Number.isFinite)) return null
      const max = Math.max(...logits)
      const exp = logits.map(value => Math.exp(value - max))
      const sum = exp.reduce((total, value) => total + value, 0)
      return Object.fromEntries(labels.map((label, i) => [label, exp[i] / sum]))
    },
  }
}
