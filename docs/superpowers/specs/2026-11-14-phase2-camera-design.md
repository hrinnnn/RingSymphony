# Phase 2: Camera as a second sensing layer

**Date:** 2026-11-14
**Status:** Design, awaiting approval
**Supersedes:** the Phase 2 section of
`2026-11-13-camera-and-detection-design.md` (that document's Phase 1 and
Phase 3 sections stand unchanged)

## Intent

The ring cannot tell an up-stroke from a down-stroke. This is not a tuning
problem, and it is already documented in the code. `src/ring/direction.js:37`:

> Up and down sit about 166 degrees apart in practice, so a real down-stroke
> and the return of an up-stroke are the same motion as far as the gyroscope
> is concerned — **no cosine threshold can separate them.** Left and right sit
> about 95 degrees apart and their returns travel a different arc, which is
> why only the vertical pair suffers.

A gyroscope measures rotation in the ring's own axes. Those axes depend on how
the ring sits on the finger, and the two vertical strokes are very nearly the
same rotation. A camera measures displacement in screen coordinates, which are
the same for every wearer, and up is unambiguously up.

So the camera is not a general accuracy improvement bolted on for its own
sake. It is the only available fix for one specific, measured blindness, and
that is the axis it is justified by.

The camera is **recommended but never required**. The game must remain fully
playable without it.

This document covers 关卡模式 (rhythm levels). 自由模式 is deferred, but one
decision here is made for its benefit: see "The module boundary".

## Goals

- Vertical direction (up vs down) becomes reliable when the camera is present,
  for both hands — the right hand's beat strokes and the left hand's
  渐强/渐弱 palm gestures.
- Beats the ring cannot classify at all get an answer instead of a toast.
- Horizontal direction (left vs right) does not regress.
- Timing is untouched. The ring remains the sole authority on *when*.
- Absence of a camera — no hardware, denied permission, dark room, hand out of
  frame — behaves exactly as Phase 1 does today, on every one of those paths.
- The player can tell whether the camera is helping, without being nagged.
- The module produced here is the one 自由模式 will use, not a prototype to be
  rewritten.

## Non-goals

- 自由模式: cursor control, lasso selection, open-palm detection as an
  interaction. Deferred. The module must not foreclose it.
- Camera-driven panning of the play view.
- Replacing the ring as the timing authority.
- Depth. Up/down is screen up/down (`README.md`: 上下是屏幕上的上下，不是
  前后), so the 2D image plane suffices.
- Removing the explicit calibration wave sequence. Silent calibration is
  attractive but unproven; see "Deferred: silent calibration".

## Anti-goals

Outcomes that would make this a failure even if it technically works:

- **The camera becomes load-bearing.** A player without a webcam must get the
  Phase 1 experience exactly, with no degraded path and no nagging.
- **The camera makes scoring worse.** The camera is given authority on
  vertical, which means a camera error can now cost a Miss where previously it
  could not. This is only acceptable because it overrules a sensor that is
  blind on that axis. If the camera's vertical answer is not trustworthy, it
  must decline rather than guess — see "Earning the vertical verdict".
- **Fusion becomes an AND gate.** Requiring both sensors to agree would kill a
  beat whenever either is uncertain: strictly worse than today.
- **Camera latency enters the timing path.** Nothing waits for a frame.
- **A second thing to calibrate.** The camera introduces no calibration step.

## Constraints

- **Hardware, as stated by the player.** Laptop lid webcam. One person wears
  both rings. Hands held out in front, both visible at once. The player will
  keep their hands in view.
- **Camera latency** is roughly 50-100ms glass-to-answer, with samples every
  ~33ms at 30fps. Constant latency can be subtracted; jitter cannot. The ring
  samples at 200Hz. The camera therefore cannot be in the timing path.
- **Lighting** is the dominant failure mode. In dim conditions exposure
  lengthens (blurring the hand) and framerate often halves, to ~15fps.
