// Desktop-control and full-level integration without a browser or audio device.
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { buildChart, STUDIES } from '../src/chart.js'
import { createConductor, FREE_BARS, FREE_BPM, FREE_METER, FREE_SCORE } from '../src/free-music.js'
import { buildPieceChart, PIECES } from '../src/repertoire.js'
import { PART_INFO, PARTS } from '../src/mixer.js'
import { createGestureLog } from '../src/ring/gesture-log.js'
import { GOOD } from '../src/judge.js'
import { lassoParts, pathLength } from '../src/lasso.js'
import { LOOP_BARS } from '../src/score.js'
const nodes = new Map()
const makeNode = () => ({
  hidden: false, textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { toggle() {} }, children: [],
  handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn },
  append(...items) { this.children.push(...items) }, setPointerCapture() {}, setAttribute() {}, clientWidth: 1200,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
})
const node = id => { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id) }
const keys = {}, audio = { now: 0, parts: new Set(), dynamics: 1, tempo: 60, ended: null, freeStarts: 0, freeStops: 0 }
let nextFrame, pickedPart, ringGesture, ringPreview, levelDone
let calibrationReady = true
let palmCalibrationReady = true
let palmCalibrationActive = false
let panelOpened = false
const ringLive = new Set()
const ringErrors = []
const poses = []
let screenPositions = []
const world = { resize() {}, update() {}, spawn() {}, emit() {}, reset() {}, setLevelHands() {}, pose(...args) { poses.push(args) }, pick() { return pickedPart }, screenPositions: () => screenPositions }
const pageHits = []
const lane = { resize() {}, update() {}, reset() {}, hit: (...args) => pageHits.push(args) }
const settings = { latency: 0, close() {}, suggest(bias) { settings.bias = bias } }
globalThis.document = { body: makeNode(), querySelector: node, querySelectorAll: () => Array.from({length:4},makeNode), createElement: makeNode }
globalThis.window = { addEventListener: (name,fn) => keys[name]=fn, setTimeout() {}, clearTimeout() {} }
globalThis.requestAnimationFrame = fn => { nextFrame = fn }
globalThis.__controller = {
  setDynamics: (value, duration) => { audio.dynamics = value; audio.dynamicsDuration = duration },
  currentDynamics: () => audio.dynamics, setFreeExpression: value => { audio.expression = value },
  setPart: (part,on) => { if(on)audio.parts.add(part) },
  startLevel: async (chart, hooks) => { audio.now=0; audio.parts=new Set(['piano','cello']); levelDone = hooks.onDone }, stopLevel() {},
  startFree: async (hooks) => {
    audio.ended = () => { audio.freeRun = null; hooks.onEnded() }
    return true
  },
  playFree: (selected) => {
    audio.freeRun = { open: new Set(selected), pending: new Map() }
    audio.freeStarts += 1
    audio.dynamics = 1
    return true
  },
  freeMix: () => audio.freeRun,
  queueFreeSections: (list, open) => {
    audio.sectionCommand = { list, open }
    return list
  },
  queueFreeSolo: (part) => { audio.soloCommand = part; return true },
  setFreeSectionDynamics: (list, direction, duration) => {
    audio.sectionDynamics = { parts: [...list], direction, duration }
  },
  endFree: () => { audio.freeStops += 1 },
  createConductor, FREE_BARS, FREE_BPM, FREE_METER, FREE_SCORE,
  createSwingEar: () => ({ hear: () => ({ accept: true }), reset() {} }),
  setTempo: (bpm, age) => { audio.tempo = bpm; audio.strokeAge = age },
  partLevels: () => ({}), transportBeats: () => 0,
  transportSeconds: () => audio.now, songSeconds: () => audio.now, buildChart, STUDIES, GOOD: .4, PERFECT: .15, createWorld: () => world, createLane: () => lane, createSettings: () => settings, startPiece: async chart => { audio.now = 0; return chart }, buildPieceChart, PIECES,
  startRing: ({ onGesture, onPreview }) => { ringGesture = onGesture; ringPreview = onPreview; return { reportError: error => ringErrors.push(error), clearTiming() {}, openPanel() { panelOpened = true }, input: { live: hand => ringLive.has(hand), snapshot: () => ({ direction: { ready: calibrationReady }, palmCalibration: { ready: palmCalibrationReady, active: palmCalibrationActive } }) } } },
  createMixerHud: () => ({ update() {} }), lassoParts, pathLength, PART_INFO, PARTS, LOOP_BARS,
  // The camera is optional and the controller must work with it absent, which is what these
  // inert stubs represent: a tracker that never has a verdict is the no-camera path.
  createCameraTracker: () => ({ verdict: () => null, framesFor: () => [], status: () => ({ state: 'off', fps: 0, hands: { left: false, right: false }, mismatch: false }), onStatus() {}, enable: async () => false, disable() {}, video: null }),
  createCameraLog: () => ({ record() {}, entries: () => [], clear() {}, toJSON: () => '{}' }),
  createCameraPanel: () => ({ render() {}, offerIfUnasked() {}, resume: async () => {} }),
  createGestureLog,
}
const names = Object.keys(globalThis.__controller).join(',')
const source=(await readFile(new URL('../src/main.js',import.meta.url),'utf8')).replace(/^import .* from .*\r?\n/gm,'')
await import('data:text/javascript;base64,'+Buffer.from(`const {${names}}=globalThis.__controller;\n`+source).toString('base64'))
const chart=buildChart()
const key = name => keys.keydown({key:name,preventDefault(){}})
const tick = time => { audio.now=time; nextFrame() }
const clickPart = part => {
  pickedPart=part
  node('#view').handlers.pointerdown({clientX:200,clientY:300,offsetX:200,pointerId:1})
  node('#view').handlers.pointerup({clientX:200,clientY:300,pointerId:1})
}
const [levelButton, threeButton, , freeButton] = node('#level-list').children
const studyButtons = node('#level-list').children
await levelButton.handlers.click()
assert.equal(ringPreview, undefined, 'the stage only reacts to confirmed gestures')
node('.ring-rerecord').open = true
tick(chart.cues[0].time); key('ArrowDown')
assert.equal(node('#tally').textContent, '0000', 'keyboard input in the supplemental dialog does not score a beat')
node('.ring-rerecord').open = false
for(const cue of chart.cues){
 tick(cue.time)
 if(cue.kind==='beat') key({down:'ArrowDown',up:'ArrowUp',left:'ArrowLeft',right:'ArrowRight'}[cue.direction])
 else if(cue.kind==='cue') clickPart(cue.part)
 else key(cue.direction==='up'?'E':'D')
}
tick(chart.duration)
const counts = () => node('#counts').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
assert.equal(node('#accuracy').textContent,'100%')
assert.equal(counts(),'Perfect 36 Good 0 Miss 0')
assert.equal(node('#tally').textContent,'3600')
assert.equal((node('#stars').innerHTML.match(/lit/g) || []).length, 3)
assert.ok(audio.parts.has('violin') && audio.parts.has('flute'))
assert.equal(audio.dynamics,.7)
assert.equal(audio.dynamicsDuration, chart.beat * 3, 'practice dynamics ramp over three beats')
assert.ok(poses.some(p=>p[0]==='left'&&p[1]==='point'&&p[2]==='violin'))
console.log('Full 36-event level via arrow keys, musician clicks and E/D: 100%, three stars, both parts enabled, dynamics applied')
await node('#retry').handlers.click()
assert.equal(audio.dynamics,1)
tick(chart.cues[0].time+.1199); key('ArrowDown')
tick(chart.cues[1].time+.2499); key('ArrowLeft')
tick(chart.cues[2].time); key('ArrowLeft') // wrong direction, but the time is exact
assert.equal(pageHits.at(-1)[3], '方向不符', 'a wrong direction has distinct feedback')
tick(chart.duration)
assert.equal(counts(),'Perfect 1 Good 2 Miss 33')
assert.match(node('#timing').innerHTML, /偏晚 2/, 'the result screen counts late hits')
assert.equal(settings.bias, null, 'two hits are too few to suggest a delay')
assert.deepEqual(pageHits.at(-1).slice(1, 2), ['miss'])
console.log('Replay resets dynamics; 120/250 ms boundaries, wrong directions, expired events and late-hit summary: pass')
await node('#retry').handlers.click()
settings.latency = 0.2
tick(chart.cues[0].time + 0.2); key('ArrowDown')
assert.equal(node('#tally').textContent, '0100', 'a 200 ms input delay setting puts a late hit back on the beat')
assert.ok(Math.abs(pageHits.at(-1)[2]) < 1e-9)
settings.latency = 0
await node('#retry').handlers.click()
const swipe=(x,y,dx,dy)=>{
 node('#view').handlers.pointerdown({clientX:x,clientY:y,offsetX:x,pointerId:2})
 node('#view').handlers.pointerup({clientX:x+dx,clientY:y+dy,pointerId:2})
}
tick(chart.cues[0].time); swipe(900,300,0,70)
assert.equal(node('#tally').textContent,'0100')
tick(chart.cues[1].time); swipe(200,300,-70,0)
assert.equal(node('#tally').textContent,'0100')
swipe(900,300,-70,0)
assert.equal(node('#tally').textContent,'0200')
console.log('Right-half swipes score directional beats; left-half horizontal swipes do not: pass')
tick(chart.cues[2].time)
node('#view').handlers.pointerdown({clientX:900,clientY:300,offsetX:900,pointerId:3})
node('#view').handlers.pointermove({clientX:900,clientY:300,pointerId:3})
assert.equal(node('#tally').textContent,'0200', 'a pointer that has not moved far enough is not a beat yet')
node('#view').handlers.pointermove({clientX:950,clientY:300,pointerId:3})
assert.equal(node('#tally').textContent,'0300', 'a swipe scores as soon as it is clearly a stroke')
node('#view').handlers.pointerup({clientX:1000,clientY:300,pointerId:3})
assert.equal(node('#tally').textContent,'0300', 'lifting the finger does not score the same swipe twice')
console.log('Swipes land on the stroke, not on release: pass')

