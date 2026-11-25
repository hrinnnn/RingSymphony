export const FREE_BPM = 108
export const FREE_BARS = 4

// Keep the mixer ids shared with the classical levels. The four files are
// aligned stems from Oğuzhan Girgin's Rust — Neon Loop (CC BY 4.0).
export const FREE_TRACKS = {
  flute: { name: "主奏", badge: "主", file: "lead.wav" },
  piano: { name: "和弦", badge: "和", file: "chords.wav" },
  cello: { name: "贝斯", badge: "贝", file: "bass.wav" },
  horn: { name: "鼓组", badge: "鼓", file: "drums.wav" },
}

export const FREE_PARTS = Object.keys(FREE_TRACKS)
export const FREE_BED = ["cello", "horn"]