- **Existing judgment windows.** Perfect ±120ms, Good ±250ms. Unchanged.
- **Purity.** `src/ring/detectors.js` and `src/ring/direction.js` are pure
  functions with no DOM, so the same code runs in the browser and in Node
  replay tests. New fusion logic must preserve this: the camera module touches
  the DOM, the fusion logic must not.
- **A teammate works in this repo.** Camera work stays in new modules.
  `src/ring/panel.js` is the likely collision point.
- **The repo has no labelled direction dataset.** See "Measuring whether this
  worked" — this constrains what may be claimed.

## Verified facts about MediaPipe

Taken from the type definitions in `@mediapipe/tasks-vision` 1.2.3
(Apache-2.0), read directly rather than from documentation:

- **Handedness is reported by the model.** `HandLandmarkerResult.handedness:
  Category[][]`. This resolves the "two hands, one camera" problem that the
  previous design flagged as foundational: hand-to-ring mapping does not need
  to be inferred from tracking heuristics.
- **Handedness inverts under mirroring.** Verbatim from the type definitions:
  *"Left and Right handedness correspond to the subject's hands, not the
  viewer. Passing a horizontally mirrored image will invert these outputs."*
  This is a trap, and it dictates a decision below.
- **`detectForVideo(image, timestamp)`** exists with `runningMode: "VIDEO"`.
  The caller supplies the timestamp, so frames can be stamped on the game's
  own clock rather than inferred.
- **Landmarks are normalized to 0-1** (`NormalizedLandmark`), with a
  `visibility` field and an optional `presence` field. Resolution-independent.
- **`createFromModelBuffer`** accepts a local model buffer; no CDN is required
  at runtime.
- **The wasm ships inside the npm package** (`@mediapipe/tasks-vision/wasm/`,
  14MB per binary). The `.task` model file does **not** ship in the package.

## Approaches considered

**A. Bundle the wasm and model in the repo.** Fully offline, reproducible, no
CDN. Rejected on a false premise initially — the wasm appeared to need
committing. It does not: it arrives via `npm install` like `three` and `tone`,
and `node_modules/` is already gitignored.

**B. Load both from a CDN at runtime.** One line, nothing committed. Rejected:
the design requires local inference with no network dependency, and a wifi
failure would silently remove the camera at a conference or demo.

**C. Fetch on first use and cache.** Repo stays small, offline works after
first run. Rejected: it adds a download step and a cache-eviction failure mode
to first run, to save committing one file.

**Chosen: A, as corrected.** The wasm comes from npm. Only the `.task` model
(~7MB) is committed, because npm does not provide it. Vite serves the wasm
from `node_modules` in dev and copies it to `dist/` on build.

On repo size, since this will be pushed for teammates: git has no hard limit,
but GitHub warns above 50MB per file and blocks at 100MB. Neither is
approached. The real cost of committed binaries is that git keeps every
version forever and binaries do not delta-compress, so each model upgrade adds
its full compressed size to the pack permanently. One ~7MB file against a
3.6MB repo is a deliberate, bounded cost, taken once, in exchange for the game
working with no network.

## Decided: per-axis authority

When the camera and the ring disagree on direction, what happens depends on
the axis, because the sensors' weaknesses differ:

| Axis | Ring | Camera | On disagreement |
|---|---|---|---|
| up / down | **Blind.** 166° apart; no threshold separates them (`direction.js:37`) | Strong: vertical displacement is large and unambiguous | **Camera wins**, when it has earned a verdict |
| left / right | **Good.** 95° apart, returns travel a different arc | Also good | **Ring wins**; the disagreement is logged |

Both sensors contribute on both axes. The table governs only the rare
disagreement.

## Decided: the camera fills in when the ring has no answer

The table above covers disagreement. The more common case is the ring
returning **no direction at all**: `classifyDetailed` rejects when the best
score is below 0.8 or the runner-up gap is under 0.08
(`direction.js:254-256`), and `directionStats` keeps four separate counters
for that outcome (`mismatch`, `mismatchGap`, `ambiguous`, `uncalibrated`).
Today those beats score nothing and toast 方向不确定 (`main.js:149-159`).

