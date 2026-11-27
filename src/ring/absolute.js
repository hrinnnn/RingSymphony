// Direction classification in the gravity frame, with no calibration.
//
// The rest of the ring code classifies a stroke by comparing its rotation axis against templates
// the player recorded by waving in each direction. That comparison happens in the ring's *own*
// axes, and it carries a premise stated in direction.js and main.js: that up and down sit about
// 166 degrees apart there, so the ring simply cannot tell them apart and the camera must.
//
// That premise is true of the device axes and false of the ring. The ring also has an
// accelerometer, and gravity is an absolute vertical reference that the device axes do not carry.
// Measured over the 160 labelled strokes in recordings/方向 (three wearers), the sign of the
// hand's linear acceleration along gravity separates up from down on 80 of 81 vertical strokes —
// 99%. Nothing about that needs a template.
//
// The same reframing removes the need for calibration altogether. Templates differ sharply between
// wearers in device axes, which is what made them necessary; but that variation *is* the ring's
// orientation on the finger, and projecting onto gravity divides it out. In the gravity frame the
// same stroke lands in the same place for everyone:
//
//     left   yaw +0.89 … +0.99     right  yaw −0.60 … −0.96     (median, per wearer)
//
// So two fixed numbers do what twelve calibration waves were doing:
//
//     wearer      strokes   correct
//     ash           66        66     100%
//     alex          49        47      96%
//     cn            45        41      91%
//     all          160       155      97%      (1 misclassified, 4 declined)
//
// against 70% for the calibrated path over the four gameplay logs it was diagnosed on. The
// thresholds were picked on the single-direction recordings and then checked against the two
// continuous alternating recordings, which had no hand in choosing them: 10/10 and 8/8.
//
// Pure: no DOM, no storage, no clock. Same code in the browser and in the Node tests.

const G = 9.81

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (v) => Math.hypot(v[0], v[1], v[2])

function unit(vector) {
  const length = norm(vector)
  return length > 1e-6 ? vector.map((value) => value / length) : null
}

// How much of the motion must lie on one axis before it is called. Swept over the labelled set:
//
//     0.3   correct 156   wrong 1   declined 3
//     0.4   correct 155   wrong 1   declined 4
//     0.5   correct 154   wrong 1   declined 5
//     0.6   correct 144   wrong 8   declined 8
//
// Flat below 0.5 and falling sharply above it, so 0.4 sits inside the plateau rather than on its
// edge. The cost of going lower is not visible here but is real: a smaller bar admits more of the
// diagonal, half-committed motions that are not strokes at all.
//
// Lowered to 0.3 once the drive window below stopped diluting the vertical reading: with a clean
// measurement the remaining declines were strokes sitting just under the bar, not ambiguous ones.
export const AXIS_FLOOR = 0.3

// The vertical reading is taken over the part of the approach where the hand is still being driven,
// ending `DRIVE_END` before the peak rather than at it.
//
// A stroke is two phases, not one: the hand accelerates into the motion and then brakes to stop.
// Both are inside a window that ends at the peak, and they have opposite sign, so averaging across
// the whole of it subtracts the brake from the drive. Traced through one up-stroke (up_ash), the
// vertical acceleration runs +27 at the height of the drive, crosses zero 20ms before the peak and
// reaches −8 by the peak itself, continuing to −23 after it.
//
// The mean survives that on a recording where the drive dominates. It does not survive a stroke
// whose peak arrives a little later in the window, where the two halves cancel — which is what the
// logs from three played sessions showed: `up` classified on 7 of 23 cues, 13 declined as
// 动作方向不明确, and every one of those declines on a beat the detector had already called `strong`.
// A big, confident motion that the direction stage could not read is the signature of cancellation,
// not of a weak stroke.
//
// Ending the window before the brake starts measures the drive alone. Over the labelled set:
//
//     mean through the peak (was)   158/164   1 wrong   5 declined
//     drive window only             162/164   1 wrong   1 declined
//
// and 10/10, 8/8 on the two continuous alternating recordings, which had no part in choosing it.
const DRIVE_END = 0.04
const DRIVE_MIN_FRAMES = 3

