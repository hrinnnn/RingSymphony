# Calibration-free direction as the default

Date: 2026-11-15
Status: approved, not yet implemented
Size: small change

## Intent and why

Right-hand strokes that the player makes correctly are being refused. The
player wants two things: the four directions to land reliably, and the
twelve-wave calibration flow gone.

The calibration-free classifier in `src/ring/absolute.js` already does both.
It reads direction from geometry — rotation about the gravity vector for
left/right, linear acceleration along gravity for up/down — so there is
nothing to calibrate and nothing that varies with how the ring sits on the
finger. It is fully wired, selectable in the 指环 panel, and already bypasses
the calibration gate for both hands (`main.js:399-411`). It is simply not the
default (`input.js:70`).

### What the evidence says

Measured against the labelled recordings in `recordings/方向/` using the
project's own stroke/return splitter (`tests/absolute.test.mjs`):

| path | result |
|---|---|
| absolute (gravity frame) | 162/164 correct, **99%**, 1 wrong, 1 declined |
| template, over four gameplay logs it was diagnosed on | ~70% |

Robustness to dropped BLE frames, simulated by randomly discarding samples
before classification:

| frame loss | result |
|---|---|
| 0% | 162/164 (99%) |
| 5% | 160/161 (99%) |
| 10% | 162/163 (99%) |
| 20% | 162/164 (99%) |
| 30% | 156/160 (98%) |

This was the main risk in making it the default. It is not one.

For contrast, the eight logged sessions in this directory — all template mode
— split into two regimes: 84–94% fused accuracy in four, and 29–47% in the
other four, where the ring declined 16–23 of ~33 strokes with
与校准动作差异过大. That cliff is the problem being removed.

### What the evidence does not say

The 99% is measured on single-direction recordings, where the hand repeats one
motion. A level asks for four directions in sequence, and a stroke's shape
depends on where the previous one left the hand — which is why
`gesture-log.js` tracks accuracy per transition. **The absolute path has never
been measured in play.** No logged session used it: `yaw` and `vertical` are
null on all 261 recorded strokes.

So the first session after this change is the measurement, not a confirmation.
`input.js:14` already states this distinction and it still holds.

A rejected mid-conversation detour, recorded so it is not retried: a
"dominant-axis wins" rule scored 88% on an ad-hoc harness and looked like an
improvement. That harness was counting return strokes as strokes — the exact
error `phase1-baseline.md` warns about. Against the project's own splitter the
same rule scores 93% and turns `right` into `up` ten times. The existing
horizontal-first ordering in `classifyAbsolute` is load-bearing. Do not
"simplify" it.

## Goals

- `absolute` is the direction mode a new player gets, with no calibration step.
- The camera can never outvote the ring while the ring is healthy.
- The next played session produces a log that says *why* any stroke failed.

## Non-goals

- Removing the template classifier, the calibration UI, or `direction.js`.
  They stay as a fallback until 免校准 has survived real sessions.
- Changing `classifyAbsolute`, `AXIS_FLOOR`, the reversal filter, or any
  threshold. Nothing in the evidence asks for it.
- Changing the camera's own decoder. Its 45°-boundary problem is real (`right`
  cues travel at −42°, exactly on the decision line) but it is a separate
  piece of work, and under 免校准 the camera matters far less.
- Touching timing, judgement windows, or scoring.

## Anti-goals

- Tuning any threshold against the gameplay logs. They are template-mode logs;
  tuning the absolute path on them would repeat the Phase 1 mistake of fitting
  numbers to mislabelled data.
- Making the mode switch harder to reach or removing it. It is the rollback.

## Constraints

- `src/ring/absolute.js` and `src/camera/fuse.js` are pure — no DOM, no
  storage, no clock. Keep them that way; the tests depend on it.
- Mode switching mid-session must keep working, and must keep resetting the
  per-ring filters (`input.js:611-621`).
- `npm test` must stay green, including `tests/absolute.test.mjs`'s 97% floor.

## Approaches

**A. Flip the default only.** One word at `input.js:70`. Leaves `fuse.js`'s
distrust override in place. Cheapest, but keeps one path where a 53%-accurate
camera can take authority from a 99%-accurate ring; if it fires, the session
degrades quietly and the cause is easy to misattribute.

