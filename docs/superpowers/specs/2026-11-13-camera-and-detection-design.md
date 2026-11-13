# Camera-assisted conducting and relative gesture detection

**Date:** 2026-11-13
**Status:** Design, awaiting approval
**Branch:** `fix/fist-false-trigger`

## Intent

Ring Symphony currently reads conducting gestures from two Ringo IMUs alone. Two
problems come out of that:

1. **Gentle motion is unreliable.** A soft beat often fails to register, while
   incidental motion sometimes registers as a beat. The player has no way to
   tune this.
2. **Calibration is a wall.** Before playing, the player must wave in four
   directions three times each. It frequently rejects the attempt with
   「某方向的三次动作差异过大」 and must be redone. Nothing is persisted, so it
   is redone on every refresh, reconnect, or ring swap.

We are adding a webcam as a second sensing layer. The camera is **recommended
but never required** — the game must remain fully playable without it.

The why: a ring reports rotation in its own axes, which depend on how it sits on
the player's finger. That dependence is the root cause of calibration existing
at all. A camera reports hand position in screen coordinates, which are the same
for everyone. The two sensors fail in different ways, and combining them covers
both.

This document covers **关卡模式 (rhythm levels) only**. Free mode is deferred;
see Phase 3.

## Goals

- A gentle conductor and an energetic conductor both play well, without either
  tuning settings or recalibrating.
- Incidental motion does not register as a beat. Deliberate-but-soft motion
  does.
- A returning player does not recalibrate.
- A single sloppy calibration wave does not invalidate the attempt.
- With a camera, direction accuracy improves and calibration burden drops.
- Without a camera, the game plays at least as well as it does today.

## Non-goals

- Free mode (cursor, lasso selection, instrument-group targeting). Deferred to
  Phase 3. Phase 2 is built so Phase 3 can adopt it.
- Camera-driven panning of the play view. Deferred with free mode.
- Replacing the ring as the timing authority. The ring stays authoritative for
  *when*; see "Division of labour".
- Depth sensing. The game defines up/down as screen up/down
  (`README.md`: 上下是屏幕上的上下，不是前后), so the 2D image plane is
  sufficient.
- Recognising *which* instrument group is pointed at. That is free mode.

## Anti-goals

Outcomes that would make this a failure even if it technically works:

- **The camera becomes load-bearing.** If a player without a webcam, with
  denied permission, or in a dim room gets a degraded or blocked experience,
  we have made the game worse. Camera absence must be silent and total: the
  game behaves exactly as Phase 1 leaves it.
- **Two sensors mean two things to calibrate.** If camera setup introduces its
  own calibration step, we have moved the burden rather than removed it.
- **Fusion makes detection more brittle.** Requiring both sensors to agree
  would mean a beat dies when *either* is uncertain — strictly worse than
  today. The camera must only ever add information.
- **Timing accuracy regresses.** Camera latency must never enter the judgment
  path.

## Constraints

- **Camera latency.** Glass-to-answer for a webcam is roughly 50-100ms
  (exposure 10-30ms, readout and USB 10-20ms, browser pipeline ~1 frame,
  inference 10-30ms), and samples arrive only every ~33ms at 30fps. Constant
  latency can be subtracted; jitter cannot. The ring samples at 200Hz. The
  camera therefore cannot be in the timing path.
- **Lighting.** In dim conditions, exposure lengthens (blurring the hand) and
  framerate often halves. This is the dominant failure mode for camera
  tracking, more than hardware quality.
- **Existing judgment windows.** Perfect ±120ms, Good ±250ms. Unchanged.
- **Existing architecture.** `src/ring/detectors.js` and `src/ring/direction.js`
  are pure functions with no DOM, so the same code runs in the browser and in
  Node replay tests (`npm test`, `npm run eval`). New detection logic must
  preserve this.
- **Parallel work.** A teammate is working on UI in the same repo. Camera work
  should stay in new modules where possible. `src/ring/panel.js` is the likely
  collision point and needs coordination.