**The camera answers when the ring cannot**, on either axis, subject to the
same earning rule as vertical authority. The player decided this.

The reasoning: the alternative is a guaranteed zero. Filling in can only
convert a no-score into a score. It does mean a camera error can cost a Miss
where previously the player got a toast and no judgement — but a 方向不确定
beat was never going to score, so the expected value is strictly positive as
long as the camera is better than chance on an axis where the ring has already
given up.

Note this is where most of the camera's benefit likely lives. Disagreements
are rare; the ring declining is not.

## Decided: the left hand is included

The camera's vertical verdict covers **both** hands, not only the conducting
hand.

The left hand has its own vertical gesture with its own wearer-dependent sign:
`playPalm` (`main.js:175`) grades 渐强/渐弱 from `palmCalibration.upObserved`,
a learned sign over integrated vertical acceleration
(`detectors.js:229-237`), with its own 3+3 calibration and its own level-start
gate (`main.js:300`). A wrong sign there scores nothing and says nothing —
`playPalm` simply returns.

So excluding the left hand would mean "vertical is reliable" covered only half
the game's vertical gestures. The camera sees both hands anyway, and
handedness is reported per hand, so the incremental cost is a second verdict
consumer rather than new tracking.

Consequence for the earning rule: "this hand is tracked" is evaluated
per hand, independently. The right hand's beat does not care whether the left
hand is in frame, and vice versa.

## Decided: direction only — the camera does not gate noise

The prior design gave the camera a second job: answering "was this deliberate
or noise?" as corroboration for the weak tier that Phase 1 shipped
(`detectors.js:122-128` emits `tier`, and `main.js:165` drops a weak beat
unless it lands within `GOOD * 2` of a cue).

**Not in this phase.** The camera decides direction and nothing else. One
fusion site, one authority question.

This has a consequence the prior design's text obscures: with a direction-only
camera, **gaining a camera mid-level does not change sensitivity at all**, so
there is nothing to hold stable. The "hold the sensing configuration stable
for the duration of a level" rule was inherited to protect against a noise
gate appearing mid-performance. With no noise gate, the rule is vestigial and
is **dropped** — a camera that becomes available mid-level simply starts
contributing direction, which is safe because direction fusion is stateless
per beat.

This is a deliberate departure from the previous design's "camera is additive
first, authoritative later", and the player made the call knowingly. The
reasoning: additive-first exists to avoid a camera error costing points where
no camera would not have. That logic holds where the ring works. On vertical
the ring is not merely weaker, it is blind — deferring to it is deferring to a
coin flip. Overruling a coin flip cannot cost accuracy in expectation.

Horizontal stays ring-authoritative precisely because there is no coin flip
there to beat, so the anti-goal applies unchanged.

## Decided: earning the vertical verdict

Vertical authority is conditional. A camera that guesses while overruling a
working sensor is worse than no camera, so the camera must decline rather than
guess. It earns a verdict only when **all** of these hold across the
measurement window:

1. **This hand is tracked** for the majority of the window. Per-hand, not
   both-hands: the left hand leaving frame must not cost the right hand its
   vertical authority, since the right hand is the one conducting beats.
2. **The hand is inside frame bounds**, with a margin. A hand clipped at the
   frame edge produces landmark positions that are pinned rather than
   measured.
3. **Displacement exceeds a noise floor.** Magnitude doubles as the confidence
   measure; no separate confidence model is needed.

Any failure → the ring decides, exactly as Phase 1. Camera absence and camera
uncertainty take the **same** code path, so the fallback is single and
well-exercised rather than a rare second branch that only runs in the dark.

## Decided: the camera window is wider than the ring's

The ring's direction window is the 150ms preceding the beat peak
(`direction.js:17`). The camera's is **300ms**, and this is my call rather
than the player's, recorded with its reasoning so it can be overturned.

The arithmetic forces it:

| | Ring @200Hz | Camera @30fps |
|---|---|---|
| Frames in 150ms | 30 | ~4.5 |
| Minus ~75ms not yet arrived | — | **~2** |

