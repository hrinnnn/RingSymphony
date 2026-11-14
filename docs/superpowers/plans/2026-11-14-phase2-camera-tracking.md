# Phase 2 Camera Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a webcam hand-tracking layer that decides vertical stroke direction, which the ring cannot do, while leaving every no-camera path byte-identical to today.

**Architecture:** A DOM-owning tracker (`src/camera/tracker.js`) runs MediaPipe HandLandmarker over `getUserMedia` and keeps a rolling per-hand buffer of timestamped landmark frames. A pure module (`src/camera/direction.js`) turns that buffer plus a beat timestamp into a direction verdict or declines. `src/ring/input.js` asks for that verdict through an injected `cameraVerdict` callback — mirroring the existing `cueDue` seam — and fuses it before the return filter. Purity is preserved: fusion and verdict logic are Node-testable, the tracker is not imported by tests.

**Tech Stack:** `@mediapipe/tasks-vision` (Apache-2.0, wasm from npm), `hand_landmarker.task` float16 (committed), Vite, vanilla JS ES modules, `node:test`-free assert-based tests matching the existing `tests/*.test.mjs` style.

**Spec:** `docs/superpowers/specs/2026-11-14-phase2-camera-design.md`

## Global Constraints

- The camera is recommended, never required. Every failure path — no hardware, denied permission, revoked permission, lost tracking, out of frame, frame-edge, poor light, frame-rate collapse, model load failure — converges on "no verdict", and the no-verdict path must leave `input.js` behaviour identical to the current commit.
- `getUserMedia` is never called until the player explicitly opts in.
- Timing is never affected. `onEvent` stays synchronous, `age` is computed as today, nothing waits for a frame.
- Preview mirroring is CSS-only. Pixels passed to `detectForVideo` are never mirrored, because MediaPipe inverts handedness on mirrored input.
- Camera window: `CAMERA_WINDOW = 0.30` seconds, anchored on the **uncompensated page clock**.
- Camera wins a disagreement only when the ring's answer and the camera's answer are **both** in `{up, down}`. Every other disagreement: ring wins, logged.
- When the ring returns no direction, the camera answers on either axis, subject to the same earning rule.
- `src/camera/direction.js` and the fusion logic contain no DOM references. `src/camera/tracker.js` is the only file that touches `navigator`, `document` or MediaPipe.
- `npm test` must pass. `npm run eval` output must stay byte-identical (no camera means no change to detection).
- Model provenance: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`, 7,819,105 bytes, md5 `FTGEMOo4UWcP6ZFBFqnPrQ==`.

## Review Focus

Five failure modes the spec implies that no single task's happy path exercises. Each has its test assigned to the task owning the code.

1. **Stale frames after a stalled or backgrounded video.** If the tab is hidden or the stream stalls, the newest buffered frame can be seconds old; a verdict computed from it would be confidently wrong. Frames older than the window must make the verdict decline. → Task 2.
2. **Permission revoked mid-level.** The track ends while a level is running; the next beat must fuse exactly as if no camera had ever been enabled, with no thrown error reaching `onEvent`. → Task 4.
3. **`localStorage` unavailable or full.** Private mode throws on `setItem`, and a full quota throws mid-session. A log write must never break a beat. → Task 5.
4. **Frame-rate collapse.** At ~15fps a 300ms window holds ~4 frames with ~2 arrived. Below a minimum frame count the verdict declines rather than fitting a direction to two points. → Task 2.
5. **Ring worn on the wrong hand relative to its role.** `setRole`, 交换左右 and silent auto-allocation can put the `"right"` role on the anatomically left hand, feeding one hand's displacement to the other's beat. Sustained contradiction must be detected, not trusted. → Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/camera/direction.js` | **New, pure.** Verdict from landmark frames + timestamp. Node-testable. |
| `src/camera/log.js` | **New, pure-ish.** Bounded persisted disagreement log; storage injected. |
| `src/camera/tracker.js` | **New, DOM.** `getUserMedia`, MediaPipe runtime, frame loop, rolling buffers. |
| `src/camera/panel.js` | **New, DOM.** Opt-in offer, framing preview, status chip. |
| `src/ring/input.js` | **Modify.** Accept `cameraVerdict`, fuse before the return filter, expose `offset`. |
| `src/main.js` | **Modify.** Wire tracker → `cameraVerdict`, mount panel. |
| `tests/camera.test.mjs` | **New.** Verdict logic, fusion, log, staleness, frame-rate collapse. |
| `vite.config.js` | **New.** Serve/copy MediaPipe wasm. |
| `models/hand_landmarker.task` | **New, committed.** 7.8MB. |