// Rings: beats must match the cue direction; left-hand strikes answer the due entrance.
const gesture = (type, hand, extra = {}) => ringGesture({ type, hand, age: 0, ...extra })
const ringCounts = () => node('#counts').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
await node('#back').handlers.click()
ringLive.add('right')
calibrationReady = false
await levelButton.handlers.click()
assert.equal(panelOpened, true, 'an uncalibrated right ring opens the calibration panel')
assert.equal(document.body.dataset.mode, 'home', 'an uncalibrated ring cannot start a level')
ringLive.clear()
calibrationReady = true
ringLive.add('left')
palmCalibrationReady = false
await levelButton.handlers.click()
assert.equal(panelOpened, true, 'an uncalibrated left ring opens the calibration panel without requiring a right ring')
assert.equal(document.body.dataset.mode, 'home', 'an uncalibrated left ring cannot start a level')
ringLive.clear()
palmCalibrationReady = true
for (const study of STUDIES) {
  await studyButtons[STUDIES.indexOf(study)].handlers.click()
  const ringChart = buildChart(study)
  assert.equal(ringChart.meter, study.meter)
  const rests = Object.values(study.hits ?? {}).reduce((n, hits) => n + study.meter - hits.length, 0)
  assert.equal(ringChart.cues.filter(c => c.kind === 'beat').length, study.bars * study.meter - rests)
  audio.now = 0; nextFrame()
  for (const cue of ringChart.cues) {
    tick(cue.time)
    if (cue.kind === 'beat') gesture('beat', 'right', { dir: cue.direction })
    else if (cue.kind === 'cue') gesture('strike', 'left')
    else gesture('palm', 'left', { dir: cue.direction })
  }
  tick(ringChart.duration)
  assert.equal(node('#accuracy').textContent, '100%', `${study.id}: every ring cue lands`)
  assert.equal(ringCounts(), `Perfect ${ringChart.cues.length} Good 0 Miss 0`)
  assert.ok(audio.parts.has('violin') && audio.parts.has('flute'))
  await node('#back').handlers.click()
}
await studyButtons[1].handlers.click()
const ringStudy = buildChart(STUDIES[1])
tick(ringStudy.cues[0].time + 0.15); gesture('beat', 'right', { age: 0.15, dir: ringStudy.cues[0].direction })
assert.equal(node('#tally').textContent, '0100', 'event age back-dates the beat onto the cue')
assert.ok(Math.abs(ringErrors.at(-1)) < 1e-9)
tick(ringStudy.cues[1].time); gesture('palm', 'left', { dir: 'up' })
assert.equal(node('#tally').textContent, '0100', 'a palm outside a dynamics cue is ignored')
gesture('beat', 'right', { age: 0.2, dir: ringStudy.cues[1].direction })
assert.equal(node('#tally').textContent, '0150', 'a beat 0.2 s early is Good')
tick(ringStudy.cues[2].time); gesture('fist', 'left')
assert.equal(node('#result').hidden, true, 'a fist must not end a rhythm level')
gesture('fist', 'right')
assert.equal(node('#result').hidden, true, 'a fist from the right hand must not end it either')
assert.equal(node('#tally').textContent, '0150', 'a fist scores nothing')
console.log('Rings: 3/4 and 4/4 levels via ring beats/strikes/palms, latency back-dating, ignored stray palms, fist ignored: pass')