- **Reference recordings.** `recordings/` holds 24 IMU recordings used by
  `npm run eval`. They are other people's motions with no per-repetition
  labels, and carry no video. They bound threshold choices; they cannot
  validate camera fusion.

## Current behaviour (verified in code)

Relevant facts, each confirmed by reading the source:

- **Beat detection is already relative.** `detectors.js:72`:
  `const level = Math.max(o.beatFloor, o.beatRise * mean)` where `mean` is a
  running average of |ω| with a 1s time constant (`beatTau`). The trigger is
  15% above recent motion.
- **An absolute floor overrides it for gentle motion.** `beatFloor` defaults to
  1.6 rad/s (≈92°/s). The relative term only exceeds it once `mean` > 1.39
  rad/s. **This is the leading hypothesis for 轻动识别不准** — the relative logic
  exists but does not engage for soft conductors. It is *not* confirmed:
  `npm run eval` shows the right-hand detector firing 34-55 beats on 三拍/四拍
  recordings containing roughly 30-45 real beats, i.e. over-triggering at
  defaults rather than under-triggering. Those recordings are not gentle play,
  so they neither confirm nor refute the hypothesis. Confirm against the
  player's own 诊断信息 before treating the fix as validated.
- **An adaptive floor is already computed but rarely active.**
  `direction.js:100-102` derives `beatFloor` from calibration speeds (70% of
  the slowest calibration wave, clamped to [0.65, 1.6]) — but only when all
  four directions have recorded speeds. An incomplete calibration leaves the
  1.6 default.
- **Calibration averages 3 samples with no outlier rejection.**
  `direction.js:85` requires every sample to lie within 45.6° (`cos⁻¹(0.7)`) of
  the centroid of all three. With n=3, one bad wave drags the centroid roughly
  a third of the way toward itself, which can push the two good waves outside
  the tolerance. One slip fails all three.
- **Calibration is all-or-nothing.** `direction.js:98`:
  `ready: complete && !issue`. One bad direction marks the entire right hand
  uncalibrated, blocking level start at `main.js:236`.
- **Nothing is persisted.** Samples live in closure variables, lost on refresh,
  reconnect, or ring change (`direction.js:65` `reset()`).
- **Direction classification uses fixed cutoffs.** `direction.js:160-161`:
  reject if best score < 0.8 (36.9°), or if best and runner-up differ by
  < 0.08.
- **Direction features come from a 150ms pre-peak window.**
  `direction.js:17`, requiring ≥10 frames, no gap > 65ms, at most one gap
  > 30ms, and ≥80ms of continuous coverage.
- **Return strokes are suppressed** within 460ms when near-opposite
  (`direction.js:37`, `RETURN_WINDOW`, cosine < -0.8).
- **The fist detector ends levels on an absolute jerk threshold.**
  `detectors.js:19` `fistJerk: 40000` (°/s²) over a 4-sample window, routed
  straight to `finish()` with no confirmation (`main.js:186`). It runs on both
  hands. This is believed to cause spurious "performance complete" during play;
  **not yet confirmed from diagnostics**.
- **localStorage persistence has precedent.** `input.js:6-7` already persists
  hand roles (`ringsymphony.roles.v2`) and timing compensation
  (`ringsymphony.compensation`) via a `readJson` helper with try/catch.

- **The fist detector keeps a 4-entry buffer** (`detectors.js:111-115`), despite
  the comment at `detectors.js:18` saying "Measured over 3 samples". The code is
  authoritative; the comment is stale and should be corrected in passing.

## Decided: nothing waits for the camera

**No part of the beat path may be deferred to wait for camera data.** The
on-screen hand moves on the ring's event, immediately. Scoring uses the ring's
timestamp. A soft beat must not feel late.

This is a hard constraint, not a preference, and it shapes corroboration:

- **Chart proximity costs nothing.** Expected cue times are already known, so
  this tie-break is instant.
- **The camera supplies whatever has already arrived.** The direction window is
  the 150ms *preceding* the beat peak — frames already captured. Given ~50-100ms
  pipeline latency, most of that window has been processed by the time the ring
  fires; roughly the final 75ms has not. Use the available portion and proceed.
  Do not block on the remainder.

