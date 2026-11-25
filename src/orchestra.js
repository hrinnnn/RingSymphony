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
// cut    — leave this stretch open for the ending
// releaseBeats can leave the last beats of a phrase for a held chord.
//
// A cue laid over a phrase. `at` is "bar:beat" inside the piece (bar is 0-based).
// point  — indicate one section and bring it in: { kind: "point", part, at }
// circle — gather several sections:            { kind: "circle", parts, at }
// swell  — raise or lower over several beats:  { kind: "swell", dir: "up"|"down", parts: "all"|string[], at, beats }
export const PHRASES = {
  canon: [
    { bar: 0, bars: 2, hand: "right" },
    { bar: 2, bars: 2, hand: "right", cues: [{ kind: "point", part: "violin", at: "2:0" }] },
    { bar: 4, bars: 2, hand: "right", cues: [{ kind: "point", part: "flute", at: "4:0" }] },
    { bar: 6, bars: 2, hand: "both", cues: [{ kind: "point", part: "horn", at: "6:0" }] },
    { bar: 8, bars: 2, hand: "right", cues: [{ kind: "circle", parts: ["violin", "flute"], at: "8:0" }] },
    { bar: 10, bars: 2, hand: "left", cues: [{ kind: "swell", dir: "up", parts: "all", at: "10:0", beats: 8 }] },
    { bar: 12, bars: 2, hand: "right", cues: [{ kind: "swell", dir: "down", parts: "all", at: "12:0", beats: 8 }] },
    { bar: 14, bars: 1, hand: "cut" },
  ],
  joy: [
    { bar: 0, bars: 2, hand: "right" },
    { bar: 2, bars: 2, hand: "right" },
    { bar: 4, bars: 2, hand: "both" },
    { bar: 6, bars: 2, hand: "right" },
    { bar: 8, bars: 2, hand: "right", cues: [{ kind: "swell", dir: "up", parts: "all", at: "8:0", beats: 8 }] },
    { bar: 10, bars: 2, hand: "right" },
    { bar: 12, bars: 2, hand: "left" },
    { bar: 14, bars: 2, hand: "left", releaseBeats: 2 },
  ],
  danube: [
    { bar: 0, bars: 8, hand: "right", cues: [{ kind: "point", part: "cello", at: "1:0" }] },
    { bar: 8, bars: 8, hand: "both", cues: [{ kind: "swell", dir: "up", parts: "all", at: "8:0", beats: 6 }] },
    { bar: 16, bars: 8, hand: "right" },
    { bar: 24, bars: 8, hand: "left", cues: [{ kind: "swell", dir: "down", parts: "all", at: "24:0", beats: 6 }] },
    { bar: 32, bars: 1, hand: "cut" },
  ],
  nachtmusik: [
    { bar: 0, bars: 8, hand: "right" },
    { bar: 8, bars: 4, hand: "left" },
    { bar: 12, bars: 4, hand: "right", cues: [{ kind: "circle", parts: ["violin", "flute"], at: "12:0" }] },
    { bar: 16, bars: 8, hand: "both", cues: [{ kind: "swell", dir: "up", parts: "all", at: "16:0", beats: 8 }] },
    { bar: 24, bars: 8, hand: "left" },
    { bar: 32, bars: 2, hand: "right", cues: [{ kind: "swell", dir: "down", parts: "all", at: "32:0", beats: 8 }] },
    { bar: 34, bars: 1, hand: "cut" },
  ],
}

// Which sections are already playing when a piece starts, and where the others enter.
// The arrangements must follow this, so a gesture and the music happen together.
export const ENTRIES = {
  canon: { on: ["cello", "piano"], violin: 2, flute: 4, horn: 6 },
  joy: { on: ["violin", "flute", "horn", "cello", "piano"] },
  danube: { on: ["violin", "flute"], cello: 1, horn: 1, piano: 1 },
  nachtmusik: { on: ["violin", "flute", "horn", "cello", "piano"] },
}
