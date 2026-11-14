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

// Below this, the fit is a line through too few points to be worth overruling a sensor with.
export const MIN_FRAMES = 4

// A hand this close to a border is being clipped, so its reported position is pinned by the frame
// rather than measured. Vertical strokes are what the camera is for, and the bottom edge is where
// a full down-stroke leaves a laptop lid webcam's view.
export const EDGE_MARGIN = 0.04

// Normalised units: ~3.5% of the frame. Below this the hand is holding still and any direction
// read out of it is noise. Magnitude doubles as the confidence measure, so there is no separate
// confidence model to keep calibrated.
export const MIN_DISPLACEMENT = 0.035

// The axis the ring cannot resolve. Fusion treats it specially; see fuse.js.
export const VERTICAL = ["up", "down"]

const decline = (reason) => ({ dir: null, reason })

// `frames` are { t, x, y, inFrame } with x and y normalised 0-1 and y growing downward, matching
// MediaPipe. `beatTime` is on the same clock as `t` — the uncompensated page clock, because this
// asks a physical question (where was the hand) rather than a judgement one.
export function cameraDirection(frames, beatTime) {
  if (!frames || !frames.length) return decline("没有画面数据")

  // Strictly before the beat: the return stroke falls after it and must never be examined. That
  // asymmetry is what lets the camera sidestep the return-stroke problem entirely.
  const window = frames.filter((frame) => frame.t > beatTime - CAMERA_WINDOW && frame.t <= beatTime)
  if (window.length < MIN_FRAMES) return decline("画面帧数不足")

  // A stalled stream or a backgrounded tab leaves old frames in the buffer. They would pass the
  // count check while describing a motion from seconds ago, so the span itself has to be recent.
  if (beatTime - window[window.length - 1].t > CAMERA_WINDOW) return decline("画面数据过旧")

  if (window.some((frame) => !frame.inFrame)) return decline("手不在画面内")
  if (window.some((frame) => frame.x < EDGE_MARGIN || frame.x > 1 - EDGE_MARGIN ||
                             frame.y < EDGE_MARGIN || frame.y > 1 - EDGE_MARGIN)) {
    return decline("手在画面边缘")
  }

  const first = window[0]
  const last = window[window.length - 1]
  const dx = last.x - first.x
  const dy = last.y - first.y
  const displacement = Math.max(Math.abs(dx), Math.abs(dy))
  if (displacement < MIN_DISPLACEMENT) return decline("位移过小")

  // The dominant component decides. A conducting stroke always carries some of both.
  return Math.abs(dy) >= Math.abs(dx)
    ? { dir: dy < 0 ? "up" : "down", axis: "vertical", displacement: Math.abs(dy) }
    : { dir: dx > 0 ? "right" : "left", axis: "horizontal", displacement: Math.abs(dx) }
}