Two frames is a single displacement vector with no way to distinguish a real
stroke from one bad landmark. That is too thin to overrule anything.

The windows need not match, because the sensors measure different things: the
ring is catching an angular-velocity peak, which is brief; the camera is
measuring gross displacement, and a conducting down-stroke takes 200-400ms of
travel. At 300ms the camera sees ~9 frames, ~6 of them arrived by the time the
ring fires — enough to fit a direction and notice an outlier.

**This value must be checked on the player's hardware.** At 15fps in a dim
room it halves to ~3 arrived frames and the window must widen again, or
vertical authority must be declined. The builder should make the window a
named constant and verify the real frame rate before trusting it.

## Decided: nothing waits for the camera

No part of the beat path may be deferred to wait for camera data. The
on-screen hand moves on the ring's event, immediately; scoring uses the ring's
timestamp; `onEvent` keeps its current synchronous shape
(`input.js:324-325`), including the `age` computation.

The camera supplies whatever has already arrived. Given ~50-100ms pipeline
latency against a 300ms window, roughly the final 75ms has not been processed
when the ring fires. Use the available portion and proceed. Do not block on
the remainder.

A consequence worth stating: the camera's answer is therefore computed from a
*truncated* window — the outbound stroke's beginning and middle, not its end.
This is fine for gross vertical displacement and is the reason the window
needs to be wide.

## Decided: fusion sits inside `input.js`, before the return filter

A reviewer raised this and it is the sharpest point in the design, because at
first glance it looks like the camera acquiring power the authority table
never granted.

Direction is not a label applied after a beat survives. At
`input.js:353-365` it is an input to whether the beat survives at all:

```js
const classified = direction.classifyDetailed(feature, ring.address)
event.dir = classified.direction
const onCue = Boolean(event.dir) && cueDue(arrival - age, event.dir)
if (event.dir ? !ring.returnFilter.accept(feature, event.t, onCue) : ring.returnFilter.isReturn(feature, event.t)) {
  directionStats.suppressed += 1
  continue            // the beat is discarded
}
```

So a camera that flips `up` to `down` changes what `cueDue` is asked, can flip
`onCue`, and can move `returnFilter.accept` from suppressing a beat to keeping
it or the reverse. `accept()` also mutates its `previous` state, so later
beats' suppression depends on the fused answer too.

**Fusion goes inside `input.js`, before the return filter, and the camera is
knowingly given that power.**

The justification is not convenience — it is that the two problems are the
same problem. From `direction.js:37`: a real down-stroke and the return of an
up-stroke *are the same motion as far as the gyroscope is concerned*. Vertical
confusion and return-stroke confusion are one phenomenon with one cause. A
camera that fixed the direction label but left the return filter reading the
ring's blind guess would fix the symptom and leave the mechanism, and would
suppress beats on the basis of a direction it had already overruled.

The alternative placement — fusing in `main.js` after `onEvent` — keeps
suppression ring-only, but then `returnFilter`'s internal state and all of
`directionStats` are recorded against the pre-fusion direction, which puts the
instrumentation in the wrong module and makes the logs describe a decision the
game did not make.

This does stretch "the camera becomes load-bearing". The containment is that
every camera contribution still passes the earning rule, and a camera with no
verdict leaves this code path byte-identical to today. The camera can change
which direction a beat was and therefore whether it was a return; it cannot
change *when* a beat was, which is the part the anti-goal protects.

## Decided: the camera window anchors on the uncompensated page clock

Four timestamps are in flight and they differ by hundreds of milliseconds:
`event.t` (ring device clock), `event.t + ring.offset` (page clock),
`arrival - age` (page clock minus `compensation`, what `cueDue` receives), and
`at = inputNow() - event.age` (song clock minus `settings.latency`, what
`main.js` scores on).

**The camera window anchors on the page clock without compensation applied.**

`compensation` is a *judgement* offset: it shifts when a stroke is scored to
account for transmission and perception delay. It is not a measurement of when
the hand moved. It is clamped to ±300ms (`input.js:551`) and auto-nudged after
every level (`main.js:272`), so a player who has accumulated 200-300ms of it
would get a 300ms camera window slid almost entirely off the stroke — and the
failure is silent, presenting either as "the camera declines a lot" or, worse,
as confident verdicts computed from the *return* stroke.

