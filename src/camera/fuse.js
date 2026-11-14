// Decides what to do when the ring and the camera disagree about a stroke's direction, and what
// to do when only one of them has an answer.
//
// Permissive, never restrictive. There is no AND gate: requiring both sensors to agree would kill
// a beat whenever either was uncertain, which is strictly worse than having no camera at all.
//
// Pure: no DOM, no imports.

const ringKeeps = (dir, disagreed) => ({ dir, source: "ring", disagreed })

// Below this the camera is reading a stroke's edges, not its body, and is wrong often enough to be
// worse than nothing: measured over 64 labelled strokes it was right 4/6 below 0.05 and 30/32
// between 0.05 and 0.1, against a ring that was right 60/60.
const TRUST_DISPLACEMENT = 0.08

// `ringDir` is the ring's classification, or null when it declined. `verdict` is the camera's,
// or null when there is no camera at all. The two null cases are deliberately identical: every
// degradation path — no hardware, denied permission, lost tracking, dim room, stalled stream —
// converges here, so the fallback is one well-exercised path rather than a rare second branch.
export function fuseDirection(ringDir, verdict) {
  const cameraDir = verdict?.dir ?? null
  if (!cameraDir) return ringKeeps(ringDir ?? null, false)

  // The ring answers, so the ring decides. This reverses an earlier decision, and the reversal is
  // the only part of this design backed by data rather than geometry.
  //
  // The argument for overruling was that up and down sit 166 degrees apart in the ring's own axes
  // (direction.js:37), so no threshold could separate a down-stroke from an up-stroke's return,
  // and deferring to the ring was deferring to a coin flip. The geometry is real. The conclusion
  // did not survive contact with a calibrated ring: over two labelled sessions, 64 strokes,
  //
  //     ring    60/60 correct when it answered
  //     camera  46/51 correct when it answered
  //
  // and every one of the three overrides took a CORRECT ring answer and made it wrong. Zero were
  // fixed. The coin flip was hypothetical; the camera's errors were not.
  //
  // What changed between the two is calibration. The ring was blind on vertical while its stored
  // calibration was missing its gyro bias — a ~0.78 rad/s offset that tilts a stroke's feature by
  // up to 27 degrees. With that fixed the ring is not blind, so there is no coin flip to beat.
  if (ringDir) return ringKeeps(ringDir, ringDir !== cameraDir)

  // The ring declined. Filling in can only convert a guaranteed no-score into a score, so it is
  // still worth doing — but only on a verdict big enough to trust. Both fill-ins in the measured
  // sessions were wrong, at displacements of 0.036 and 0.055, which is the camera reading the
  // start or end of a stroke rather than its body.
  if ((verdict.displacement ?? 0) < TRUST_DISPLACEMENT) return ringKeeps(null, false)
  return { dir: cameraDir, source: "camera", disagreed: false }
}
