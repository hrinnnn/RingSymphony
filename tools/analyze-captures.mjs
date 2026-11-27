// Replay prompted actions through the same IMU input pipeline as the game.
// Usage: node tools/analyze-captures.mjs [imported-directory]
import { readFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRingInput } from "../src/ring/input.js"

const directory = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../recordings/captures-2026-11-27/", import.meta.url))
const read = async name => JSON.parse(await readFile(join(directory, name), "utf8"))
const manifest = await read("manifest.json")

function replay(stream, hand) {
  let arrival = 1
  const events = []
  const input = createRingInput({
    now: () => arrival,
    WebSocketImpl: null,
    storage: {
      getItem: key => key === "ringsymphony.roles.v2" ? JSON.stringify({ [stream.device]: hand }) : null,
      setItem() {},
    },
    onEvent: event => events.push({ ...event, atMs: (arrival - event.age - 1) * 1000 }),
  })
  input.feed({ type: "status", rings: [{ address: stream.device, connected: true }] })
  for (let i = 0; i < stream.samples; i++) {
    arrival = 1 + stream.receivedMs[i] / 1000
    input.feed({ type: "imu", address: stream.device, timestamp: stream.t[i], sequence: stream.sequence[i],
      acc: stream.acc[i], gyr: stream.gyr[i] })
  }
  return events
}

function expectedType(group) {
  if (group.direction || ["beat-light", "beat-natural", "beat-strong"].includes(group.exercise)) return "beat"
  if (group.exercise.startsWith("fist-")) return "fist"
  if (group.exercise.startsWith("palm-")) return "palm"
  if (group.exercise === "point") return "strike"
  return null
}

console.log("Prompted actions (IMU only, no chart-based reversal rescue):")
const quality = { missingSequenceNumbers: 0, clockResets: 0, maxReceiveGapMs: 0 }
for (const entry of manifest.groups) {
  const group = await read(entry.file)
  if (group.finishReason !== "complete") continue
  const type = expectedType(group)
  const dir = group.direction ?? (type === "palm" ? group.exercise.slice("palm-".length) : null)
  const output = {}
  for (const [hand, stream] of Object.entries(group.streams)) {
    quality.missingSequenceNumbers += stream.quality.missingSequenceNumbers
    quality.clockResets += stream.quality.clockResets
    quality.maxReceiveGapMs = Math.max(quality.maxReceiveGapMs, stream.quality.maxReceiveGapMs)
    if (group.performingHand !== "both" && group.performingHand !== hand) continue
    const events = replay(stream, hand)
    const windows = group.trials.map(trial =>
      events.filter(event => event.atMs >= trial.shownAtMs && event.atMs <= trial.endedAtMs))
    const labels = {}
    for (const event of windows.flat()) labels[event.type] = (labels[event.type] ?? 0) + 1
    const first = type ? windows.map(window => window.find(event => event.type === type)) : []
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
  }
  console.log(group.exercise, JSON.stringify(output))
}
console.log("Complete-group stream quality", JSON.stringify(quality))

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
