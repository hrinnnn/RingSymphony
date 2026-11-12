const CHORDS = [
  { root: "C2", piano: ["C4", "E4", "G4"], violin4: ["C5", "D5", "E5", "G5"], violin3: ["C5", "E5", "G5"], flute: ["G5", "E5"] },
  { root: "G2", piano: ["B3", "D4", "G4"], violin4: ["B4", "C5", "D5", "G5"], violin3: ["B4", "D5", "G5"], flute: ["D5", "B4"] },
  { root: "A2", piano: ["A3", "C4", "E4"], violin4: ["A4", "C5", "E5", "A5"], violin3: ["A4", "C5", "E5"], flute: ["E5", "C5"] },
  { root: "F2", piano: ["F3", "A3", "C4"], violin4: ["F4", "A4", "C5", "F5"], violin3: ["F4", "A4", "C5"], flute: ["C5", "A4"] },
  { root: "C2", piano: ["C4", "E4", "G4"], violin4: ["E5", "D5", "C5", "G4"], violin3: ["G5", "E5", "C5"], flute: ["G5", "C5"] },
  { root: "G2", piano: ["B3", "D4", "G4"], violin4: ["D5", "B4", "G4", "D5"], violin3: ["G5", "D5", "B4"], flute: ["D5", "G4"] },
  { root: "A2", piano: ["A3", "C4", "E4"], violin4: ["E5", "C5", "A4", "E5"], violin3: ["E5", "C5", "A4"], flute: ["A4", "E5"] },
  { root: "F2", piano: ["F3", "A3", "C4"], violin4: ["C5", "A4", "F4", "C5"], violin3: ["C5", "A4", "F4"], flute: ["F4", "C5"] },
]

// Free-mode flute melody over the eight-bar C–G–Am–F loop, as [note, beats] pairs.
const MELODY = [
  [["E5", 1], ["G5", 1], ["C6", 2]],
  [["B5", 1], ["A5", 1], ["G5", 2]],
  [["A5", 1], ["G5", 1], ["E5", 2]],
  [["F5", 1], ["A5", 1], ["C6", 1], ["A5", 1]],
  [["G5", 1], ["E5", 1], ["C5", 2]],
  [["D5", 1], ["G5", 1], ["B5", 2]],
  [["C6", 1], ["B5", 1], ["A5", 2]],
  [["A5", 1], ["G5", 1], ["F5", 2]],
]
export const LOOP_BARS = MELODY.length

export function loopEvents() {
  const events = []
  for (let bar = 0; bar < LOOP_BARS; bar += 1) {
    const chord = CHORDS[bar]
    for (const beat of [0, 2]) {
      events.push({ part: "piano", note: chord.piano, time: `${bar}:${beat}:0`, dur: "4n", vel: beat ? 0.5 : 0.65 })
      events.push({ part: "cello", note: chord.root, time: `${bar}:${beat}:0`, dur: "2n", vel: beat ? 0.45 : 0.55 })
    }
    chord.violin4.forEach((note, beat) => {
      events.push({ part: "violin", note, time: `${bar}:${beat}:0`, dur: "8n", vel: 0.55 })
    })
    let beat = 0
    for (const [note, length] of MELODY[bar]) {
      events.push({ part: "flute", note, time: `${bar}:${beat}:0`, dur: length === 2 ? "2n" : "4n", vel: 0.45 })
      beat += length
    }
  }
  return events
}

function chordFor(bar) {
  return CHORDS[bar === 0 ? 0 : (bar - 1) % CHORDS.length]
}

