import { readFileSync, writeFileSync } from "node:fs"

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
const pitchName = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`

function parse(path) {
  const u8 = readFileSync(path)
  let o = 0
  const str = (n) => { const s = u8.subarray(o, o + n).toString("latin1"); o += n; return s }
  const u32 = () => { const n = u8.readUInt32BE(o); o += 4; return n }
  const u16 = () => { const n = u8.readUInt16BE(o); o += 2; return n }
  const readVar = () => {
    let n = 0
    let b = 0
    do { b = u8[o++]; n = (n << 7) | (b & 0x7f) } while (b & 0x80)
    return n
  }
  if (str(4) !== "MThd") throw new Error(`${path} is not MIDI`)
  const hlen = u32()
  u16(); const ntrks = u16(); const division = u16()
  o += hlen - 6
  const tracks = []
  const tempos = []
  const sigs = []
  for (let t = 0; t < ntrks; t += 1) {
    if (str(4) !== "MTrk") throw new Error("bad track")
    const len = u32()
    const end = o + len
    let tick = 0
    let running = 0
    let name = ""
    const ons = []
    while (o < end) {
      tick += readVar()
      let status = u8[o]
      if (status < 0x80) status = running
      else { running = status; o += 1 }
      if (status === 0xff) {
        const meta = u8[o++]
        const n = readVar()
        const data = u8.subarray(o, o + n)
        o += n
        if (meta === 0x03) name = Buffer.from(data).toString("utf8")
        if (meta === 0x51 && n === 3) tempos.push({ tick, us: (data[0] << 16) | (data[1] << 8) | data[2] })
        if (meta === 0x58) sigs.push({ tick, num: data[0], den: 2 ** data[1] })
        continue
      }
      if (status === 0xf0 || status === 0xf7) { o += readVar(); continue }
      const type = status & 0xf0
      if (type === 0xc0 || type === 0xd0) { o += 1; continue }
      if (type === 0x90 || type === 0x80) {
        const note = u8[o++]
        const vel = u8[o++]
        if (type === 0x90 && vel > 0) ons.push({ tick, note, vel, end: null })
        else {
          for (let i = ons.length - 1; i >= 0; i -= 1) {
            if (ons[i].note === note && ons[i].end == null) { ons[i].end = tick; break }
          }
        }
        continue
      }
      o += 2
    }
    tracks.push({ name, notes: ons.filter((note) => note.end != null && note.end > note.tick) })
  }
  return { division, tracks, tempos, sigs }
}

const jobs = [
  {
    id: "canon",
    file: "public/midi/canon_per_3_violini_e_basso.mid",
    map: { "violinI:": "violin", "violinII:": "flute", "violinIII:": "horn", "violoncello:": "cello" },
    pianoFrom: "cello",
  },
  {
    id: "joy",
    file: "public/midi/ode.mid",
    map: { upper: "violin", lower: "cello" },
    also: { violin: "flute", cello: "piano" },
    hornFrom: "cello",
  },
  {
    id: "danube",
    file: "public/midi/danube.mid",
    map: { "up:upper": "violin", "down:lower": "cello" },
    also: { violin: "flute", cello: "piano" },
    hornFrom: "cello",
  },
  {
    id: "nachtmusik",
    file: "public/midi/MozartWA-KV525-mov-01.mid",
    mapByOrder: ["violin", "flute", "horn", "cello"],
    pianoFrom: "cello",
  },
]

const out = {}
for (const job of jobs) {
  const midi = parse(job.file)
  const tempo = midi.tempos[0]
  const bpm = Math.round(60_000_000 / tempo.us)
  const sig = midi.sigs[0] || { num: 4, den: 4 }
  const quartersPerBar = sig.num * (4 / sig.den)
  const ticksPerBar = midi.division * quartersPerBar
  const playable = midi.tracks.filter((track) => track.notes.length)
  const assigned = []
  playable.forEach((track, index) => {
    const part = job.mapByOrder ? job.mapByOrder[index] : job.map[track.name]
    if (!part) return
    assigned.push({ part, notes: track.notes })
    if (job.also?.[part]) assigned.push({ part: job.also[part], notes: track.notes })
  })
  if (job.pianoFrom || job.hornFrom) {
    const source = assigned.find((item) => item.part === (job.pianoFrom || job.hornFrom))
    if (job.pianoFrom && source) assigned.push({ part: "piano", notes: source.notes.map((note) => ({ ...note, vel: Math.round(note.vel * 0.7) })) })
    if (job.hornFrom && source) assigned.push({ part: "horn", notes: source.notes.filter((note) => note.note >= 48 && note.note <= 72) })
  }
  let lastTick = 0
  const events = []
  for (const { part, notes } of assigned) {
    const groups = new Map()
    for (const note of notes) {
      lastTick = Math.max(lastTick, note.end)
      const sixteenths = Math.round((note.tick / midi.division) * 4)
      const key = `${part}:${sixteenths}`
      const bucket = groups.get(key) || []
      bucket.push(note)
      groups.set(key, bucket)
    }
    for (const [key, bucket] of groups) {
      const sixteenths = Number(key.split(":")[1])
      const perBar = quartersPerBar * 4
      const bar = Math.floor(sixteenths / perBar)
      const rem = sixteenths % perBar
      const quarter = Math.floor(rem / 4)
      const sixteenth = rem % 4
      const durTicks = Math.max(...bucket.map((note) => note.end - note.tick))
      const dur = Math.max(0.05, (durTicks / midi.division) * (60 / bpm))
      const vel = Math.min(1, Math.max(0.15, bucket.reduce((sum, note) => sum + note.vel, 0) / bucket.length / 127))
      const names = [...new Set(bucket.map((note) => pitchName(note.note)))]
      events.push({
        part,
        note: names.length === 1 ? names[0] : names,
        time: `${bar}:${quarter}:${sixteenth}`,
        dur: Math.round(dur * 1000) / 1000,
        vel: Math.round(vel * 100) / 100,
      })
    }
  }
  events.sort((a, b) => a.time.localeCompare(b.time, undefined, { numeric: true }) || a.part.localeCompare(b.part))
  const bars = Math.max(...events.map((event) => Number(event.time.split(":")[0]))) + 1
  const first = {}
  for (const event of events) {
    const bar = Number(event.time.split(":")[0])
    if (first[event.part] == null || bar < first[event.part]) first[event.part] = bar
  }
  out[job.id] = { bpm, meter: sig.num, bars, first, events }
  console.log(`${job.id}: ${bpm} bpm ${sig.num}/${sig.den} ${bars} bars ${events.length} events first=${JSON.stringify(first)} tempos=${midi.tempos.length} sigs=${midi.sigs.length}`)
}

writeFileSync("src/midi-score.json", JSON.stringify(out))
console.log("wrote src/midi-score.json", (JSON.stringify(out).length / 1024).toFixed(0), "KB")

const gymnopedie = parse("public/midi/gymnopedie_1.mid")
const pianoNotes = gymnopedie.tracks.flatMap(({ notes }) => notes)
  .sort((a, b) => a.tick - b.tick || a.note - b.note)
const nextAttack = new Map()
const notes = pianoNotes.toReversed().map(({ tick, note, vel, end }) => {
  const next = nextAttack.get(note)
  nextAttack.set(note, tick)
  return {
    beat: tick / gymnopedie.division,
    duration: (end - tick) / gymnopedie.division,
    maxDuration: next === undefined ? null : (next - tick) / gymnopedie.division,
    note: pitchName(note),
    pitch: note,
    velocity: vel / 127,
  }
}).reverse()
writeFileSync("src/gymnopedie-score.json", JSON.stringify({
  bpm: 60_000_000 / gymnopedie.tempos[0].us,
  meter: gymnopedie.sigs[0].num,
  endBeat: Math.max(...pianoNotes.map(({ end }) => end)) / gymnopedie.division,
  notes,
}))
