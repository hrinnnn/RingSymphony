import * as Tone from "tone"
import { PARTS } from "./mixer.js"
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
  parts = { synths, gates, meters, master }
}

function scheduleEvents(events, hooks) {
  // Monophonic voices throw if a late callback hands them a start time at or before their previous one.
  const lastStart = {}
  for (const event of events) {
    Tone.Transport.schedule((time) => {
      const at = Math.max(time, (lastStart[event.part] ?? -Infinity) + 0.001)
      lastStart[event.part] = at
      parts.synths[event.part].triggerAttackRelease(event.note, event.dur, at, event.vel)
      if (!parts.gates[event.part]) return
      Tone.Draw.schedule(() => {
        if (parts.gates[event.part].gain.value > 0.05) hooks.onVoice(event.part)
      }, time)
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