The camera is asking a physical question — where was this hand during the
motion — so it must use the clock that tracks physical time.

This requires exposing the per-ring `offset` out of `input.js` (it is
currently absent from `snapshot()`) so camera frames and ring events can be
compared on one clock. The tracker stamps frames with the page clock via
`detectForVideo`'s caller-supplied timestamp.

## Decided: handedness is checked against role, not assumed

MediaPipe's `handedness` settles the *anatomical* question — which of the
subject's hands this is. It does not settle the mapping to the game's roles,
which are mutable and player-controlled: `setRole()` (`input.js:427`), 交换左右
(`input.js:452`, `panel.js:15`), and silent auto-allocation in `allocate()`
(`input.js:183-200`) all reassign which physical ring is `"right"`. Nothing
enforces that the ring in the `"right"` role is worn on the anatomical right
hand.

A mismatch produces exactly the symptom the mirroring section warns about —
one hand's displacement feeding the other hand's beat — but via role
assignment rather than a transform, so a mirroring test would not catch it.

Therefore: MediaPipe `"Right"` maps to the `"right"` role by default, and a
sustained contradiction between the two is surfaced in the panel rather than
silently trusted. **交换左右 and any role change invalidate accumulated camera
state**, following the precedent that `assign()` calls `direction.reset()`
when the right-hand role moves (`input.js:170`).

## Decided: the disagreement log persists, with a bounded schema

The player asked whether this data survives a refresh. It does — it persists
across the whole life of the installation, and only an explicit clear removes
it. A log that dies on refresh cannot accumulate into a dataset, which was the
stated payoff.

Volume decides the schema. Measured sizes for a 300ms window at 30fps
(~9 frames per entry):

| Stored per disagreement | Per entry | 500 entries | Fills a 5MB quota at |
|---|---|---|---|
| All 21 landmarks | 4.8 KB | 2.3 MB | ~1,091 entries |
| Wrist + middle-finger base | 0.5 KB | 258 KB | ~9,929 entries |

Full landmarks would exhaust `localStorage` within a few sessions. **Store the
wrist and the middle-finger base only**, with a 500-entry rolling cap: oldest
entries drop when full. Displacement is what the verdict is made of, and two
points recover it; the other nineteen landmarks matter for 自由模式's
open-palm detection, not for "did the hand go up".

**The counters stay session-scoped and separate.** `directionStats` is zeroed
by 清零统计 (`panel.js`), and the baseline method in `phase1-baseline.md`
depends on clearing before each level. Folding a lifetime log into those
counters would break that workflow. Counters behave exactly as today; the log
is a separate persisted store.

**An export path is required, not optional.** A log that can only be read
through devtools is not a dataset. A JSON download from the ring panel.

**Privacy, since this repo gets pushed to teammates.** The log holds hand
positions derived from the player's webcam, kept in their own browser. It
never leaves the machine unless exported. Exported files must not be committed
casually, so the export filename pattern goes in `.gitignore`.

## Decided: a one-time home-page offer, and no camera access until opt-in

The prior design specified a first-run screen before first play explaining the
camera. Describing the preview as living "alongside ring calibration" would
have replaced that with a panel the player has to go looking for, making a
"recommended" feature effectively hidden.

Both survive: a **one-time offer on the home page**, dismissible and
changeable later in 设置, plus the framing preview inside the panel for
ongoing use.

**`getUserMedia` is never called until the player explicitly opts in.**
Requesting on load would put a browser permission prompt in front of every
player on every load, which is the nagging the anti-goals forbid, and would
ask for a camera before explaining why.

## The model file

`hand_landmarker.task`, float16 variant, **7,819,105 bytes verified** at
`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`
(HTTP 200, `x-goog-stored-content-length` confirmed 2026-11-14).

