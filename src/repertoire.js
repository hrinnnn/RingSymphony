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

const TRIAD = {
  D3: ["D4", "F#4", "A4"], A2: ["A3", "C#4", "E4"], B2: ["B3", "D4", "F#4"],
  "F#2": ["F#3", "A3", "C#4"], G2: ["G3", "B3", "D4"], D2: ["D3", "F#3", "A3"],
  G3: ["G3", "B3", "D4"], A3: ["A3", "C#4", "E4"],
}

// Pachelbel: each bass note is a half note, the famous eight-note ground, four times.
const CANON_BASS = ["D3", "A2", "B2", "F#2", "G2", "D3", "G2", "A2"]
const CANON_TUNE = ["F#5", "E5", "D5", "C#5", "B4", "A4", "B4", "C#5", "D5", "C#5", "B4", "A4", "G4", "F#4", "G4", "E4"]
function canon() {
  const events = []
  for (let bar = 0; bar < 16; bar += 1) {
    for (const half of [0, 1]) {
      const root = CANON_BASS[(bar * 2 + half) % CANON_BASS.length]
      push(events, "cello", root, bar, half * 2, "2n", 0.55)
      push(events, "piano", TRIAD[root], bar, half * 2, "2n", 0.42)
    }
  }
  for (let i = 0; i < 12 * 4; i += 1) {
    const bar = 4 + Math.floor(i / 4)
    const note = CANON_TUNE[i % CANON_TUNE.length]
    push(events, "violin", note, bar, i % 4, "4n", 0.64)
    if (bar >= 8) push(events, "flute", note, bar, i % 4, "4n", 0.48)
  }
  for (let bar = 12; bar < 16; bar += 1) {
    push(events, "horn", bar % 2 ? "A3" : "D4", bar, 0, "2n", 0.5)
    push(events, "horn", bar % 2 ? "F#4" : "A3", bar, 2, "2n", 0.46)
  }
  return events
}

// Ode to Joy, quarter notes, the real tune twice. The last bars keep moving into the cadence.
const JOY = ["E4", "E4", "F#4", "G4", "G4", "F#4", "E4", "D4", "C#4", "C#4", "D4", "E4", "E4", "D4", "D4", "E4", "E4", "E4", "F#4", "G4", "G4", "F#4", "E4", "D4", "C#4", "C#4", "D4", "E4", "D4", "C#4", "C#4", "D4"]
const JOY_CHORD = ["D", "D", "A", "D", "D", "D", "A", "D", "D", "D", "A", "D", "D", "A", "D", "D"]
function joy() {
  const events = []
  for (let bar = 0; bar < 16; bar += 1) {
    const name = JOY_CHORD[bar]
    const loud = bar >= 8 ? 0.7 : 0.55
    push(events, "cello", ROOT[name], bar, 0, "2n", 0.52)
    push(events, "cello", ROOT[name], bar, 2, "2n", 0.46)
    push(events, "piano", CHORD[name], bar, 0, "4n", 0.48)
    push(events, "piano", CHORD[name], bar, 2, "4n", 0.4)
    for (let beat = 0; beat < 4; beat += 1) {
      const note = JOY[(bar % 8) * 4 + beat].replace("4", "5")
      push(events, "violin", note, bar, beat, "4n", loud)
      push(events, "flute", note, bar, beat, "4n", loud - 0.12)
      if (bar >= 4) push(events, "horn", JOY[(bar % 8) * 4 + beat], bar, beat, "4n", 0.42)
    }
  }
  return events
}

// A plain waltz: bass, off-beat chords, and a tune that keeps going through the last bar.
const WALTZ = ["D5", "F#5", "A5", "A5", "F#5", "D5", "E5", "G5", "B4", "A4", "F#5", "D5", "G5", "F#5", "E5", "D5", "C#5", "D5", "E5", "F#5", "E5", "D5", "A4", "F#4", "G4", "A4", "B4", "A4", "G4", "F#4", "E4", "D5", "F#5", "A5", "D6", "A5", "F#5", "D5", "A4", "F#4", "G4", "B4", "D5", "A4", "F#4", "D5"]
function danube() {
  const events = []
  const bars = ["D", "A", "G", "D", "D", "G", "A", "D", "D", "A", "G", "D", "Bm", "G", "A", "D"]
  for (let bar = 0; bar < 16; bar += 1) {
    const name = bars[bar]
    const root = name === "Bm" ? "B2" : ROOT[name]
    const chord = name === "Bm" ? ["B3", "D4", "F#4"] : CHORD[name]
    push(events, "cello", root, bar, 0, "4n", 0.58)
    push(events, "piano", chord, bar, 1, "4n", 0.34)
    push(events, "piano", chord, bar, 2, "4n", 0.3)
    push(events, "horn", name === "G" ? "G3" : name === "A" ? "A3" : "D4", bar, 0, "2n.", 0.4)
    for (let beat = 0; beat < 3; beat += 1) {
      const note = WALTZ[(bar * 3 + beat) % WALTZ.length]
      push(events, "violin", note, bar, beat, "4n", bar >= 8 ? 0.68 : 0.55)
      if (bar >= 4) push(events, "flute", note, bar, beat, "4n", 0.4)
    }
  }
  return events
}

// Eine kleine: the opening leap, the soft answer, then the same idea through the final bar.
const NIGHT = ["G4", "D5", "G5", "D6", "B5", "G5", "D5", "B4", "D5", "G5", "B5", "D6", "C6", "A5", "F#5", "D5", "G5", "D5", "B4", "G4", "A4", "B4", "C5", "D5", "B4", "G4", "D5", "G5"]
function nachtmusik() {
  const events = []
  const chords = ["G", "G", "D", "D", "G", "D", "G", "D", "G", "G", "D", "G", "C", "G", "D", "G"]
  for (let bar = 0; bar < 16; bar += 1) {
    const name = chords[bar]
    const vel = bar >= 4 && bar < 8 ? 0.38 : bar >= 12 ? 0.72 : 0.58
    push(events, "cello", ROOT[name], bar, 0, "2n", vel)
    push(events, "cello", ROOT[name], bar, 2, "2n", vel - 0.06)
    push(events, "piano", CHORD[name], bar, 0, "4n", vel - 0.08)
    push(events, "piano", CHORD[name], bar, 2, "4n", vel - 0.12)
    push(events, "horn", name === "D" ? "D4" : name === "C" ? "C4" : "G3", bar, 0, "2n", 0.4)
    push(events, "horn", name === "D" ? "A3" : "D4", bar, 2, "2n", 0.36)
    for (let beat = 0; beat < 4; beat += 1) {
      const note = NIGHT[(bar * 2 + Math.floor(beat / 2)) % NIGHT.length].replace(/4$/, "5").replace(/5$/, "5")
      const high = note.replace("4", "5")
      push(events, "violin", high, bar, beat, "4n", vel)
      if (bar >= 8) push(events, "flute", high, bar, beat, "4n", 0.46)
    }
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
