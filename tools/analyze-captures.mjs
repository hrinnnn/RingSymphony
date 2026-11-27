// Replay prompted actions through the same IMU input pipeline as the game.
// Usage: node tools/analyze-captures.mjs [imported-directory]
import { readFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createRingInput } from "../src/ring/input.js"

const args = process.argv.slice(2)
const baselineRoot = args.find(arg => arg.startsWith("--baseline="))?.slice("--baseline=".length)
const capturePath = args.find(arg => !arg.startsWith("--"))
const directory = capturePath
  ? resolve(capturePath)
  : fileURLToPath(new URL("../recordings/captures-2026-11-27/", import.meta.url))
const read = async name => JSON.parse(await readFile(join(directory, name), "utf8"))
const manifest = await read("manifest.json")
const strokeLevels = ["beat-light", "beat-natural", "beat-strong"]

function replay(stream, hand, cutoffs = [], factory = createRingInput, previewCues = []) {
  let arrival = 1
  let deviceTime = 0
  const events = []
  const previews = []
  const previewDue = (_hand, age, dir) => {
    const atMs = (arrival - age - 1) * 1000
    return previewCues.some(cue => cue.direction === dir && atMs >= cue.start && atMs <= cue.end)
  }
  const input = factory({
    now: () => arrival,
    WebSocketImpl: null,
    previewDue,
    onPreview: event => {
      if (!previewCues.length || previewDue(event.hand, event.age, event.dir)) {
        previews.push({ dir: event.dir, receivedMs: (arrival - 1) * 1000 })
      }
    },
    cutoffDue: cutoffs.length ? (_hand, age) => {
      const time = (arrival - age - 1) * 1000
      return cutoffs.some(trial => time >= trial.shownAtMs && time <= trial.endedAtMs)
    } : undefined,
    storage: {
      getItem: key => key === "ringsymphony.roles.v2" ? JSON.stringify({ [stream.device]: hand }) : null,
      setItem() {},
    },
    onEvent: event => {
      const detectionDelayMs = event.detectionDelayMs ?? Math.max(0, (deviceTime - event.t) * 1000)
      events.push({ ...event, detectionDelayMs, transportAgeMs: event.transportAgeMs ??
        Math.max(0, event.age * 1000 - detectionDelayMs), atMs: (arrival - event.age - 1) * 1000 })
    },
  })
  input.feed({ type: "status", rings: [{ address: stream.device, connected: true }] })
  for (let i = 0; i < stream.samples; i++) {
    arrival = 1 + stream.receivedMs[i] / 1000
    deviceTime = stream.t[i]
    input.feed({ type: "imu", address: stream.device, timestamp: stream.t[i], sequence: stream.sequence[i],
      acc: stream.acc[i], gyr: stream.gyr[i] })
  }
  return { events, previews }
}

function expectedType(group) {
  if (group.direction || group.bpm || strokeLevels.includes(group.exercise)) return "beat"
  if (group.exercise.startsWith("fist-")) return "fist"
  if (group.exercise.startsWith("circle-")) return "circle"
  if (group.exercise.startsWith("palm-")) return "palm"
  if (group.exercise === "point") return "strike"
  return null
}

function promptedPreviews(factory = createRingInput) {
  const result = { left: [], right: [] }
  for (const group of evaluatedGroups) {
    if (!group.direction && !group.bpm) continue
    const cues = group.trials.map(trial => ({
      start: trial.beatAtMs == null ? trial.shownAtMs : trial.beatAtMs - 250,
      end: trial.beatAtMs == null ? trial.endedAtMs : trial.beatAtMs + 250,
      direction: trial.direction ?? group.direction,
    }))
    for (const [hand, stream] of Object.entries(group.streams)) {
      if (group.performingHand !== "both" && group.performingHand !== hand) continue
      const { events, previews } = replay(stream, hand, [], factory, cues)
      for (const trial of group.trials) {
        const inTrial = time => time >= trial.shownAtMs && time <= trial.endedAtMs
        const preview = previews.find(event => inTrial(event.receivedMs))
        const beat = events.find(event => event.type === "beat" && inTrial(event.atMs))
        result[hand].push({
          preview: Boolean(preview),
          lead: preview && beat ? (beat.atMs + beat.age * 1000) - preview.receivedMs : null,
        })
      }
    }
  }
  return Object.fromEntries(Object.entries(result).map(([hand, trials]) => {
    const leads = trials.map(trial => trial.lead).filter(ms => ms > 0)
    return [hand, { previewed: trials.filter(trial => trial.preview).length,
      trials: trials.length, beforeConfirmation: leads.length, medianLeadMs: median(leads.map(Math.round)) }]
  }))
}