---

### Task 1: Dependency, model and build wiring

**Files:**
- Create: `vite.config.js`, `models/README.md`
- Add: `models/hand_landmarker.task` (downloaded, committed)
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Produces: `@mediapipe/tasks-vision` importable; wasm served at `/mediapipe/` in dev and copied to `dist/mediapipe/` on build; model fetchable at `/models/hand_landmarker.task`.

- [ ] **Step 1: Install the dependency**

```bash
npm install @mediapipe/tasks-vision
```

- [ ] **Step 2: Download the model and verify its size**

```bash
mkdir -p models
curl -sL -o models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task
wc -c < models/hand_landmarker.task
```

Expected: `7819105`. Stop if it differs — the published model changed and the design's provenance note needs updating first.

- [ ] **Step 3: Write `models/README.md`**

Record the provenance URL, the byte count, the md5 from the design doc, the licence (Apache-2.0), and why the file is committed rather than fetched (npm does not ship it; the game must work with no network).

- [ ] **Step 4: Write `vite.config.js`**

Use `viteStaticCopy` if already available, otherwise a small `configureServer` + `closeBundle` plugin: serve `node_modules/@mediapipe/tasks-vision/wasm` at `/mediapipe/` and copy it into `dist/mediapipe/` on build. The wasm must not be committed.

- [ ] **Step 5: Add the export filename pattern to `.gitignore`**

Append `camera-log-*.json` so an exported log cannot be committed casually.

- [ ] **Step 6: Verify the build**

Run: `npm run build && ls dist/mediapipe/`
Expected: the wasm files are present in `dist/mediapipe/`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.js models/ .gitignore
git commit -m "feat: add MediaPipe hand tracking dependency and model"
```

---

### Task 2: The pure verdict module

**Files:**
- Create: `src/camera/direction.js`
- Test: `tests/camera.test.mjs`

**Interfaces:**
- Produces:
  - `export const CAMERA_WINDOW = 0.30`
  - `export const MIN_FRAMES = 4`
  - `export const EDGE_MARGIN = 0.04`
  - `export const MIN_DISPLACEMENT = 0.035`
  - `export const VERTICAL = ["up", "down"]`
  - `export function cameraDirection(frames, beatTime)` → `{ dir: "up"|"down"|"left"|"right", axis: "vertical"|"horizontal", displacement: number } | { dir: null, reason: string }`
- Frame shape consumed: `{ t: number, x: number, y: number, inFrame: boolean }` where `x`/`y` are normalized 0-1 with **y increasing downward** (MediaPipe's convention), and `t` is on the page clock.

- [ ] **Step 1: Write the failing tests**

```js
// tests/camera.test.mjs
import assert from 'node:assert/strict'
import { cameraDirection, CAMERA_WINDOW, MIN_FRAMES } from '../src/camera/direction.js'

const frames = (pts, { t0 = 1.0, step = 0.033, inFrame = true } = {}) =>
  pts.map(([x, y], i) => ({ t: t0 + i * step, x, y, inFrame }))