Consequence: no deferral buffer, and `onEvent` keeps its current synchronous
shape (`input.js:324-325`), including the `age` computation. This removes the
largest architectural unknown in the design.

Open question for the builder: whether the truncated window degrades direction
accuracy enough to matter. Gross left/right displacement should survive losing
the last 75ms, but this needs measuring on real hardware.

## Decided: a missing direction blocks levels that need it

When a direction fails calibration, the player is told which direction is
missing and asked to calibrate it. Levels requiring that direction are blocked
until they do.

No auto-Miss, and no letting unclassified beats through — both would silently
cost the player points for a setup problem. The message must name the specific
direction and offer a direct path to calibrating only that one (the 补录方向
flow already exists), never a full recalibration.

Per `chart.js:1-4`, 4/4 levels use all four directions and 3/4 levels use
down/right/up, so a missing `left` still permits waltz levels. The gate is
per-level, not global.

## Decided: fist no longer ends a rhythm level

Remove the fist → `finish()` path from 关卡模式 (`main.js:186`). The gesture
belongs to free mode, where `main.js:361` uses it musically — the orchestra
winds down over the current bar (握拳收束 · 这一小节后谢幕). That use stays.

In rhythm mode it is an irreversible kill switch reachable by a single spike on
either hand, which is strictly a liability.

This is a documented behaviour change: `README.md` lists 握拳 as working on
任一只手 to end a performance. Update the README in the same change.

Supporting evidence (`npm run eval`, 24 recordings): the detector is accurate
at `fistJerk: 40000` — zero fires across all three 走路及日常 recordings, 5-8
per 握拳 recording, one stray on `指定/zzw`. The problem was never detection
sensitivity; it was that a single detection was irreversible.

## Decided: pause instead

Rhythm levels get a pause with explicit **resume** or **end** rather than an
instant abort. A misfire should cost a moment, not the run.

Trigger, in order of preference:

1. **The ring's physical button**, if it proves pleasant in practice.
2. **Keyboard**, which works today and should ship first regardless.

The button is not currently reachable and requires patching Ring Studio:

- `stream_hub.py:140` rejects every stream except `imu`
  (`if set(streams)-{"imu"}: raise`).
- `engine.py:358` only ever calls `publish_imu`; there is no button publisher.
- The firmware does send the events — `API_README.md:151` documents the packet
  (`27 02`, then `seq:u16, event:u8, uptime_ms:u32`) and Ring Studio already
  decodes and displays them in 按钮事件.
- `API_README.md:5` confirms the TCP interface deliberately excludes them:
  不提供…按钮订阅.

So the work is: add a button publisher alongside `publish_imu`, permit
`"button"` in the subscribe filter, forward it through `bridge/server.mjs`.
Small — roughly 20-30 lines across two repos — but it forks a vendor package
and must be re-applied on Ring Studio upgrades. Weigh that against
keyboard-only before committing.

**Unverified:** ~~how the button behaves physically~~ — resolved, see below.

**Verified on hardware** (Ringo3E1A, firmware 2.0.2, 按钮事件). One physical
press emits three events, labels matching `ringo_protocol.py:10`:

| # | Event | Δ from press |
|---|---|---|
| 96 | 按下 press | 0 ms |
| 97 | 松开 release | +213 ms |
| 98 | 单击 single click | +514 ms |

Consecutive sequence numbers indicate no dropped events.

**Bind 按下, not 单击.** 单击 lands 514 ms after the press (301 ms after
release) because the firmware waits out the double-click window before
committing. Half a second of lag on a pause is clearly perceptible; 按下 fires
immediately.

The cost is that 按下 cannot be told apart from the beginning of a long-press or
double-click, so one button does one thing. If 长按 or 双击 is later wanted for a
second action, either accept that it pauses first, or move pause to 单击 and
accept the delay.

