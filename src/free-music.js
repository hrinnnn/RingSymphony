import score from "./gymnopedie-score.json" with { type: "json" }

export const FREE_SCORE = score
export const FREE_BPM = score.bpm
export const FREE_METER = score.meter
export const FREE_BARS = Math.ceil(score.endBeat / score.meter)

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

// Hitting late in the beat means the music is ahead. Correct over the next
// few beats, without jumping the playhead or changing the note's pitch.
export function phaseTarget(bpm, beatPosition) {
  const error = beatPosition - Math.round(beatPosition)
  return bpm * (1 - clamp(error * 0.36, -0.12, 0.12))
}

export function createConductor() {
  let last = null
  let bpm = FREE_BPM
  let intervals = []
  let travel = null
  let weight = 1
  let articulation = 0.95
  return {
    get bpm() { return bpm },
    tap(at) {
      const interval = last === null ? null : at - last
      const beat = 60 / bpm
      if (interval !== null && interval < Math.max(0.32, beat * 0.55)) return null
      last = at
      if (interval === null || interval > beat * 1.75) {
        intervals = []
        return { bpm: null }
      }
      intervals.push(interval)
      if (intervals.length > 3) intervals.shift()
      const sorted = intervals.toSorted((a, b) => a - b)
      const middle = Math.floor(sorted.length / 2)
      const typical = sorted.length % 2 ? sorted[middle] : (sorted[0] + sorted[1]) / 2
      bpm += (clamp(60 / typical, 40, 105) - bpm) * 0.52
      return { bpm }
    },
    stroke({ angularTravel, rise, peakSpeed }) {
      if (angularTravel > 0) {
        travel ??= angularTravel
        const emphasis = clamp(angularTravel / travel, 0.55, 1.65)
        weight += (emphasis - weight) * 0.55
        travel += (angularTravel - travel) * 0.08
      }
      if (Number.isFinite(rise) && peakSpeed > 0) {
        // Normalize by peak speed so a sharp attack and a wide swing can
        // produce different articulations even at the same conducting tempo.
        const sharpness = clamp((rise / peakSpeed - 5) / 12, 0, 1)
        articulation += (1.05 - 0.48 * sharpness - articulation) * 0.6
      }
      return { velocity: 0.52 + weight * 0.48, articulation }
    },
    reset() {
      last = null
      bpm = FREE_BPM
      intervals = []
      travel = null
      weight = 1
      articulation = 0.95
    },
  }
}

export function pianoDuration(note, articulation) {
  return Math.min(note.duration * articulation, note.maxDuration === null ? Infinity : note.maxDuration - 0.02)
}
