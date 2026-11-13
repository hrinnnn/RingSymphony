// Desktop-control and full-level integration without a browser or audio device.
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { buildChart, STUDIES } from '../src/chart.js'
import { createMixer, PART_INFO, PARTS, DUCK } from '../src/mixer.js'
import { createTempo } from '../src/tempo.js'
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
const keys = {}, audio = { now: 0, parts: new Set(), dynamics: 1, queued: [], gains: {}, tempo: 96, ended: null, freeStarted: false }
let nextFrame, pickedPart, ringGesture, ringPreview, levelDone
let calibrationReady = true
let palmCalibrationReady = true
let palmCalibrationActive = false
let panelOpened = false
const ringLive = new Set()
const ringErrors = []
const poses = []
const previews = []
let screenPositions = []
const world = { resize() {}, update() {}, spawn() {}, emit() {}, reset() {}, setLevelHands() {}, pose(...args) { poses.push(args) }, previewRight(dir) { previews.push(dir) }, pick() { return pickedPart }, screenPositions: () => screenPositions }
const pageHits = []
const lane = { resize() {}, update() {}, reset() {}, hit: (...args) => pageHits.push(args) }
const settings = { latency: 0, close() {}, suggest(bias) { settings.bias = bias } }
globalThis.document = { body: makeNode(), querySelector: node, querySelectorAll: () => Array.from({length:4},makeNode), createElement: makeNode }
globalThis.window = { addEventListener: (name,fn) => keys[name]=fn, setTimeout() {}, clearTimeout() {} }
globalThis.requestAnimationFrame = fn => { nextFrame = fn }
globalThis.__controller = {
  setDynamics: value => { audio.dynamics=value }, setPart: (part,on) => { if(on)audio.parts.add(part) },
  startLevel: async (chart, hooks) => { audio.now=0; audio.parts=new Set(['piano','cello']); levelDone = hooks.onDone }, stopLevel() {},
  startFree: async () => { audio.freeStarted = true }, endFree: fn => { audio.ended = fn },
  queuePart: (part, gain, quantum, landed) => { audio.queued.push({ part, gain, quantum, landed }) },
  setPartGain: (part, gain) => { audio.gains[part] = gain }, setTempo: bpm => { audio.tempo = bpm },
  partLevels: () => ({}), transportBeats: () => 0,
  transportSeconds: () => audio.now, songSeconds: () => audio.now, buildChart, STUDIES, GOOD: .25, PERFECT: .12, createWorld: () => world, createLane: () => lane, createSettings: () => settings,
  startRing: ({ onGesture, onPreview }) => { ringGesture = onGesture; ringPreview = onPreview; return { reportError: error => ringErrors.push(error), clearTiming() {}, openPanel() { panelOpened = true }, input: { live: hand => ringLive.has(hand), snapshot: () => ({ direction: { ready: calibrationReady }, palmCalibration: { ready: palmCalibrationReady, active: palmCalibrationActive } }) } } },
  createMixerHud: () => ({ update() {} }), lassoParts, pathLength, createMixer, PART_INFO, PARTS, LOOP_BARS, createTempo,
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
ringPreview({ hand: 'right', dir: 'down' })
assert.deepEqual(previews, ['down'], 'right-hand preview is sent to the world during a level')
assert.equal(node('#tally').textContent, '0000', 'a preview never scores')
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
assert.ok(poses.some(p=>p[0]==='left'&&p[1]==='point'&&p[2]==='violin'))
console.log('Full 36-event level via arrow keys, musician clicks and E/D: 100%, three stars, both parts enabled, dynamics applied')
await node('#retry').handlers.click()
assert.equal(audio.dynamics,1)
tick(chart.cues[0].time+.1199); key('ArrowDown')
tick(chart.cues[1].time+.2499); key('ArrowLeft')
tick(chart.cues[2].time); key('ArrowLeft') // wrong direction
tick(chart.duration)
assert.equal(counts(),'Perfect 1 Good 1 Miss 34')
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
assert.equal(node('#tally').textContent, '0000', 'unknown direction cannot score')
const previousErrors = ringErrors.length
gesture('beat', 'right', { dir: 'up' })
assert.equal(ringErrors.length, previousErrors, 'a wrong-direction beat must not be used for latency compensation')
tick(ringStudy.duration)
assert.match(counts(), /Miss/, 'wrong direction is a miss')
assert.equal(node('#tally').textContent, '0000')
ringLive.clear()
await node('#back').handlers.click()

// Free mode: select → queued entry on the next beat → per-section dynamics → solo → stop → full close.
await node('#back').handlers.click()
await freeButton.handlers.click()
assert.ok(audio.freeStarted)
ringLive.add('left')
gesture('strike', 'left')
assert.equal(audio.queued.length, 0, 'a ring strike without a selection does not start a section')
screenPositions = [{ part: 'violin', x: 25, y: 25 }, { part: 'flute', x: 75, y: 75 }, { part: 'piano', x: 150, y: 150 }]
node('#view').handlers.pointerdown({ clientX: 0, clientY: 0, offsetX: 0, pointerId: 5 })
for (const [clientX, clientY] of [[100, 0], [100, 100], [0, 100]]) {
  node('#view').handlers.pointermove({ clientX, clientY, pointerId: 5 })
}
node('#view').handlers.pointerup({ clientX: 0, clientY: 0, pointerId: 5 })
palmCalibrationActive = true
gesture('strike', 'left')
assert.equal(audio.queued.length, 0, 'calibration movements cannot start selected sections')
palmCalibrationActive = false
gesture('strike', 'left')
assert.deepEqual(audio.queued.map(q => q.part), ['violin', 'flute'], 'ring strike starts the circled sections')
audio.queued.forEach(q => q.landed()); audio.queued = []
palmCalibrationReady = false
gesture('palm', 'left', { dir: 'up' })
assert.equal(audio.dynamics, 1, 'uncalibrated palms do not change dynamics in free mode')
palmCalibrationReady = true
gesture('palm', 'left', { dir: 'up' })
assert.equal(audio.dynamics, 1.2, 'calibrated palms control dynamics in free mode')
ringLive.clear()
await node('#back').handlers.click()
await freeButton.handlers.click()
key('f')
assert.equal(audio.queued.length, 0, 'start without a selection does nothing')
key('1'); key('3')
key('f')
assert.deepEqual(audio.queued.map(q => [q.part, q.gain, q.quantum]), [['violin', 1, '4n'], ['flute', 1, '4n']])
audio.queued.forEach(q => q.landed()); audio.queued = []
key('f'); assert.equal(audio.queued.length, 0, 'selection clears after an entry')
key('1'); key('e')
assert.equal(audio.gains.violin, 1.25)
key('s')
assert.equal(audio.gains.violin, 1.25)
assert.ok(Math.abs(audio.gains.flute - (1 - DUCK)) < 1e-9, 'accompaniment ducks while violin solos')
key('Escape'); key('s')
assert.equal(audio.gains.flute, 1, 'solo released')
let now = 1000
const realNow = performance.now.bind(performance)
performance.now = () => now
for (let i = 0; i < 8; i++) { key('ArrowDown'); now += 500 }
performance.now = realNow
assert.ok(Math.abs(audio.tempo - 120) < 3, `tempo follows 0.5 s beats (got ${audio.tempo})`)
key('3'); key('g')
assert.deepEqual(audio.queued.map(q => [q.part, q.gain]), [['flute', 0]])
audio.queued.forEach(q => q.landed()); audio.queued = []
key('g')
assert.ok(audio.ended, 'fist with nothing selected closes the whole piece')
audio.ended()
assert.equal(audio.tempo, 96)
console.log('Free mode: two sections enter on the next beat, per-section crescendo, solo ducking, tap tempo, section stop and full close: pass')
