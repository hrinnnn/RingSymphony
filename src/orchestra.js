// Shared contract for the five sections, the repertoire, and the two hooks the
// stage and the audio engine use to talk. Section ids match mixer.js PARTS.

export const SECTIONS = ["violin", "flute", "horn", "cello", "piano"]

// A note the audio engine emits at the moment it sounds, so the stage can move
// the matching players. `dur` and the transport time are seconds.
// { part, note, dur, vel }  vel is 0..1, dur is seconds.
export function noteEvent(part, note, dur, vel) {
  return { part, note, dur, vel }
}

// How the conductor's hands are occupied for a stretch of bars.
// right  — beat with the right hand
// left   — beat with the left hand
// both   — the downbeat is a two-hand accent, then the right hand continues
// free   — stop beating; the music carries itself
// cut    — close the phrase (both hands close)
//
// A cue laid over a phrase. `at` is "bar:beat" inside the piece (bar is 0-based).
// point  — indicate one section and bring it in: { kind: "point", part, at }
// circle — gather several sections:            { kind: "circle", parts, at }
// swell  — raise or lower over several beats:  { kind: "swell", dir: "up"|"down", parts: "all"|string[], at, beats }
export const PHRASES = {
  canon: [
    { bar: 0, bars: 4, hand: "right" },
    { bar: 4, bars: 4, hand: "right", cues: [{ kind: "point", part: "violin", at: "4:0" }] },
    { bar: 8, bars: 4, hand: "right", cues: [{ kind: "point", part: "flute", at: "8:0" }, { kind: "swell", dir: "up", parts: "all", at: "8:0", beats: 4 }] },
    { bar: 12, bars: 3, hand: "free", cues: [{ kind: "point", part: "horn", at: "12:0" }, { kind: "swell", dir: "down", parts: "all", at: "13:0", beats: 4 }] },
    { bar: 15, bars: 1, hand: "cut" },
  ],
  joy: [
    { bar: 0, bars: 4, hand: "right" },
    { bar: 4, bars: 4, hand: "both", cues: [{ kind: "point", part: "horn", at: "4:0" }] },
    { bar: 8, bars: 4, hand: "right", cues: [{ kind: "swell", dir: "up", parts: ["violin", "horn"], at: "8:0", beats: 8 }] },
    { bar: 12, bars: 3, hand: "left" },
    { bar: 15, bars: 1, hand: "cut" },
  ],
  danube: [
    { bar: 0, bars: 4, hand: "right" },
    { bar: 4, bars: 4, hand: "free", cues: [{ kind: "swell", dir: "up", parts: "all", at: "4:0", beats: 8 }] },
    { bar: 8, bars: 4, hand: "both", cues: [{ kind: "circle", parts: ["violin", "cello"], at: "8:0" }] },
    { bar: 12, bars: 3, hand: "right", cues: [{ kind: "swell", dir: "down", parts: "all", at: "12:0", beats: 6 }] },
    { bar: 15, bars: 1, hand: "cut" },
  ],
  nachtmusik: [
    { bar: 0, bars: 4, hand: "both" },
    { bar: 4, bars: 4, hand: "left" },
    { bar: 8, bars: 4, hand: "both", cues: [{ kind: "point", part: "flute", at: "8:0" }] },
    { bar: 12, bars: 3, hand: "right", cues: [{ kind: "swell", dir: "up", parts: "all", at: "12:0", beats: 6 }] },
    { bar: 15, bars: 1, hand: "cut" },
  ],
}

// Which sections are already playing when a piece starts, and where the others enter.
// The arrangements must follow this, so a gesture and the music happen together.
export const ENTRIES = {
  canon: { on: ["cello", "piano"], violin: 4, flute: 8, horn: 12 },
  joy: { on: ["violin", "cello", "piano"], horn: 4, flute: 0 },
  danube: { on: ["violin", "cello", "piano", "horn"], flute: 4 },
  nachtmusik: { on: ["violin", "cello", "piano", "horn"], flute: 8 },
}