await node('#back').handlers.click()
ringLive.add('left')
await threeButton.handlers.click()
const delayedPalm = ringStudy.cues.find(cue => cue.kind === 'dynamics')
tick(delayedPalm.time + 0.45)
gesture('palm', 'left', { dir: delayedPalm.direction, age: 0.45 })
assert.equal(node('#tally').textContent, '0100', 'a delayed left-ring palm is judged at its original time before the cue expires')
ringLive.clear()

await node('#back').handlers.click()
ringLive.add('right')
await levelButton.handlers.click()
const lastBeat = chart.cues.filter(cue => cue.kind === 'beat').at(-1)
tick(chart.duration)
levelDone()
assert.equal(node('#result').hidden, true, 'the last ring beat stays open for its late detection grace')
gesture('beat', 'right', { dir: lastBeat.direction, age: chart.duration - lastBeat.time })
tick(chart.duration + 0.1)
assert.equal(node('#result').hidden, false, 'the level ends when every cue has been judged')
assert.match(ringCounts(), /Perfect 1 Good 0 Miss 35/, 'all cues are included in the results')
ringLive.clear()

// A hand with a streaming ring ignores the keyboard and mouse in the levels; the other hand still uses them.
await node('#back').handlers.click()
await threeButton.handlers.click()
ringLive.add('right')
tick(ringStudy.cues[0].time); key('ArrowDown')
assert.equal(node('#tally').textContent, '0000', 'right-hand keys are ignored while the right ring is live')
swipe(900, 300, 0, 70)
assert.equal(node('#tally').textContent, '0000', 'right-half swipes are ignored too')
gesture('beat', 'right', { dir: ringStudy.cues[0].direction })
assert.equal(node('#tally').textContent, '0100', 'the ring still scores')
const leftCue = ringStudy.cues.find(c => c.kind === 'dynamics')
tick(leftCue.time); key(leftCue.direction === 'up' ? 'E' : 'D')
assert.equal(node('#tally').textContent, '0200', 'left hand has no ring yet: keyboard still works')
ringLive.clear()
console.log('Live ring takes over its hand from keyboard and mouse; the other hand keeps them: pass')
await node('#retry').handlers.click()
ringLive.add('right')
tick(ringStudy.cues[0].time)
gesture('beat', 'right', { dir: null })
assert.equal(node('#tally').textContent, '0100', 'an unclear direction is judged on time alone')
assert.equal(pageHits.at(-1)[3], '方向未识别')
const previousErrors = ringErrors.length
await node('#retry').handlers.click()
ringLive.add('right')
tick(ringStudy.cues[0].time)
gesture('beat', 'right', { dir: 'up' })
assert.equal(ringErrors.length, previousErrors, 'a wrong-direction beat must not be used for latency compensation')
assert.equal(node('#tally').textContent, '0050', 'a wrong direction on time is Good, not a miss')
assert.equal(pageHits.at(-1)[3], '方向不符')
await node('#retry').handlers.click()
const openingRingBeat = ringStudy.cues[0]
const hitCountBeforeStray = pageHits.length
tick(openingRingBeat.time - GOOD - 0.01)
gesture('beat', 'right', { dir: openingRingBeat.direction })
assert.equal(pageHits.length, hitCountBeforeStray)
assert.equal(node('#tally').textContent, '0000', 'an early ring movement cannot use up a note')
tick(openingRingBeat.time)
gesture('beat', 'right', { dir: 'up', tier: 'weak' })
assert.equal(node('#tally').textContent, '0000', 'a weak wrong direction leaves the cue open')
gesture('beat', 'right', { dir: openingRingBeat.direction })
assert.equal(node('#tally').textContent, '0100', 'the intended beat can score after the stray input')
ringLive.clear()
await node('#back').handlers.click()