console.log("Prompted actions (IMU only, no chart-based reversal rescue):")
const quality = { missingSequenceNumbers: 0, clockResets: 0, maxReceiveGapMs: 0 }
const onlineDirections = { left: [], right: [] }
const onlinePalms = {}
const previewControls = {}
const evaluatedGroups = []
for (const entry of manifest.groups) {
  const group = await read(entry.file)
  if (group.finishReason !== "complete") continue
  evaluatedGroups.push(group)
  const type = expectedType(group)
  const dir = group.direction ?? (type === "palm" ? group.exercise.slice("palm-".length) : null)
  const output = {}
  for (const [hand, stream] of Object.entries(group.streams)) {
    quality.missingSequenceNumbers += stream.quality.missingSequenceNumbers
    quality.clockResets += stream.quality.clockResets
    quality.maxReceiveGapMs = Math.max(quality.maxReceiveGapMs, stream.quality.maxReceiveGapMs)
    if (group.performingHand !== "both" && group.performingHand !== hand) continue
    const { events, previews } = replay(stream, hand)
    const windows = group.trials.map(trial =>
      events.filter(event => event.atMs >= trial.shownAtMs && event.atMs <= trial.endedAtMs))
    const labels = {}
    for (const event of windows.flat()) labels[event.type] = (labels[event.type] ?? 0) + 1
    const first = type ? windows.map(window => window.find(event => event.type === type)) : []
    if (group.direction || group.bpm) {
      for (const [i, trial] of group.trials.entries()) {
        const preview = previews.find(event => event.receivedMs >= trial.shownAtMs && event.receivedMs <= trial.endedAtMs)
        onlineDirections[hand].push({ expect: trial.direction ?? group.direction, preview, timing: first[i]?.timing })
      }
    }
    if (type === "palm") onlinePalms[group.exercise] = first.filter(event => event?.dir === dir).map(event => event.timing)
    if (["rest", "ordinary"].includes(group.exercise)) {
      const controls = previewControls[group.exercise] ??= {}
      controls[hand] = previews.length
    }
    output[hand] = type ? {
      trials: first.length,
      detected: first.filter(Boolean).length,
      ...(dir && {
        correct: first.filter(event => event?.dir === dir).length,
        wrong: first.filter(event => event?.dir && event.dir !== dir).length,
        unclear: first.filter(event => event && !event.dir).length,
        anyCorrect: windows.filter(window => window.some(event => event.type === type && event.dir === dir)).length,
      }),
      otherEvents: Object.fromEntries(Object.entries(labels).filter(([key]) => key !== type)),
    } : labels
    if (type === "fist") {
      const { events: atCutoff } = replay(stream, hand, group.trials)
      output[hand].withCutoff = group.trials.filter(trial => atCutoff.some(event =>
        event.type === "fist" && event.atMs >= trial.shownAtMs && event.atMs <= trial.endedAtMs)).length
    }
    if (strokeLevels.includes(group.exercise) || ["ordinary", "hard-negatives"].includes(group.exercise)) {
      const { events: atCutoff } = replay(stream, hand, group.trials)
      output[hand].fistsInSimulatedCutoff = atCutoff.filter(event => event.type === "fist" &&
        group.trials.some(trial => event.atMs >= trial.shownAtMs && event.atMs <= trial.endedAtMs)).length
    }
    if (group.bpm) {
      output[hand].correct = first.filter((event, i) => event?.dir === group.trials[i].direction).length
      output[hand].medianTargetOffsetMs = median(first.map((event, i) => event
        ? event.atMs - group.trials[i].beatAtMs : null))
    }
  }
  console.log(group.exercise, JSON.stringify(output))
}
console.log("Complete-group stream quality", JSON.stringify(quality))

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (!sorted.length) return null
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

console.log("\nOnline timing (device lags; preview lead uses local receive times):")
for (const [hand, trials] of Object.entries(onlineDirections)) {
  const previewLeads = trials.map(trial => trial.timing?.previewLeadMs).filter(ms => ms > 0)
  console.log(hand, JSON.stringify({
    trials: trials.length,
    previewed: trials.filter(trial => trial.preview).length,
    correctFirstPreview: trials.filter(trial => trial.preview?.dir === trial.expect).length,
    medianOnsetToPeakMs: median(trials.map(trial => trial.timing?.onsetToPeakMs)),
    medianPeakToConfirmMs: median(trials.map(trial => trial.timing?.peakToConfirmMs)),
    confirmedWithEarlierPreview: previewLeads.length,
    medianPreviewLeadMs: median(previewLeads),
  }))
}
for (const [action, measurements] of Object.entries(onlinePalms)) {
  console.log(action, JSON.stringify({ correct: measurements.length,
    medianPeakToConfirmMs: median(measurements.map(timing => timing?.peakToConfirmMs)) }))
}
console.log("Preview events over control recordings", JSON.stringify(previewControls))
console.log("Visible previews over prompted direction trials", JSON.stringify(promptedPreviews()))

