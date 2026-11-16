import assert from "node:assert/strict"
import { ENTRIES } from "../src/orchestra.js"
import { PIECES, buildPieceChart, eventsFor } from "../src/repertoire.js"

const SECTIONS = new Set(["violin", "flute", "horn", "cello", "piano"])

for (const piece of PIECES) {
  const events = eventsFor(piece.id)
  assert.ok(events.length > 40, `${piece.id} has a full arrangement`)
  const entry = ENTRIES[piece.id]
  for (const event of events) {
    assert.ok(SECTIONS.has(event.part), event.part)
    const bar = Number(event.time.split(":")[0])
    assert.ok(bar >= 0 && bar < piece.bars, `${piece.id} ${event.time}`)
    const starts = entry[event.part]
    if (typeof starts === "number") assert.ok(bar >= starts, `${piece.id} ${event.part} enters at ${starts}, found bar ${bar}`)
  }
  for (const part of entry.on) assert.ok(events.some((event) => event.part === part && event.time.startsWith("0:")), `${piece.id} ${part} plays from the start`)
  const chart = buildPieceChart(piece)
  assert.ok(chart.cues.some((cue) => cue.kind === "beat"))
  assert.equal(chart.cues.at(-1).kind === "cut" || chart.cues.some((cue) => cue.kind === "cut"), true)
  const swell = chart.cues.find((cue) => cue.kind === "dynamics")
  if (swell) assert.ok(swell.until > swell.time, "a swell stays open across its span")
}
const canon = buildPieceChart(PIECES[0])
assert.ok(canon.cues.some((cue) => cue.kind === "beat" && cue.hand === "free") === false)
assert.ok(canon.cues.filter((cue) => cue.hand === "both").length >= 1)
console.log("Repertoire: four pieces follow their entrances, and phrases become wide cues")