The firmware distinguishes five codes — 按下 / 松开 / 单击 / 长按 / 双击
(`ringo_protocol.py:10`) — so gesture disambiguation is handled on-device and
does not need inferring from press/release timing.

## Decided: camera is additive first, authoritative later

When camera and ring disagree on direction, **the camera does not override at
first**. It fills in only where the ring is uncertain.

Every disagreement is logged: ring's classification, camera's, and which the
player's subsequent behaviour suggests was right (an immediate retry of the
same cue is a reasonable signal of a wrong call).

Once that data shows the camera winning disagreements on real hardware, flip it
to authoritative.

Rationale: camera-wins is very likely correct in principle, since screen
coordinates are wearer-independent while ring axes are not — that is the core
argument for having a camera at all. But a wrong direction scores an outright
Miss (`main.js:144`), so an overriding camera that errs actively costs points
versus no camera, violating the anti-goal that the camera must only ever add
information. There is currently no data on this player's lighting, webcam, or
tracker behaviour. Additive-first captures most of the benefit at no risk and
converts the question into a measurable one.

## Division of labour between sensors

The central design decision. The two sensors answer **different questions**
rather than voting on the same one:

| Question | Authority | Why |
|---|---|---|
| *When* did the beat happen? | **Ring** | 200Hz, feels the angular-velocity peak directly. Camera is 50-100ms late with ~33ms granularity. |
| *Which direction* did the hand go? | **Camera** (when confident) | Screen coordinates need no per-wearer translation. Ring axes depend on how the ring sits. |
| *Was this deliberate or noise?* | **Camera** (when present) | A twitch produces no screen displacement. |

Three consequences follow:

**Calibration becomes largely unnecessary for direction.** The ring needs
teaching because its axes are wearer-dependent. The camera's are not.

**The return-stroke problem resolves for free.** A wave right must be followed
by a move left to return. The camera alone cannot tell which stroke was
intended. But the ring timestamps the beat at time T, and the camera is then
asked only about the window *before* T — the outbound stroke. The return falls
after T and is never examined. Neither sensor solves this alone.

**Fusion is permissive, not restrictive.** The camera answers only when it has a
clear answer; otherwise the ring's classification stands. There is no AND gate.
Disagreement is resolved per "Decided: camera is additive first, authoritative
later" — the ring's classification stands initially and the disagreement is
logged.

## Relative detection

The player's framing: detection should be relative, not absolute — ignore noise,
recognise intent, without demanding a fixed motion size.

Three changes carry this:

**1. The beat floor adapts without calibration.** Replace the fixed 1.6 rad/s
floor with one learned from the player's own motion: track a low percentile of
|ω| over a rolling window and set the floor from that. A gentle conductor gets a
gentle bar on their first session. The existing calibration-derived floor stays
as a refinement when available. The clamp range needs care — too low and resting
tremor triggers beats; `[0.65, 1.6]` from the existing code is the starting
point, and the lower bound should be validated against the 走路及日常 recordings,
which contain non-conducting motion.

**2. Two thresholds instead of one.** Today a motion is a beat or it is not.
Instead:

- Above a **high bar**: accept outright.
- Below a **low bar**: reject outright.
- Between: accept only with corroboration — proximity to an expected beat time
  in the chart, or camera-observed hand displacement.

Deliberate-but-soft motion passes, because it has corroboration. Noise does not,
because it has neither. Both bars are relative to the player's running mean.

Note the risk: using chart proximity as corroboration makes detection
self-fulfilling near expected beats, which could mask genuine timing error. The
corroboration window must be meaningfully wider than the Perfect window so it
admits notes without flattering them, and the two corroboration sources should
be separable in testing.

**3. Direction scoring is relative to the player's own spread.** Replace the
fixed 0.8 cutoff with a comparison against how well-separated this player's four
calibrated directions actually are. Well-separated directions permit a looser
cutoff; clustered ones demand a tighter one.

## Phase 1 — Detection and calibration, no camera

Self-contained, playable on its own, and derisks Phase 2.

**Adaptive beat floor.** As above. Removes the dependence on complete
calibration for gentle play.

**Two-tier beat acceptance.** As above.

