import * as Tone from "tone"
import { PARTS } from "./mixer.js"
import { eventsFor as pieceEvents } from "./repertoire.js"
import { eventsFor } from "./score.js"
import { FREE_BED, FREE_BPM, FREE_PARTS, FREE_TRACKS } from "./free-music.js"

let parts
let freeBuffers
let freeSession
let freeGeneration = 0

// Each section: voice → entry/solo gate → section dynamics → beat accents → master dynamics → reverb.
function ensure() {
  if (parts) return
  const reverb = new Tone.Reverb({ decay: 2.2, wet: 0.2 }).toDestination()
  const master = new Tone.Gain(1).connect(reverb)
  const accents = new Tone.Gain(1).connect(master)
  const synths = {
    piano: new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.012, decay: 0.28, sustain: 0.12, release: 0.7 },
    }),
    cello: new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.06, decay: 0.2, sustain: 0.7, release: 0.5 },
    }),
    violin: new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.12, sustain: 0.25, release: 0.25 },
    }),
    flute: new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.08, decay: 0.1, sustain: 0.35, release: 0.4 },
    }),
    horn: new Tone.Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.08, decay: 0.2, sustain: 0.6, release: 0.4 },
    }),
  }
  const samples = {
    violin: { G3: "G3.mp3", A3: "A3.mp3", C4: "C4.mp3", E4: "E4.mp3", G4: "G4.mp3", A4: "A4.mp3", C5: "C5.mp3", E5: "E5.mp3", G5: "G5.mp3", A5: "A5.mp3", C6: "C6.mp3", E6: "E6.mp3", G6: "G6.mp3", A6: "A6.mp3" },
    flute: { C4: "C4.mp3", E4: "E4.mp3", A4: "A4.mp3", C5: "C5.mp3", E5: "E5.mp3", A5: "A5.mp3", C6: "C6.mp3", E6: "E6.mp3", A6: "A6.mp3", C7: "C7.mp3" },
    horn: { D3: "D3.mp3", F3: "F3.mp3", A3: "A3.mp3", C4: "C4.mp3", D5: "D5.mp3", F5: "F5.mp3" },
    cello: { C2: "C2.mp3", "D#2": "Ds2.mp3", G2: "G2.mp3", "A#2": "As2.mp3", "C#3": "Cs3.mp3", E3: "E3.mp3", G3: "G3.mp3", "A#3": "As3.mp3", "C#4": "Cs4.mp3", E4: "E4.mp3", G4: "G4.mp3" },
    piano: { C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3", C6: "C6.mp3" },
  }
  const samplers = {}
  for (const part of PARTS) {
    samplers[part] = new Tone.Sampler({
      urls: samples[part],
      baseUrl: `/samples/${part}/`,
      release: 0.8,
      onerror: () => {},
    })
  }
  synths.piano.volume.value = -12
  synths.cello.volume.value = -6
  synths.violin.volume.value = -8
  synths.flute.volume.value = -11
  synths.horn.volume.value = -10
  const gates = {}
  const meters = {}
  const sectionDynamics = {}
  for (const part of PARTS) {
    const gate = new Tone.Gain(0)
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.82 })
    synths[part].connect(gate)
    samplers[part].connect(gate)
    const dynamics = new Tone.Gain(1).connect(accents).connect(meter)
    gate.connect(dynamics)
    sectionDynamics[part] = dynamics
    gates[part] = gate
    meters[part] = meter
  }
  // The pulse is not a section: it bypasses the gates and the dynamics so the beat is always audible.
  synths.kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 3, envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.05 } })
  synths.tick = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 } })
  synths.kick.volume.value = -1
  synths.tick.volume.value = -10
  parts = { synths, samplers, gates, meters, sectionDynamics, accents, master }
}

function voice(part) {
  const sampler = parts.samplers[part]
  const synth = parts.synths[part]
  if (sampler?.loaded) {
    // A loaded sampler and its fallback synth were both in the graph, so every chord paid for two instruments.
    if (!sampler.fallbackCut) {
      synth.disconnect()
      sampler.fallbackCut = true
    }
    return sampler
  }
  return synth
}