// The first beat starts the ensemble; later beats and gesture shape affect separate controls.
await node('#back').handlers.click()
await freeButton.handlers.click()
assert.equal(audio.freeStarts, 0, 'the ensemble waits for the conductor')
nextFrame()
assert.equal(node('#status').textContent, '等待起奏')

let now = 1000
const realNow = performance.now.bind(performance)
performance.now = () => now
key('ArrowDown')
assert.equal(audio.freeStarts, 1)
for (let i = 0; i < 6; i++) {
  now += 600
  key('ArrowDown')
}
assert.ok(Math.abs(audio.tempo - 100) < 2, 'keyboard conducting changes the ensemble tempo')
assert.deepEqual([...audio.freeRun.open], PARTS, 'the first beat opens all five written parts')
ringLive.add('right')
now += 600
gesture('beat', 'right', { dir: 'down', age: 0.08, angularTravel: 0.5, peakSpeed: 5, rise: 35 })
assert.equal(audio.strokeAge, 0.08)
assert.ok(audio.expression.articulation > 0.9)
now += 600
gesture('beat', 'right', { dir: 'down', age: 0.08, angularTravel: 0.65, peakSpeed: 5, rise: 85 })
assert.ok(audio.expression.articulation < 0.85)
assert.ok(audio.expression.velocity > 1)