function compare(factory) {
  const totals = { firstDirection: { left: 0, right: 0 }, strokeLevels: {}, ordinary: 0,
    ordinaryFistsInCutoff: 0, controls: {}, delay: {} }
  const delays = {}
  for (const group of evaluatedGroups) {
    const type = expectedType(group)
    for (const [hand, stream] of Object.entries(group.streams)) {
      if (group.performingHand !== "both" && group.performingHand !== hand) continue
      const { events } = replay(stream, hand, [], factory)
      const windows = group.trials.map(trial => events.filter(event =>
        event.atMs >= trial.shownAtMs && event.atMs <= trial.endedAtMs))
      const first = windows.map(window => window.find(event => event.type === type))
      if (group.direction || group.bpm) totals.firstDirection[hand] += first.filter((event, i) =>
        event && event.dir === (group.trials[i].direction ?? group.direction)).length
      if (strokeLevels.includes(group.exercise)) totals.strokeLevels[group.exercise] = first.filter(Boolean).length
      if (group.exercise === "ordinary") {
        totals.ordinary += windows.flat().filter(event => event.type === "beat").length
        const cutoff = replay(stream, hand, group.trials, factory).events
        totals.ordinaryFistsInCutoff += cutoff.filter(event => event.type === "fist" && group.trials.some(trial =>
          event.atMs >= trial.shownAtMs && event.atMs <= trial.endedAtMs)).length
      }
      if (type === "circle" || type === "fist") totals.controls[group.exercise] = first.filter(Boolean).length
      if (type === "fist") {
        const cutoff = replay(stream, hand, group.trials, factory).events
        totals.controls[`${group.exercise} (cutoff)`] = group.trials.filter(trial =>
          cutoff.some(event => event.type === type && event.atMs >= trial.shownAtMs && event.atMs <= trial.endedAtMs)).length
      }
      if (group.direction || group.bpm || type === "palm") {
        const target = group.direction ?? group.exercise.slice(5)
        const key = type === "beat" ? `beat ${hand}` : group.exercise
        const selected = first.filter(event => type === "beat" ? Boolean(event) : event?.dir === target)
        const bucket = delays[key] ??= []
        bucket.push(...selected)
      }
    }
  }
  for (const [key, events] of Object.entries(delays)) totals.delay[key] = {
    count: events.length, detectionDelayMs: median(events.map(event => event.detectionDelayMs)),
    transportAgeMs: median(events.map(event => event.transportAgeMs)),
    peakToPageMs: median(events.map(event => event.detectionDelayMs + event.transportAgeMs)),
  }
  return totals
}

if (baselineRoot) {
  const baseline = await import(pathToFileURL(resolve(baselineRoot, "src/ring/input.js")).href)
  console.log("\nBaseline comparison (same labeled windows):")
  console.log("before", JSON.stringify(compare(baseline.createRingInput)))
  console.log("after ", JSON.stringify(compare(createRingInput)))
  console.log("Visible previews before", JSON.stringify(promptedPreviews(baseline.createRingInput)))
}

console.log("\nGameplay (as recorded; chart prompts are not verified attempts):")
for (const entry of manifest.games) {
  const { game, gaps } = await read(entry.file)
  const byCue = {}
  let overlap = 0
  let secondaryCues = 0
  for (const cue of game.cues ?? []) {
    const results = byCue[cue.kind] ??= {}
    const verdict = cue.result ?? "unjudged"
    results[verdict] = (results[verdict] ?? 0) + 1
    if (!["cue", "circle", "dynamics"].includes(cue.kind)) continue
    secondaryCues++
    if (game.cues.some(beat => beat.kind === "beat" && beat.hand !== "left" &&
      beat.time >= cue.time - 0.25 && beat.time <= (cue.until ?? cue.time + 0.25))) overlap++
  }
  console.log(entry.file, entry.title, JSON.stringify({ byCue, overlap, secondaryCues, receiveGaps: gaps.length }))
}