function scheduleEvents(events, hooks) {
  // Monophonic voices throw if a late callback hands them a start time at or before their previous one.
  const lastStart = {}
  for (const event of events) {
    Tone.Transport.schedule((time) => {
      try {
        const at = Math.max(time, (lastStart[event.part] ?? -Infinity) + 0.001)
        lastStart[event.part] = at
        voice(event.part).triggerAttackRelease(event.note, event.dur, at, event.vel)
        if (!parts.gates[event.part]) return
        Tone.Draw.schedule(() => {
          const dur = Tone.Time(event.dur).toSeconds()
          hooks.onNote?.({ part: event.part, note: event.note, dur, vel: event.vel })
          if (parts.gates[event.part].gain.value > 0.05) hooks.onVoice(event.part)
        }, time)
      } catch {
        // One bad note must not stall the transport, or the whole bar arrives late.
      }
    }, Tone.Time(event.time).toSeconds())
  }
}

function resetTransport(bpm, meter) {
  Tone.Transport.stop()
  Tone.Transport.cancel()
  Tone.Transport.loop = false
  Tone.Transport.bpm.cancelScheduledValues(0)
  Tone.Transport.bpm.value = bpm
  Tone.Transport.timeSignature = meter
  Tone.Transport.position = 0
  PARTS.forEach((part) => {
    parts.gates[part].gain.cancelScheduledValues(0)
    parts.gates[part].gain.value = 0
  })
  for (const { gain } of [...Object.values(parts.sectionDynamics), parts.accents, parts.master]) {
    gain.cancelScheduledValues(0)
    gain.value = 1
  }
  // Keep the reference pulse clear in levels. Free-mode drums are a playable section.
  for (const drum of [parts.synths.kick, parts.synths.tick]) drum.disconnect().toDestination()
}

export function setPart(part, open) {
  if (!parts) return
  parts.gates[part].gain.rampTo(open ? 1 : 0, 0.05)
}

export function setDynamics(amount, duration = 0.2) {
  parts?.master.gain.linearRampTo(Math.max(0.25, Math.min(1.8, amount)), duration)
}

export function setPartDynamics(part, amount, duration) {
  parts?.sectionDynamics[part].gain.linearRampTo(amount, duration)
}

export function setBeatAccent(amount) {
  parts?.accents.gain.linearRampTo(amount, 0.2)
}

export function currentDynamics() {
  if (!parts) return 1
  const now = Tone.immediate()
  return parts.master.gain.getValueAtTime(now) * parts.accents.gain.getValueAtTime(now)
}

export async function startLevel(chart, hooks) {
  await Tone.start()
  ensure()
  resetTransport(chart.bpm, chart.meter)
  setPart("piano", true)
  setPart("cello", true)
  scheduleEvents(eventsFor(chart.study), hooks)
  Tone.Transport.schedule((time) => {
    Tone.Draw.schedule(() => hooks.onDone(), time)
  }, chart.duration)
  Tone.Transport.start()
}

export async function startPiece(piece, hooks) {
  await Tone.start()
  ensure()
  resetTransport(piece.bpm, piece.meter)
  // Every written part sounds on its own. A missed point still leaves the music intact.
  PARTS.forEach((part) => setPart(part, true))
  const bar = Tone.Time("1m").toSeconds()
  scheduleEvents(pieceEvents(piece.id).map((event) => ({
    ...event,
    time: Tone.Time(event.time).toSeconds() + bar,
  })), hooks)
  const duration = piece.duration
  Tone.Transport.schedule((time) => {
    Tone.Draw.schedule(() => hooks.onDone?.(), time)
  }, duration)
  Tone.Transport.start()
  return { duration, countIn: bar }
}

function loadFreeBuffers() {
  freeBuffers ??= Promise.all(FREE_PARTS.map((part) => (
    Tone.ToneAudioBuffer.load(`/music/neon/${FREE_TRACKS[part].file}`)
  ))).catch((error) => {
    freeBuffers = undefined
    throw error
  })
  return freeBuffers
}

