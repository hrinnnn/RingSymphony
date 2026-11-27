// Use the exact browser feature implementation for offline training.
import { readFile, readdir, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { causalFeatures, causalSequence, FEATURE_COUNT, FEATURE_VERSION,
  SEQUENCE_CHANNELS, SEQUENCE_STEPS, SEQUENCE_VERSION } from "../src/ring/causal-classifier.js"
import { createGravity, createHandDetector } from "../src/ring/detectors.js"
import { createClockOffset, createGyroBias } from "../src/ring/signal.js"

const seen = new Set()
const ordinary = new Set(["ordinary", "rest", "hard-negatives", "走路及日常"])
const data = []
const args = process.argv.slice(2)
const includeSequence = args.includes("--sequence")

function examples(raw, hand, exercise, direction, trials, player, group) {
  const gravity = createGravity()
  let bias = createGyroBias()
  const clock = createClockOffset()
  const detector = createHandDetector(hand)
  const frames = []
  const events = []
  let previousT = null
  for (const frame of raw) {
    const gap = frame.t - (previousT ?? frame.t - 0.005)
    previousT = frame.t
    if (gap <= 0 || gap > 0.2) {
      gravity.reset()
      detector.gap()
    }
    if (gap <= 0) { clock.reset(); bias = createGyroBias() }
    const estimated = bias.update(frame.t, frame.acc, frame.gyr, Math.max(0, gap))
    const gyr = frame.gyr.map((value, i) => value - estimated[i])
    const up = gravity.update(frame.acc, gyr, Math.min(0.02, Math.max(0.001, gap)), gap > 0.025)
    const ms = frame.ms == null ? frame.t * 1000 : (frame.t + clock.push(frame.ms / 1000, frame.t)) * 1000
    // createClockOffset operates on seconds. Keep corrected device time separate
    // from receipt time so batched BLE arrivals don't move the cue annotations.
    const prepared = { ...frame, gyr, up, ms, speed: Math.hypot(...gyr) }
    frames.push(prepared)
    events.push(...detector.push(prepared))
  }
  if (!frames.length) return
  const targets = []
  const label = direction || (exercise.startsWith("fist-") || exercise === "握拳" ? "fist" : null)
  if (ordinary.has(exercise)) {
    let next = frames[0].t + 0.18
    for (const frame of frames) {
      if (frame.t < next) continue
      targets.push({ t: frame.t, label: "ordinary" })
      next = frame.t + 0.12
    }
    for (const ev of events) if (ev.type === "beat" || ev.type === "fist") targets.push({ t: ev.t, label: "ordinary" })
  } else if (trials?.length) {
    for (const trial of trials) {
      const from = trial.beatAtMs == null ? trial.shownAtMs : trial.beatAtMs - 140
      const to = trial.beatAtMs == null ? trial.endedAtMs : trial.beatAtMs + 140
      const expected = trial.direction ?? label
      if (!expected) continue
      let peak = null
      for (const frame of frames) {
        if (frame.ms >= from && frame.ms <= to && (!peak || frame.speed > peak.speed)) peak = frame
      }
      if (peak && peak.speed >= 0.65) targets.push({ t: peak.t, label: expected })
    }
  } else if (label) {
    for (const event of events) if (event.type === (label === "fist" ? "fist" : "beat")) targets.push({ t: event.t, label })
  }
  // Replay trigger context even when no labeled target was sampled at that frame.
  const triggers = events.filter(event => event.type === "beat" || event.type === "fist").map(event => event.t)
  const combined = [...new Set([...triggers, ...targets.map(target => target.t)])].sort((a, b) => a - b)
  const labels = new Map(targets.map(target => [target.t, target.label]))
  const triggerTimes = new Set(triggers)
  let previous = null
  let start = 0
  let sequenceStart = 0
  let end = 0
  for (const t of combined) {
    while (start < frames.length && frames[start].t < t - 0.18) start++
    while (end < frames.length && frames[end].t <= t) end++
    const features = causalFeatures(frames.slice(start, end), t, previous)
    if (!features) continue
    if (labels.has(t)) {
      const row = { group, player, label: labels.get(t), x: features.values }
      if (includeSequence) {
        while (sequenceStart < start && frames[sequenceStart].t < t - 0.24) sequenceStart++
        row.sequence = causalSequence(frames.slice(sequenceStart, end), t)
      }
      data.push(row)
    }
    if (triggerTimes.has(t)) previous = { t, direction: features.direction }
  }
}

async function visit(path) {
  if (seen.has(path)) return
  seen.add(path)
  if ((await stat(path)).isDirectory()) {
    for (const name of (await readdir(path)).sort()) {
      if (name === "games" || name.startsWith(".")) continue
      await visit(join(path, name))
    }
    return
  }
  if (!path.endsWith(".json")) return
  const file = JSON.parse(await readFile(path, "utf8"))
  if (file.kind === "group" && file.finishReason === "complete" && !file.quality?.recommendRetry) {
    const input = file.streams ?? Object.fromEntries(Object.entries(file.hands ?? {}).map(([address, hand]) =>
      [hand, file.frames.filter(frame => frame.address === address)]))
    for (const [hand, stream] of Object.entries(input)) {
      if (file.performingHand !== "both" && file.performingHand !== hand) continue
      const rows = Array.isArray(stream) ? stream.map(frame => ({ t: frame.timestamp ?? frame.local_timestamp,
        acc: frame.acc, gyr: frame.gyr, ms: frame.receivedMs })) :
        stream.t.map((t, i) => ({ t, acc: stream.acc[i], gyr: stream.gyr[i], ms: stream.receivedMs[i] }))
      const player = file.playerId ?? (file.streams ? dirname(dirname(path)) : "unknown")
      examples(rows, hand, file.exercise, file.direction, file.trials, player, path)
    }
    return
  }
  if (!Array.isArray(file.t) || !Array.isArray(file.acc) || !Array.isArray(file.gyr)) return
  const folder = basename(dirname(path))
  const name = basename(path, ".json")
  const direction = /^(down|up|left|right)_/.exec(name)?.[1]
  if (!(folder === "方向" && direction) && folder !== "握拳" && !ordinary.has(folder)) return
  const player = name.includes("_") ? name.split("_").at(-1).replace(/\d+$/, "") : name
  examples(file.t.map((t, i) => ({ t, acc: file.acc[i], gyr: file.gyr[i] })),
    "right", folder, direction, null, player, path)
}

for (const path of args.filter(value => value !== "--sequence")) await visit(resolve(path))
process.stdout.write(JSON.stringify({ featureVersion: FEATURE_VERSION, featureCount: FEATURE_COUNT,
  ...(includeSequence && { sequenceVersion: SEQUENCE_VERSION, sequenceSteps: SEQUENCE_STEPS,
    sequenceChannels: SEQUENCE_CHANNELS }), data }))
