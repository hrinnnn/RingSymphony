import { readFileSync } from "node:fs"

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
  const format = u16()
  const ntrks = u16()
  const division = u16()
  o += hlen - 6
  const tracks = []
  for (let t = 0; t < ntrks; t += 1) {
    if (str(4) !== "MTrk") throw new Error("bad track")
    const len = u32()
    const end = o + len
    let tick = 0
    let running = 0
    let name = ""
    let notes = 0
    let min = 127
    let max = 0
    const tempos = []
    const sigs = []
    const programs = []
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
        if (meta === 0x03) name = data.toString("utf8")
        if (meta === 0x51 && n === 3) tempos.push({ tick, us: (data[0] << 16) | (data[1] << 8) | data[2] })
        if (meta === 0x58) sigs.push({ tick, num: data[0], den: 2 ** data[1] })
        continue
      }
      if (status === 0xf0 || status === 0xf7) { o += readVar(); continue }
      const type = status & 0xf0
      if (type === 0xc0) { programs.push(u8[o++]); continue }
      if (type === 0xd0) { o += 1; continue }
      if (type === 0x90 || type === 0x80) {
        const note = u8[o++]
        const vel = u8[o++]
        if (type === 0x90 && vel > 0) {
          notes += 1
          min = Math.min(min, note)
          max = Math.max(max, note)
        }
        continue
      }
      o += 2
    }
    tracks.push({ name, notes, min, max, programs, last: tick })
    tracks.tempos = tempos
    tracks.sigs = sigs
  }
  const tempos = []
  const sigs = []
  // reparse is messy; collect from first pass stored on array — redo simply below
  return { format, ntrks, division, tracks }
}

const files = process.argv.slice(2)
for (const file of files) {
  const midi = parse(file)
  console.log(`\n${file} format=${midi.format} tracks=${midi.ntrks} division=${midi.division}`)
  for (const [i, track] of midi.tracks.entries()) {
    if (!track.notes && !track.name) continue
    console.log(`  ${i} ${JSON.stringify(track.name)} notes=${track.notes} pitch=${track.min}-${track.max} prog=${track.programs.join(",")} end=${track.last}`)
  }
}
