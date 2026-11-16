import { ENTRIES, PHRASES } from "./orchestra.js"

const DIRS = { 3: ["down", "right", "up"], 4: ["down", "left", "right", "up"] }

export const PIECES = [
  { id: "canon", title: "卡农", sub: "PACHELBEL　/　4:4　/　76 BPM", meter: 4, bpm: 76, bars: 16, tag: "入门" },
  { id: "joy", title: "欢乐颂", sub: "BEETHOVEN　/　4:4　/　104 BPM", meter: 4, bpm: 104, bars: 16, tag: "基础" },
  { id: "danube", title: "蓝色多瑙河", sub: "STRAUSS　/　3:4　/　88 BPM", meter: 3, bpm: 88, bars: 16, tag: "圆舞" },
  { id: "nachtmusik", title: "小夜曲", sub: "MOZART　/　4:4　/　126 BPM", meter: 4, bpm: 126, bars: 16, tag: "快板" },
]

const CHORD = {
  D: ["D4", "F#4", "A4"], A: ["A3", "C#4", "E4"], Bm: ["B3", "D4", "F#4"],
  G: ["G3", "B3", "D4"], Em: ["E4", "G4", "B4"], C: ["C4", "E4", "G4"], F: ["F4", "A4", "C5"],
}
const ROOT = { D: "D3", A: "A2", Bm: "B2", G: "G2", Em: "E3", C: "C3", F: "F3" }

function push(events, part, note, bar, beat, dur, vel) {
  events.push({ part, note, time: `${bar}:${beat}:0`, dur, vel })
}

// Pachelbel: the ground bass, then the canon tune entering a fifth higher each time.
const CANON_BASS = ["D", "A", "Bm", "F#", "G", "D", "G", "A"]
const CANON_TUNE = ["F#5", "E5", "D5", "C#5", "B4", "A4", "B4", "C#5", "D5", "C#5", "B4", "A4", "G4", "F#4", "G4", "E4"]
function canon() {
  const events = []
  for (let bar = 0; bar < 16; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      const name = CANON_BASS[(bar * 4 + beat) % 8]
      const root = name === "F#" ? "F#2" : ROOT[name]
      push(events, "cello", root, bar, beat, "4n", beat % 2 ? 0.42 : 0.55)
      if (beat % 2 === 0) push(events, "piano", CHORD[name] || CHORD.D, bar, beat, "4n", 0.4)
    }
  }
  for (let i = 0; i < 12 * 4; i += 1) {
    const bar = 4 + Math.floor(i / 4)
    const note = CANON_TUNE[i % CANON_TUNE.length]
    push(events, "violin", note, bar, i % 4, "4n", 0.62)
    if (bar >= 8) push(events, "flute", note, bar, i % 4, "4n", 0.5)
  }
  for (let bar = 12; bar < 16; bar += 1) push(events, "horn", bar % 2 ? "A3" : "D4", bar, 0, "1m", 0.48)
  return events.filter((event) => event.note)
}

// Ode to Joy in D. The horn takes the tune when the second statement opens up.
const JOY = ["E4", "E4", "F#4", "G4", "G4", "F#4", "E4", "D4", "C#4", "C#4", "D4", "E4", "E4", "D4", "D4", "R", "E4", "E4", "F#4", "G4", "G4", "F#4", "E4", "D4", "C#4", "C#4", "D4", "E4", "D4", "C#4", "C#4", "R"]
function joy() {
  const events = []
  const bass = ["D", "D", "G", "A", "D", "G", "A", "D", "D", "D", "G", "A", "D", "A", "D", "D"]
  for (let bar = 0; bar < 16; bar += 1) {
    const loud = bar >= 8 ? 0.72 : 0.55
    push(events, "cello", ROOT[bass[bar]], bar, 0, "1m", 0.5)
    push(events, "piano", CHORD[bass[bar]], bar, 1, "4n", 0.34)
    push(events, "piano", CHORD[bass[bar]], bar, 3, "4n", 0.3)
    const a = JOY[bar * 2]
    const b = JOY[bar * 2 + 1]
    if (a !== "R") {
      push(events, "violin", a.replace("4", "5"), bar, 0, "2n", loud)
      push(events, "flute", a.replace("4", "5"), bar, 0, "2n", loud - 0.12)
    }
    if (b !== "R") {
      push(events, "violin", b.replace("4", "5"), bar, 2, "2n", loud)
      push(events, "flute", b.replace("4", "5"), bar, 2, "2n", loud - 0.12)
    }
    if (bar >= 4 && a !== "R") push(events, "horn", a, bar, 0, "2n", 0.46)
  }
  return events
}

