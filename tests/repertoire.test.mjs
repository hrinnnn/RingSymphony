import assert from "node:assert/strict"
import { createConductor, FREE_SCORE, phaseTarget, pianoDuration } from "../src/free-music.js"
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
  assert.ok(chart.duration - chart.countIn < 65)
  if (piece.endBeat) {
    const latest = events.reduce((end, event) => {
      const [bar, beat, sixteenth] = event.time.split(":").map(Number)
      return Math.max(end, (bar * piece.meter + beat + sixteenth / 4) * chart.beat + event.dur)
    }, 0)
    assert.ok(latest <= piece.endBeat * chart.beat + 1e-6, "scheduled notes end at the same excerpt boundary")
  }
  assert.equal(chart.cues.at(-1).kind, "cut")
  assert.equal(chart.cues.at(-1).time, chart.musicEnd)
  assert.ok(chart.cues.every((cue) => cue.kind !== "beat" || cue.time < chart.musicEnd))
  assert.ok(chart.duration > chart.musicEnd)
  const swell = chart.cues.find((cue) => cue.kind === "dynamics")
  if (swell) assert.ok(swell.until > swell.time, "a swell stays open across its span")
}
const canon = buildPieceChart(PIECES[0])
assert.ok(canon.cues.some((cue) => cue.kind === "beat" && cue.hand === "free") === false)
const opening = canon.cues.filter((cue) => cue.kind === "beat").slice(0, 8)
assert.deepEqual(opening.map((cue) => cue.direction), ["down", "left", "right", "up", "down", "left", "right", "up"])
assert.ok(Math.abs(opening[1].time - opening[0].time - 60 / 110) < 1e-9)
assert.ok(Math.abs(canon.countIn - 4 * 60 / 55) < 1e-9)
assert.ok(canon.cues.filter((cue) => cue.hand === "both").length >= 1)
const joy = buildPieceChart(PIECES.find((piece) => piece.id === "joy"))
assert.deepEqual(joy.phrases.map((phrase) => phrase.bars * joy.meter), Array(8).fill(8))
const lastJoyBeat = joy.cues.filter((cue) => cue.kind === "beat").at(-1)
assert.ok(Math.abs(lastJoyBeat.time - (joy.musicEnd - 3 * joy.beat)) < 1e-9, "leave the final two beats to the held tonic")
assert.ok(Math.abs(joy.musicEnd - joy.countIn - 64 * joy.beat) < 1e-9)
console.log("Repertoire: four pieces follow their entrances, and phrases become wide cues")

assert.equal(FREE_SCORE.meter, 3)
assert.equal(FREE_SCORE.notes.length, 282)
assert.equal(FREE_SCORE.endBeat, 141)
assert.ok(FREE_SCORE.notes.every((note) => pianoDuration(note, 0.57) < pianoDuration(note, 1.05)))
assert.ok(phaseTarget(60, 5.8) > 60, "speed up gently when the piano is behind a stroke")
assert.ok(phaseTarget(60, 6.2) < 60, "ease back when the piano is ahead")
const conductor = createConductor()
conductor.tap(1)
assert.equal(conductor.tap(1.24), null, "an extra motion between beats must not corrupt tempo")
assert.equal(conductor.tap(2).bpm, 60)
for (let i = 1; i <= 8; i++) conductor.tap(2 + i * 1.28)
assert.ok(Math.abs(conductor.bpm - 60 / 1.28) < 1, "follow a sustained rallentando")
