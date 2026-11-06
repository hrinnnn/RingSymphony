// Desktop-control and full-level integration without a browser or audio device.
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { buildChart } from '../src/chart.js'
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
let nextFrame, pickedPart
const poses = []
const world = { resize() {}, update() {}, spawn() {}, emit() {}, reset() {}, pose(...args) { poses.push(args) }, pick() { return pickedPart }, screenPositions: () => [] }
globalThis.document = { body: makeNode(), querySelector: node, querySelectorAll: () => Array.from({length:4},makeNode), createElement: makeNode }
globalThis.window = { addEventListener: (name,fn) => keys[name]=fn, setTimeout() {}, clearTimeout() {} }
globalThis.requestAnimationFrame = fn => { nextFrame = fn }
globalThis.__controller = {
  setDynamics: value => { audio.dynamics=value }, setPart: (part,on) => { if(on)audio.parts.add(part) },
  startLevel: async () => { audio.now=0; audio.parts=new Set(['piano','cello']) }, stopLevel() {},
  startFree: async () => { audio.freeStarted = true }, endFree: fn => { audio.ended = fn },
  queuePart: (part, gain, quantum, landed) => { audio.queued.push({ part, gain, quantum, landed }) },
  setPartGain: (part, gain) => { audio.gains[part] = gain }, setTempo: bpm => { audio.tempo = bpm },
  partLevels: () => ({}), transportBeats: () => 0,
  transportSeconds: () => audio.now, buildChart, GOOD: .18, PERFECT: .08, createWorld: () => world,
  createMixerHud: () => ({ update() {} }), lassoParts, pathLength, createMixer, PART_INFO, PARTS, LOOP_BARS, createTempo,
}
const names = Object.keys(globalThis.__controller).join(',')
const source=(await readFile(new URL('../src/main.js',import.meta.url),'utf8')).replace(/^import .* from .*\n/gm,'')
await import('data:text/javascript;base64,'+Buffer.from(`const {${names}}=globalThis.__controller;\n`+source).toString('base64'))
const chart=buildChart()
const key = name => keys.keydown({key:name,preventDefault(){}})
const tick = time => { audio.now=time; nextFrame() }
const clickPart = part => {
  pickedPart=part
  node('#view').handlers.pointerdown({clientX:200,clientY:300,offsetX:200,pointerId:1})
  node('#view').handlers.pointerup({clientX:200,clientY:300,pointerId:1})
}
const [levelButton, freeButton] = node('#level-list').children
await levelButton.handlers.click()
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
tick(chart.cues[0].time+.0799); key('ArrowDown')
tick(chart.cues[1].time+.1799); key('ArrowLeft')
tick(chart.cues[2].time); key('ArrowLeft') // wrong direction
tick(chart.duration)
assert.equal(counts(),'Perfect 1 Good 1 Miss 34')
console.log('Replay resets dynamics; 80/180 ms boundaries, wrong directions and expired events: pass')
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

// Free mode: select → queued entry on the next beat → per-section dynamics → solo → stop → full close.
await node('#back').handlers.click()
await freeButton.handlers.click()
assert.ok(audio.freeStarted)
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
