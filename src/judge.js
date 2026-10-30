export const PERFECT = 0.08
export const GOOD = 0.18

export function createJudge(level) {
  const beatSec = 60 / level.bpm
  const countIn = level.meter * beatSec
  const total = 8 * level.meter
  const beats = Array.from({ length: total }, (_, i) => ({
    time: countIn + i * beatSec,
    point: i % level.meter,
    result: null,
  }))
  const counts = { perfect: 0, good: 0, miss: 0 }

  function grade(distance) {
    if (distance <= PERFECT) return "perfect"
    if (distance <= GOOD) return "good"
    return "miss"
  }

  return {
    beats,
    counts,
    beatSec,
    countIn,
    total,
    submit(transportSeconds) {
      if (transportSeconds < countIn) return null
      let best = null
      let bestAbs = Infinity
      for (const beat of beats) {
        if (beat.result) continue
        const distance = Math.abs(transportSeconds - beat.time)
        if (distance < bestAbs) {
          bestAbs = distance
          best = beat
        }
      }
      if (!best || bestAbs > beatSec / 2) return null
      best.result = grade(bestAbs)
      counts[best.result] += 1
      return best
    },
    expire(transportSeconds) {
      const late = []
      for (const beat of beats) {
        if (!beat.result && transportSeconds > beat.time + GOOD) {
          beat.result = "miss"
          counts.miss += 1
          late.push(beat)
        }
      }
      return late
    },
    finished(transportSeconds) {
      return transportSeconds >= countIn + total * beatSec
    },
    accuracy() {
      return (counts.perfect + 0.5 * counts.good) / total
    },
  }
}
