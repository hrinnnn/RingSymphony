// Turns camera hand positions into a stroke direction, or declines.
//
// This module exists because of one measured blindness in the ring. From direction.js:37: up and
// down sit about 166 degrees apart in the gyroscope's own axes, so a real down-stroke and the
// return of an up-stroke are the same motion and no threshold separates them. A camera measures
// displacement in screen coordinates, which are the same for every wearer, so up is simply up.
//
// Pure: no DOM, no MediaPipe. The tracker feeds it frames; tests feed it synthetic ones.

// The ring's direction window is 150ms (direction.js:17). This one is wider, and deliberately so:
// the ring is catching an angular-velocity peak, which is brief, while this is measuring gross
// displacement, and a conducting stroke takes 200-400ms to travel. At 30fps, 150ms holds ~4.5
// frames and roughly the last 75ms has not cleared the camera pipeline when the ring fires, which
// leaves ~2 arrived frames — one displacement vector, with no way to tell a stroke from a single
// bad landmark. 300ms leaves ~6 arrived frames, enough to fit a direction and notice an outlier.
//
// This value is tuned for ~30fps. In a dim room exposure lengthens and the rate often halves, at
// which point MIN_FRAMES declines the verdict rather than this widening to compensate: a wider
// window would start reaching back into the previous stroke.
export const CAMERA_WINDOW = 0.30

// Three, with MIN_SPAN doing the real work of rejecting a fit through too little motion.
//
// It was four, which was wrong once latency is accounted for. At 30fps a 300ms window holds ~9
// frames but only ~6 have cleared the ~75ms pipeline when the ring fires; in a dim room the rate
// often halves to 15fps, leaving ~3. Four therefore declined *every* verdict in poor light — the
// exact conditions the camera is most needed in, and a silent failure, since declining looks
// identical to having no camera.
export const MIN_FRAMES = 3

// A hand this close to a border is being clipped, so its reported position is pinned by the frame
// rather than measured. Frames like that are dropped from the measurement — not used to reject it.
// Rejecting the whole window was the first version's behaviour and it systematically killed the
// vertical verdicts the camera exists to provide: a full up-stroke on a laptop webcam reaches the
// top of the image, so one clipped frame at the end of a perfectly good stroke threw the stroke
// away. The frames before the hand left still prove which way it was going.
export const EDGE_MARGIN = 0.04

// Normalised units: ~3.5% of the frame. Below this the hand is holding still and any direction
// read out of it is noise. Magnitude doubles as the confidence measure, so there is no separate
// confidence model to keep calibrated.
export const MIN_DISPLACEMENT = 0.035

// The usable frames must cover at least this much time. This, rather than the frame count, is what
// stops two adjacent samples being fitted into a confident direction: at 30fps three frames span
// 66ms, which is a real motion, while three frames spanning 250ms with a gap in the middle are two
// unrelated observations.
export const MIN_SPAN = 0.06

// The axis the ring cannot resolve. Kept for callers that reason about the vertical pair.
export const VERTICAL = ["up", "down"]

const decline = (reason) => ({ dir: null, reason })

const usable = (frame) =>
  frame.inFrame &&
  frame.x >= EDGE_MARGIN && frame.x <= 1 - EDGE_MARGIN &&
  frame.y >= EDGE_MARGIN && frame.y <= 1 - EDGE_MARGIN

// `frames` are { t, x, y, inFrame } with x and y normalised 0-1 and y growing downward, matching
// MediaPipe. `beatTime` is on the same clock as `t` — the uncompensated page clock, because this
// asks a physical question (where was the hand) rather than a judgement one.
export function cameraDirection(frames, beatTime) {
  if (!frames || !frames.length) return decline("没有画面数据")

  // Strictly before the beat: the return stroke falls after it and must never be examined. That
  // asymmetry is what lets the camera sidestep the return-stroke problem entirely.
  const window = frames.filter((frame) => frame.t > beatTime - CAMERA_WINDOW && frame.t <= beatTime)
  if (!window.length) return decline("没有画面数据")

  // A stalled stream or a backgrounded tab leaves old frames in the buffer. They would pass the
  // count check while describing a motion from seconds ago, so the span itself has to be recent.
  if (beatTime - window[window.length - 1].t > CAMERA_WINDOW) return decline("画面数据过旧")

  // The longest unbroken run of measurable frames. A run rather than every usable frame, because
  // frames either side of a tracking dropout are two separate observations, and a displacement
  // measured across the gap would describe a motion nobody made.
  let best = []
  let run = []
  for (const frame of window) {
    if (usable(frame)) run.push(frame)
    else {
      if (run.length > best.length) best = run
      run = []
    }
  }
  if (run.length > best.length) best = run

  if (best.length < MIN_FRAMES) {
    return decline(window.some(usable) ? "画面帧数不足" : window.some((f) => f.inFrame) ? "手在画面边缘" : "手不在画面内")
  }

  const first = best[0]
  const last = best[best.length - 1]
  if (last.t - first.t < MIN_SPAN) return decline("画面帧数不足")

  // Image x grows rightward *in the image*, and the player faces the camera unmirrored, so their
  // left hand appears on the image's right. A stroke the player makes to their left therefore
  // travels toward increasing x. Flipping here — rather than mirroring the pixels — keeps
  // MediaPipe's handedness output valid, since that inverts on a mirrored image.
  const dx = first.x - last.x
  const dy = last.y - first.y
  const displacement = Math.max(Math.abs(dx), Math.abs(dy))
  if (displacement < MIN_DISPLACEMENT) return decline("位移过小")

  // The dominant component decides, which is a hard boundary at 45 degrees. A stroke the player
  // means as "up" but shapes as up-and-right sits near that boundary, and a few degrees either
  // side flips the answer between `up` and `right` with no change in intent.
  //
  // So the raw geometry travels with the verdict rather than being discarded: `angle` is the
  // stroke's direction in degrees (0 = player's right, 90 = up, measured in the player's frame,
  // not the image's), and `margin` is how far the dominant axis led the other, as a ratio of the
  // displacement. A margin near 0 means a diagonal that could have gone either way; near 1 means
  // a clean single-axis stroke. Neither changes the verdict — they make its confidence legible.
  const vertical = Math.abs(dy) >= Math.abs(dx)
  const magnitude = Math.hypot(dx, dy)
  return {
    dir: vertical ? (dy < 0 ? "up" : "down") : (dx > 0 ? "right" : "left"),
    axis: vertical ? "vertical" : "horizontal",
    displacement: vertical ? Math.abs(dy) : Math.abs(dx),
    // dy is screen-down-positive; negate so that 90 degrees means the player moved up.
    angle: Math.round((Math.atan2(-dy, dx) * 180) / Math.PI),
    margin: magnitude > 0 ? Number(((Math.abs(Math.abs(dy) - Math.abs(dx))) / magnitude).toFixed(3)) : 0,
  }
}