ringLive.add('left')
palmCalibrationReady = false
gesture('palm', 'left', { dir: 'up' })
assert.equal(audio.dynamics, 1, 'uncalibrated palms do not change dynamics in free mode')
palmCalibrationReady = true
gesture('palm', 'left', { dir: 'up' })
assert.equal(audio.dynamics, 1.2, 'calibrated palms change overall dynamics over a phrase')
assert.ok(Math.abs(audio.dynamicsDuration - 180 / audio.tempo) < 1e-9)
key('1')
gesture('fist', 'left')
assert.deepEqual(audio.sectionCommand, { list: ['violin'], open: false })
key('1')
gesture('strike', 'left')
assert.deepEqual(audio.sectionCommand, { list: ['violin'], open: true })
key('4')
key('s')
assert.equal(audio.soloCommand, 'cello', 'cello can take the lead')
key('3')
key('d')
assert.equal(audio.sectionDynamics.direction, 'down')
assert.deepEqual(audio.sectionDynamics.parts, ['horn'])
key('Escape')
gesture('fist', 'left')
assert.equal(audio.freeStops, 1)
audio.ended()
nextFrame()
assert.equal(node('#status').textContent, '等待起奏')
key('f')
assert.equal(audio.freeStarts, 2, 'F starts a fresh performance after the cutoff')
ringLive.clear()
performance.now = realNow
console.log('Free ensemble: timing, expression, section cues, lead selection, and restart pass')