// Screen y grows downward, so a rising hand has decreasing y.
{
  const f = frames([[0.5, 0.60], [0.5, 0.52], [0.5, 0.45], [0.5, 0.38], [0.5, 0.30]])
  const v = cameraDirection(f, 1.14)
  assert.equal(v.dir, 'up')
  assert.equal(v.axis, 'vertical')
}
{
  const f = frames([[0.5, 0.30], [0.5, 0.38], [0.5, 0.45], [0.5, 0.52], [0.5, 0.60]])
  assert.equal(cameraDirection(f, 1.14).dir, 'down')
}
{
  const f = frames([[0.30, 0.5], [0.38, 0.5], [0.45, 0.5], [0.52, 0.5], [0.60, 0.5]])
  const v = cameraDirection(f, 1.14)
  assert.equal(v.dir, 'right')
  assert.equal(v.axis, 'horizontal')
}
// The dominant axis wins when a stroke carries both.
{
  const f = frames([[0.40, 0.60], [0.42, 0.50], [0.44, 0.40], [0.46, 0.32], [0.48, 0.25]])
  assert.equal(cameraDirection(f, 1.14).axis, 'vertical')
}
// Review Focus 1: frames older than the window are stale, not current.
{
  const f = frames([[0.5, 0.60], [0.5, 0.50], [0.5, 0.40], [0.5, 0.32], [0.5, 0.25]], { t0: 1.0 })
  assert.equal(cameraDirection(f, 9.0).dir, null, 'a verdict must not be built from stale frames')
}
// Review Focus 4: too few frames to fit a direction.
{
  const f = frames([[0.5, 0.60], [0.5, 0.30]])
  assert.equal(cameraDirection(f, 1.07).dir, null, 'two frames cannot distinguish a stroke from an outlier')
  assert.ok(MIN_FRAMES >= 4)
}
// Out-of-frame and frame-edge frames do not earn a verdict.
{
  const f = frames([[0.5, 0.60], [0.5, 0.50], [0.5, 0.40], [0.5, 0.32], [0.5, 0.25]], { inFrame: false })
  assert.equal(cameraDirection(f, 1.14).dir, null)
}
{
  const f = frames([[0.5, 0.05], [0.5, 0.04], [0.5, 0.03], [0.5, 0.02], [0.5, 0.01]])
  assert.equal(cameraDirection(f, 1.14).dir, null, 'a hand pinned at the frame edge is not measured')
}
// A still hand has no direction.
{
  const f = frames([[0.5, 0.500], [0.5, 0.502], [0.5, 0.499], [0.5, 0.501], [0.5, 0.500]])
  assert.equal(cameraDirection(f, 1.14).dir, null)
}
// Only frames inside the window are considered.
{
  const f = [...frames([[0.5, 0.1], [0.5, 0.9]], { t0: 0.1 }),
             ...frames([[0.5, 0.60], [0.5, 0.50], [0.5, 0.40], [0.5, 0.32], [0.5, 0.25]], { t0: 1.0 })]
  assert.equal(cameraDirection(f, 1.14).dir, 'up', 'frames before the window must not steer the verdict')
  assert.ok(CAMERA_WINDOW === 0.30)
}
// Frames after the beat are the return stroke and must be excluded.
{
  const f = [...frames([[0.5, 0.60], [0.5, 0.50], [0.5, 0.40], [0.5, 0.32], [0.5, 0.25]], { t0: 1.0 }),
             ...frames([[0.5, 0.35], [0.5, 0.50], [0.5, 0.65]], { t0: 1.18 })]
  assert.equal(cameraDirection(f, 1.14).dir, 'up', 'the return stroke falls after the beat and is never examined')
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/camera.test.mjs`
Expected: FAIL — cannot find module `../src/camera/direction.js`.

- [ ] **Step 3: Implement `cameraDirection(frames, beatTime)` in `src/camera/direction.js`**

Select frames in `(beatTime - CAMERA_WINDOW, beatTime]`. Decline with a distinct `reason` for: fewer than `MIN_FRAMES`, any selected frame not `inFrame`, any frame within `EDGE_MARGIN` of a border, displacement below `MIN_DISPLACEMENT`. Displacement is last-minus-first per axis; the larger absolute component picks the axis. Mirror the module-comment style of `src/ring/direction.js` — explain *why* a rule exists where the reason is not evident from the code.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/camera.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/camera/direction.js tests/camera.test.mjs
git commit -m "feat: derive stroke direction from camera hand displacement"
```

---

### Task 3: Fusion

**Files:**
- Create: `src/camera/fuse.js`
- Test: append to `tests/camera.test.mjs`

**Interfaces:**
- Consumes: Task 2's verdict shape.
- Produces: `export function fuseDirection(ringDir, verdict)` → `{ dir, source: "ring"|"camera", disagreed: boolean }`.

- [ ] **Step 1: Write the failing tests**

```js
import { fuseDirection } from '../src/camera/fuse.js'

const up = { dir: 'up', axis: 'vertical', displacement: 0.3 }
const down = { dir: 'down', axis: 'vertical', displacement: 0.3 }
const left = { dir: 'left', axis: 'horizontal', displacement: 0.3 }
const none = { dir: null, reason: '不在画面内' }

// The vertical pair is the confusable one: the camera overrules the ring there.
assert.deepEqual(fuseDirection('up', down), { dir: 'down', source: 'camera', disagreed: true })
assert.deepEqual(fuseDirection('down', up), { dir: 'up', source: 'camera', disagreed: true })
// Horizontal: the ring is not blind, so it keeps the call.
assert.deepEqual(fuseDirection('left', { dir: 'right', axis: 'horizontal', displacement: 0.3 }),
  { dir: 'left', source: 'ring', disagreed: true })
// Cross-axis disagreement is not the 166-degree confusion; the ring keeps it.
assert.deepEqual(fuseDirection('up', left), { dir: 'up', source: 'ring', disagreed: true })
// Fill-in: the ring declined, so any earned verdict is better than nothing.
assert.deepEqual(fuseDirection(null, up), { dir: 'up', source: 'camera', disagreed: false })
assert.deepEqual(fuseDirection(null, left), { dir: 'left', source: 'camera', disagreed: false })
// No verdict: the ring's answer stands untouched, including when it is null.
assert.deepEqual(fuseDirection('up', none), { dir: 'up', source: 'ring', disagreed: false })
assert.deepEqual(fuseDirection(null, none), { dir: null, source: 'ring', disagreed: false })
assert.deepEqual(fuseDirection('up', null), { dir: 'up', source: 'ring', disagreed: false })
// Agreement is not a disagreement.
assert.deepEqual(fuseDirection('up', up), { dir: 'up', source: 'ring', disagreed: false })
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/camera.test.mjs`
Expected: FAIL — cannot find module `../src/camera/fuse.js`.

- [ ] **Step 3: Implement `fuseDirection` in `src/camera/fuse.js`**

Pure, no imports beyond Task 2's `VERTICAL`. The comment must state why vertical is special, citing the 166° geometry in `src/ring/direction.js:37` — a future reader will otherwise read the asymmetry as arbitrary.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/camera.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/camera/fuse.js tests/camera.test.mjs
git commit -m "feat: fuse camera and ring directions per axis"
```

---

### Task 4: Wire fusion into the ring pipeline

**Files:**
- Modify: `src/ring/input.js` (beat path ~line 352, palm path ~line 349, `snapshot()` ~line 557, options ~line 19)
- Test: append to `tests/camera.test.mjs`

**Interfaces:**
- Consumes: `fuseDirection` (Task 3).
- Produces: `createRingInput({ cameraVerdict })` where `cameraVerdict(hand, pageTime)` returns a Task 2 verdict or `null`; `snapshot().rings[].offset`; `snapshot().cameraStats` with `{ fills, overrides, disagreements }`.

- [ ] **Step 1: Write the failing tests**

Drive `createRingInput` with a stub `WebSocketImpl` and synthetic IMU frames, following the existing harness in `tests/ring.test.mjs`. Assert:

```js
// A camera verdict reaches the beat and replaces a vertical misread.
// A camera verdict fills in where the ring declined.
// Review Focus 2: a cameraVerdict that throws must not break the beat.
{
  // ... input built with cameraVerdict: () => { throw new Error('revoked') }
  assert.ok(events.length > 0, 'a throwing camera must not stop beats reaching the game')
}
// With no cameraVerdict supplied, the emitted events are identical to the
// pre-camera pipeline: capture events from two inputs over the same frames,
// one with cameraVerdict omitted, and deep-compare.
// The left hand's palm direction is also fused.
// snapshot().rings[0].offset is a finite number.
// cameraStats counts fills and overrides separately.
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/camera.test.mjs`
Expected: FAIL — `cameraVerdict` is not consulted.

- [ ] **Step 3: Add the `cameraVerdict` option and fuse in `src/ring/input.js`**

Default `cameraVerdict = () => null`, matching the `cueDue` precedent at line 27. In the beat path, call it with `("right", event.t + ring.offset)` — the uncompensated page clock — and pass the result through `fuseDirection` **before** `onCue` and the return filter are computed, so suppression sees the fused direction. Wrap the call in try/catch; a throw means no verdict. Apply the same fusion to the left-hand palm direction after the `upObserved` mapping. Add `offset` to each ring in `snapshot()`, and a `cameraStats` counter object alongside `directionStats`.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/camera.test.mjs && npm test`
Expected: PASS, including the existing suites.

- [ ] **Step 5: Verify detection has not moved**

Run: `npm run eval > /tmp/eval-after.txt && git stash && npm run eval > /tmp/eval-before.txt && git stash pop && diff /tmp/eval-before.txt /tmp/eval-after.txt`
Expected: no differences. No camera means no change.

- [ ] **Step 6: Commit**

```bash
git add src/ring/input.js tests/camera.test.mjs
git commit -m "feat: let the camera decide vertical direction before return filtering"
```

---

### Task 5: The persisted disagreement log

**Files:**
- Create: `src/camera/log.js`
- Test: append to `tests/camera.test.mjs`

**Interfaces:**
- Produces: `export const LOG_KEY = "ringsymphony.cameralog.v1"`, `export const LOG_CAP = 500`, `export function createCameraLog({ storage, cap })` with `record(entry)`, `entries()`, `clear()`, `toJSON()`.
- Entry shape: `{ t, hand, axis, ring, cam, source, earned, frames: [{ t, w: [x,y], m: [x,y] }] }` — wrist and middle-finger base only.

- [ ] **Step 1: Write the failing tests**

```js
import { createCameraLog, LOG_CAP } from '../src/camera/log.js'

// Entries persist through the injected storage and survive a reconstruction.
// The cap drops the oldest entry, never the newest.
{
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const log = createCameraLog({ storage, cap: 3 })
  for (const t of [1, 2, 3, 4]) log.record({ t, hand: 'right', axis: 'vertical', ring: 'up', cam: 'down', source: 'camera', earned: true, frames: [] })
  assert.deepEqual(log.entries().map(e => e.t), [2, 3, 4])
  const reloaded = createCameraLog({ storage, cap: 3 })
  assert.equal(reloaded.entries().length, 3, 'the log must survive a refresh')
}
// Review Focus 3: storage that throws must not throw out of record().
{
  const hostile = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } }
  const log = createCameraLog({ storage: hostile })
  assert.doesNotThrow(() => log.record({ t: 1, frames: [] }))
  assert.deepEqual(log.entries(), [{ t: 1, frames: [] }], 'the session log still works without storage')
}
// Absent storage is tolerated.
assert.doesNotThrow(() => createCameraLog({ storage: null }).record({ t: 1, frames: [] }))
assert.equal(LOG_CAP, 500)
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/camera.test.mjs`
Expected: FAIL — cannot find module `../src/camera/log.js`.

- [ ] **Step 3: Implement `createCameraLog` in `src/camera/log.js`**

Follow the `readJson` try/catch pattern at `src/ring/input.js:10`. Hold entries in memory and mirror to storage; a storage failure degrades to session-only, exactly as roles and compensation already do.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/camera.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/camera/log.js tests/camera.test.mjs
git commit -m "feat: persist camera and ring disagreements for later labelling"
```

---

### Task 6: The tracker

**Files:**
- Create: `src/camera/tracker.js`
- Test: append to `tests/camera.test.mjs` (pure helpers only; MediaPipe is not loaded in Node)

**Interfaces:**
- Consumes: `cameraDirection` (Task 2), `@mediapipe/tasks-vision`.
- Produces: `export function createCameraTracker({ now, modelPath, wasmPath })` with `enable()` → `Promise<boolean>`, `disable()`, `verdict(hand, pageTime)`, `status()` → `{ state: "off"|"starting"|"on"|"denied"|"error", fps, hands: { left: boolean, right: boolean }, mismatch: boolean }`, `video` (the element for preview), `onStatus(cb)`.
- Also exports the pure helper `export function handedToRole(label)` → `"right"|"left"|null`.

- [ ] **Step 1: Write the failing test for the pure helpers**

```js
import { handedToRole } from '../src/camera/tracker.js'
assert.equal(handedToRole('Right'), 'right')
assert.equal(handedToRole('Left'), 'left')
assert.equal(handedToRole('nonsense'), null)
```

Note: importing `tracker.js` must not import MediaPipe eagerly, or this test cannot run in Node. Use a dynamic `import()` inside `enable()`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/camera.test.mjs`
Expected: FAIL — cannot find module `../src/camera/tracker.js`.

- [ ] **Step 3: Implement the tracker**

`enable()` calls `getUserMedia({ video: { width: 640, height: 480 } })`, dynamically imports `FilesetResolver` and `HandLandmarker`, creates the landmarker with `runningMode: "VIDEO"`, `numHands: 2`, and the local model path. Drive frames with `requestVideoFrameCallback` where available, falling back to `requestAnimationFrame`. Per result, map each hand via `handedToRole(result.handedness[i][0].categoryName)` and push `{ t: now(), x, y, inFrame }` into that hand's rolling buffer, keeping ~1s. Derive `x`/`y` from landmark 0 (wrist) and 9 (middle-finger MCP) midpoint, and retain both for the log. `verdict(hand, pageTime)` delegates to `cameraDirection`. Track observed fps for the status. Handle track `ended` and permission errors by moving to `denied`/`error` and emptying buffers so `verdict` naturally declines.

**Review Focus 5:** when both hands are visible and their horizontal order contradicts the assigned roles across a sustained run of frames, set `mismatch: true` in the status rather than silently trusting it. Do not auto-swap — surface it.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/camera.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/camera/tracker.js tests/camera.test.mjs
git commit -m "feat: track both hands with MediaPipe over the local webcam"
```

---

### Task 7: Opt-in, preview and status chip

**Files:**
- Create: `src/camera/panel.js`
- Modify: `index.html`, `src/style.css`, `src/main.js`, `src/ring/panel.js`

**Interfaces:**
- Consumes: tracker (Task 6), log (Task 5).
- Produces: `export function createCameraPanel({ tracker, log, chip, host, storage })` with `mount()`, `offerIfUnasked()`.
- `CAMERA_PREF_KEY = "ringsymphony.camera.v1"` holding `"on" | "off"`.

- [ ] **Step 1: Add the chip and preview markup**

A `#camera-btn` chip in the header beside `#ring-btn`, carrying `data-state` with the same on/wait/off vocabulary as `src/ring/panel.js:171`. A camera section inside the ring panel holding a mirrored `<video>` and a target box overlay. Mirror with `transform: scaleX(-1)` in CSS on the video element only — never on data passed to inference.

- [ ] **Step 2: Implement `createCameraPanel`**

`offerIfUnasked()` shows a one-time home-page offer when `CAMERA_PREF_KEY` is unset, explaining that the camera improves up/down detection and is optional, with a visible skip. Choosing yes stores `"on"` and calls `tracker.enable()`; skip stores `"off"` and never calls `getUserMedia`. On load with `"on"`, enable without re-asking. The panel section offers enable/disable, the framing preview, the mismatch warning from Task 6, and an export button producing `camera-log-<date>.json` from `log.toJSON()`, plus a clear button.

The target box must span the whole stroke range, not where the hand rests: the design's reasoning is that a full down-stroke may leave the bottom of a lid-webcam frame, which the player can only discover by seeing it.

- [ ] **Step 3: Wire into `src/main.js`**

Create the tracker and log, pass `cameraVerdict: (hand, t) => tracker.verdict(hand, t)` into `startRing`, mount the panel, and call `offerIfUnasked()` on reaching the home screen. Chip state follows `tracker.status()`. No toast when a hand leaves frame — the chip going amber is the whole signal.

- [ ] **Step 4: Verify in the browser**

Run `npm run ring` and `npm run dev`, open the page, and confirm: no permission prompt before opting in; the preview is mirrored; enabling then covering the camera turns the chip amber without interrupting anything; disabling returns the chip to off.

- [ ] **Step 5: Commit**

```bash
git add index.html src/style.css src/camera/panel.js src/main.js src/ring/panel.js
git commit -m "feat: offer the camera once, preview framing, show status in the header"
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/phase1-baseline.md`

- [ ] **Step 1: Document the camera in `README.md`**

In Chinese, matching the surrounding style. Cover: the camera is optional and improves up/down; how to enable it; that it runs locally and no video leaves the machine; that the explicit wave calibration is still required; and that the disagreement log can be exported for later labelling.

- [ ] **Step 2: Record what remains unmeasured**

Add a short section to `phase1-baseline.md` noting that camera fusion cannot be validated from `recordings/` (no video, no labels), that the hardware baseline table is still unfilled, and that the exported log is the intended route to a labelled dataset.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/phase1-baseline.md
git commit -m "docs: describe the optional camera layer and what it cannot yet prove"
```

---

## Self-Review

**Spec coverage.** Per-axis authority → Task 3. Fill-in → Task 3. Both hands → Tasks 4, 6. Direction-only, no latching → Task 4 (no tier code touched). Fusion before the return filter → Task 4. Uncompensated page clock → Task 4. Earning the verdict → Task 2. 300ms window → Task 2. Nothing waits → Task 4 (synchronous `verdict`). CSS-only mirroring → Task 7. Module boundary → Tasks 2, 3, 6 split. Main-thread inference → Task 6. Degradation → Tasks 2, 4, 6. Persisted log with export → Tasks 5, 7. One-time offer, no access before opt-in → Task 7. Model provenance → Task 1. Handedness vs role → Task 6. Silent calibration → explicitly deferred, no task.

**Gap found and closed:** the design says the log stores "the frames behind it" but left the landmark choice implicit; Task 5's entry shape pins it to wrist + middle-finger base, matching the measured volume table.

**Type consistency.** `cameraDirection` returns `{ dir, axis, displacement }` or `{ dir: null, reason }`; `fuseDirection` consumes exactly that and tolerates `null`; `tracker.verdict` returns the same shape; `input.js` consumes only `.dir` via `fuseDirection`. `handedToRole` returns the same `"right"|"left"` strings as `ring.hand`.

**Proportion.** Plan is shorter than the spec. Code blocks are tests and signatures; no implementation bodies except where a convention must be pinned.
