# Phase 1: Detection and Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gentle conducting register reliably, stop one sloppy calibration wave from invalidating the whole setup, persist calibration across sessions, and replace the fist kill-switch with a pause menu.

**Architecture:** All detection logic stays in the existing pure modules (`src/ring/detectors.js`, `src/ring/direction.js`) so Node replay tests keep working — no DOM, no timers, no chart awareness inside the detector. Two-tier beat acceptance is implemented by tagging the beat event with a `tier` field and letting `main.js` decide; the detector never learns about the chart. Nothing in the beat path defers or waits.

**Tech Stack:** Vanilla ES modules, Node's built-in `node:assert/strict` (no test framework), localStorage for persistence.

**Spec:** `docs/superpowers/specs/2026-11-13-camera-and-detection-design.md`

## Global Constraints

- **Nothing in the beat path may wait.** The on-screen hand moves on the ring's event, synchronously. `onEvent` keeps its current synchronous shape (`input.js:324-325`); the `age` computation is unchanged.
- **Detection modules stay pure.** `detectors.js` and `direction.js` must remain DOM-free, timer-free and chart-free so the same code runs in the browser and in `npm test` / `npm run eval`.
- **Calibration must not require more waves than today** — currently 12 (4 directions x 3). Outlier resistance must not raise this count.
- **`npm test` must pass at the end of every task.**
- **Judgment windows unchanged:** `PERFECT = 0.12`, `GOOD = 0.25` (`src/judge.js:1-2`).
- **`fistJerk` stays at 40000.** Eval shows it discriminates well; the fix is removing the consequence, not retuning detection.
- **UI copy is Chinese**, matching existing strings in `main.js` and `panel.js`.
- **Run tests with `npm test`** (runs all six test files). Single file: `node tests/<name>.test.mjs`.

## Review Focus

Input classes the spec implies but no task's tests would otherwise exercise. Each has a test assigned to the task that owns the code.

1. **localStorage unavailable or throwing** (private browsing, disabled storage). Calibration must fall back to session-only, never crash. — Task 5.
2. **Corrupt or wrong-version persisted calibration** (hand-edited, stale schema). Must be discarded, not loaded into the classifier. — Task 5.
3. **A level needing a direction the player has not calibrated.** Must block with a message naming that direction, not auto-Miss. — Task 4.
4. **Pause fired outside a level** (home screen, results, count-in). Must be a no-op rather than opening a menu over the wrong screen. — Task 6.
5. **The adaptive floor seeing only noise** (ring on a table, player idle). Floor must not drop so far that resting tremor produces beats. — Task 1.

---

### Task 1: Adaptive beat floor

The fixed `beatFloor: 1.6` rad/s overrides the relative term for gentle conductors (relative only exceeds it once mean > 1.3913). Learn the floor from the player's own motion instead.

**Files:**
- Modify: `src/ring/detectors.js` (DEFAULTS, `createBeatDetector`)
- Test: `tests/detectors.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `createBeatDetector({ adaptiveFloor: boolean, floorMin: number, floorMax: number })`. Detector gains a `floor` getter returning the current effective floor. Default `adaptiveFloor: true`, `floorMin: 0.65`, `floorMax: 1.6` (clamp range from `direction.js:101`).

- [ ] **Step 1: Write the failing tests**

```js
// tests/detectors.test.mjs
import assert from 'node:assert/strict'
import { createBeatDetector } from '../src/ring/detectors.js'

// A gentle conductor whose peaks never reach 1.6 rad/s must still produce beats.
{
  const detector = createBeatDetector()
  const events = []
  // 40 s of gentle strokes peaking at 1.0 rad/s, resting near 0.15.
  for (let i = 0; i < 8000; i += 1) {
    const t = i * 0.005
    const phase = (i % 200) / 200
    const speed = phase < 0.15 ? 0.15 + 0.85 * Math.sin((phase / 0.15) * Math.PI) : 0.15
    const event = detector.push(t, speed)
    if (event) events.push(event)
  }
  assert.ok(events.length > 20, `gentle strokes must register beats, got ${events.length}`)
}

