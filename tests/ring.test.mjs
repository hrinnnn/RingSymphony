// Ring pipeline without hardware: recorded IMU data → detectors → input hub → WebSocket bridge.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { startBridge } from '../bridge/server.mjs'
import { createBeatDetector, createFistDetector, createHandDetector, createGravity } from '../src/ring/detectors.js'
import { createRingInput } from '../src/ring/input.js'

const recording = async (cls, person) => {
  const raw = JSON.parse(await readFile(new URL(`../recordings/${cls}/${person}.json`, import.meta.url), 'utf8'))
  return raw.t.map((t, i) => ({ t, acc: raw.acc[i], gyr: raw.gyr[i] }))
}
const run = async (cls, person, hand) => {
  const detector = createHandDetector(hand)
  const events = []
  for (const frame of await recording(cls, person)) events.push(...detector.push(frame))
  return events
}
const count = (events, type, dir) => events.filter(e => e.type === type && (!dir || e.dir === dir)).length
const people = ['lry', 'yyh', 'zzw']

// A peak must be reported when its speed falls 20%, even if it is still above the trigger level.
{
  const detector = createBeatDetector({ beatFloor: 1.6, adaptiveFloor: false })
  const signal = [0, 0, 2, 4, 3.1, 2.5, 1, 0]
  const events = signal.map((speed, i) => detector.push(i * 0.05, speed))
  assert.equal(events.findIndex(Boolean), 4, 'peak detection must not wait for speed to drop below the trigger threshold')
  assert.ok(Math.abs(events[4].t - 0.15) < 1e-9)
}

{
  const detector = createBeatDetector({ beatFloor: 1.6, adaptiveFloor: false })
  const stroke = (start) => [0, 0, 2, 4, 1, 0].map((speed, i) => detector.push(start + i * 0.01, speed)).filter(Boolean)
  assert.equal(stroke(1).length, 1)
  detector.gap()
  assert.equal(stroke(1.18).length, 0, 'a brief data gap must not erase the beat lockout')
  assert.equal(stroke(1.5).length, 1, 'a subsequent beat outside the lockout still triggers')
}

{
  const detector = createBeatDetector({ adaptiveFloor: false, beatTravel: 0.08 })
  const stroke = (start, speeds) => speeds.map((speed, i) => detector.push(start + i * 0.005, speed)).filter(Boolean)
  assert.equal(stroke(1, [0, 2, 3, 1, 0]).length, 0, 'a small, brief movement does not reserve the beat')
  assert.equal(stroke(1.04, [0, 3, 5, 1, 0]).length, 1, 'a brisk deliberate stroke can still land right after it')
  detector.gap()
  assert.equal(stroke(1.5, [0, 2, 3, 1, 0]).length, 1, 'sparse data does not prove a small stroke')
}

// Gravity filter: a still ring reports 1 g along "up"; the gyroscope must carry that direction through a rotation.
{
  const gravity = createGravity()
  let up
  for (let i = 0; i < 200; i++) up = gravity.update([0, 0, 9.81], [0, 0, 0], 0.005)
  assert.ok(Math.abs(up[2] - 1) < 1e-6)
  const steps = 200
  for (let i = 1; i <= steps; i++) {
    // Gravity vanishes from the accelerometer (free fall) so only the gyroscope can move the estimate.
    up = gravity.update([0, 0, 0.001], [1, 0, 0], 0.005)
  }
  const expected = [0, Math.sin(1), Math.cos(1)]
  assert.ok(up[1] * expected[1] + up[2] * expected[2] > 0.99, `up after 1 rad roll ${up}`)
}

// Beats: 12 bars were recorded for each metre; every person should give roughly one peak per beat.
for (const person of people) {
  const three = count(await run('三拍', person, 'right'), 'beat')
  const four = count(await run('四拍', person, 'right'), 'beat')
  assert.ok(three >= 28 && three <= 45, `${person} 3/4 beats ${three}`)
  assert.ok(four >= 38 && four <= 58, `${person} 4/4 beats ${four}`)
}
console.log('Right ring: 3/4 and 4/4 recordings give about one beat per swing for all three people: pass')

