import * as Tone from "tone"
import { PARTS } from "./mixer.js"
import { eventsFor as pieceEvents } from "./repertoire.js"
import { eventsFor } from "./score.js"
import { FREE_BPM, FREE_METER, FREE_SCORE, phaseTarget, pianoDuration } from "./free-music.js"

let parts
let freeSession
let freeGeneration = 0

// Each section flows through a gain gate into the master dynamics and reverb.
function ensure() {
  if (parts) return
  const reverb = new Tone.Reverb({ decay: 2.2, wet: 0.2 }).toDestination()
  const master = new Tone.Gain(1).connect(reverb)
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
  let settlePiano
  const pianoReady = new Promise((resolve) => { settlePiano = resolve })
  for (const part of PARTS) {
    samplers[part] = new Tone.Sampler({
      urls: samples[part],
      baseUrl: `/samples/${part}/`,
      release: 0.8,
      onload: part === "piano" ? settlePiano : () => {},
      onerror: part === "piano" ? settlePiano : () => {},
    })
  }
  synths.piano.volume.value = -12
  synths.cello.volume.value = -6
  synths.violin.volume.value = -8
  synths.flute.volume.value = -11
  synths.horn.volume.value = -10
  const gates = {}
  const meters = {}
  for (const part of PARTS) {
    const gate = new Tone.Gain(0)
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.82 })
    synths[part].connect(gate)
    samplers[part].connect(gate)
    gate.connect(master).connect(meter)
    gates[part] = gate
    meters[part] = meter
  }
  // The pulse is not a section: it bypasses the gates and the dynamics so the beat is always audible.
  synths.kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 3, envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.05 } })
  synths.tick = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 } })
  synths.kick.volume.value = -1
  synths.tick.volume.value = -10
  parts = { synths, samplers, gates, meters, master, pianoReady }
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
  parts.master.gain.cancelScheduledValues(0)
  parts.master.gain.value = 1
  // Keep the reference pulse clear in the rhythm levels.
  for (const drum of [parts.synths.kick, parts.synths.tick]) drum.disconnect().toDestination()
}

export function setPart(part, open) {
  if (!parts) return
  parts.gates[part].gain.rampTo(open ? 1 : 0, 0.05)
}

export function setDynamics(amount, duration = 0.2) {
  parts?.master.gain.linearRampTo(Math.max(0.25, Math.min(1.8, amount)), duration)
}

export function currentDynamics() {
  if (!parts) return 1
  return parts.master.gain.getValueAtTime(Tone.immediate())
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

export async function startFree(hooks) {
  const generation = ++freeGeneration
  await Tone.start()
  if (generation !== freeGeneration) return false
  ensure()
  await parts.pianoReady
  if (generation !== freeGeneration) return false
  freeSession = { hooks, run: null }
  return true
}

const ticksAt = (beats) => Math.round(beats * Tone.Transport.PPQ)
const atBeat = (beats) => `${ticksAt(beats)}i`

function finishFree(session, run) {
  if (freeSession !== session || session.run !== run) return
  session.run = null
  run.piano.releaseAll(Tone.immediate())
  Tone.Transport.stop(Tone.immediate())
  Tone.Transport.cancel()
  session.hooks.onEnded()
}

export function playFree() {
  const session = freeSession
  if (!session || session.run) return false
  resetTransport(FREE_BPM, FREE_METER)
  parts.gates.piano.gain.value = 0.62
  const run = { piano: voice("piano"), velocity: 1, articulation: 0.95, cutBeat: Infinity }
  session.run = run
  let lastVisualBeat = -1
  for (const note of FREE_SCORE.notes) {
    Tone.Transport.scheduleOnce((time) => {
      if (session.run !== run || note.beat >= run.cutBeat) return
      const duration = pianoDuration(note, run.articulation)
      const velocity = Math.min(1, note.velocity * run.velocity)
      run.piano.triggerAttack(note.note, time, velocity)
      // A release is placed on the score clock as well, so notes already
      // sounding still lengthen or shorten with the conductor.
      Tone.Transport.scheduleOnce((offTime) => {
        if (session.run === run) run.piano.triggerRelease(note.note, offTime)
      }, atBeat(note.beat + duration))
      if (lastVisualBeat === note.beat) return
      lastVisualBeat = note.beat
      Tone.Draw.schedule(() => {
        if (session.run !== run) return
        const bpm = Tone.Transport.bpm.getValueAtTime(time)
        session.hooks.onNote({ ...note, dur: duration * 60 / bpm, vel: velocity })
      }, time)
    }, atBeat(note.beat))
  }
  Tone.Transport.scheduleOnce((time) => {
    Tone.Draw.schedule(() => finishFree(session, run), time + 1)
  }, atBeat(FREE_SCORE.endBeat))
  Tone.Transport.start(Tone.now() + 0.025)
  return true
}

function audibleTime() {
  const raw = Tone.getContext().rawContext
  const output = (raw.outputLatency ?? 0) || (raw.baseLatency ?? 0)
  return Math.max(0, Tone.immediate() - output)
}

export function setTempo(bpm, age = 0) {
  if (!freeSession?.run) return
  const transport = Tone.Transport
  const at = Math.max(0, audibleTime() - age)
  const beatPosition = transport.getTicksAtTime(at) / transport.PPQ
  const time = Tone.now()
  transport.bpm.linearRampTo(phaseTarget(bpm, beatPosition), 0.28, time)
  transport.bpm.linearRampToValueAtTime(bpm, time + 120 / bpm)
}

export function setFreeExpression(expression) {
  const run = freeSession?.run
  if (run) Object.assign(run, expression)
}

export function endFree() {
  const session = freeSession
  const run = session?.run
  if (!run || Number.isFinite(run.cutBeat)) return
  const ticks = FREE_METER * Tone.Transport.PPQ
  const at = (Math.floor(Tone.Transport.ticks / ticks) + 1) * ticks
  run.cutBeat = at / Tone.Transport.PPQ
  Tone.Transport.scheduleOnce((time) => {
    if (session.run !== run) return
    parts.gates.piano.gain.linearRampTo(0, 0.6, time)
    run.piano.releaseAll(time)
    Tone.Draw.schedule(() => finishFree(session, run), time + 0.9)
  }, `${at}i`)
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
  if (freeSession?.run) {
    freeSession.run.piano.releaseAll(Tone.immediate())
    freeSession.run = null
  }
  freeSession = undefined
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
  return Tone.Transport.getTicksAtTime(audibleTime()) / Tone.Transport.PPQ
}