Committed to the repo, because npm does not ship it. Provenance URL and hash
recorded alongside it so a future upgrade is auditable. MediaPipe models are
Apache-2.0, matching the `@mediapipe/tasks-vision` package licence.

The float16 variant rather than a lite variant: it is the default Google
publishes for the web pipeline, and the frame-rate budget that the
main-thread decision rests on must be measured against the model actually
shipped rather than a smaller stand-in.

## Decided: preview at setup, a status chip during play

The two phases ask different questions, so they get different UI.

**At setup**, the question is "is my framing right?", which cannot be answered
without seeing yourself. A full mirrored preview with a target box showing
where hands should sit, placed alongside ring calibration, where the player
already goes.

The target box must show the **whole stroke range**, not where the hand rests.
Hands held in front of a laptop lid webcam are close and large in frame; a
full down-stroke may leave the bottom of frame — on precisely the axis the
camera exists to fix. If down-strokes exit frame the remedy is tilting the
lid, and the player can only discover that by seeing it.

**During play**, the question is "did my hand just leave frame?", and a
preview is the wrong answer to it. This is a rhythm game: eyes are on notes
flying toward judgment rings. A preview is ignored when things are fine and
costs score when looked at. Screen space is already contested — Three.js
stage, lane canvas, mixer, HUD, progress bar.

Instead, a header chip beside the existing `指环 · 2 枚在线` button, following
the same `data-state` on/wait/off vocabulary (`panel.js:171`).

**No toast when a hand leaves frame.** The design requires the player not be
nagged, and a toast would compete with the `方向不确定` messages that
`main.js:158` already rate-limits. A chip quietly going amber says enough, and
nothing breaks when it does.

## Decided: preview mirroring is CSS-only

The preview must be mirrored, or it feels wrong to the player. The pixels fed
to inference must **not** be mirrored, because MediaPipe's handedness output
inverts under a horizontally mirrored image.

Mirror with a CSS transform on the display element only. Never mirror the
canvas or video contents passed to `detectForVideo`.