// The same beat detector runs on the left wrist. A slow rise still reports a palm.
for (const person of people) {
  const beats = count(await run('四拍', person, 'left'), 'beat')
  assert.ok(beats >= 38 && beats <= 58, `${person} left-hand 4/4 beats ${beats}`)
  const up = await run('上升', person, 'left')
  assert.ok(count(up, 'palm', 'up') > count(up, 'palm', 'down'), `${person} left beats must not swallow a rise`)
}
console.log('Left ring: conducting strokes are beats, and a rise is still a palm: pass')

// Fist: most of the ≈10 fists per recording are found, and ordinary movement never triggers it.
for (const person of people) {
  assert.ok(count(await run('握拳', person, 'right'), 'fist') >= 4, `${person} fists`)
  for (const cls of ['三拍', '四拍', '上升', '下降', '画圈选定', '走路及日常']) {
    assert.equal(count(await run(cls, person, 'right'), 'fist'), 0, `${person} ${cls} must not look like a fist`)
  }
}
console.log('Fist: found in the fist recordings, never in beats, palms, circles or walking: pass')

{
  const detector = createFistDetector()
  const pulse = (start, confirm) => [1, 1, 4, 8].map((w, i) =>
    detector.push(start + i * 0.005, [w, 0, 0], () => confirm)).filter(Boolean)
  assert.equal(pulse(1, false).length, 0, 'a short impulse outside a cutoff cannot become a fist')
  assert.equal(pulse(1.2, true).at(-1)?.tier, 'short', 'a short impulse can answer the indicated cutoff')
}