// A stroke and the arm coming back are the same rotation reversed, so a return classifies as the
// exact opposite direction. In the gravity frame that is a complete test on its own — it needs no
// template, no `rise` proxy and, unlike the geometric filter in direction.js, no *classified*
// predecessor. Measured on the alternating recordings every stroke→return pair was an exact
// reversal (right→left ×9, up→down ×8).
//
// The window comes from the same recordings: stroke→return gaps run 0.34s min, 0.36s median, 0.41s
// p90. 0.46 keeps the 95% that land inside it while staying under one beat at any tempo the game
// charts (0.5s at 120bpm), so a genuine next-beat stroke is never mistaken for a return.
export const REVERSAL_WINDOW = 0.46

const OPPOSITE = { down: "up", up: "down", left: "right", right: "left" }

// Mean gravity direction and mean linear acceleration over the approach to a peak, both in the
// ring's own axes. The caller supplies frames carrying `up`, the gravity estimate the detector
// already maintains — recomputing it here would mean running a second filter over the same data.
export function gravityFrame(frames, peakTime, window = 0.15, driveEnd = DRIVE_END) {
  const slice = frames.filter((frame) => frame.t >= peakTime - window && frame.t <= peakTime && frame.up)
  if (slice.length < 5) return null
  const mean = (pick) => {
    const sum = [0, 0, 0]
    for (const frame of slice) {
      const value = pick(frame)
      for (let axis = 0; axis < 3; axis += 1) sum[axis] += value[axis] / slice.length
    }
    return sum
  }
  const gravity = unit(mean((frame) => frame.up))
  if (!gravity) return null
  // Rotation is read over the whole approach: it does not reverse the way acceleration does, so
  // the extra frames only steady it.
  const rotation = unit(mean((frame) => frame.gyr))
  if (!rotation) return null
  // Gravity removed: what is left is the hand being driven, which is what carries up/down. Taken
  // over the drive alone — see DRIVE_END — so the brake into the peak cannot cancel it.
  const drive = slice.filter((frame) => frame.t <= peakTime - driveEnd)
  let linear = null
  let linMag = 0
  if (drive.length >= DRIVE_MIN_FRAMES) {
    const sum = [0, 0, 0]
    for (const frame of drive) {
      for (let axis = 0; axis < 3; axis += 1) sum[axis] += (frame.acc[axis] - G * frame.up[axis]) / drive.length
    }
    linMag = norm(sum)
    linear = unit(sum)
  }
  return { gravity, linear, rotation, linMag }
}

// Which direction a stroke went, from geometry alone.
//
// Two measurements, each with a physical meaning rather than a learned one:
//
//   yaw      how much of the rotation is about the vertical axis. A horizontal sweep rotates the
//            hand about vertical; a vertical one does not. Its sign is the side swept to.
//   vertical how much of the hand's linear acceleration is along gravity, and which way.
//
export function classifyAbsolute(frame) {
  if (!frame) return { direction: null, reason: "数据不足或断帧", yaw: null, vertical: null }
  const { gravity, linear, rotation, linMag = 9.81 } = frame
  const yaw = dot(rotation, gravity)
  const vertical = linear ? dot(linear, gravity) : null
  const verticalClear = Math.abs(vertical) >= AXIS_FLOOR && Math.abs(vertical * linMag) >= 1.25
  // Linear acceleration is sensitive to braking and concurrent movement.
  // Ask it to show a larger relative advantage over the steadier yaw signal.
  const verticalWins = verticalClear && (Math.abs(yaw) < AXIS_FLOOR || Math.abs(yaw) < Math.abs(vertical) * 0.73)
  if (verticalWins) {
    return { direction: vertical > 0 ? "up" : "down", reason: null, yaw, vertical }
  }
  if (Math.abs(yaw) >= AXIS_FLOOR) {
    return { direction: yaw > 0 ? "left" : "right", reason: null, yaw, vertical }
  }
  return { direction: null, reason: "动作方向不明确", yaw, vertical }
}