const KINDS = {
  C: { root: "C2", fifth: "G2", piano: ["C4", "E4", "G4"], arp: ["C5", "E5", "G5", "E5"], flute: ["G5", "E5", "C5"] },
  G: { root: "G2", fifth: "D3", piano: ["B3", "D4", "G4"], arp: ["D5", "G5", "B5", "G5"], flute: ["D5", "B4", "G4"] },
  Am: { root: "A2", fifth: "E3", piano: ["A3", "C4", "E4"], arp: ["A4", "C5", "E5", "C5"], flute: ["E5", "C5", "A4"] },
  F: { root: "F2", fifth: "C3", piano: ["A3", "C4", "F4"], arp: ["F4", "A4", "C5", "A4"], flute: ["C5", "A4", "F4"] },
  Dm: { root: "D2", fifth: "A2", piano: ["A3", "D4", "F4"], arp: ["D5", "F5", "A5", "F5"], flute: ["F5", "D5", "A4"] },
  Em: { root: "E2", fifth: "B2", piano: ["B3", "E4", "G4"], arp: ["E5", "G5", "B5", "G5"], flute: ["G5", "E5", "B4"] },
}

// Bar 0 is the count-in: only the pulse sounds, one click per beat. Every playing bar keeps a pulse on every beat,
// so the beat a cue is judged on is always audible, whichever sections have entered.
export function eventsFor(study) {
  const { meter, bars, style, chords } = study
  const events = []
  const at = (bar, beat) => `${bar}:${beat}:0`
  for (let beat = 0; beat < meter; beat += 1) events.push({ part: "tick", note: "C6", time: at(0, beat), dur: "32n", vel: beat ? 0.6 : 1 })
  for (let bar = 1; bar <= bars; bar += 1) {
    const chord = KINDS[chords[bar - 1]]
    for (let beat = 0; beat < meter; beat += 1) {
      events.push({ part: beat ? "tick" : "kick", note: beat ? "G5" : "C2", time: at(bar, beat), dur: beat ? "32n" : "8n", vel: beat ? 0.4 : 0.9 })
    }
    const [low, mid, high] = chord.piano
    if (style === "waltz") {
      events.push({ part: "cello", note: chord.root, time: at(bar, 0), dur: "4n", vel: 0.6 })
      events.push({ part: "piano", note: [low], time: at(bar, 0), dur: "8n", vel: 0.5 })
      for (const beat of [1, 2]) events.push({ part: "piano", note: chord.piano, time: at(bar, beat), dur: "8n", vel: 0.45 })
      chord.arp.slice(0, 3).forEach((note, beat) => events.push({ part: "violin", note, time: at(bar, beat), dur: "8n", vel: 0.6 }))
      events.push({ part: "flute", note: chord.flute[0], time: at(bar, 0), dur: "2n.", vel: 0.4 })
    } else if (style === "march") {
      events.push({ part: "cello", note: chord.root, time: at(bar, 0), dur: "4n", vel: 0.6 })
      events.push({ part: "cello", note: chord.fifth, time: at(bar, 2), dur: "4n", vel: 0.55 })
      for (let beat = 0; beat < meter; beat += 1) {
        events.push({ part: "piano", note: beat % 2 ? chord.piano : [low, high], time: at(bar, beat), dur: "8n", vel: beat % 2 ? 0.55 : 0.5 })
        events.push({ part: "violin", note: chord.arp[beat], time: at(bar, beat), dur: "8n", vel: 0.58 })
      }
      chord.flute.concat(chord.flute[1]).forEach((note, beat) => events.push({ part: "flute", note, time: at(bar, beat), dur: "4n", vel: 0.42 }))
    } else {
      events.push({ part: "cello", note: chord.root, time: at(bar, 0), dur: "2n", vel: 0.58 })
      events.push({ part: "cello", note: chord.fifth, time: at(bar, 2), dur: "2n", vel: 0.5 })
      for (let beat = 0; beat < meter; beat += 1) {
        events.push({ part: "piano", note: beat % 2 ? [mid, high] : chord.piano, time: at(bar, beat), dur: "4n", vel: beat ? 0.4 : 0.65 })
        events.push({ part: "violin", note: chord.arp[beat], time: at(bar, beat), dur: "8n", vel: 0.6 })
      }
      events.push({ part: "flute", note: chord.flute[0], time: at(bar, 0), dur: "4n", vel: 0.4 })
      events.push({ part: "flute", note: chord.flute[1], time: at(bar, 2), dur: "4n", vel: 0.36 })
    }
  }
  return events
}