A mirrored-handedness bug is subtle in the worst way: everything works,
左右 are simply swapped, and the symptom (the left hand's displacement feeding
the right hand's beat) looks like a fusion bug rather than a transform bug.
The builder should assert this explicitly in a test rather than rely on
inspection.

## The module boundary

**The camera module emits hand landmarks and derived position. It never emits
a direction verdict.**

This is the one decision made for 自由模式's benefit, and it costs nothing
now. 自由模式 needs the hand as a cursor: `main.js:597` already collects
`pointer.trail`, and `lassoParts(trail, world.screenPositions())`
(`src/lasso.js:12`) already returns every section whose player heads fall
inside a loop. The circular hand motion the player described *is* that trail.
A module that answers "the hand went up" is useless to that; one that answers
"the hand is here, these are its 21 landmarks" serves both.

Landmarks rather than position alone, because open-vs-closed and palm-facing
come free from the same inference — 自由模式 will want them, and the ring
already detects palm-up/palm-down (`main.js:205`), so the camera would
corroborate an existing gesture rather than invent one.

Shape:

- **`src/camera/tracker.js`** — owns `getUserMedia`, the MediaPipe runtime and
  the frame loop. Touches the DOM. Emits timestamped per-hand landmark frames.
- **`src/camera/direction.js`** — pure. Given a hand's frames and a beat
  timestamp, returns a vertical verdict or declines. No DOM, so it is testable
  in Node like `src/ring/direction.js`.
- **Fusion** — pure, consuming the ring's classification and the camera's
  verdict per the authority table.

## Decided: inference runs on the main thread, for now

The previous design left this to the builder. The call: main thread first.

MediaPipe's GPU delegate needs a canvas, and `OffscreenCanvas` in a worker
adds real complexity. The render loop is already doing Three.js work, so this
needs measuring on the player's hardware rather than assuming.

It is reversible: the module boundary above means moving inference to a worker
later changes `tracker.js` and nothing else. If frame rate suffers measurably,
move it.

## Degradation

Every one of these falls back to Phase 1 behaviour without interrupting play:
no camera hardware, permission denied, permission revoked mid-session,
tracking lost, hand out of frame, hand at frame edge, poor light, frame rate
collapse, model or wasm failing to load.

They converge on the same path — "the camera has no verdict" — rather than
each getting its own branch.

**Sensing configuration is not latched.** A camera that becomes available
mid-level simply starts contributing direction. This is safe only because the
camera is direction-only: with no noise gate, gaining it changes no threshold
and alters no sensitivity, so there is nothing to hold stable. See "Decided:
direction only". If a camera-backed noise gate is ever added, latching has to
come back with it.

## Deferred: silent calibration

The previous design proposed that a confident camera direction plus a
simultaneous ring gyro signature is a labeled training sample acquired with no
prompt, and that accumulating these could eventually replace the explicit wave
sequence.

**Not in this phase.** Phase 1 already tried learning direction templates from
strokes made during play (`956241c`) and reverted it (`1e7871a`) because it
had no demonstrated benefit and made the opening of a level worse. The
baseline document is explicit that the accuracy figures which motivated it
were meaningless. Repeating that pattern with a camera as the labeller, before
the camera itself is validated on this hardware, would be the same mistake
with an extra dependency.

Revisit once the camera has a track record. The logging below is what would
make that judgement possible.

## Measuring whether this worked

The honest constraint, from `docs/superpowers/specs/phase1-baseline.md`:

> **the repo contains no labelled dataset for measuring direction accuracy.**
> […] Claims of the form "this improves detection by X%" are not currently
> possible from this repo. Verify by playing, or collect labelled data first.

That applies here with more force, because the 24 recordings carry no video
and so cannot validate fusion at all.

**Instrument from the start.** Every ring/camera disagreement is logged with
the ring's classification, the camera's verdict, the axis, whether the camera
earned a verdict, and the frames behind it. The existing `directionStats`
counters (`input.js:40`, surfaced at `panel.js:213`) are the precedent and the
place to extend.

This matters beyond debugging: **playing the game with the camera on generates
the labelled dataset that does not currently exist.** Ring-only captures
cannot be retrofitted into camera data, so a separate recording session before
the camera exists would need redoing afterwards. Building the capture into the
camera layer is strictly cheaper.

**What can be claimed after this phase**, on current evidence: that vertical
direction *feels* reliable, judged by playing, and that disagreement counts
moved in a particular direction. Not a percentage accuracy improvement.

A note on collecting labelled data later, since the player raised it: the
reason the earlier numbers were meaningless is that every prompted wave
contains a return stroke, and the analysis assumed stroke *i* was direction
*i mod 4*. Inspection showed the strokes alternate between two opposing
clusters. Recording more people the same way reproduces that flaw at triple
the cost. The fix is cheap but must be designed in at capture time: prompt one
direction, record, require a pause, and label the stroke *and* its return as
separate events. The prompt is the ground truth and is free to record then,
impossible to recover afterwards.

## Testing

`npm test` must keep passing. Fusion and camera direction logic stay pure, so
they are testable in Node with synthetic landmark frames — including the cases
that are hard to produce on demand in a room: hand leaving frame mid-window,
frame rate collapse, a single outlier landmark, clipped frame edges.

The mirroring/handedness invariant gets an explicit test, per above.

What tests cannot cover, and must be checked by playing: whether a full
down-stroke stays in frame on this laptop, the real frame rate in the player's
room, and whether 300ms is the right window. The README is already candid that
replay passing does not demonstrate real-use accuracy; that remains true.

## Decisions left to the builder

- The displacement noise floor, and the in-frame margin.
- How "tracked for the majority of the window" is counted.
- Whether the 300ms window needs to adapt to observed frame rate, or whether
  declining the verdict at low frame rates is sufficient.
- Exact storage of the camera preference (the `localStorage` precedent is
  `ROLE_KEY`/`COMP_KEY`/`CAL_KEY` in `input.js`).
- Where the setup preview lives in the panel, coordinated with the teammate.
- The log format for disagreements, subject to it being sufficient to
  reconstruct the decision later.