{
  const directory = new URL('../recordings/captures-2026-11-27/', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'))
  for (const exercise of ['circle-cw', 'circle-ccw', 'arc', 'ordinary']) {
    const item = manifest.groups.find(group => group.exercise === exercise && group.finishReason === 'complete')
    const group = JSON.parse(await readFile(new URL(item.file, directory), 'utf8'))
    const stream = group.streams.left
    const events = []
    let arrival = 1
    const input = createRingInput({
      boundHands: { left: stream.device },
      WebSocketImpl: null,
      now: () => arrival,
      onEvent: event => {
        if (event.type === 'circle') events.push((arrival - event.age - 1) * 1000)
      },
    })
    input.feed({ type: 'status', rings: [{ address: stream.device, connected: true }] })
    for (let i = 0; i < stream.samples; i++) {
      arrival = 1 + stream.receivedMs[i] / 1000
      input.feed({ type: 'imu', address: stream.device, timestamp: stream.t[i], sequence: stream.sequence[i],
        acc: stream.acc[i], gyr: stream.gyr[i] })
    }
    const hits = group.trials.filter(trial => events.some(at => at >= trial.shownAtMs && at <= trial.endedAtMs)).length
    if (exercise.startsWith('circle-')) assert.ok(hits >= 6, `${exercise}: ${hits}/10 loops recognized through ring input`)
    else assert.equal(hits, 0, `${exercise}: the control samples do not select a section`)
  }
}

// Palm: stroke direction decides, the preparatory lift and the return stroke are outvoted.
for (const person of people) {
  const up = await run('上升', person, 'left')
  const down = await run('下降', person, 'left')
  assert.ok(count(up, 'palm', 'up') > count(up, 'palm', 'down'), `${person} up`)
  assert.ok(count(down, 'palm', 'down') > count(down, 'palm', 'up'), `${person} down`)
}
console.log('Left ring: rising recordings yield mostly up, falling recordings mostly down: pass')

// Input hub: roles, clock offset, latency compensation. Ring Studio lists offline rings too (as it does in real use).
{
  let clock = 100
  const events = []
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const input = createRingInput({ onEvent: e => events.push(e), now: () => clock, WebSocketImpl: null, storage })
  const status = { type: 'status', rings: [{ address: 'Z', name: 'Ringo-Z', connected: false }, { address: 'A', name: 'Ringo-A', connected: true }, { address: 'B', name: 'Ringo-B', connected: true }] }
  input.feed(status)
  assert.equal(input.live('right'), false, 'no ring is streaming yet')
  const frames = await recording('四拍', 'yyh')
  const idle = await recording('走路及日常', 'lry')
  frames.forEach((f, i) => {
    clock = 100 + f.t + 0.02
    input.feed({ type: 'imu', address: 'A', name: 'Ringo-A', timestamp: f.t, sequence: i, acc: f.acc, gyr: f.gyr })
    const g = idle[i % idle.length]
    input.feed({ type: 'imu', address: 'B', name: 'Ringo-B', timestamp: f.t, sequence: i, acc: g.acc, gyr: g.gyr })
  })
  const snap = input.snapshot()
  assert.deepEqual(snap.rings.map(r => [r.address, r.hand]), [['A', 'right'], ['B', 'left']], 'offline rings neither take a hand nor show up')
  assert.ok(input.live('right') && input.live('left'))
  const rightBeats = events.filter(e => e.type === 'beat' && e.hand === 'right')
  assert.ok(rightBeats.length > 30 && rightBeats.every(e => e.address === 'A'))
  assert.ok(events.some(e => e.type === 'beat' && e.hand === 'left' && e.address === 'B'), 'the left ring reports its own beats')
  const beats = events.filter(e => e.type === 'beat')
  assert.ok(beats.every(e => e.age >= 0 && e.age < 0.3), 'age accounts for detection lag; constant transport delay is not observable from device time alone')
  assert.equal(input.snapshot().last?.type !== undefined, true, 'last gesture is reported for the panel')
  const rightLast = input.snapshot().lastByHand.right
  assert.equal(rightLast.hand, 'right')
  assert.ok(rightLast.count > 0 && rightLast.detectionDelay >= 0, 'per-hand diagnostics include event count and detector delay')
  assert.ok(input.snapshot().lastByHand.left === null || input.snapshot().lastByHand.left.hand === 'left')
  input.compensation = 0.05
  input.swap()
  assert.equal(input.snapshot().lastByHand.right, null, 'old gestures are cleared after roles change')
  assert.deepEqual(input.snapshot().rings.map(r => [r.address, r.hand]), [['A', 'left'], ['B', 'right']])
  assert.equal(JSON.parse(store.get('ringsymphony.roles.v2')).A, 'left', 'explicit roles persist')
  clock += 3
  assert.equal(input.live('right'), false, 'a ring that stops streaming no longer counts as live')

  const restored = createRingInput({ onEvent() {}, now: () => clock, WebSocketImpl: null, storage })
  restored.feed(status)
  const send = (hub, address, sequence) => hub.feed({ type: 'imu', address, name: address, timestamp: sequence * 0.005, sequence, acc: [0, 0, 9.81], gyr: [0, 0, 0] })
  send(restored, 'B', 1); send(restored, 'A', 1)
  assert.deepEqual(restored.snapshot().rings.map(r => [r.address, r.hand]), [['A', 'left'], ['B', 'right']], 'stored roles win over arrival order')
  assert.equal(restored.compensation, 0.05)

  // Only one ring streams: after a short wait it becomes the right hand, so beats work while the left hand stays on the keyboard.
  const solo = createRingInput({ onEvent() {}, now: () => clock, WebSocketImpl: null, storage: { getItem: () => null, setItem() {} } })
  solo.feed(status)
  send(solo, 'B', 1)
  assert.equal(solo.live('right'), false, 'roles wait briefly for the other connected ring')
  clock += 0.6
  send(solo, 'B', 2)
  assert.equal(solo.live('right'), true)
  assert.equal(solo.live('left'), false)

  // Two rings that start in either order always get the same hands (by address).
  for (const order of [['A', 'B'], ['B', 'A']]) {
    const hub = createRingInput({ onEvent() {}, now: () => clock, WebSocketImpl: null, storage: { getItem: () => null, setItem() {} } })
    hub.feed(status)
    order.forEach(address => send(hub, address, 1))
    assert.deepEqual(hub.snapshot().rings.map(r => [r.address, r.hand]), [['A', 'right'], ['B', 'left']], `order ${order}`)
  }

  const bound = createRingInput({ boundHands: { left: 'B', right: 'A' }, now: () => clock, WebSocketImpl: null, storage })
  const connected = (...devices) => bound.feed({
    ...status, rings: status.rings.map(ring => ({ ...ring, connected: devices.includes(ring.address) })),
  })
  connected('Z', 'B')
  send(bound, 'Z', 1)
  send(bound, 'B', 1)
  clock += 0.6
  send(bound, 'Z', 2)
  assert.equal(bound.live('left'), true)
  assert.equal(bound.live('right'), false, 'another streaming ring cannot take the bound right hand')
  connected('Z', 'B', 'A')
  send(bound, 'A', 1)
  bound.swap()
  bound.setRole('B', 'right')
  assert.deepEqual(bound.snapshot().rings.map(r => [r.address, r.hand]), [['Z', null], ['A', 'right'], ['B', 'left']])
  connected('Z', 'B')
  assert.equal(bound.live('right'), false)
  assert.equal(bound.snapshot().rings.find(r => r.address === 'A').hand, 'right', 'an offline ring retains its binding')
  connected('Z', 'B', 'A')
  send(bound, 'A', 2)
  assert.equal(bound.live('right'), true, 'a returning ring resumes its designated role')
  assert.equal(JSON.parse(store.get('ringsymphony.roles.v2')).A, 'left', 'capture bindings do not write to normal game preferences')

  const single = createRingInput({ boundHands: { left: 'B' }, now: () => clock, WebSocketImpl: null, storage })
  single.feed(status)
  send(single, 'A', 1)
  send(single, 'B', 1)
  assert.equal(single.live('left'), true, 'single capture uses the selected hand')
  assert.equal(single.live('right'), false, 'the other hand stays available to manual input')
}
console.log('Input hub: offline rings ignored, auto left/right, swap, persisted roles and compensation, liveness, event age: pass')

{
  let time = 300
  let sequence = 0
  const events = []
  const input = createRingInput({ now: () => time, onEvent: e => events.push(e), WebSocketImpl: null, storage: { getItem: () => null, setItem() {} } })
  input.feed({ type: 'status', rings: [{ address: 'A', connected: true }] })
  function push(speed) {
    input.feed({ type: 'imu', address: 'A', timestamp: time, sequence: sequence++, acc: [0, 0, 9.81], gyr: [speed, 0, 0] })
    time += 0.005
  }
  for (let i = 0; i < 100; i++) push(0)
  function stroke() {
    for (let i = 0; i <= 20; i++) push(3 * Math.sin(Math.PI * i / 20))
  }
  stroke()
  assert.equal(count(events, 'beat'), 1)
  time += 0.06
  stroke()
  assert.equal(count(events, 'beat'), 1, 'input gap does not allow a duplicate beat inside lockout')
  for (let i = 0; i < 100; i++) push(0)
  stroke()
  assert.equal(count(events, 'beat'), 2, 'input detects the next stroke after lockout')
}

// Bridge: fake Ring Studio (TCP JSON lines) → WebSocket client.
{
  const received = []
  let studioSocket
  const studio = net.createServer(socket => {
    studioSocket = socket
    socket.setEncoding('utf8')
    socket.on('data', chunk => received.push(chunk))
    socket.write('{"type":"hello","version":1}\n')
  })
  studio.listen(0, '127.0.0.1'); await once(studio, 'listening')
  const bridge = startBridge({ studioPort: studio.address().port, port: 0, log() {} })
  await once(bridge.wss, 'listening')
  const url = `ws://127.0.0.1:${bridge.wss.address().port}`
  await new Promise(r => setTimeout(r, 200))
  const lines = []
  const ws = new WebSocket(url)
  ws.on('message', m => lines.push(...String(m).split('\n')))
  await once(ws, 'open')
  studioSocket.write('{"type":"imu","address":"A","name":"R","timestamp":1,"sequence":1,"acc":[0,0,9.8],"gyr":[0,0,0]}\n{"type":"imu","address":"A","name":"R","timestamp":1.005,"sequence":2,"acc":[0,0,9.8],"gyr":[0,0,0]}\n')
  await new Promise(r => setTimeout(r, 200))
  assert.ok(lines.some(l => JSON.parse(l).type === 'bridge' && JSON.parse(l).tcp === true), 'client is told Ring Studio is connected')
  assert.deepEqual(lines.filter(l => JSON.parse(l).type === 'imu').map(l => JSON.parse(l).sequence), [1, 2], 'IMU lines arrive intact and in order')
  assert.ok(received.join('').includes('"subscribe"'), 'bridge subscribes to the IMU stream')
  const foreign = new WebSocket(url, { origin: 'https://example.com' })
  const rejected = await new Promise(resolve => { foreign.on('error', () => resolve(true)); foreign.on('open', () => resolve(false)) })
  assert.ok(rejected, 'pages from other origins are refused')
  ws.close(); bridge.close(); studioSocket.destroy(); studio.close()
}
console.log('Bridge: relays Ring Studio lines to WebSocket clients, subscribes, refuses foreign origins: pass')

// The calibration-free classifier is what a new player gets, and the camera cannot outrank it.
//
// Both halves are wiring, not logic: absolute.js is measured in tests/absolute.test.mjs and the
// distrust guard in tests/camera.test.mjs. What is untested without this is whether the default
// actually reaches a fresh page, and whether input.js passes the guard down to the fusion at all.
{
  const empty = { getItem: () => null, setItem() {} }
  const fresh = createRingInput({ onEvent() {}, now: () => 0, WebSocketImpl: null, storage: empty })
  assert.equal(fresh.snapshot().directionMode, 'absolute',
    'a page with no stored choice starts calibration-free')

  // A choice made in the panel still wins, which is what makes the switch a working rollback.
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const picked = createRingInput({ onEvent() {}, now: () => 0, WebSocketImpl: null, storage })
  picked.setDirectionMode('template')
  assert.equal(store.get('ringsymphony.direction-mode.v2'), 'template', 'the choice persists')
  const reopened = createRingInput({ onEvent() {}, now: () => 0, WebSocketImpl: null, storage })
  assert.equal(reopened.snapshot().directionMode, 'template', 'and survives a reload')

  // A value stored under the pre-default key is ignored, or the flip would never reach anyone who
  // had tried the switch before it changed.
  const stale = { getItem: k => (k === 'ringsymphony.direction-mode' ? 'template' : null), setItem() {} }
  const migrated = createRingInput({ onEvent() {}, now: () => 0, WebSocketImpl: null, storage: stale })
  assert.equal(migrated.snapshot().directionMode, 'absolute', 'the old key no longer pins the mode')
}
console.log('Ring input: starts calibration-free, honours an explicit choice, ignores the old key: pass')

// The distrust guard reaches the fusion from input.js. Driven through a real recording so the
// assertion is about the wiring under load, not a hand-made event.
{
  const seen = []
  let clock = 100
  const input = createRingInput({
    onEvent: e => { if (e.type === 'beat') seen.push(e) },
    now: () => clock,
    WebSocketImpl: null,
    storage: { getItem: () => null, setItem() {} },
    // A camera that always answers 'down' confidently. Under distrust this would overrule the
    // ring; under the absolute path it must only ever fill in a decline.
    cameraVerdict: () => ({ dir: 'down', axis: 'vertical', displacement: 0.3, angle: -90, margin: 0.9 }),
  })
  input.feed({ type: 'status', rings: [{ address: 'A', name: 'Ringo-A', connected: true }] })
  const frames = await recording('四拍', 'yyh')
  // A lone ring waits briefly before it takes the right hand, so the clock has to move first.
  clock += 0.6
  frames.forEach((f, i) => {
    clock = 100 + f.t + 0.02
    input.feed({ type: 'imu', address: 'A', name: 'Ringo-A', timestamp: f.t, sequence: i, acc: f.acc, gyr: f.gyr })
  })
  assert.equal(input.snapshot().directionMode, 'absolute')
  assert.ok(seen.length > 20, `the recording still produces beats (${seen.length})`)
  const overruled = seen.filter(e => e.ringDir && e.directionSource === 'camera')
  assert.equal(overruled.length, 0,
    `the camera never overrules a ring answer in absolute mode (${overruled.length} did)`)
  // The fill-in path is still live, which is the half that can only help.
  assert.ok(seen.every(e => e.directionSource !== 'camera' || !e.ringDir),
    'any camera-sourced direction came from a stroke the ring declined')
}
console.log('Ring input: the camera fills in but never overrules the gravity-frame classifier: pass')
