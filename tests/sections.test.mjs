import assert from 'node:assert/strict'
import { createMixer, DUCK } from '../src/mixer.js'
import { createTempo } from '../src/tempo.js'
import { lassoParts } from '../src/lasso.js'

const mixer = createMixer()
assert.deepEqual(mixer.request(['violin', 'cello'], true), ['violin', 'cello'])
assert.deepEqual(mixer.request(['violin'], true), [], 'a pending entry is not queued twice')
assert.equal(mixer.gainOf('violin'), 0, 'not audible until the entry lands')
mixer.commit('violin'); mixer.commit('cello')
assert.equal(mixer.gainOf('violin'), 1)
mixer.toggleSolo(['violin'])
assert.equal(mixer.gainOf('violin'), 1)
assert.ok(Math.abs(mixer.gainOf('cello') - (1 - DUCK)) < 1e-9)
mixer.request(['violin'], false); mixer.commit('violin')
assert.equal(mixer.solo, null, 'solo ends when the soloist stops')
assert.equal(mixer.gainOf('cello'), 1)
mixer.nudge(['cello'], 'up'); mixer.nudge(['cello'], 'up'); mixer.nudge(['cello'], 'up')
assert.equal(mixer.parts.cello.local, 1.6, 'local gain is capped')
console.log('Section mixer: queued entries, solo ducking, release on exit, capped local gain: pass')

const tempo = createTempo(96)
for (let i = 0; i < 12; i++) tempo.tap(i * 0.5)
assert.ok(Math.abs(tempo.bpm - 120) < 1)
tempo.tap(5.6)
assert.ok(Math.abs(tempo.bpm - 120) < 1, 'taps inside the 0.22 s refractory gap are ignored')
tempo.tap(8)
assert.ok(Math.abs(tempo.bpm - 120) < 1, 'outlier intervals do not move the tempo')
console.log('Tempo follower: converges to the beat, ignores double taps and outliers: pass')

const loop = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
const seats = [{ part: 'violin', x: 50, y: 50 }, { part: 'violin', x: 300, y: 50 }, { part: 'flute', x: 150, y: 50 }, { part: 'cello', x: 10, y: 90 }]
assert.deepEqual(lassoParts(loop, seats), ['violin', 'cello'])
console.log('Lasso: circles sections by their players inside the loop: pass')