// Judge the completed stroke from the motion before its peak. Measuring each frame
// against its own up vector avoids mixing device axes as the wrist rotates. A clear
// vertical impulse can resolve a moderate sideways component during an up/down stroke.
export function classifyAbsoluteStroke(frames, peakTime) {
  const features = gravityFrame(frames, peakTime)
  const base = classifyAbsolute(features)
  const approach = frames.filter(frame => frame.up && frame.t >= peakTime - 0.18 && frame.t <= peakTime)
  const sparse = approach.some((frame, i) => i > 0 && frame.t - approach[i - 1].t > 0.025)
  if (base.direction && features?.linear && (!sparse || Math.abs(base.yaw) > 0.57)) return base
  if (approach.length < 2) return base

  let yawRotation = 0
  let rotation = 0
  let drive = 0
  let driveDirection = null
  let weightedUp = 0
  let weightedMagnitude = 0
  let weight = 0
  for (const [i, frame] of approach.entries()) {
    yawRotation += dot(frame.gyr, frame.up)
    rotation += norm(frame.gyr)
    if (frame.t <= peakTime - 0.02) {
      // Weight the observed samples in the pre-peak window without extending
      // any single reading across a long interval with missing IMU data.
      const dt = Math.min(0.04, (approach[i + 1]?.t ?? peakTime - 0.02) - frame.t)
      weightedUp += (dot(frame.acc, frame.up) - G) * dt
      weightedMagnitude += norm(frame.acc.map((value, axis) => value - G * frame.up[axis])) * dt
      weight += dt
    }
    const first = approach[i - 2]
    if (!first || frame.t - first.t > 0.03 || frame.t > peakTime - 0.025) continue
    const middle = approach[i - 1]
    const vertical = (dot(first.acc, first.up) + dot(middle.acc, middle.up) + dot(frame.acc, frame.up)) / 3 - G
    // Keep the earlier of similarly strong impulses so braking does not replace the drive.
    if (Math.abs(vertical) > Math.abs(drive) * 1.2) {
      drive = vertical
      const magnitude = [first, middle, frame].reduce((sum, sample) =>
        sum + norm(sample.acc.map((value, axis) => value - G * sample.up[axis])), 0) / 3
      driveDirection = magnitude > 1e-6 ? drive / magnitude : null
    }
  }
  const yaw = rotation > 1e-6 ? yawRotation / rotation : 0
  if (!driveDirection && weight > 0 && weightedMagnitude > 1e-6) {
    drive = weightedUp / weight
    driveDirection = weightedUp / weightedMagnitude
  }
  if (Math.abs(yaw) < 0.55 && Math.abs(drive) >= 1.25) {
    return { direction: drive > 0 ? "up" : "down", reason: null, yaw, vertical: driveDirection }
  }
  if (!base.direction && Math.abs(yaw) > 0.48) {
    return { ...base, direction: yaw > 0 ? "left" : "right", reason: null, yaw }
  }
  return base
}

// Rejects the arm coming back from a stroke, by the one fact that defines it: it is the reverse of
// what just happened, and it happens soon.
//
// This is the whole return filter for the absolute path. direction.js needs three mechanisms for
// this job — a geometric reversal test, a `rise` ramp proxy and a cue-based rescue — because a
// template classification cannot say which way a stroke went in the world, only which template it
// resembles. With absolute directions the reversal is simply visible.
export function createReversalFilter() {
  let previous = null
  return {
    reset() { previous = null },
    // Read-only, for previews and for callers that have not decided to accept yet.
    isReversal(direction, time) {
      if (!direction || !previous) return false
      return time > previous.time && time - previous.time < REVERSAL_WINDOW &&
        direction === OPPOSITE[previous.direction]
    },
    // `onCue` is the chart saying it asked for this direction now. A player conducting
    // left→right→left genuinely reverses on the beat, and that is a stroke, not a return.
    // It still becomes the reference for what follows, so its own return is caught in turn.
    accept(direction, time, onCue = false) {
      if (!direction) return true
      if (!onCue && this.isReversal(direction, time)) return false
      previous = { direction, time }
      return true
    },
  }
}
