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

function chordFor(bar) {
  return CHORDS[bar === 0 ? 0 : (bar - 1) % CHORDS.length]
}

export function eventsFor(meter) {
  const events = []
  for (let bar = 0; bar < 9; bar += 1) {
    const chord = chordFor(bar)
    const line = meter === 3 ? chord.violin3 : chord.violin4
    events.push({ part: "piano", note: chord.piano, time: `${bar}:0:0`, dur: "4n", vel: 0.7 })
    events.push({ part: "cello", note: chord.root, time: `${bar}:0:0`, dur: "1m", vel: 0.55 })
    for (let beat = 0; beat < meter; beat += 1) {
      events.push({
        part: "violin",
        note: line[beat],
        time: `${bar}:${beat}:0`,
        dur: "8n",
        vel: 0.62,
      })
    }
    events.push({ part: "flute", note: chord.flute[0], time: `${bar}:0:0`, dur: "4n", vel: 0.4 })
    if (meter > 2) {
      events.push({ part: "flute", note: chord.flute[1], time: `${bar}:2:0`, dur: "4n", vel: 0.36 })
    }
  }
  return events
}