**Outlier rejection in calibration.** One sloppy wave must not invalidate a
direction. The method is the builder's call, with one constraint: **it must not
increase the number of waves the player performs.** Calibration being a wall is
the problem being solved, so collecting more samples to get robustness trades
against the goal. Median-of-3, or re-prompting only the sample that failed,
both achieve outlier resistance at the current 12 waves.

**Per-direction validity.** Replace all-or-nothing `ready` with per-direction
status, consumed as described in "Decided: a missing direction blocks levels
that need it". `ready` is currently read at six sites (`main.js:236`,
`direction.js:153`, `input.js:238`, `input.js:287`, `input.js:302`,
`panel.js:211`) and each needs its own answer — level gating asks "are the
directions *this level* needs valid?", while classification asks "is *this*
direction valid?". Do not collapse them back into one boolean.

**Persist calibration.** localStorage keyed by ring address, following the
existing `ROLE_KEY`/`COMP_KEY` pattern in `input.js`. Include a version field
for format changes, a timestamp, and provide an explicit "recalibrate" path.

Invalidation needs care beyond address matching. `assign()`
(`input.js:146-164`) calls `direction.reset()` whenever the right-hand role
moves, auto-allocation (`input.js:167-189`) can silently change which physical
ring is "right", and 交换左右 (`input.js:430-433`) deliberately swaps them. A
calibration captured while a ring was worn on the right hand is wrong for that
same ring worn on the left. **Persisted calibration must therefore be keyed by
address *and* hand**, and discarded when either changes.

**Relative direction scoring.** As above.

**Remove fist-ends-level; add pause.** Per "Decided: fist no longer ends a
rhythm level" and "Decided: pause instead". Keyboard-triggered pause ships in
Phase 1; the ring button is optional follow-on work requiring a Ring Studio
patch. Leave `fistJerk` alone — eval shows it discriminates well, and removing
the consequence makes its sensitivity moot in rhythm mode.

This supersedes any threshold tuning: because the fist no longer ends a level,
confirming whether it was firing spuriously is no longer a prerequisite. The
diagnostic check is still worth doing if levels continue ending early *after*
this change, since that would point at a different cause.

## Phase 2 — Camera as a recommended layer

**First-run setup.** A screen before first play that explains the camera,
recommends it, shows what it improves, and offers a clearly visible skip. The
choice persists and is changeable in 设置.

**Hand tracking.** A browser hand-landmark model over `getUserMedia`. Library
choice is the builder's, subject to: runs locally with no network inference,
works in-browser, and licensing fits the project. MediaPipe Hands is the
obvious candidate. The tracker should run off the main thread if that is
achievable without undue complexity, since the render loop is already doing
Three.js work.

**Displacement, not pose.** The camera supplies hand position per frame.
Direction comes from displacement over the window preceding the ring's beat
timestamp. Displacement magnitude doubles as the confidence measure and as the
noise gate — no separate confidence model. Hand position must be mapped to a
consistent frame of reference and mirrored appropriately, so that "right" means
the player's right regardless of the camera's mirroring.

**Fusion.** As described in "Division of labour": ring times, camera directs,
camera gates noise, permissive not restrictive.

**Silent calibration.** When the camera confidently observes a direction and the
ring simultaneously records its gyro signature, that pair is a labeled training
sample acquired with no prompt. Accumulating these should let direction
calibration improve during play, and eventually replace the explicit wave
sequence for camera users. Open question for the builder: whether accumulated
silent samples should also be persisted, and how they should interact with
samples from explicit calibration (weighting, precedence, or kept separate).

**What survives.** The gyro-bias estimate stays — it measures the ring's own
sensor drift, which no camera can observe.

Note it is not currently standalone. `input.js:258-273` requires 40 frames,
≥0.35s of samples, ≥0.55s elapsed and deviation < 0.35, embedded in the
`automatic.state === "settle"` machine that *is* the prompted calibration flow.
If explicit direction calibration goes away for camera users, extracting a
standalone bias estimator is real work, not a no-op.

