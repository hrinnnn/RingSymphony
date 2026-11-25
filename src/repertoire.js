import { ENTRIES, PHRASES } from "./orchestra.js"
import score from "./midi-score.json" with { type: "json" }

const DIRS = { 3: ["down", "right", "up"], 4: ["down", "left", "right", "up"] }

// The notes come from the Mutopia MIDI files in public/midi, not from a sketch.
export const PIECES = [
  { id: "canon", title: "卡农", sub: "PACHELBEL　/　4:4　/　55 BPM · 挥拍 110", strokesPerBeat: 2, meter: score.canon.meter, bpm: score.canon.bpm, bars: 15, endBeat: 14 * 4 + 1, tag: "入门" },
  { id: "joy", title: "欢乐颂", sub: "BEETHOVEN　/　4:4　/　100 BPM", meter: score.joy.meter, bpm: score.joy.bpm, bars: score.joy.bars, tag: "基础" },
  { id: "danube", title: "蓝色多瑙河", sub: "STRAUSS　/　3:4　/　150 BPM", meter: score.danube.meter, bpm: score.danube.bpm, bars: score.danube.bars, tag: "圆舞" },
  { id: "nachtmusik", title: "小夜曲", sub: "MOZART　/　4:4　/　132 BPM", meter: score.nachtmusik.meter, bpm: score.nachtmusik.bpm, bars: 35, endBeat: 34 * 4 + 1, tag: "快板" },
]

export function eventsFor(id) {
  const piece = PIECES.find((item) => item.id === id)
  const events = score[id].events
  if (piece.endBeat === undefined) return events
  const beat = 60 / piece.bpm
  return events.flatMap((event) => {
    const [bar, inBar, sixteenth] = event.time.split(":").map(Number)
    const remaining = (piece.endBeat - (bar * piece.meter + inBar + sixteenth / 4)) * beat
    if (remaining <= 0) return []
    return [{ ...event, dur: Math.min(event.dur, remaining) }]
  })
}

// Turns a piece and its phrase list into the same cue list the level already plays.
// A "both" phrase accents its first downbeat with two hands, then the right hand keeps time.
// A "free" stretch has no beat cues. A swell stays open for its whole span.
export function buildPieceChart(piece = PIECES[0]) {
  const beat = 60 / piece.bpm
  const strokesPerBeat = piece.strokesPerBeat ?? 1
  const beatStep = beat / strokesPerBeat
  const countIn = piece.meter * beat
  const musicEnd = countIn + (piece.endBeat ?? piece.bars * piece.meter) * beat
  const at = (bar, inBar) => countIn + (bar * piece.meter + inBar) * beat
  const cues = []
  for (const phrase of PHRASES[piece.id]) {
    if (phrase.hand !== "free" && phrase.hand !== "cut") {
      const strokes = (phrase.bars * piece.meter - (phrase.releaseBeats ?? 0)) * strokesPerBeat
      for (let i = 0; i < strokes; i += 1) {
        const accent = phrase.hand === "both" && i === 0
        cues.push({
          kind: "beat",
          hand: accent ? "both" : phrase.hand === "left" ? "left" : "right",
          direction: DIRS[piece.meter][i % piece.meter],
          time: at(phrase.bar, i / strokesPerBeat),
        })
      }
    }
    for (const cue of phrase.cues || []) {
      const [bar, inBar] = cue.at.split(":").map(Number)
      const time = at(bar, inBar)
      if (cue.kind === "point") cues.push({ kind: "cue", hand: "left", part: cue.part, time, until: time + beat * 2 })
      if (cue.kind === "circle") cues.push({ kind: "circle", hand: "left", parts: cue.parts, time, until: time + beat * 2 })
      if (cue.kind === "swell") cues.push({ kind: "dynamics", hand: "both", direction: cue.dir, parts: cue.parts, time, until: time + cue.beats * beat })
    }
  }
  cues.push({ kind: "cut", hand: "both", time: musicEnd })
  cues.sort((a, b) => a.time - b.time)
  return {
    ...piece,
    beat,
    beatStep,
    countIn,
    cues,
    musicEnd,
    duration: musicEnd + 1.4,
    study: piece,
    entries: ENTRIES[piece.id],
    phrases: PHRASES[piece.id],
  }
}