export async function startFree() {
  const generation = ++freeGeneration
  const [, buffers] = await Promise.all([Tone.start(), loadFreeBuffers()])
  if (generation !== freeGeneration) return false
  ensure()
  resetTransport(FREE_BPM, 4)
  const start = Tone.now() + 0.03
  const filters = []
  const stems = FREE_PARTS.map((part, index) => {
    const gate = parts.gates[part]
    gate.gain.value = FREE_BED.includes(part) ? 0.82 : 0
    const source = new Tone.ToneBufferSource({ url: buffers[index], loop: true })
    if (part === "flute" || part === "piano") {
      const filter = new Tone.Filter(4600, "lowpass").connect(gate)
      source.connect(filter)
      filters.push(filter)
    } else source.connect(gate)
    source.start(start)
    return source
  })
  freeSession = { stems, filters, queued: new Map() }
  Tone.Transport.start(start)
  return true
}

// Place every command on the shared transport in ticks so queued actions stay
// on-beat even if the conductor changes the tempo before they land.
function scheduleFreeChange(key, beats, change, onLanded, tail = 0) {
  const session = freeSession
  if (!session) return
  const pending = session.queued.get(key)
  if (pending !== undefined) Tone.Transport.clear(pending)
  const ticks = beats * Tone.Transport.PPQ
  const at = (Math.floor(Tone.Transport.ticks / ticks) + 1) * ticks
  const current = () => session === freeSession && session.queued.get(key) === id
  const id = Tone.Transport.scheduleOnce((time) => {
    if (!current()) return
    change?.(time)
    Tone.Draw.schedule(() => {
      if (!current()) return
      session.queued.delete(key)
      onLanded()
    }, time + tail)
  }, `${at}i`)
  session.queued.set(key, id)
}

export function queuePart(part, gain, onLanded) {
  scheduleFreeChange(part, 1, (time) => setPartGain(part, gain, time), onLanded)
}

export function queueSolo(onLanded) {
  scheduleFreeChange("solo", 4, null, onLanded)
}

export function setPartGain(part, gain, time = Tone.now()) {
  parts.gates[part].gain.linearRampTo(gain * 0.82, 0.16, time)
}

export function setTempo(bpm) {
  if (!freeSession) return
  const time = Tone.now()
  for (const stem of freeSession.stems) stem.playbackRate.linearRampTo(bpm / FREE_BPM, 0.22, time)
  Tone.Transport.bpm.linearRampTo(bpm, 0.22, time)
}

export function setFreeEnergy(energy) {
  const amount = Math.max(0.55, Math.min(1.55, energy))
  setBeatAccent(1 + (amount - 1) * 0.2)
  for (const filter of freeSession?.filters ?? []) filter.frequency.rampTo(1000 + amount ** 2 * 3600, 0.45)
}

export function endFree(onEnded) {
  const session = freeSession
  if (!session) return
  for (const id of session.queued.values()) Tone.Transport.clear(id)
  session.queued.clear()
  scheduleFreeChange("end", 4, (time) => {
    for (const part of FREE_PARTS) parts.gates[part].gain.linearRampTo(0, 0.38, time)
  }, onEnded, 0.38)
}

export function partLevels() {
  if (!parts) return {}
  return Object.fromEntries(PARTS.map((part) => {
    const value = parts.meters[part].getValue()
    return [part, Math.min(1, (Array.isArray(value) ? value[0] : value) * 4)]
  }))
}

export function stopLevel() {
  freeGeneration += 1
  if (freeSession) {
    for (const stem of freeSession.stems) stem.dispose()
    for (const filter of freeSession.filters) filter.dispose()
    freeSession = undefined
  }
  Tone.Transport.stop(Tone.immediate())
  Tone.Transport.cancel()
}

export function transportSeconds() {
  return Tone.Transport.seconds
}

// What the player is hearing now. Transport.seconds runs lookAhead ahead of the audio clock, and the
// device adds its own output latency on top; judging and drawing against it would put every beat early.
export function songSeconds() {
  const context = Tone.getContext()
  const raw = context.rawContext
  const output = (raw.outputLatency ?? 0) || (raw.baseLatency ?? 0)
  return Tone.Transport.seconds - context.lookAhead - output
}

export function transportBeats() {
  return Tone.Transport.ticks / Tone.Transport.PPQ
}
