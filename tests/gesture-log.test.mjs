// Scoring each sensor against the chart. The chart is ground truth only if the player conducted
// what it asked for, so these drive synthetic strokes where the intent is known by construction.
import assert from 'node:assert/strict'
import { createGestureLog, MATCH_WINDOW } from '../src/ring/gesture-log.js'

const study = { title: '晨光', bpm: 80, meter: 4 }
const cues = [
  { hand: 'right', kind: 'beat', time: 3.00, direction: 'down' },
  { hand: 'right', kind: 'beat', time: 3.75, direction: 'left' },
  { hand: 'right', kind: 'beat', time: 4.50, direction: 'right' },
  { hand: 'right', kind: 'beat', time: 5.25, direction: 'up' },
  { hand: 'left', kind: 'dynamics', time: 4.0, direction: 'up' },
]

// A perfect run: every sensor right, timing dead on.
{
  const log = createGestureLog()
  log.begin(study, cues)
  for (const cue of cues.filter(c => c.hand === 'right')) {
    log.record({ at: cue.time, fused: cue.direction, ring: cue.direction, camera: cue.direction, source: 'ring', tier: 'strong' })
  }
  const s = log.summary()
  assert.equal(s.cues, 4, 'only right-hand beat cues are ground truth here')
  assert.equal(s.matched, 4)
  assert.deepEqual(s.ring, { answered: 4, right: 4, silent: 0 })
  assert.deepEqual(s.camera, { answered: 4, right: 4, silent: 0 })
  assert.equal(s.timing.median, 0)
  assert.equal(s.timing.spread, 0)
}

// The case this exists to measure: the ring is wrong, the camera is right, and the fused answer
// follows the camera. Scored separately, these three tell three different stories.
{
  const log = createGestureLog()
  log.begin(study, cues)
  log.record({ at: 3.00, fused: 'down', ring: 'up', camera: 'down', source: 'camera' })
  log.record({ at: 3.75, fused: 'left', ring: 'right', camera: 'left', source: 'camera' })
  log.record({ at: 4.50, fused: 'right', ring: 'right', camera: 'right', source: 'ring' })
  log.record({ at: 5.25, fused: 'up', ring: 'up', camera: 'up', source: 'ring' })
  const s = log.summary()
  assert.deepEqual(s.ring, { answered: 4, right: 2, silent: 0 }, 'the ring got half of them wrong')
  assert.deepEqual(s.camera, { answered: 4, right: 4, silent: 0 })
  assert.deepEqual(s.fused, { answered: 4, right: 4, silent: 0 }, 'fusion recovered both misreads')
  // The confusion matrix names which way the ring erred, which is what decides the fix.
  assert.equal(s.confusion.down.up, 1, 'a down stroke read as up')
  assert.equal(s.confusion.left.right, 1, 'a left stroke read as right')
}

// A sensor that declines is not a sensor that is wrong, and conflating them would make a silent
// camera look like an accurate one.
{
  const log = createGestureLog()
  log.begin(study, cues)
  log.record({ at: 3.00, fused: 'down', ring: 'down', camera: null, cameraReason: '手在画面边缘' })
  log.record({ at: 3.75, fused: 'left', ring: 'left', camera: null, cameraReason: '手在画面边缘' })
  log.record({ at: 4.50, fused: 'right', ring: 'right', camera: 'right' })
  const s = log.summary()
  assert.deepEqual(s.camera, { answered: 1, right: 1, silent: 2 })
  assert.deepEqual(s.cameraSilence, { '手在画面边缘': 2 }, 'why it declined is the actionable part')
}

// Timing is reported as a distribution, not a single number: a consistent lateness is one slider
// away from fixed, a wide spread is not correctable by any offset.
{
  const log = createGestureLog()
  log.begin(study, cues)
  const offsets = [0.08, 0.10, 0.09, 0.11]
  cues.filter(c => c.hand === 'right').forEach((cue, i) => {
    log.record({ at: cue.time + offsets[i], fused: cue.direction, ring: cue.direction })
  })
  const s = log.summary()
  assert.ok(s.timing.mean > 0.09 && s.timing.mean < 0.10, 'consistently late')
  assert.ok(s.timing.spread <= 0.03, 'tight spread means a compensation offset would fix it')
}

// A stroke nowhere near a cue has no ground truth and must not be scored against one.
{
  const log = createGestureLog()
  log.begin(study, cues)
  log.record({ at: 3.00, fused: 'down', ring: 'down' })
  log.record({ at: 9.90, fused: 'up', ring: 'up' })
  const s = log.summary()
  assert.equal(s.matched, 1)
  assert.equal(s.unmatched, 1, 'an unmatched stroke is counted, never silently dropped')
  assert.deepEqual(s.ring, { answered: 1, right: 1, silent: 0 })
}

// Matching is by time alone. Matching on direction too would discard every misread - which is the
// one thing this must never do, since misreads are the measurement.
{
  const log = createGestureLog()
  log.begin(study, cues)
  log.record({ at: 3.02, fused: 'up', ring: 'up' })
  const s = log.summary()
  assert.equal(s.matched, 1)
  assert.equal(s.confusion.down.up, 1, 'a wrong direction near a cue is a misread, not an absence')
  assert.ok(MATCH_WINDOW > 0.25, 'the match window must exceed the Good window or late strokes vanish')
}

