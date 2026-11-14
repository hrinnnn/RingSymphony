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

  return {
    // Called at level start. The chart's cues are the ground truth for everything that follows.
    begin(study, cues) {
      level = { title: study?.title ?? "?", bpm: study?.bpm ?? null, meter: study?.meter ?? null, startedAt: new Date().toISOString() }
      strokes = []
      this.cues = cues.filter((cue) => cue.hand === "right" && cue.kind === "beat").map((cue) => ({ time: cue.time, direction: cue.direction }))
    },

    cues: [],

    // Called for every right-hand beat that reached the game, whether or not it scored. `at` is on
    // the song clock, the same clock the cues use.
    record({ at, fused, ring, ringReason, camera, cameraReason, displacement, source, tier }) {
      if (!level) return
      // The nearest unused cue, by time alone. Deliberately not by direction: matching on
      // direction would quietly discard every misread, which is the thing being measured.
      let best = null
      for (const cue of this.cues) {
        const gap = Math.abs(at - cue.time)
        if (gap <= MATCH_WINDOW && (!best || gap < best.gap)) best = { cue, gap }
      }
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
        source: source ?? null,
        tier: tier ?? null,
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
      return {
        level,
        cues: this.cues.length,
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
