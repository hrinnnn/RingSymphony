import * as Tone from "tone"
import { eventsFor } from "./score.js"

let parts

function ensure() {
  if (parts) return
  const piano = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.012, decay: 0.28, sustain: 0.12, release: 0.7 },
  })
  const cello = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.06, decay: 0.2, sustain: 0.7, release: 0.5 },
  })
  const violin = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.02, decay: 0.12, sustain: 0.25, release: 0.25 },
  })
  const flute = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.08, decay: 0.1, sustain: 0.35, release: 0.4 },
  })
  const gates = {}
  for (const [name, synth] of Object.entries({ piano, cello, violin, flute })) {
    const gate = new Tone.Gain(name === "violin" || name === "flute" ? 0 : 1)
    synth.connect(gate)
    gate.toDestination()
    gates[name] = gate
  }
  piano.volume.value = -12
  cello.volume.value = -6
  violin.volume.value = -8
  flute.volume.value = -11
  parts = { piano, cello, violin, flute, gates, level: 1 }
}

export function setPart(part, open) {
  if (!parts) return
  parts.gates[part].gain.rampTo(open ? parts.level : 0, 0.05)
}

export function setDynamics(amount) {
  if (!parts) return
  parts.level = Math.max(0.25, Math.min(1.8, amount))
  Object.values(parts.gates).forEach((gate) => {
    if (gate.gain.value > 0.05) gate.gain.rampTo(parts.level, 0.2)
  })
}

export async function startLevel(chart, hooks) {
  await Tone.start()
  ensure()
  setPart("piano", true)
  setPart("cello", true)
  setPart("violin", false)
  setPart("flute", false)
  Tone.Transport.stop()
  Tone.Transport.cancel()
  Tone.Transport.bpm.value = chart.bpm
  Tone.Transport.timeSignature = chart.meter
  for (const event of eventsFor(chart.meter)) {
    const when = Tone.Time(event.time).toSeconds()
    Tone.Transport.schedule((time) => {
      parts[event.part].triggerAttackRelease(event.note, event.dur, time, event.vel)
      Tone.Draw.schedule(() => {
        if (parts.gates[event.part].gain.value > 0.05) hooks.onVoice(event.part)
      }, time)
    }, when)
  }
  Tone.Transport.schedule((time) => {
    Tone.Draw.schedule(() => hooks.onDone(), time)
  }, chart.duration)
  Tone.Transport.position = 0
  Tone.Transport.start()
}

export function stopLevel() {
  if (Tone.Transport.state === "started") Tone.Transport.stop()
  Tone.Transport.cancel()
}

export function transportSeconds() {
  return Tone.Transport.seconds
}