// The export carries the assumption it rests on, so a fumbled run is not later mistaken for data.
{
  const log = createGestureLog()
  log.begin(study, cues)
  log.record({ at: 3.00, fused: 'down', ring: 'down' })
  const parsed = JSON.parse(log.toJSON())
  assert.ok(parsed.assumption.includes('谱面'), 'the export states that the chart is only ground truth if the player followed it')
  assert.equal(parsed.strokes.length, 1)
  assert.equal(parsed.summary.level.title, '晨光')
}

console.log('gesture log tests passed')

// Why the ring declined, kept apart from why the camera did. Measured over two sessions every
// declined stroke was early - mean -124ms against +6ms for classified ones - and the reason is
// what separates a detector warmup from a direction window that could not be filled. Without it
// those four declines could not be explained at all.
{
  const log = createGestureLog()
  log.begin(study, cues)
  log.record({ at: 3.00, fused: 'down', ring: null, ringReason: '数据不足或断帧', camera: null, cameraReason: '位移过小' })
  log.record({ at: 3.75, fused: 'left', ring: null, ringReason: '数据不足或断帧', camera: 'left', displacement: 0.12 })
  log.record({ at: 4.50, fused: 'right', ring: 'right', camera: 'right', displacement: 0.12 })
  const s = log.summary()
  assert.deepEqual(s.ringSilence, { '数据不足或断帧': 2 })
  assert.deepEqual(s.cameraSilence, { '位移过小': 1 }, 'the two sensors silence separately and for different reasons')
  assert.equal(JSON.parse(log.toJSON()).strokes[0].ringReason, '数据不足或断帧', 'the per-stroke reason survives export')
}

console.log('ring silence tests passed')

// ---------- transition analysis ----------
//
// The player's hypothesis: a conductor shapes each stroke from where the last one left their hand,
// so "up after left" tends to cut back toward centre and arrive diagonal, while "up after up" is a
// clean vertical. If detection fails on specific pairs rather than uniformly, that is the shape of
// the problem, and no per-direction total can show it.
{
  const log = createGestureLog()
  log.begin(study, cues)
  // left -> up arrives diagonal (angle 55, low margin) and the camera calls it right.
  log.record({ at: 3.00, fused: 'down', ring: 'down', camera: 'down', angle: -88, margin: 0.9 })
  log.record({ at: 3.75, fused: 'left', ring: 'left', camera: 'left', angle: 178, margin: 0.88 })
  log.record({ at: 4.50, fused: 'right', ring: 'right', camera: 'right', angle: 3, margin: 0.9 })
  log.record({ at: 5.25, fused: 'up', ring: 'up', camera: 'right', angle: 44, margin: 0.02 })
  const s = log.summary()
  assert.equal(s.transitions['down->left'].n, 1)
  assert.equal(s.transitions['right->up'].n, 1)
  assert.equal(s.transitions['right->up'].cameraRight, 0, 'the diagonal up was called right')
  assert.ok(Math.abs(s.transitions['right->up'].meanAngle - 44) <= 1, 'the raw angle survives, not just the quantised direction')
  assert.ok(s.transitions['right->up'].meanMargin < 0.1, 'a near-diagonal has almost no margin between the axes')
  // The first stroke has no predecessor and must not invent one.
  assert.equal(s.transitions['null->down'], undefined)
}

// Near-boundary strokes are counted apart, because a 45-degree stroke is not a detection failure -
// it is a stroke that genuinely points between two directions.
{
  const log = createGestureLog()
  log.begin(study, cues)
  log.record({ at: 3.00, fused: 'down', ring: 'down', camera: 'down', angle: -90, margin: 0.95 })
  log.record({ at: 3.75, fused: 'left', ring: 'left', camera: 'up', angle: 130, margin: 0.05 })
  log.record({ at: 4.50, fused: 'right', ring: 'right', camera: 'right', angle: 0, margin: 0.99 })
  const s = log.summary()
  assert.equal(s.nearBoundary.count, 1, 'only the diagonal counts as near the boundary')
  assert.equal(s.nearBoundary.cameraAnswered, 1)
  assert.equal(s.nearBoundary.cameraRight, 0)
}

// Angles average correctly across the +-180 wrap, where an arithmetic mean would give 0 for two
// strokes that both went left.
{
  const log = createGestureLog()
  log.begin(study, cues)
  log.record({ at: 3.00, fused: 'down', ring: 'down', camera: 'down', angle: -90, margin: 0.9 })
  log.record({ at: 3.75, fused: 'left', ring: 'left', camera: 'left', angle: 179, margin: 0.9 })
  log.record({ at: 4.50, fused: 'right', ring: 'right', camera: 'right', angle: 0, margin: 0.9 })
  log.record({ at: 5.25, fused: 'up', ring: 'up', camera: 'up', angle: 90, margin: 0.9 })
  log.record({ at: 6.00, fused: 'down', ring: 'down', camera: 'down', angle: -90, margin: 0.9 })
  log.record({ at: 6.75, fused: 'left', ring: 'left', camera: 'left', angle: -179, margin: 0.9 })
  const s = log.summary()
  assert.ok(Math.abs(Math.abs(s.transitions['down->left'].meanAngle) - 180) <= 1,
    'two strokes at +179 and -179 average to 180, not to 0')
  assert.ok(s.transitions['down->left'].consistency > 0.99, 'and they are consistent with each other')
}

console.log('transition analysis tests passed')
