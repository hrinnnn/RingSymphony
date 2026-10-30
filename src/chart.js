const DIRS = ["down", "left", "right", "up"]

export function buildChart() {
  const bpm = 96
  const meter = 4
  const beat = 60 / bpm
  const countIn = meter * beat
  const bars = 8
  const cues = []
  for (let i = 0; i < bars * meter; i += 1) {
    cues.push({
      kind: "beat",
      hand: "right",
      direction: DIRS[i % 4],
      time: countIn + i * beat,
    })
  }
  cues.push({ kind: "cue", hand: "left", part: "violin", time: countIn + 8 * beat - beat * 0.5 })
  cues.push({ kind: "cue", hand: "left", part: "flute", time: countIn + 16 * beat - beat * 0.5 })
  cues.push({ kind: "dynamics", hand: "left", direction: "up", time: countIn + 20 * beat })
  cues.push({ kind: "dynamics", hand: "left", direction: "down", time: countIn + 26 * beat })
  cues.sort((a, b) => a.time - b.time)
  return {
    bpm,
    meter,
    beat,
    countIn,
    bars,
    cues,
    duration: countIn + bars * meter * beat,
  }
}
