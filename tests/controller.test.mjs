// Desktop-control and full-level integration without a browser or audio device.
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { buildChart } from '../src/chart.js'
const nodes = new Map()
const makeNode = () => ({
  hidden: false, textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { toggle() {} },
  handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn },
  append(child) { this.child = child }, setPointerCapture() {}, clientWidth: 1200,
})
for (const id of ['status','home','play','result','hint','grade','view','level-list','accuracy','counts','progress-fill','cue-hint','tally','retry','back']) nodes.set('#'+id,makeNode())
const keys = {}, audio = { now: 0, parts: new Set(), dynamics: 1 }
let nextFrame, pickedPart
const poses = []
const world = { resize() {}, update() {}, spawn() {}, reset() {}, pose(...args) { poses.push(args) }, pick() { return pickedPart } }
globalThis.document = { body: makeNode(), querySelector: id => nodes.get(id), querySelectorAll: () => Array.from({length:4},makeNode), createElement: makeNode }
globalThis.window = { addEventListener: (name,fn) => keys[name]=fn, setTimeout() {} }
globalThis.requestAnimationFrame = fn => { nextFrame = fn }
globalThis.__controller = {
  setDynamics: value => { audio.dynamics=value }, setPart: (part,on) => { if(on)audio.parts.add(part) },
  startLevel: async () => { audio.now=0; audio.parts=new Set(['piano','cello']) }, stopLevel() {},
  transportSeconds: () => audio.now, buildChart, GOOD: .18, PERFECT: .08, createWorld: () => world,
}
const source=(await readFile(new URL('../src/main.js',import.meta.url),'utf8')).replace(/^import .* from .*\n/gm,'')
await import('data:text/javascript;base64,'+Buffer.from('const {setDynamics,setPart,startLevel,stopLevel,transportSeconds,buildChart,GOOD,PERFECT,createWorld}=globalThis.__controller;\n'+source).toString('base64'))
const chart=buildChart()
const key = name => keys.keydown({key:name,preventDefault(){}})
const tick = time => { audio.now=time; nextFrame() }
const clickPart = part => {
  pickedPart=part
  nodes.get('#view').handlers.pointerdown({clientX:200,clientY:300,offsetX:200,pointerId:1})
  nodes.get('#view').handlers.pointerup({clientX:200,clientY:300,pointerId:1})
}
await nodes.get('#level-list').child.handlers.click()
for(const cue of chart.cues){
 tick(cue.time)
 if(cue.kind==='beat') key({down:'ArrowDown',up:'ArrowUp',left:'ArrowLeft',right:'ArrowRight'}[cue.direction])
 else if(cue.kind==='cue') clickPart(cue.part)
 else key(cue.direction==='up'?'E':'D')
}
tick(chart.duration)
assert.equal(nodes.get('#accuracy').textContent,'100%')
assert.equal(nodes.get('#counts').textContent,'Perfect 36    Good 0    Miss 0')
assert.equal(nodes.get('#tally').textContent,'3600')
assert.ok(audio.parts.has('violin') && audio.parts.has('flute'))
assert.equal(audio.dynamics,.7)
assert.ok(poses.some(p=>p[0]==='left'&&p[1]==='point'&&p[2]==='violin'))
console.log('Full 36-event level via arrow keys, musician clicks and E/D: 100%, both parts enabled, dynamics applied')
await nodes.get('#retry').handlers.click()
assert.equal(audio.dynamics,1)
tick(chart.cues[0].time+.0799); key('ArrowDown')
tick(chart.cues[1].time+.1799); key('ArrowLeft')
tick(chart.cues[2].time); key('ArrowLeft') // wrong direction
tick(chart.duration)
assert.equal(nodes.get('#counts').textContent,'Perfect 1    Good 1    Miss 34')
console.log('Replay resets dynamics; 80/180 ms boundaries, wrong directions and expired events: pass')
await nodes.get('#retry').handlers.click()
const swipe=(x,y,dx,dy)=>{
 nodes.get('#view').handlers.pointerdown({clientX:x,clientY:y,offsetX:x,pointerId:2})
 nodes.get('#view').handlers.pointerup({clientX:x+dx,clientY:y+dy,pointerId:2})
}
tick(chart.cues[0].time); swipe(900,300,0,70)
assert.equal(nodes.get('#tally').textContent,'0100')
tick(chart.cues[1].time); swipe(200,300,-70,0)
assert.equal(nodes.get('#tally').textContent,'0100')
swipe(900,300,-70,0)
assert.equal(nodes.get('#tally').textContent,'0200')
console.log('Right-half swipes score directional beats; left-half horizontal swipes do not: pass')
