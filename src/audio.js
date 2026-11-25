import * as Tone from "tone"
import { PARTS } from "./mixer.js"
import { eventsFor as pieceEvents } from "./repertoire.js"
import { eventsFor } from "./score.js"
import { phraseEvents, SAINTS_BARS, SAINTS_BPM } from "./saints.js"

let parts
let bandLive = false
let bandLoop = null
let bandHooks = null
let bandPlan = { violin: "off", flute: "off", piano: "off" }
let bandEnergy = 1

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
  bandLive = false
  bandLoop = null
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

export function setBandPlan(roles, energy) {
  if (roles) {
    bandPlan = {
      violin: roles.violin || "off",
      flute: roles.flute || "off",
      piano: roles.piano || "off",
      cello: roles.cello === "off" ? "off" : "on",
      horn: roles.horn === "off" ? "off" : "on",
    }
  }
  if (typeof energy === "number" && Number.isFinite(energy)) bandEnergy = energy
}

// The next phrase is armed from inside the current downbeat, two bars ahead,
// so the event is still in the future. Arming it at the downbeat itself gets dropped,
// and then 起奏 never reaches the other players.
function armPhrase(absolute) {
  const scoreBar = absolute % SAINTS_BARS
  Tone.Transport.schedule((time) => {
    const roles = { ...bandPlan }
    const energy = bandEnergy
    const hooks = bandHooks || {}
    const soloing = ["violin", "flute", "piano"].some((part) => roles[part] === "solo")
    const beat = Tone.Time("4n").toSeconds()
    for (const part of ["violin", "flute", "piano", "cello"]) {
      const role = part === "cello" ? "bed" : roles[part]
      const open = part === "cello" ? roles.cello !== "off" : role === "comp" || role === "solo"
      const level = !open ? 0 : soloing && role === "comp" ? 0.5 : 1
      const gate = parts.gates[part].gain
      gate.cancelScheduledValues(time)
      gate.rampTo(level, 0.06, time)
    }
    for (const event of phraseEvents(scoreBar, roles, energy)) {
      const at = time + event.offset * beat
      try {
        if (event.drum === "kick") parts.synths.kick.triggerAttackRelease("C2", "8n", at, 1)
        else if (event.drum === "tick") parts.synths.tick.triggerAttackRelease("G4", "16n", at, 0.9)
        else voice(event.part).triggerAttackRelease(event.note, event.dur, at, event.vel)
      } catch {
        // One bad note must not stall the bar.
      }
      if (event.drum === "tick") continue
      Tone.Draw.schedule(() => {
        hooks.onNote?.({ part: event.part, note: event.note, dur: 0.35, vel: event.vel })
        if (!event.drum) hooks.onVoice?.(event.part)
      }, at)
    }
    armPhrase(absolute + 2)
  }, Tone.Time(`${absolute}:0:0`).toSeconds())
}

function scheduleBand() {
  armPhrase(0)
}

export async function startFree(hooks) {
  await Tone.start()
  ensure()
  resetTransport(SAINTS_BPM, 4)
  for (const drum of [parts.synths.kick, parts.synths.tick]) drum.disconnect().connect(parts.sectionDynamics.horn)
  bandHooks = hooks
  bandLive = true
  bandPlan = { violin: "off", flute: "off", piano: "off", cello: "on", horn: "on" }
  bandEnergy = 1
  scheduleBand()
  parts.gates.cello.gain.value = 1
  if (Tone.context.state !== "running") await Tone.context.resume()
  Tone.Transport.start()
}

// Entries and exits land on the next beat (or bar) so a phrase is not cut mid-note.
// The first entry starts the timeline right away, as the downbeat of bar one.
export function queuePart(part, gain, quantum, onLanded) {
  if (!parts) return
  if (bandLive) {
    if (Tone.Transport.state !== "started") {
      scheduleBand()
      Tone.Transport.position = 0
      Tone.Transport.start()
    }
    const at = Tone.Transport.state === "started" ? Tone.Transport.nextSubdivision(quantum) : Tone.now()
    Tone.Draw.schedule(onLanded, at)
    return
  }
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