// Review Focus 5: idle noise must not produce beats.
{
  const detector = createBeatDetector()
  const events = []
  for (let i = 0; i < 8000; i += 1) {
    const event = detector.push(i * 0.005, 0.05 + Math.random() * 0.05)
    if (event) events.push(event)
  }
  assert.equal(events.length, 0, `idle noise must not produce beats, got ${events.length}`)
}

// The adaptive floor must never leave the clamp range.
{
  const detector = createBeatDetector()
  for (let i = 0; i < 4000; i += 1) detector.push(i * 0.005, 0.02)
  assert.ok(detector.floor >= 0.65, `floor must not fall below floorMin, got ${detector.floor}`)
  for (let i = 4000; i < 8000; i += 1) detector.push(i * 0.005, 12)
  assert.ok(detector.floor <= 1.6, `floor must not rise above floorMax, got ${detector.floor}`)
}

// Opting out restores today's fixed behaviour.
{
  const detector = createBeatDetector({ adaptiveFloor: false })
  for (let i = 0; i < 2000; i += 1) detector.push(i * 0.005, 0.05)
  assert.equal(detector.floor, 1.6)
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/detectors.test.mjs`
Expected: FAIL — `detector.floor` is undefined.

- [ ] **Step 3: Implement the adaptive floor in `src/ring/detectors.js`**

Add to `DEFAULTS`: `adaptiveFloor: true`, `floorMin: 0.65`, `floorMax: 1.6`.

In `createBeatDetector`, track a slow-moving estimate of the player's resting rotation and derive the floor from it, clamped to `[floorMin, floorMax]`. Use an EMA of |w| with a time constant well longer than `beatTau` (which is 1.0 s) so strokes do not drag the resting estimate upward — 8-15 s is the intended range. The floor must sit far enough above resting level that tremor cannot cross it; a multiplier in the 3-5x range over the resting estimate is the intended shape, tuned so both tests above pass. Expose `get floor()`. When `adaptiveFloor` is false, `floor` returns `o.beatFloor` unchanged.

Keep `level = Math.max(floor, o.beatRise * mean)` — only the first argument becomes dynamic.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/detectors.test.mjs`
Expected: PASS (4 assertions).

- [ ] **Step 5: Verify no regression against recordings**

Run: `npm test && npm run eval`
Expected: `npm test` passes. Record the eval beat counts in the commit message — these are the baseline for later comparison.

- [ ] **Step 6: Commit**

```bash
git add src/ring/detectors.js tests/detectors.test.mjs
git commit -m "feat: adaptive beat floor so gentle conducting registers"
```

---

### Task 2: Two-tier beat acceptance

One threshold forces a bad tradeoff: low enough for gentle beats catches twitches; high enough to reject twitches loses gentle beats. Emit strong and weak tiers and let the consumer decide. The detector stays chart-unaware.

**Files:**
- Modify: `src/ring/detectors.js` (`createBeatDetector`, `createHandDetector`)
- Modify: `src/main.js:133-144` (`playBeat`), `src/main.js:186` (`onRing`)
- Test: `tests/detectors.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 1's adaptive floor.
- Produces: beat events gain `tier: "strong" | "weak"`. `createBeatDetector({ weakRise })` where `weakRise` defaults to `1.15` (today's `beatRise`) and `beatRise` rises to `1.6` for the strong tier. `createHandDetector` passes both through unchanged.

- [ ] **Step 1: Write the failing tests**

```js
// A clear stroke is strong; a soft one above the floor is weak.
{
  const detector = createBeatDetector({ adaptiveFloor: false })
  const strong = [0, 0, 2, 6, 1, 0].map((s, i) => detector.push(i * 0.01, s)).filter(Boolean)
  assert.equal(strong.length, 1)
  assert.equal(strong[0].tier, 'strong')
}
{
  const detector = createBeatDetector({ adaptiveFloor: false, beatFloor: 0.5 })
  for (let i = 0; i < 400; i += 1) detector.push(i * 0.005, 0.5)
  const weak = [0.5, 0.5, 0.7, 0.9, 0.6, 0.5].map((s, i) => detector.push(2 + i * 0.01, s)).filter(Boolean)
  assert.equal(weak.length, 1)
  assert.equal(weak[0].tier, 'weak')
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/detectors.test.mjs`
Expected: FAIL — `tier` is undefined.

- [ ] **Step 3: Add tiering in `src/ring/detectors.js`**

Add `weakRise: 1.15` to `DEFAULTS` and raise `beatRise` to `1.6`. In `createBeatDetector`, trigger on `Math.max(floor, o.weakRise * mean)` as today, and on emit set `tier` to `"strong"` when `peak >= Math.max(floor, o.beatRise * mean)`, otherwise `"weak"`. Both tiers are emitted; nothing is suppressed in the detector.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/detectors.test.mjs`
Expected: PASS.

- [ ] **Step 5: Consume the tier in `src/main.js`**

In `onRing` (`main.js:186`), pass `event.tier` through to `playBeat`. In `playBeat`, add parameter `tier = "strong"`. A `"weak"` beat is accepted only when `nearest(at, "right", "beat")` returns a cue within `GOOD * 2` (0.5 s) — the corroboration window is deliberately wider than the Perfect window so it admits notes without flattering them. A weak beat with no nearby cue returns without calling `world.pose` or `scoreCue`. A strong beat behaves exactly as today.

Chart proximity is known synchronously, so this adds no latency.

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ring/detectors.js src/main.js tests/detectors.test.mjs
git commit -m "feat: two-tier beat acceptance with chart corroboration for soft beats"
```

---

### Task 3: Outlier rejection in calibration

`direction.js:85` requires every sample within 45.57 degrees of the centroid of all three. With n=3 and no outlier rejection, one bad wave drags the centroid and can fail the two good ones.

**Files:**
- Modify: `src/ring/direction.js` (`status`, `capture`)
- Test: `tests/direction.test.mjs` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `status()` return gains `perDirection: { down: {...}, left: {...}, right: {...}, up: {...} }` where each entry is `{ count: number, valid: boolean, issue: string }`. Existing fields keep their meaning.

- [ ] **Step 1: Write the failing test**

```js
// Two consistent waves and one outlier must still yield a usable direction.
{
  const cal = createDirectionCalibration()
  const good = [0, 0, 1]
  const outlier = [0, 1, 0]
  cal.arm('down', 'AA', 0); cal.capture(good, 'AA', 0.1)
  cal.arm('down', 'AA', 1); cal.capture(good, 'AA', 1.1)
  cal.arm('down', 'AA', 2); cal.capture(outlier, 'AA', 2.1)
  const status = cal.status(3)
  assert.equal(status.perDirection.down.valid, true, 'two agreeing samples must survive one outlier')
}

// Three mutually inconsistent waves must still be rejected.
{
  const cal = createDirectionCalibration()
  const samples = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  samples.forEach((sample, i) => { cal.arm('down', 'AA', i); cal.capture(sample, 'AA', i + 0.1) })
  assert.equal(cal.status(4).perDirection.down.valid, false, 'three disagreeing samples must not pass')
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/direction.test.mjs`
Expected: FAIL — `perDirection` undefined.

- [ ] **Step 3: Implement outlier-tolerant validation in `src/ring/direction.js`**

In `status()`, replace the all-samples-must-agree check with one that tolerates a single outlier: a direction is valid when at least 2 of its 3 samples agree with each other within the existing 0.7 cosine tolerance. The centroid used for classification must then be computed from the agreeing samples only, so the outlier does not skew it. Sample count stays at `SAMPLES_PER_DIRECTION = 3` — do not raise it.

Keep the existing pairwise distinctness check (`> 0.92`) between direction centroids.

Build `perDirection` with `count`, `valid` and `issue` per direction.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/direction.test.mjs`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ring/direction.js tests/direction.test.mjs
git commit -m "feat: tolerate one outlier wave per calibration direction"
```

---

### Task 4: Per-direction validity and per-level gating

`direction.js:98` makes `ready` all-or-nothing, so one bad direction blocks every level. Gate per level instead: 4/4 levels need all four directions, 3/4 levels need down/right/up (`chart.js:1-4`).

**Files:**
- Modify: `src/ring/direction.js` (`classifyDetailed`)
- Modify: `src/main.js:234-244` (`begin`)
- Modify: `src/ring/panel.js` (calibration status display)
- Test: `tests/direction.test.mjs`, `tests/sections.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 3's `perDirection`.
- Produces: `status()` gains `readyFor(directions: string[]) -> { ok: boolean, missing: string[] }`. `classifyDetailed` returns `{ direction: null, reason: "<方向>尚未校准" }` for an invalid direction rather than failing globally.

- [ ] **Step 1: Write the failing tests**

```js
// A missing 'left' must still allow a 3/4 level, which needs only down/right/up.
{
  const cal = createDirectionCalibration()
  const vectors = { down: [0, 0, 1], right: [1, 0, 0], up: [0, 0, -1] }
  for (const [dir, vec] of Object.entries(vectors)) {
    for (let i = 0; i < 3; i += 1) { cal.arm(dir, 'AA', i); cal.capture(vec, 'AA', i + 0.1) }
  }
  const status = cal.status(10)
  assert.deepEqual(status.readyFor(['down', 'right', 'up']), { ok: true, missing: [] })
  assert.deepEqual(status.readyFor(['down', 'left', 'right', 'up']), { ok: false, missing: ['left'] })
}
```

In `tests/sections.test.mjs`, assert `DIRS_BY_METER[3]` is `['down','right','up']` and `DIRS_BY_METER[4]` is `['down','left','right','up']`, so the gate's assumption is pinned.

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/direction.test.mjs`
Expected: FAIL — `readyFor` is not a function.

- [ ] **Step 3: Implement `readyFor` in `src/ring/direction.js`**

Returns `{ ok, missing }` where `missing` lists requested directions whose `perDirection[dir].valid` is false. Update `classifyDetailed` so an uncalibrated direction reports only that direction, not global failure.

- [ ] **Step 4: Gate per level in `src/main.js`**

Export `DIRS_BY_METER` from `src/chart.js` (currently module-private at line 1). In `begin()` (`main.js:236`), replace the `!ringSnapshot.direction.ready` check with `readyFor(DIRS_BY_METER[study.meter])`. On failure, open the panel and toast naming the missing directions, e.g. `请先校准右手的「上」方向` — Review Focus 3. The message must name the directions; do not fall back to a generic string.

- [ ] **Step 5: Surface per-direction state in `src/ring/panel.js`**

Mark each direction valid or needing recapture in the existing calibration block, so the player can see which one to redo via the existing 补录方向 flow.

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ring/direction.js src/chart.js src/main.js src/ring/panel.js tests/
git commit -m "feat: gate levels on the directions they need, not all four"
```

---

### Task 5: Persist calibration

Calibration is lost on every refresh, reconnect and ring swap (`direction.js:65`). Persist it keyed by address **and** hand — `assign()` (`input.js:146-164`) and 交换左右 (`input.js:430-433`) can move a ring to the other hand, where its calibration is wrong.

**Files:**
- Modify: `src/ring/direction.js` (export serialise/restore)
- Modify: `src/ring/input.js` (save/load alongside `ROLE_KEY`, `COMP_KEY`)
- Test: `tests/direction.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 3's internals.
- Produces: `calibration.serialise() -> { version: 1, address, hand, samples, speeds, savedAt }` and `calibration.restore(data, address, hand) -> boolean` (false when rejected). Storage key `ringsymphony.calibration.v1`.

- [ ] **Step 1: Write the failing tests**

```js
// A round trip restores a working calibration.
{
  const cal = createDirectionCalibration()
  const vectors = { down: [0,0,1], left: [0,1,0], right: [1,0,0], up: [0,0,-1] }
  for (const [dir, vec] of Object.entries(vectors)) {
    for (let i = 0; i < 3; i += 1) { cal.arm(dir, 'AA', i); cal.capture(vec, 'AA', i + 0.1) }
  }
  const saved = cal.serialise()
  const fresh = createDirectionCalibration()
  assert.equal(fresh.restore(saved, 'AA', 'right'), true)
  assert.equal(fresh.status(0).ready, true)
}

// Review Focus 2: wrong version, wrong address and wrong hand are all rejected.
{
  const cal = createDirectionCalibration()
  assert.equal(cal.restore({ version: 99, address: 'AA', hand: 'right' }, 'AA', 'right'), false)
  assert.equal(cal.restore({ version: 1, address: 'BB', hand: 'right', samples: {}, speeds: {} }, 'AA', 'right'), false)
  assert.equal(cal.restore({ version: 1, address: 'AA', hand: 'left', samples: {}, speeds: {} }, 'AA', 'right'), false)
  assert.equal(cal.restore(null, 'AA', 'right'), false)
  assert.equal(cal.restore({ version: 1, address: 'AA', hand: 'right', samples: 'garbage' }, 'AA', 'right'), false)
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/direction.test.mjs`
Expected: FAIL — `serialise` is not a function.

- [ ] **Step 3: Implement `serialise` and `restore` in `src/ring/direction.js`**

`restore` returns false unless `version === 1`, `address` matches, `hand` matches, and `samples`/`speeds` are objects whose values are arrays of 3-element numeric arrays. Reject rather than throw on malformed input.

- [ ] **Step 4: Wire persistence in `src/ring/input.js`**

Add `const CAL_KEY = "ringsymphony.calibration.v1"` beside the existing keys (`input.js:6-7`). Load via the existing `readJson` helper, which already try/catches (Review Focus 1). Save in `save()` after each successful `capture`. In `assign()`, attempt `restore` for the new address+hand before falling back to `direction.reset()`.

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ring/direction.js src/ring/input.js tests/direction.test.mjs
git commit -m "feat: persist calibration per ring address and hand"
```

---

### Task 6: Replace fist-ends-level with pause

`main.js:186` routes a single fist event straight to `finish()`, irreversibly, from either hand. Remove it from rhythm mode (free mode keeps 握拳收束 at `main.js:361`) and add a pause with resume/end.

**Files:**
- Modify: `src/main.js:186` (`onRing`), `src/main.js:76` (`setMode`)
- Modify: `src/hud.js` (pause overlay — no overlay component exists yet; follow the panel pattern in `src/settings.js:21-33`)
- Modify: `src/style.css` (pause overlay styling)
- Modify: `README.md` (握拳 no longer ends a performance)
- Test: `tests/controller.test.mjs` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `pause()` and `resume()` in `main.js`; mode `"paused"`.

- [ ] **Step 1: Write the failing test**

```js
// A fist during a rhythm level must not end it.
// Build the controller in the mode the existing tests in this file use,
// dispatch { type: 'fist', hand: 'right' }, and assert the mode is unchanged
// and no result screen was produced.

// Review Focus 4: pause outside a level is a no-op.
// Call pause() while mode is 'home' and assert mode is still 'home'.
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/controller.test.mjs`
Expected: FAIL — fist still finishes the level.

- [ ] **Step 3: Remove the fist path and add pause in `src/main.js`**

Delete the `if (event.type === "fist") return stopByFist()` line from `onRing` (`main.js:186`). Keep `stopByFist` itself — free mode still calls it.

Add `pause()`: returns immediately unless mode is `"playing"` or `"count-in"`; otherwise sets mode `"paused"`, stops audio and the note lane, shows the overlay. Add `resume()`: restores mode and restarts the clock from where it stopped. The overlay's 结束 button calls the existing `finish()`.

Bind `Escape` to `pause()`.

The music clock must not advance while paused, or notes will have moved on resume.

- [ ] **Step 4: Add the overlay**

Two buttons, 继续 and 结束. There is no existing overlay component — follow the
panel pattern in `src/settings.js:21-33`: a `panel.innerHTML` template with a
`.panel-head`, and `hidden` toggled for visibility. Style it in `src/style.css`
alongside the existing panel rules.

- [ ] **Step 5: Update `README.md`**

The 手势 table lists 握拳 / 任一只手 / "立即收束并显示结果". Change it to say the fist applies to free mode, and document Escape as pause in rhythm levels.

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main.js src/style.css src/index.html src/hud.js README.md tests/controller.test.mjs
git commit -m "feat: replace fist kill-switch with pause menu in rhythm levels"
```

---

### Task 7: Relative direction scoring

`direction.js:160` rejects anything below a fixed 0.8 cosine (36.87 degrees) regardless of how well-separated the player's own directions are. Scale the cutoff to the player's actual spread.

**Files:**
- Modify: `src/ring/direction.js` (`classifyDetailed`)
- Test: `tests/direction.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 3's centroids.
- Produces: no signature change; `classifyDetailed` behaviour becomes spread-relative.

- [ ] **Step 1: Write the failing test**

```js
// Well-separated calibration directions should accept a wave that a fixed 0.8 cutoff rejects,
// while a wave near the midpoint between two centroids is still refused as ambiguous.
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/direction.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement spread-relative scoring in `src/ring/direction.js`**

Derive the acceptance cutoff from the maximum pairwise cosine between this player's four centroids: widely-separated directions permit a looser cutoff, clustered ones demand a tighter one. Keep 0.8 as the strictest value so this never accepts less than today. The runner-up margin check (`< 0.08`) is unchanged.

- [ ] **Step 4: Verify**

Run: `npm test && npm run eval`
Expected: `npm test` passes. Compare eval direction counts against the Task 1 baseline and note changes in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/ring/direction.js tests/direction.test.mjs
git commit -m "feat: scale direction cutoff to the player's calibration spread"
```

---

### Task 8: Baseline measurement

The spec requires measuring whether Phase 1 worked, using the `directionStats` counters already in `input.js:38` and surfaced at `panel.js:213`.

**Files:**
- Create: `docs/superpowers/specs/phase1-baseline.md`

- [ ] **Step 1: Record the before/after numbers**

With real hardware, play each level and record the `directionStats` distribution (accepted / data / weak / mismatch / mismatchGap / ambiguous / uncalibrated / suppressed), plus Misses on cues the player believes they conducted. The spec's expectations: `uncalibrated` and `mismatch` fall; `accepted` rises relative to total candidates; `weak` falling *without* `accepted` rising means the floor dropped too far.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/phase1-baseline.md
git commit -m "docs: Phase 1 detection baseline measurements"
```

---

## Notes for the implementer

- Tasks 1-2 are the gentle-motion fix; 3-5 the calibration fix; 6 the pause; 7 a refinement. Order matters: Task 2 builds on Task 1's floor, Tasks 4-5 build on Task 3's `perDirection`.
- The claim that the 1.6 floor causes 轻动识别不准 is a **hypothesis**, not a finding — `npm run eval` shows the detector *over*-triggering on the rhythm recordings (34-55 beats where ~30-45 are real). Those recordings are not gentle play, so they neither confirm nor refute it. Task 8 exists to settle it on real hardware.
- A teammate is working on UI in parallel. `src/ring/panel.js` (Task 4) and the HUD/CSS (Task 6) are the likely collision points — coordinate before starting those.