**B. Flip the default, and stop the camera outranking the ring in absolute
mode. ← chosen.** Adds a guard so distrust mode cannot engage when the
absolute classifier is live. The camera still fills in strokes the ring
declines, which can only turn a guaranteed no-score into a score. Small, and
it closes the one way this change could silently make things worse.

**C. Delete calibration outright.** Remove `direction.js` templates, the
twelve-wave flow, the per-address storage. This is where the project is
heading, but doing it now discards the fallback before the replacement has
survived a single real session.

B was chosen because the distrust override was tuned for the template
classifier's bad days — the regime being retired — and under 免校准 its
trigger condition should never be met. A guard that never fires costs nothing;
the absence of one costs a confusing session. C follows once a couple of
sessions confirm 免校准 in play.

## The design

### 1. Default to `absolute`

`input.js:70` becomes `let directionMode = "absolute"`.

### 2. Ignore stored template choices once

`MODE_KEY` moves from `ringsymphony.direction-mode` to
`ringsymphony.direction-mode.v2`.

Reason: the stored value is only written when the player explicitly picks a
mode (`input.js:611`). Anyone who tried the switch earlier and went back has
`"template"` pinned, and a new default would never reach them — including this
player, who has eight template sessions behind them. Bumping the key makes the
flip actually take effect once; a choice made *after* this change still
persists normally. My call, not the player's.

### 3. Distrust cannot engage in absolute mode

`fusion.fuse` takes a third argument, and `input.js:472` passes
`{ allowDistrust: !absolute }`. Inside `fuse.js`, when `allowDistrust` is
false the refusal rate is still tracked (so the panel's `ringDistrusted`
readout stays meaningful) but `decide` is called with `distrusted = false`.

Keeps `fuse.js` pure and leaves the template path's behaviour byte-identical.

### 4. Panel copy

The mode note already describes both paths correctly
(`panel.js:233-235`). Update only what implies template is the norm, so the
calibration section reads as the fallback rather than the expected first step.

## What is left to the builder

- Where to put the `allowDistrust` branch inside `fuse.js` — in `fuse` before
  calling `decide`, or as a parameter threaded into `decide`. Either is fine;
  `decide` must stay a pure function of its arguments.
- Exact Chinese wording for the panel copy, matching the existing register.
- Whether the new test for the distrust guard lives in `tests/camera.test.mjs`
  (where `fuse.js` is covered) or `tests/ring.test.mjs` (where the wiring is).
  Prefer the former for the pure behaviour, the latter if asserting the flag
  actually reaches `fuse` from `input.js`.

## Verification

Automated, before the player touches it:

- `npm test` green, with `tests/absolute.test.mjs` still at 162/164.
- A new test: with the absolute classifier live and the ring declining every
  stroke, a camera verdict above `DISTRUST_DISPLACEMENT` does **not** override
  a ring answer. The same scenario in template mode still does.
- `npm run eval` byte-identical to before, confirming the detectors are
  untouched.

Then, on hardware — this is the part that actually decides:

1. Open the 指环 panel. Confirm it starts in 免校准 with no calibration
   prompt, and that no calibration gate blocks starting a level.
2. Play 第一乐章 without calibrating anything.
3. Export the gesture log and read, in this order:
   - `mode` — must be `"absolute"`, or the session measures nothing new.
   - `ring.answered` vs `ring.silent` — the template sessions' failure was
     refusal. This should be near-zero silence.
   - `axes` per direction: `nearMiss` means strokes read correctly but under
     `AXIS_FLOOR`, and a floor change is then justified by data. `confidentlyWrong`
     means the measurement pointed the other way, which no threshold fixes.
   - `transitions` — the thing the recordings cannot show. A direction failing
     only after a particular predecessor is the shape of a real problem.
   - `source` — any `camera` on a stroke the ring answered means the distrust
     guard failed.

The player's own judgement of whether strokes land is the measure that counts.
The log says what to change if they do not.

## Rollback

One click to template in the 指环 panel. Nothing is deleted by this change.