// Waltz: bass on one, chords on two and three, the rising Danube motif in the violin.
const DANUBE = [
  ["D5", "F#5", "A5"], ["A5", "F#5", "D5"], ["E5", "G5", "B5"], ["A5", "F#5", "D5"],
  ["D5", "F#5", "A5"], ["B4", "D5", "F#5"], ["E5", "C#5", "A4"], ["D5", "F#5", "A5"],
]
function danube() {
  const events = []
  const bars = ["D", "A", "G", "D", "D", "G", "A", "D", "D", "A", "G", "D", "Bm", "G", "A", "D"]
  for (let bar = 0; bar < 16; bar += 1) {
    const name = bars[bar]
    const lift = bar >= 4 && bar < 12 ? 0.7 : 0.5
    push(events, "cello", name === "Bm" ? "B2" : ROOT[name], bar, 0, "4n", 0.58)
    push(events, "piano", CHORD[name] || CHORD.D, bar, 1, "4n", 0.32)
    push(events, "piano", CHORD[name] || CHORD.D, bar, 2, "4n", 0.28)
    push(events, "horn", name === "A" ? "A3" : "D4", bar, 0, "2n.", 0.4)
    const motif = DANUBE[bar % DANUBE.length]
    motif.forEach((note, beat) => push(events, "violin", note, bar, beat, "4n", lift))
    if (bar >= 4) motif.forEach((note, beat) => push(events, "flute", note.replace("5", "6").replace("4", "5"), bar, beat, "4n", 0.4))
  }
  return events
}

// Eine kleine Nachtmusik: the opening arpeggio, its soft echo, then the tune again with the flute.
function nachtmusik() {
  const events = []
  const climb = ["G4", "D5", "G5", "D5", "G5", "D5", "G5", "B5"]
  for (let bar = 0; bar < 16; bar += 1) {
    const echo = bar >= 4 && bar < 8
    const vel = echo ? 0.34 : bar >= 12 ? 0.75 : 0.6
    const chord = echo ? "D" : bar % 4 === 3 ? "D" : "G"
    push(events, "cello", ROOT[chord], bar, 0, "2n", vel)
    push(events, "piano", CHORD[chord], bar, 2, "4n", vel - 0.1)
    push(events, "horn", chord === "D" ? "D4" : "G3", bar, 0, "2n", echo ? 0.3 : 0.42)
    if (bar < 2 || (bar >= 8 && bar < 10)) {
      climb.forEach((note, i) => push(events, "violin", note, bar, Math.floor(i / 2), "8n", vel))
    } else if (bar === 2 || bar === 10) {
      push(events, "violin", "D6", bar, 0, "2n", vel)
    } else if (!echo) {
      push(events, "violin", bar % 2 ? "B5" : "D6", bar, 0, "2n", vel)
      push(events, "violin", "G5", bar, 2, "2n", vel - 0.05)
    } else {
      push(events, "violin", "D5", bar, 0, "2n", vel)
      push(events, "violin", "B4", bar, 2, "2n", vel)
    }
    if (bar >= 8) push(events, "flute", bar % 2 ? "D6" : "G5", bar, 0, "2n", 0.48)
  }
  return events
}

const BUILDERS = { canon, joy, danube, nachtmusik }

export function eventsFor(id) {
  return BUILDERS[id]()
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