**Two hands, one camera.** Both hands wear rings and both conduct. The camera
sees up to two hands and must map each to the correct ring — including when
hands cross, when only one is in frame, and when tracking swaps identities
between frames. A wrong mapping would feed the right hand's displacement to the
left hand's beat. The approach is the builder's call, but it is foundational to
fusion rather than an edge case.

**Gaining the camera mid-level.** Degradation covers losing the camera. Gaining
it mid-performance also changes effective sensitivity, since the mid-tier noise
gate appears. Prefer holding the sensing configuration stable for the duration
of a level over changing thresholds under an active performance.

**Degradation.** No camera, denied permission, tracking lost, hand out of
frame, poor light — each falls back to Phase 1 behaviour without interrupting
play. The player should be able to tell whether the camera is currently
contributing, but should not be nagged.

**Measure the real latency.** Once running, measure actual camera latency on
real hardware instead of relying on the estimates above, and feed it into the
existing 判定延迟 compensation.

## Phase 3 — Free mode (deferred)

Not designed here. Recorded so Phase 2 does not foreclose it: cursor control for
instrument-group selection, lasso selection (the README notes existing
`lassoParts` logic can accept screen-space closed paths), and camera panning.

**Panning decision.** Panning is deliberately excluded from rhythm mode. Notes
fly toward judgment rings at fixed screen positions; moving those rings because
the player leaned would make a timing game fight its player. If panning is
wanted in rhythm mode, it should move the **background only** — orchestra,
curtains, organ — with judgment rings and note lanes locked.

**Panning follows the head, not the hands.** The hands are conducting; using
them to pan would make every beat swing the view, and in free mode would make
reaching toward an instrument group pan away from it. Head tracking is also the
easier signal: faces are large, consistent, rarely leave frame, and do not
self-occlude. Hands are better used as a fallback when the face is lost — hold
or drift gently rather than snapping.

## Measuring whether this worked

Every goal above is qualitative, and the recordings cannot validate the
changes. Without an instrument, Phase 1 could ship with nobody able to say
whether it helped.

The instrument already exists: `directionStats` in `input.js:40` counts
`accepted`, `data`, `weak`, `mismatch`, `mismatchGap`, `ambiguous`,
`uncalibrated` and `suppressed`, surfaced in 诊断信息 (`panel.js:213-214`).

Before changing anything, record a baseline: play each level with these
counters cleared and note the distribution, for both a gentle and an energetic
conductor. After each Phase 1 change, repeat and compare. Specifically:

- `uncalibrated` and `mismatch` should fall (calibration fixes working).
- `accepted` should rise relative to total candidates (detection improving).
- `weak` falling without `accepted` rising means the floor dropped too far and
  noise is being promoted into candidates.

These counters only cover candidates that reached the detector. Motion too soft
to trigger at all is invisible to them, which is precisely the 轻动 case — so
also count Misses on cues where the player believes they conducted. Keep the
baseline numbers in the repo alongside this document.

## Testing

`npm test` must keep passing. Detection logic stays pure so replay tests work.

The recordings in `recordings/` have no video and no per-repetition labels, so
they bound Phase 1 threshold choices but cannot validate Phase 2 fusion.
Phase 2 needs synchronised ring-and-video capture to test honestly — at minimum
a manual real-hardware pass in both good and poor lighting, with a gentle
conductor and an energetic one.

The existing README is candid that replay passing does not demonstrate real-use
accuracy. That remains true here.

## Decisions left to the builder

- Hand-tracking library, subject to the constraints above.
- Rolling-window length and percentile for the adaptive floor; the clamp range,
  validated against 走路及日常.
- The two bar values for tiered acceptance, and the corroboration window width.
- How many samples to collect and discard in calibration (5-discard-1 is the
  starting suggestion, not a requirement).
- Storage schema and versioning for persisted calibration.
- Whether silent-calibration samples persist, and how they interact with
  explicit calibration samples.
- Whether the tracker runs in a worker.
- Where camera status surfaces in the UI, coordinated with the teammate's work.