// Auto-compensation converges on the player's offset without oscillating, and a partial step is
// what prevents it: reportError only samples beats that landed within GOOD, so the measured mean
// understates a large offset and a full correction would overshoot.
{
  const MIN = 6, DEADZONE = 0.02, STEP = 0.6, MAX_MOVE = 0.08
  const settle = (trueBias) => {
    let comp = 0
    const seen = []
    for (let level = 0; level < 8; level += 1) {
      const residual = trueBias - comp
      const samples = []
      for (let i = 0; i < 20; i += 1) {
        const jitter = (Math.sin(i * 2.3) + Math.sin(i * 0.7)) / 2 * 0.06
        const e = residual + jitter
        if (Math.abs(e) <= 0.25) samples.push(e)
      }
      if (samples.length >= MIN) {
        const mean = samples.reduce((s, x) => s + x, 0) / samples.length
        if (Math.abs(mean) >= DEADZONE) comp += Math.max(-MAX_MOVE, Math.min(MAX_MOVE, mean * STEP))
      }
      seen.push(trueBias - comp)
    }
    return seen
  }
  const early = settle(-0.130)
  assert.ok(Math.abs(early.at(-1)) < 0.02, `a 130ms early bias must settle inside the dead zone, got ${Math.round(early.at(-1) * 1000)}ms`)
  assert.ok(Math.abs(early[3]) <= Math.abs(early[0]), 'it must improve, not diverge')
  const late = settle(0.090)
  assert.ok(Math.abs(late.at(-1)) < 0.02, `a 90ms late bias must settle too, got ${Math.round(late.at(-1) * 1000)}ms`)
  const none = settle(0.005)
  assert.equal(none.every((e) => Math.abs(e) < 0.02), true, 'a player already on time is left alone')
}

console.log('Auto-compensation: converges on the ring offset without oscillating')

const canonButton = node('#level-list').children.find(button => button.innerHTML.includes('卡农'))
await canonButton.handlers.click()
const canon = buildPieceChart(PIECES[0])
const accent = canon.cues.find(cue => cue.kind === 'beat' && cue.hand === 'both')
tick(accent.time); key('ArrowDown'); key('K')
assert.equal(pageHits.at(-1)[1], 'perfect', 'two hands complete the same accent')
const circle = canon.cues.find(cue => cue.kind === 'circle')
screenPositions = [{ part: 'violin', x: 25, y: 25 }, { part: 'flute', x: 75, y: 75 }]
tick(circle.time)
assert.match(node('#cue-hint').textContent, /^圈住.*小提琴.*长笛/)
node('#view').handlers.pointerdown({ clientX: 0, clientY: 0, offsetX: 0, pointerId: 5 })
for (const [clientX, clientY] of [[100, 0], [100, 100], [0, 100]]) {
  node('#view').handlers.pointermove({ clientX, clientY, pointerId: 5 })
}
node('#view').handlers.pointerup({ clientX: 0, clientY: 0, pointerId: 5 })
assert.deepEqual(poses.at(-1), ['left', 'circle'], 'a level lasso animates circle selection')
tick(circle.time + 0.02)
assert.doesNotMatch(node('#cue-hint').textContent, /^圈住/, 'the prompt clears when the lasso scores')
const swell = canon.cues.find(cue => cue.kind === 'dynamics')
const previousRightBeat = canon.cues.findLast(cue =>
  cue.kind === 'beat' && cue.hand !== 'left' && cue.time < swell.time)
tick(swell.time)
const lateRightBeat = Math.min(swell.time - 0.1, previousRightBeat.time + GOOD * 0.9)
gesture('beat', 'right', { dir: previousRightBeat.direction, age: swell.time - lateRightBeat })
assert.equal(pageHits.at(-1)[0].time, previousRightBeat.time, 'the right hand scored a beat just before the swell')
assert.match(node('#cue-hint').textContent, /^抬掌/)
gesture('palm', 'right', { dir: swell.direction })
assert.deepEqual(poses.at(-1), ['right', 'palm', 'up'], 'the right ring can answer a swell while the left hand conducts')
assert.ok(Math.abs(audio.dynamicsDuration - (swell.until - swell.time)) < 1e-9, 'a written swell follows the full phrase')
const cut = canon.cues.find(cue => cue.kind === 'cut')
tick(cut.time); gesture('fist', 'right')
assert.deepEqual(poses.at(-1), ['right', 'fist'], 'the hand that closes plays the cutoff')
assert.equal(pageHits.at(-1)[0].kind, 'cut')
tick(canon.duration)
await node('#retry').handlers.click()
assert.equal(node('#session-title').textContent, PIECES[0].title, 'retry reopens the same classical excerpt')
console.log('Classical modes: double accent, circle, right palm, cutoff and retry pass')
