import { saintsScore as score } from "./saints-score.js"

export const SAINTS_BARS = score.bars
export const SAINTS_BPM = score.bpm

const MELODIC = ["flute", "violin", "piano"]

function durOf(quarters) {
  const q = Math.max(0.25, Math.round(quarters * 4) / 4)
  const named = {
    0.25: "16n", 0.5: "8n", 0.75: "8n.", 1: "4n", 1.5: "4n.",
    2: "2n", 3: "2n.", 4: "1n", 5: "1n.", 6: "1m", 8: "1m",
  }
  return named[q] || "4n"
}

function written(events, notes, part, startBar, scale) {
  for (const note of notes || []) {
    if (note.bar < startBar || note.bar >= startBar + 2) continue
    events.push({
      part,
      note: note.note,
      offset: (note.bar - startBar) * 4 + note.beat,
      dur: durOf(note.dur),
      vel: Math.min(1, (note.vel || 0.7) * scale),
    })
  }
}

function bassHolds(bar) {
  return score.bass.some((note) => {
    const start = note.bar * 4 + note.beat
    const end = start + note.dur
    return start < bar * 4 && end > bar * 4 + 0.2
  })
}

// One 8-beat phrase taken from the Saints MIDI itself.
// Solo plays the melody. Comp plays a written voice: sax the upper line,
// guitar the lower line, piano both. Nothing here is a newly invented chord stab.
export function phraseEvents(startBar, roles = {}, energy = 1) {
  const events = []
  const loud = Math.max(0.55, Math.min(1.45, energy))
  const soloing = MELODIC.some((part) => roles[part] === "solo")
  const duck = soloing ? 0.45 : 1
  const bassOn = roles.cello !== "off"
  const drumsOn = roles.horn !== "off"
  for (const part of MELODIC) {
    if (roles[part] === "solo") written(events, score.solo, part, startBar, 0.95 * loud)
  }
  if (bassOn) {
    written(events, score.bass, "cello", startBar, 0.9 * loud)
    for (let bar = startBar; bar < startBar + 2; bar += 1) {
      const hasAttack = score.bass.some((note) => note.bar === bar)
      if (!hasAttack && !bassHolds(bar)) {
        events.push({
          part: "cello", note: score.roots[bar], offset: (bar - startBar) * 4,
          dur: "1n", vel: Math.min(1, 0.66 * loud),
        })
      }
    }
  }
  if (roles.flute === "comp") written(events, score.upper, "flute", startBar, 0.85 * duck * loud)
  if (roles.violin === "comp") written(events, score.harmony, "violin", startBar, 0.85 * duck * loud)
  if (roles.piano === "comp") {
    written(events, score.upper, "piano", startBar, 0.7 * duck * loud)
    written(events, score.harmony, "piano", startBar, 0.7 * duck * loud)
  }
  if (drumsOn) {
    const busy = energy >= 1.15
    for (let beat = 0; beat < 8; beat += 1) {
      if (beat % 2 === 0 || busy) {
        events.push({ part: "horn", drum: "kick", note: "C1", offset: beat, dur: "8n", vel: beat % 2 === 0 ? 0.9 : 0.5 })
      }
      if (beat % 2 === 1) {
        events.push({ part: "horn", drum: "tick", note: "G5", offset: beat, dur: "32n", vel: 0.35 })
      }
    }
  }
  return events
}
