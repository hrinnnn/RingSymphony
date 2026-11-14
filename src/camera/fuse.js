// Decides what to do when the ring and the camera disagree about a stroke's direction, and what
// to do when only one of them has an answer.
//
// Permissive, never restrictive. There is no AND gate: requiring both sensors to agree would kill
// a beat whenever either was uncertain, which is strictly worse than having no camera at all.
//
// Pure: no DOM, no imports beyond the axis constant.
import { VERTICAL } from "./direction.js"

const ringKeeps = (dir, disagreed) => ({ dir, source: "ring", disagreed })

// `ringDir` is the ring's classification, or null when it declined. `verdict` is the camera's,
// or null when there is no camera at all. The two null cases are deliberately identical: every
// degradation path — no hardware, denied permission, lost tracking, dim room, stalled stream —
// converges here, so the fallback is one well-exercised path rather than a rare second branch.
export function fuseDirection(ringDir, verdict) {
  const cameraDir = verdict?.dir ?? null
  if (!cameraDir) return ringKeeps(ringDir ?? null, false)

  // The ring had nothing. An unclassified beat scores nothing and shows 方向不确定, so any earned
  // camera verdict is strictly better than what it replaces — on either axis. This is the common
  // case: the ring declining is far more frequent than the two sensors contradicting each other.
  if (!ringDir) return { dir: cameraDir, source: "camera", disagreed: false }

  if (ringDir === cameraDir) return ringKeeps(ringDir, false)

  // Both answers vertical is the one case the camera is justified in overruling. From
  // direction.js:37, up and down sit about 166 degrees apart in the ring's own axes, so a
  // down-stroke and the return of an up-stroke are the same rotation and no threshold separates
  // them. Deferring to the ring here is deferring to a coin flip, and overruling a coin flip
  // cannot cost accuracy in expectation.
  if (VERTICAL.includes(ringDir) && VERTICAL.includes(cameraDir)) {
    return { dir: cameraDir, source: "camera", disagreed: true }
  }

  // Everything else: left against right (95 degrees apart, with differently-shaped returns, so the
  // ring is not blind), or a cross-axis contradiction, which is not the confusion the camera is
  // justified by and more likely means one of the two is simply wrong. The ring keeps the call and
  // the disagreement is logged for later.
  return ringKeeps(ringDir, true)
}
