// Scores what each sensor said against what the chart actually asked for.
//
// This exists because of a gap phase1-baseline.md is blunt about: the repo has no labelled dataset
// for direction accuracy, and the 24 recordings carry no video so they cannot validate the camera
// at all. But a rhythm level *is* a labelled dataset, as long as the player is conducting the
// gestures the chart asked for — the cue says "down at 3.00s", so a stroke matched to that cue is
// a sample labelled `down`. That assumption is the whole method and it is recorded with every
// session rather than left implicit, because a session where the player fumbled is not evidence
// about the sensors.
//
// Pure: no DOM, no storage. The page feeds it strokes; tests feed it synthetic ones.

// How far from a cue a stroke may land and still be taken as an attempt at it. Wider than the Good
// window (±250ms) on purpose: a stroke 300ms late is a timing error, not a different gesture, and
// counting it as "unmatched" would hide exactly the timing data this is meant to expose.
export const MATCH_WINDOW = 0.4

const DIRECTIONS = ["up", "down", "left", "right"]

const emptyMatrix = () => Object.fromEntries(DIRECTIONS.map((want) => [want, Object.fromEntries(DIRECTIONS.map((got) => [got, 0]))]))

export function createGestureLog() {
  let strokes = []
  let level = null
  let previousWant = null
  // Which classifier produced this session's strokes. Set from the first stroke that reports one,
  // since the mode cannot change mid-level (switching it resets gesture state).
  let mode = null

  return {
    // Called at level start. The chart's cues are the ground truth for everything that follows.
    begin(study, cues) {
      level = { title: study?.title ?? "?", bpm: study?.bpm ?? null, meter: study?.meter ?? null, startedAt: new Date().toISOString() }
      strokes = []
      previousWant = null
      mode = null
      this.cues = cues.filter((cue) => cue.hand === "right" && cue.kind === "beat").map((cue) => ({ time: cue.time, direction: cue.direction }))
    },

    cues: [],

    // Called for every right-hand beat that reached the game, whether or not it scored. `at` is on
    // the song clock, the same clock the cues use.
    record({ at, fused, ring, ringReason, camera, cameraReason, displacement, angle, margin, source, tier, yaw, vertical, mode: modeName, peakSpeed }) {
      if (!level) return
      if (mode === null && modeName) mode = modeName
      // The nearest unused cue, by time alone. Deliberately not by direction: matching on
      // direction would quietly discard every misread, which is the thing being measured.
      let best = null
      for (const cue of this.cues) {
        const gap = Math.abs(at - cue.time)
        if (gap <= MATCH_WINDOW && (!best || gap < best.gap)) best = { cue, gap }
      }
      const from = previousWant
      if (best) previousWant = best.cue.direction
      strokes.push({
        at: Number(at.toFixed(3)),
        want: best?.cue.direction ?? null,
        offset: best ? Number((at - best.cue.time).toFixed(3)) : null,
        fused: fused ?? null,
        ring: ring ?? null,
        ringReason: ringReason ?? null,
        camera: camera ?? null,
        cameraReason: cameraReason ?? null,
        displacement: displacement == null ? null : Number(displacement.toFixed(3)),
        angle: angle ?? null,
        margin: margin ?? null,
        // What the chart asked for on the PREVIOUS beat. A conductor shapes each stroke from where
        // the last one left their hand, so "up after left" and "up after up" are different
        // motions, and only the pairing makes that visible.
        from,
        source: source ?? null,
        tier: tier ?? null,
        // The absolute classifier's two measurements, rounded to the precision that is meaningful
        // for a unit projection. These are what the verdict was actually made from: `yaw` is how
        // much of the rotation was about the vertical axis (+left/−right) and `vertical` how much
        // of the hand's drive was along gravity (+up/−down). A stroke that failed is only
        // diagnosable with them — "declined at 0.28" and "called right at −0.71" are different
        // problems. Null in template mode, which produces no such numbers.
        yaw: yaw == null ? null : Number(yaw.toFixed(3)),
        vertical: vertical == null ? null : Number(vertical.toFixed(3)),
        peakSpeed: peakSpeed == null ? null : Number(peakSpeed.toFixed(2)),
      })
    },

    strokes: () => strokes.map((stroke) => ({ ...stroke })),

    // Per-sensor accuracy over the strokes that matched a cue, plus the timing distribution. Each
    // sensor is scored only on the strokes where it offered an answer, and the count is reported
    // alongside — a sensor that answers twice and is right both times is not more accurate than
    // one that answers forty times and is right thirty-five.
    summary() {
      const matched = strokes.filter((stroke) => stroke.want)
      const score = (key) => {
        const answered = matched.filter((stroke) => stroke[key])
        const right = answered.filter((stroke) => stroke[key] === stroke.want).length
        return { answered: answered.length, right, silent: matched.length - answered.length }
      }
      const offsets = matched.map((stroke) => stroke.offset).sort((a, b) => a - b)
      const confusion = emptyMatrix()
      for (const stroke of matched) if (stroke.ring) confusion[stroke.want][stroke.ring] += 1
      // Why the camera stayed silent, which is the difference between "move back from the camera"
      // and "the room is too dark".
      const silence = {}
      for (const stroke of matched) if (!stroke.camera && stroke.cameraReason) silence[stroke.cameraReason] = (silence[stroke.cameraReason] ?? 0) + 1
      // The same for the ring. Measured so far, every stroke it declined was early — mean -124ms
      // against +6ms for the ones it classified — so the reason is what distinguishes a detector
      // warmup from a direction window that could not be filled.
      const ringSilence = {}
      for (const stroke of matched) if (!stroke.ring && stroke.ringReason) ringSilence[stroke.ringReason] = (ringSilence[stroke.ringReason] ?? 0) + 1
      // Accuracy per transition: what the previous cue asked for, then what this one did. A
      // conductor shapes each stroke from where the last one left their hand, so an `up` after a
      // `left` is a different motion from an `up` after an `up` - the first tends to cut back
      // toward centre and arrive diagonal. If detection is failing on specific pairs rather than
      // uniformly, that is the shape of the problem and no per-direction total will show it.
      const transitions = {}
      for (const stroke of matched) {
        if (!stroke.from) continue
        const key = `${stroke.from}->${stroke.want}`
        const row = transitions[key] ??= { n: 0, ringRight: 0, ringSilent: 0, cameraRight: 0, cameraSilent: 0, angles: [], margins: [] }
        row.n += 1
        if (!stroke.ring) row.ringSilent += 1
        else if (stroke.ring === stroke.want) row.ringRight += 1
        if (!stroke.camera) row.cameraSilent += 1
        else if (stroke.camera === stroke.want) row.cameraRight += 1
        if (stroke.angle != null) row.angles.push(stroke.angle)
        if (stroke.margin != null) row.margins.push(stroke.margin)
      }
      for (const row of Object.values(transitions)) {
        // The mean of a set of angles is meaningless across the +-180 wrap, so average the unit
        // vectors instead and read the direction back off the result.
        if (row.angles.length) {
          const x = row.angles.reduce((sum, a) => sum + Math.cos((a * Math.PI) / 180), 0)
          const y = row.angles.reduce((sum, a) => sum + Math.sin((a * Math.PI) / 180), 0)
          row.meanAngle = Math.round((Math.atan2(y, x) * 180) / Math.PI)
          // How tightly the strokes agree, 0 to 1. A low value means the player shaped that
          // transition differently each time, which no threshold can rescue.
          row.consistency = Number((Math.hypot(x, y) / row.angles.length).toFixed(2))
        }
        if (row.margins.length) row.meanMargin = Number((row.margins.reduce((a, b) => a + b, 0) / row.margins.length).toFixed(2))
        delete row.angles
        delete row.margins
      }

      // Strokes the camera called within 15 degrees of the 45-degree boundary between two
      // directions: a few degrees either way flips the verdict with no change in intent.
      const nearBoundary = matched.filter((s) => s.margin != null && s.margin < 0.26)
      // What the classifier measured, grouped by what the chart asked for. This is the view that
      // says *why* a direction is failing rather than just how often: a direction whose strokes
      // cluster just under the accept bar needs a different fix from one whose strokes point
      // confidently the wrong way, and the per-direction accuracy alone cannot tell them apart.
      //
      // `axis` is whichever measurement decided the verdict — yaw for a horizontal call, vertical
      // for a vertical one — so "how close was this to being read correctly" is one number.
      const axes = {}
      for (const stroke of matched) {
        if (stroke.yaw == null && stroke.vertical == null) continue
        const row = axes[stroke.want] ??= { n: 0, yaw: [], vertical: [], nearMiss: 0, confident: 0 }
        row.n += 1
        if (stroke.yaw != null) row.yaw.push(stroke.yaw)
        if (stroke.vertical != null) row.vertical.push(stroke.vertical)
        if (stroke.ring === stroke.want) continue
        // The decisive measurement for the direction the chart wanted. A left/right cue is decided
        // on yaw, an up/down cue on vertical.
        const decisive = stroke.want === "left" || stroke.want === "right" ? stroke.yaw : stroke.vertical
        if (decisive == null) continue
        const wanted = stroke.want === "left" || stroke.want === "up" ? 1 : -1
        // Right sign, too small to clear the bar: the stroke was read correctly but faintly, and a
        // lower threshold would have scored it.
        if (Math.sign(decisive) === wanted && Math.abs(decisive) < 0.3) row.nearMiss += 1
        // Wrong sign and not faint: the measurement genuinely pointed the other way, which no
        // threshold can fix — that is the motion or the frame, not the bar.
        else if (Math.sign(decisive) !== wanted && Math.abs(decisive) >= 0.3) row.confident += 1
      }
      const median = (list) => {
        if (!list.length) return null
        const sorted = [...list].sort((a, b) => a - b)
        return Number(sorted[Math.floor(sorted.length / 2)].toFixed(3))
      }
      for (const [want, row] of Object.entries(axes)) {
        axes[want] = {
          n: row.n,
          medianYaw: median(row.yaw),
          medianVertical: median(row.vertical),
          // Failures that a lower accept bar would have rescued.
          nearMiss: row.nearMiss,
          // Failures where the measurement pointed the wrong way outright.
          confidentlyWrong: row.confident,
        }
      }

      return {
        level,
        // Which classifier produced these numbers. A session's accuracy is uninterpretable without
        // it, since the two paths fail in entirely different ways.
        mode: mode ?? null,
        cues: this.cues.length,
        transitions,
        axes,
        nearBoundary: {
          count: nearBoundary.length,
          cameraRight: nearBoundary.filter((s) => s.camera === s.want).length,
          cameraAnswered: nearBoundary.filter((s) => s.camera).length,
        },
        strokes: strokes.length,
        matched: matched.length,
        unmatched: strokes.length - matched.length,
        missedCues: this.cues.length - new Set(matched.map((stroke) => stroke.want && Math.round(stroke.at * 1000))).size,
        ring: score("ring"),
        camera: score("camera"),
        fused: score("fused"),
        confusion,
        cameraSilence: silence,
        ringSilence,
        timing: offsets.length ? {
          median: Number(offsets[Math.floor(offsets.length / 2)].toFixed(3)),
          mean: Number((offsets.reduce((sum, value) => sum + value, 0) / offsets.length).toFixed(3)),
          earliest: offsets[0],
          latest: offsets[offsets.length - 1],
          // Spread matters more than the mean: a consistent lateness is one compensation slider
          // away from fixed, while a wide spread is not correctable by any single offset.
          spread: Number((offsets[offsets.length - 1] - offsets[0]).toFixed(3)),
        } : null,
      }
    },

    toJSON() {
      return JSON.stringify({
        version: 1,
        exported: new Date().toISOString(),
        // Stated with the data, not just in the docs: every conclusion drawn from this assumes the
        // player conducted what the chart asked for. A fumbled run looks exactly like a sensor
        // failure here, and only the player knows which it was.
        assumption: "每个击拍按谱面要求的方向完成。若演奏时动作本身出错，本记录无法区分是传感器误判还是动作失误。",
        summary: this.summary(),
        strokes,
      }, null, 2)
    },
  }
}
