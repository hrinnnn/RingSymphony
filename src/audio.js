import * as Tone from "tone"
import { PARTS } from "./mixer.js"
import { ENTRIES } from "./orchestra.js"
import { eventsFor as pieceEvents } from "./repertoire.js"
import { eventsFor, LOOP_BARS, loopEvents } from "./score.js"

let parts

// Each section: synth → gate (on/off × local gain × solo duck) → master (global dynamics) → reverb.
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
  for (const part of PARTS) {
    const gate = new Tone.Gain(0)
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.82 })
    synths[part].connect(gate)
    samplers[part].connect(gate)
    gate.connect(master)
    gate.connect(meter)
    gates[part] = gate
    meters[part] = meter
  }
  // The pulse is not a section: it bypasses the gates and the dynamics so the beat is always audible.
  synths.kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 3, envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.05 } })
  synths.tick = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 } })
  synths.kick.volume.value = -6
  synths.tick.volume.value = -24
  synths.kick.toDestination()
  synths.tick.toDestination()
  parts = { synths, samplers, gates, meters, master }
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
}

export function setPart(part, open) {
  if (!parts) return
  parts.gates[part].gain.rampTo(open ? 1 : 0, 0.05)
}

export function setDynamics(amount) {
  if (!parts) return
  parts.master.gain.rampTo(Math.max(0.25, Math.min(1.8, amount)), 0.2)
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
  const open = new Set(ENTRIES[piece.id].on)
  PARTS.forEach((part) => setPart(part, open.has(part)))
  const bar = Tone.Time("1m").toSeconds()
  scheduleEvents(pieceEvents(piece.id).map((event) => ({
    ...event,
    time: Tone.Time(event.time).toSeconds() + bar,
  })), hooks)
  const duration = bar * (piece.bars + 1)
  Tone.Transport.schedule((time) => {
    Tone.Draw.schedule(() => hooks.onDone?.(), time)
  }, duration)
  Tone.Transport.start()
  return { duration, countIn: bar }
}

export async function startFree(hooks) {
  await Tone.start()
  ensure()
  resetTransport(96, 4)
  Tone.Transport.loop = true
  Tone.Transport.loopStart = 0
  Tone.Transport.loopEnd = `${LOOP_BARS}m`
  scheduleEvents(loopEvents(), hooks)
}

// Entries and exits land on the next beat (or bar) so a phrase is not cut mid-note.
// The first entry starts the timeline right away, as the downbeat of bar one.
export function queuePart(part, gain, quantum, onLanded) {
  if (!parts) return
  const gate = parts.gates[part].gain
  if (Tone.Transport.state !== "started") {
    Tone.Transport.position = 0
    Tone.Transport.start()
    gate.rampTo(gain, 0.04)
    onLanded()
    return
  }
  const at = Tone.Transport.nextSubdivision(quantum)
  gate.cancelScheduledValues(at)
  gate.rampTo(gain, gain > 0 ? 0.08 : 0.25, at)
  Tone.Draw.schedule(onLanded, at)
}

export function setPartGain(part, gain) {
  if (!parts) return
  parts.gates[part].gain.rampTo(gain, 0.35)
}

export function setTempo(bpm) {
  Tone.Transport.bpm.rampTo(bpm, 0.25)
}

export function endFree(onEnded) {
  const at = Tone.Transport.state === "started" ? Tone.Transport.nextSubdivision("1m") : Tone.now()
  PARTS.forEach((part) => parts?.gates[part].gain.rampTo(0, 0.6, at))
  Tone.Draw.schedule(() => {
    Tone.Transport.stop()
    Tone.Transport.position = 0
    onEnded()
  }, at + 0.7)
}

export function partLevels() {
  if (!parts) return {}
  return Object.fromEntries(PARTS.map((part) => {
    const value = parts.meters[part].getValue()
    return [part, Math.min(1, (Array.isArray(value) ? value[0] : value) * 4)]
  }))
}

export function freeRunning() {
  return Tone.Transport.state === "started"
}

export function stopLevel() {
  if (Tone.Transport.state === "started") Tone.Transport.stop()
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
