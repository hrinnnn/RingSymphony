// Decides what to do when the ring and the camera disagree about a stroke's direction, and what
// to do when only one of them has an answer.
//
// Permissive, never restrictive. There is no AND gate: requiring both sensors to agree would kill
// a beat whenever either was uncertain, which is strictly worse than having no camera at all.
//
// Pure: no DOM, no imports beyond the axis constant.

const ringKeeps = (dir, disagreed) => ({ dir, source: "ring", disagreed })

// `ringDir` is the ring's classification, or null when it declined. `verdict` is the camera's,
// or null when there is no camera at all. The two null cases are deliberately identical: every
// degradation path — no hardware, denied permission, lost tracking, dim room, stalled stream —
// converges here, so the fallback is one well-exercised path rather than a rare second branch.
export function fuseDirection(ringDir, verdict) {
  const cameraDir = verdict?.dir ?? null
  if (!cameraDir) return ringKeeps(ringDir ?? null, false)

  // The ring had nothing. An unclassified beat scores nothing and shows 方向不确定, so any earned
  // camera verdict is strictly better than what it replaces. This is the common case: the ring
  // declining is far more frequent than the two sensors contradicting each other.
  if (!ringDir) return { dir: cameraDir, source: "camera", disagreed: false }

  if (ringDir === cameraDir) return ringKeeps(ringDir, false)

  // The camera wins every disagreement it has earned a verdict for.
  //
  // This started narrower — vertical only — on the reasoning that up and down sit 166 degrees
  // apart in the ring's axes while left and right sit 95, so the ring was blind on one axis and
  // merely weaker on the other. Measuring the calibrated centroids from recordings/方向 showed
  // that 95 degrees is the wrong number to look at:
  //
  //     up vs down 166   up vs right 39   down vs left 127
  //     left vs right 95   up vs left 67   down vs right 130
  //
  // A left stroke returns rightward, and that return sits 39 degrees from `up` and near `right` —
  // so when a return escapes suppression, or the player starts the next stroke without returning
  // first, a left stroke is read as 右. That is a wearer-dependent axis confusion of exactly the
  // kind screen coordinates do not have, and it is not confined to the vertical pair.
  //
  // The camera's displacement is unambiguous on both axes, and it only reaches this point having
  // satisfied the earning rule in direction.js: tracked through the window, inside the frame, and
  // past a real displacement threshold.
  return { dir: cameraDir, source: "camera", disagreed: true }
}
