// Exercises real scene geometry and raycasts with only the GPU renderer stubbed.
// This does not replace a browser visual or audio playthrough.
import * as Three from 'three'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { buildChart, STUDIES } from '../src/chart.js'
import { eventsFor } from '../src/score.js'
import { PERFECT, GOOD } from '../src/judge.js'
import { laneLayout } from '../src/lane.js'
const noop = () => {}
let rendered
class TestRenderer {
  shadowMap = {}; capabilities = { getMaxAnisotropy: () => 1 }
  setPixelRatio() {} setSize() {}
  render(scene, camera) { scene.updateMatrixWorld(true); rendered = { scene, camera } }
}
globalThis.__THREE = { ...Three, WebGLRenderer: TestRenderer }
globalThis.__laneLayout = laneLayout
globalThis.window = { devicePixelRatio: 1 }
globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => noop, set: () => true }) }) }
const source = (await readFile(new URL('../src/world.js', import.meta.url), 'utf8'))
  .replace('import * as THREE from "three"', 'const THREE = globalThis.__THREE')
  .replace('import { laneLayout } from "./lane.js"', 'const laneLayout = globalThis.__laneLayout')
const { createWorld } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
let width = 1440, height = 900
const canvas = { getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }) }
const laneCanvas = { width: 1440, height: 900 }
const world = createWorld(canvas, laneCanvas)
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
for (const part of ['violin', 'flute']) {
  const cue = { kind: 'cue', part, time: 7 }
  world.spawn(cue); world.update(5.5, new Set())
  let rings = []
  scene.traverse(o => { if(o.userData.person) rings.push(o) })
  assert.equal(rings.length, part === 'violin' ? 5 : 2)
  cue.result = 'perfect'; world.update(7, new Set()); assert.ok(rings.every(r => r.parent === null))
}
console.log('Section cues: circles anchored to 5 violinists / 2 flutists, removed after judgement')
for (const direction of ['up','down']) { world.spawn({kind:'dynamics', direction, time: 9}); world.update(7.5, new Set()); world.pose('left',direction); world.update(8,new Set()) }
let pageObjects = 0; scene.traverse(o => { if (o.userData.cue || o.userData.person) pageObjects++ })
assert.equal(pageObjects, 0, 'beats and dynamics are drawn on the page overlay, not in the hall')
world.pose('left','point','flute'); world.update(8,new Set())
world.pose('right','down'); world.update(8,new Set(['violin','flute','cello','piano']))
assert.ok(world.players.filter(p=>p.userData.part === 'violin').some(p=>Math.abs(p.userData.moving.position.x)>0))
const rightHand = camera.children.find(child => child.userData.tip)
assert.ok(rightHand)
const realPerformance = globalThis.performance
let visualTime = 1000
globalThis.performance = { now: () => visualTime }
const settle = () => { for (let i = 0; i < 12; i++) world.update(8, new Set()) }
for (const [direction, axis, sign] of [['up', 'y', 1], ['down', 'y', -1], ['left', 'x', -1], ['right', 'x', 1]]) {
  visualTime += 5000; world.reset(); settle()
  const rest = rightHand.position.clone()
  world.pose('right', direction); visualTime += 150; settle()
  assert.ok((rightHand.position[axis] - rest[axis]) * sign > 0.05, `${direction} beat moves the hand ${direction} on screen`)
  assert.ok(Math.abs(rightHand.position.z - rest.z) < 1e-9, `${direction} beat never moves the hand toward or away from the player`)
}
console.log('Right hand: up / down / left / right beats move strictly in the screen plane')
const leftHand = camera.children.find(child => child.userData.fingers && !child.userData.tip)
assert.ok(leftHand)
const lanePlane = camera.children.find(child => child.material?.map?.image === laneCanvas)
assert.ok(lanePlane && !lanePlane.visible && lanePlane.material.depthTest && !lanePlane.material.depthWrite)
let laneDisposals = 0
lanePlane.material.map.addEventListener('dispose', () => { laneDisposals += 1 })
function sleeveEnds() {
  const { forearm, cuff } = leftHand.userData
  const end = (object, y) => object.localToWorld(new Three.Vector3(0, y, 0))
  return { anchor: end(forearm, -0.5), forearmEnd: end(forearm, 0.5), cuffStart: end(cuff, -0.5), cuffEnd: end(cuff, 0.5), wrist: leftHand.localToWorld(new Three.Vector3(0, -0.04, 0.012)) }
}
for (const [direction, sign] of [['up', 1], ['down', -1]]) {
  visualTime += 5000; world.reset(); settle()
  const rest = leftHand.position.clone()
  const restRotation = leftHand.rotation.x
  const anchor = sleeveEnds().anchor
  world.pose('left', direction)
  const start = visualTime
  const advance = (elapsed) => {
    while (visualTime < start + elapsed) {
      visualTime = Math.min(visualTime + 16, start + elapsed)
      world.update(8, new Set())
    }
    return (leftHand.position.y - rest.y) * sign
  }
  const early = advance(200)
  const middle = advance(450)
  const peak = advance(950)
  assert.ok(early > 0 && early < middle && middle < peak, `${direction} moves progressively rather than reaching its peak in 200 ms`)
  assert.ok(early < peak * 0.3 && peak > 0.1, `${direction} takes time to reach its full movement`)
  assert.ok((leftHand.position.y - rest.y) * sign > 0.1, `${direction} palm moves vertically on screen`)
  assert.ok(Math.abs(leftHand.position.z - rest.z) < 1e-9, `${direction} palm does not move toward or away from the player`)
  assert.ok(Math.abs(leftHand.rotation.x - restRotation) < 0.01, `${direction} moves the arm without bending the wrist`)
  assert.ok(leftHand.userData.fingers.every(finger => Math.abs(finger.rotation.x) < 0.3), `${direction} keeps the hand open`)
  const sleeve = sleeveEnds()
  assert.ok(sleeve.anchor.distanceTo(anchor) < 1e-8, `${direction} keeps the forearm anchored`)
  assert.ok(sleeve.forearmEnd.distanceTo(sleeve.cuffStart) < 1e-8 && sleeve.cuffEnd.distanceTo(sleeve.wrist) < 1e-8, `${direction} keeps the sleeve connected to the wrist`)
  assert.ok(Math.abs(sleeve.wrist.clone().project(camera).y) < 1, `${direction} keeps the wrist visible`)
  const returning = advance(1450)
  assert.ok(returning > 0 && returning < peak, `${direction} returns gradually`)
  advance(2200); settle()
  assert.ok(Math.abs(leftHand.position.y - rest.y) < 0.03, `${direction} returns to rest`)
}
visualTime += 5000; world.reset(); settle()
const leftRest = leftHand.position.clone()
world.pose('left', 'point', 'flute'); visualTime += 200; settle()
assert.ok(leftHand.position.z < leftRest.z - 0.1, 'point reaches forward')
assert.ok(leftHand.userData.fingers[0].rotation.x > -0.2 && leftHand.userData.fingers[1].rotation.x < -1, 'point extends the index finger and curls the others')
assert.ok(sleeveEnds().cuffEnd.distanceTo(sleeveEnds().wrist) < 1e-8, 'point keeps the sleeve connected to the wrist')
world.pose('left', 'point'); visualTime += 200; settle()
assert.ok(Math.abs(leftHand.position.x - leftRest.x) < 0.02, 'an untargeted point does not retain the previous target')
for (const [w, h] of [[1440, 900], [800, 600], [375, 667]]) {
  width = w; height = h
  const expectedDisposals = laneDisposals + (laneCanvas.width !== w || laneCanvas.height !== h ? 1 : 0)
  laneCanvas.width = w; laneCanvas.height = h
  world.setLevelHands(true); world.resize()
  assert.ok(lanePlane.visible && lanePlane.position.z < leftHand.position.z && lanePlane.position.z < rightHand.position.z, 'lane is in the scene behind both hands')
  visualTime += 5000; world.reset()
  for (let i = 0; i < 50; i++) world.update(8, new Set())
  assert.equal(laneDisposals, expectedDisposals, 'the lane texture is recreated exactly once when its dimensions change')
  const corner = lanePlane.localToWorld(new Three.Vector3(0.5, 0.5, 0)).project(camera)
  assert.ok(Math.abs(corner.x - 1) < 1e-8 && Math.abs(corner.y - 1) < 1e-8, 'lane plane covers the viewport after resize')
  const targets = laneLayout(width, height)
  for (const [hand, item] of [['left', leftHand], ['right', rightHand]]) {
    const projected = item.localToWorld(new Three.Vector3(0, 0.02, -0.02)).project(camera)
    const point = { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height }
    assert.ok(Math.abs(point.x - targets[hand].target.x) < 1 && Math.abs(point.y - (targets[hand].target.y + height * 0.1)) < 1, `${hand} hit target sits beyond the palm at ${width}x${height}`)
  }
}
world.setLevelHands(false)
assert.equal(lanePlane.visible, false, 'free mode hides the lane plane')
width = 1440; height = 900; world.resize()
visualTime += 5000; world.reset(); settle()
assert.ok(Math.abs(leftHand.position.x + 0.26) < 0.01 && Math.abs(rightHand.position.x - 0.4) < 0.01, 'free mode restores the original hand positions')
visualTime = 20000
world.previewRight('down')
visualTime = 20050
world.update(8, new Set())
const priorY = rightHand.position.y
visualTime = 20100
world.previewRight('down')
world.pose('right', 'down')
world.update(8, new Set())
const strokeDepth = Math.sin(Math.pow(0.1 / 0.46, 0.36) * Math.PI)
assert.ok(Math.abs(rightHand.position.y - (priorY + (-0.35 - 0.22 * strokeDepth - priorY) * 0.5)) < 1e-8, 'repeated preview and matching confirmed beat do not restart the hand animation')
globalThis.performance = realPerformance
console.log('Hand gestures and active musician animation: pass')
world.reset(); let cueCount=0; scene.traverse(o=>{if(o.userData.cue||o.userData.person)cueCount++}); assert.equal(cueCount,0)
width=390; height=844; world.resize(); world.update(0,new Set())
for (const player of world.players) {
  const pos = player.position.clone().add(new Three.Vector3(0, 1.3, 0)).project(camera)
  assert.ok(Math.abs(pos.x) < 1 && Math.abs(pos.y) < 1, 'Portrait orchestra framing')
}
console.log('Replay cleanup and portrait resize: pass')
const chart = buildChart()
assert.equal(chart.bpm,80); assert.equal(chart.meter,4); assert.equal(chart.bars,8); assert.equal(chart.countIn,3)
assert.equal(chart.cues.filter(c=>c.kind==='beat').length,32)
// Every left-hand cue shares its moment with a right-hand beat, so the player tracks one grid
// rather than two: entries now land on the bar line instead of half a beat ahead of it.
assert.equal(chart.cues.find(c=>c.part==='violin').time,9)
assert.equal(chart.cues.find(c=>c.part==='flute').time,15)
assert.equal(chart.cues.find(c=>c.kind==='dynamics'&&c.direction==='up').time,18)
assert.equal(chart.cues.find(c=>c.kind==='dynamics'&&c.direction==='down').time,22.5)
for (const cue of chart.cues.filter(c=>c.hand==='left')) {
  assert.ok(chart.cues.some(c=>c.hand==='right'&&Math.abs(c.time-cue.time)<1e-9),
    `left-hand ${cue.kind} at ${cue.time}s must share a beat with a right-hand cue`)
}
assert.equal(PERFECT,.12); assert.equal(GOOD,.25)
console.log('Chart I, cue positions, 120 ms / 250 ms windows: pass')
for (const study of STUDIES) {
  const built = buildChart(study)
  const events = eventsFor(study)
  const seconds = (time) => { const [bar, beat] = time.split(':').map(Number); return (bar * study.meter + beat) * built.beat }
  const beats = built.cues.filter(c => c.kind === 'beat')
  const sounding = (c, parts) => events.some(e => parts.includes(e.part) && Math.abs(seconds(e.time) - c.time) < 1e-9)
  assert.ok(beats.every(c => sounding(c, ['piano'])), `${study.id}: every right-hand cue lands on a piano chord`)
  assert.ok(beats.every(c => sounding(c, ['kick', 'tick'])), `${study.id}: every right-hand cue lands on an audible pulse`)
  assert.ok(events.filter(e => e.time.startsWith('0:')).every(e => e.part === 'tick'), `${study.id}: the count-in is pulse only`)
  assert.equal(events.filter(e => e.part === 'tick' && e.time.startsWith('0:')).length, study.meter, `${study.id}: one count-in click per beat`)
  for (const c of built.cues.filter(c => c.kind === 'cue')) {
    const bars = (c.time - built.countIn) / (study.meter * built.beat)
    assert.ok(Math.abs(bars - Math.round(bars)) < 1e-9, `${study.id}: ${c.part} is cued on the bar line`)
  }
  // Both hands act together: a left-hand cue always shares its moment with a right-hand beat,
  // so the player counts one grid instead of two.
  for (const c of built.cues.filter(c => c.hand === 'left')) {
    assert.ok(beats.some((b) => Math.abs(b.time - c.time) < 1e-9),
      `${study.id}: left-hand ${c.kind} at ${c.time.toFixed(3)}s shares a beat with a right-hand cue`)
  }
}
console.log('Every level: cues sit on audible pulses and piano chords, count-in is pulse only')
