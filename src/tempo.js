// Beat-interval tempo follower from the design doc (§6.1 ①): 0.22 s refractory gap,
// 0.3 / 0.7 smoothing, and outliers outside 0.6–1.4× the current tempo are ignored.
export const MIN_GAP = 0.22
const MIN_BPM = 50
const MAX_BPM = 180

export function createTempo(initial = 96) {
  let bpm = initial
  let last = null
  return {
    get bpm() { return bpm },
    tap(seconds) {
      if (last !== null && seconds - last < MIN_GAP) return bpm
      if (last !== null) {
        const instant = 60 / (seconds - last)
        const ratio = instant / bpm
        if (ratio > 0.6 && ratio < 1.4) bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, 0.3 * instant + 0.7 * bpm))
      }
      last = seconds
      return bpm
    },
    reset(next = initial) {
      bpm = next
      last = null
    },
  }
}
