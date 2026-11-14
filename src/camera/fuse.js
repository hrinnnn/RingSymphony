// Decides what to do when the ring and the camera disagree about a stroke's direction, and what
// to do when only one of them has an answer.
//
// Permissive, never restrictive. There is no AND gate: requiring both sensors to agree would kill
// a beat whenever either was uncertain, which is strictly worse than having no camera at all.
//
// Pure: no DOM, no storage, no clock.

// Below this the camera is reading a stroke's edges rather than its body, and is wrong often
// enough to be worse than nothing: measured over 193 labelled strokes it was right 56% below 0.05
// displacement and 85% between 0.12 and 0.2.
const TRUST_DISPLACEMENT = 0.08

// While the ring is distrusted its own answers are already unreliable, so the bar for preferring
// the camera drops — a weak camera verdict still beats a sensor that is refusing two strokes in
// three.
const DISTRUST_DISPLACEMENT = 0.04

// How many recent strokes the refusal rate is measured over. Ten is about two and a half bars at
// 4/4, long enough that a single fumbled stroke cannot flip the mode.
const WINDOW = 10

// Enter distrust when the ring has refused more than 60% of the last WINDOW strokes, and leave it
// only below 10%. The gap is hysteresis: without it the mode would oscillate around the threshold
// and two identical strokes seconds apart would be judged differently.
const ENTER_DISTRUST = 0.6
const LEAVE_DISTRUST = 0.1

const ringKeeps = (dir, disagreed) => ({ dir, source: "ring", disagreed })

// Tracks how often the ring has been declining lately, which is what decides who outranks whom.
//
// The need for this is measured, not theoretical. Across eight labelled sessions the ring's
// accuracy *when it answered* never dropped below 77%, but how often it answered swung between
// 34% and 100% depending on which calibration the player happened to record. Neither fixed rule
// wins in both regimes:
//
//     ring decides        28/31 and 30/33 with a good calibration, 10/35 with a bad one
//     camera overrules    20/31 and 23/33 with a good calibration, 16/35 with a bad one
//
// So the authority follows the evidence instead of being fixed. Tuned against all eight sessions:
// zero regressions, +8 strokes overall, +5 on the worst session.
export function createFusion({ window = WINDOW, enter = ENTER_DISTRUST, leave = LEAVE_DISTRUST } = {}) {
  let recent = []
  let distrusted = false

  return {
    get distrusted() { return distrusted },

    reset() {
      recent = []
      distrusted = false
    },

    // `ringDir` is the ring's classification, or null when it declined. `verdict` is the camera's,
    // or null when there is no camera at all. The two null cases are deliberately identical: every
    // degradation path — no hardware, denied permission, lost tracking, dim room, stalled stream —
    // converges here, so the fallback is one well-exercised path rather than a rare second branch.
    fuse(ringDir, verdict) {
      // Decided before this stroke updates the rate, so the decision never depends on its own
      // outcome and a replay of the same strokes always yields the same answers.
      const result = decide(ringDir, verdict, distrusted)

      recent.push(ringDir ? 0 : 1)
      if (recent.length > window) recent.shift()
      if (recent.length === window) {
        const refusalRate = recent.reduce((sum, value) => sum + value, 0) / window
        if (!distrusted && refusalRate > enter) distrusted = true
        else if (distrusted && refusalRate < leave) distrusted = false
      }
      return result
    },
  }
}

function decide(ringDir, verdict, distrusted) {
  const cameraDir = verdict?.dir ?? null
  if (!cameraDir) return ringKeeps(ringDir ?? null, false)

  // The ring is refusing most strokes, which means its templates no longer describe how this
  // player is conducting. Its remaining answers are not trustworthy enough to outrank a camera
  // that can see the motion directly, so the camera leads until the ring recovers.
  if (distrusted) {
    if ((verdict.displacement ?? 0) >= DISTRUST_DISPLACEMENT) {
      return { dir: cameraDir, source: "camera", disagreed: Boolean(ringDir) && ringDir !== cameraDir }
    }
    return ringKeeps(ringDir ?? null, false)
  }

  // The ring is healthy, so the ring decides. Measured over 64 strokes with a good calibration it
  // was right 60/60 while the camera was right 46/51, and every camera override took a correct
  // ring answer and made it wrong.
  if (ringDir) return ringKeeps(ringDir, ringDir !== cameraDir)

  // The ring declined this one stroke. Filling in can only convert a guaranteed no-score into a
  // score, so it is worth doing — but only on a verdict big enough to trust.
  if ((verdict.displacement ?? 0) < TRUST_DISPLACEMENT) return ringKeeps(null, false)
  return { dir: cameraDir, source: "camera", disagreed: false }
}

// Stateless form, kept for callers that fuse a single stroke with no history — the left hand's
// palm gestures, which are far rarer than beats and never accumulate a meaningful rate.
export function fuseDirection(ringDir, verdict) {
  return decide(ringDir, verdict, false)
}
