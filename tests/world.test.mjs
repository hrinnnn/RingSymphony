// Exercises real scene geometry and raycasts with only the GPU renderer stubbed.
// This does not replace a browser visual or audio playthrough.
import * as Three from 'three'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { buildChart } from '../src/chart.js'
import { PERFECT, GOOD } from '../src/judge.js'
const noop = () => {}
let rendered
class TestRenderer {
  shadowMap = {}; capabilities = { getMaxAnisotropy: () => 1 }
  setPixelRatio() {} setSize() {}
  render(scene, camera) { scene.updateMatrixWorld(true); rendered = { scene, camera } }
}
globalThis.__THREE = { ...Three, WebGLRenderer: TestRenderer }
globalThis.window = { devicePixelRatio: 1 }
globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => noop, set: () => true }) }) }
const source = (await readFile(new URL('../src/world.js', import.meta.url), 'utf8')).replace('import * as THREE from "three"', 'const THREE = globalThis.__THREE')
const { createWorld } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
let width = 1440, height = 900
const canvas = { getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }) }
const world = createWorld(canvas)
world.resize(); world.update(0, new Set())
assert.equal(world.players.length, 13)
const { scene, camera } = rendered
let objects = 0
scene.traverse(o => { objects++; if (o.isMesh) { assert.ok(o.geometry.attributes.position); assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite)) } })
console.log('Scene construction:', objects, 'objects; 13 seated musicians; all vertices finite')
for (const player of world.players) {
  const pos = player.position.clone().add(new Three.Vector3(0, 1.3, 0)).project(camera)
  assert.ok(Math.abs(pos.x) < 1 && Math.abs(pos.y) < 1, `${player.userData.part} outside camera`)
  const part = world.pick((pos.x + 1) / 2 * width, (1 - pos.y) / 2 * height)
  assert.equal(part, player.userData.part, `Picking ${player.userData.part}`)
}
console.log('Camera projection and musician raycast picking: all 13 pass')
const findCue = cue => { let group; scene.traverse(o => { if(o.userData.cue === cue) group = o }); return group }
for (const direction of ['down', 'left', 'right', 'up']) {
  const cue = { kind: 'beat', direction, time: 3 }
  world.spawn(cue); world.update(1.5, new Set())
  const group = findCue(cue)
  const start = group.position.clone()
  world.update(3, new Set())
  assert.equal(group.position.y, 0.035)
  assert.ok(Math.abs(group.position.z + 1.65) < 1e-10)
  assert.ok(start.z < group.position.z)
  assert.ok(start.y > group.position.y)
  cue.result = 'perfect'; world.update(3.01, new Set()); assert.equal(group.parent, null)
}
console.log('All four arrow directions approach player, cross the SAME horizontal line, and clear on judgement')
for (const part of ['violin', 'flute']) {
  const cue = { kind: 'cue', part, time: 7 }
  world.spawn(cue); world.update(5.5, new Set())
  let rings = []
  scene.traverse(o => { if(o.userData.person) rings.push(o) })
  assert.equal(rings.length, part === 'violin' ? 6 : 3)
  cue.result = 'perfect'; world.update(7, new Set()); assert.ok(rings.every(r => r.parent === null))
}
console.log('Section cues: circles anchored to 6 violinists / 3 flutists, removed after judgement')
for (const direction of ['up','down']) { world.spawn({kind:'dynamics', direction, time: 9}); world.update(7.5, new Set()); world.pose('left',direction); world.update(8,new Set()) }
world.pose('left','point','flute'); world.update(8,new Set())
world.pose('right','down'); world.update(8,new Set(['violin','flute','cello','piano']))
assert.ok(world.players.filter(p=>p.userData.part === 'violin').some(p=>Math.abs(p.userData.moving.position.x)>0))
console.log('Hand gestures, dynamics ribbons and active musician animation: pass')
world.reset(); let cueCount=0; scene.traverse(o=>{if(o.userData.cue||o.userData.person)cueCount++}); assert.equal(cueCount,0)
width=390; height=844; world.resize(); world.update(0,new Set())
for (const player of world.players) {
  const pos = player.position.clone().add(new Three.Vector3(0, 1.3, 0)).project(camera)
  assert.ok(Math.abs(pos.x) < 1 && Math.abs(pos.y) < 1, 'Portrait orchestra framing')
}
console.log('Replay cleanup and portrait resize: pass')
const chart = buildChart()
assert.equal(chart.bpm,96); assert.equal(chart.meter,4); assert.equal(chart.bars,8); assert.equal(chart.countIn,2.5)
assert.equal(chart.cues.filter(c=>c.kind==='beat').length,32)
assert.equal(chart.cues.find(c=>c.part==='violin').time,7.1875)
assert.equal(chart.cues.find(c=>c.part==='flute').time,12.1875)
assert.equal(chart.cues.find(c=>c.kind==='dynamics'&&c.direction==='up').time,15)
assert.equal(chart.cues.find(c=>c.kind==='dynamics'&&c.direction==='down').time,18.75)
assert.equal(PERFECT,.08); assert.equal(GOOD,.18)
console.log('Original chart, cue positions, 80 ms / 180 ms windows: preserved')
