import { ENTRIES, PHRASES } from "./orchestra.js"
import score from "./midi-score.json" with { type: "json" }

const DIRS = { 3: ["down", "right", "up"], 4: ["down", "left", "right", "up"] }

// The notes come from the Mutopia MIDI files in public/midi, not from a sketch.
export const PIECES = [
  { id: "canon", title: "卡农", sub: "PACHELBEL　/　4:4　/　55 BPM", meter: score.canon.meter, bpm: score.canon.bpm, bars: score.canon.bars, tag: "入门" },
  { id: "joy", title: "欢乐颂", sub: "BEETHOVEN　/　4:4　/　100 BPM", meter: score.joy.meter, bpm: score.joy.bpm, bars: score.joy.bars, tag: "基础" },
  { id: "danube", title: "蓝色多瑙河", sub: "STRAUSS　/　3:4　/　150 BPM", meter: score.danube.meter, bpm: score.danube.bpm, bars: score.danube.bars, tag: "圆舞" },
  { id: "nachtmusik", title: "小夜曲", sub: "MOZART　/　4:4　/　132 BPM", meter: score.nachtmusik.meter, bpm: score.nachtmusik.bpm, bars: score.nachtmusik.bars, tag: "快板" },
]

export function eventsFor(id) {
  return score[id].events
}

// Turns a piece and its phrase list into the same cue list the level already plays.
// A "both" phrase accents its first downbeat with two hands, then the right hand keeps time.
// A "free" stretch has no beat cues. A swell stays open for its whole span.
export function buildPieceChart(piece = PIECES[0]) {
  const beat = 60 / piece.bpm
  const countIn = piece.meter * beat
  const at = (bar, inBar) => countIn + (bar * piece.meter + inBar) * beat
  const cues = []
  for (const phrase of PHRASES[piece.id]) {
    for (let bar = phrase.bar; bar < phrase.bar + phrase.bars; bar += 1) {
      if (phrase.hand === "free") continue
      if (phrase.hand === "cut") {
        cues.push({ kind: "cut", hand: "both", time: at(bar, 0) })
        continue
      }
      for (let i = 0; i < piece.meter; i += 1) {
        const accent = phrase.hand === "both" && bar === phrase.bar && i === 0
        cues.push({
          kind: "beat",
          hand: accent ? "both" : phrase.hand === "left" ? "left" : "right",
          direction: DIRS[piece.meter][i],
          time: at(bar, i),
        })
      }
    }
    for (const cue of phrase.cues || []) {
      const [bar, inBar] = cue.at.split(":").map(Number)
      const time = at(bar, inBar)
      if (cue.kind === "point") cues.push({ kind: "cue", hand: "left", part: cue.part, time, until: time + beat * 2 })
      if (cue.kind === "circle") cues.push({ kind: "circle", hand: "left", parts: cue.parts, time, until: time + beat * 2 })
      if (cue.kind === "swell") cues.push({ kind: "dynamics", hand: "left", direction: cue.dir, parts: cue.parts, time, until: time + cue.beats * beat })
    }
  }
  cues.sort((a, b) => a.time - b.time)
  return {
    ...piece,
    beat,
    countIn,
    cues,
    duration: countIn + piece.bars * piece.meter * beat,
    study: piece,
    entries: ENTRIES[piece.id],
    phrases: PHRASES[piece.id],
  }
}
