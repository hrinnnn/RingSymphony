# Phase 1 baseline

## Known-good detection state

**Commit `1e7871a`, tag `detection-good-2026-11-13`.**

Confirmed good by the player on real hardware (two Ringo rings, firmware
2.0.2) on 2026-11-13: *"the detection is so much better now, this is the best
version for detection"*.

**Return here if later detection work makes things worse.** `git diff
detection-good-2026-11-13 -- src/ring/ src/main.js` shows what has changed
since.

What is in this state:

| Change | Commit |
|---|---|
| Adaptive beat floor | `88d6a9c` |
| Two-tier beats, corrected thresholds | `92dfc8a` |
| Outlier tolerance in calibration | `e211598` |
| Calibration persisted per address and hand | `c064630` |
| Fist no longer ends a rhythm level | `f4345a3` |
| Cue-backed vertical stroke vs return | `7b1fe08` |
| Learning from play - **reverted** | `1e7871a` |

### Why this is the only evidence that counts

This judgement came from playing, and that matters more than it sounds.

During this work I quoted accuracy figures (56-68% baseline, 84/61/96% with
learning, 0% cold start) derived from the `recordings/四拍/` files by assuming
stroke *i* was direction `['down','left','right','up'][i % 4]`. Inspecting the
data showed the strokes alternate between only **two** opposing clusters - the
recordings are someone beating time, not conducting four directions.
`README.md` states this directly: 没有逐次动作的时间标签，不能直接把所有波峰按
文件名训练或计算准确率.

**Every one of those numbers was meaningless.** The feature built on them
(learning direction templates from strokes made during play) had no
demonstrated benefit and made the opening of a level worse, which is what
prompted the revert.

The lesson for anyone continuing: **the repo contains no labelled dataset for
measuring direction accuracy.** The only labelled data is `recordings/方向/`,
which has one direction per file and three documented stroke times in
`tests/direction.test.mjs`. That is enough to check a template is built
correctly; it is not enough to measure classification accuracy, and it cannot
be used to tune thresholds. Claims of the form "this improves detection by X%"
are not currently possible from this repo. Verify by playing, or collect
labelled data first.

### Confidence in each surviving change

| Change | Evidence |
|---|---|
| Fist no longer ends levels | Strong - reported by the player, cause found in `main.js:189` |
| Weak-tier threshold correction | Strong - measured tier split; beat counts across all 24 recordings restored to pre-Phase-1 values |
| 方向不确定 rate limiting | Strong - it fired on every unrecognised stroke |
| Calibration persistence | Strong - tested end to end through `input.js` |
| Outlier tolerance | Strong - logic verified, does not depend on labels |
| Vertical stroke vs return | Partial - the 166-degree geometry is measured and real; the 8-of-8 improvement is from a simulation, not hardware |
| Adaptive beat floor | Weak - tuned against a synthetic gentle signal, since no gentle recording exists |

Instrument for judging whether the Phase 1 detection and calibration changes
actually helped. Required by
`docs/superpowers/specs/2026-11-13-camera-and-detection-design.md`.

## Recording baseline (automated, done)

`npm run eval` runs the detectors over the 24 recordings in `recordings/`.
Output is **byte-identical** before and after every Phase 1 change committed so
far (Tasks 1, 2, 3, 5). This is the regression guard: it shows the changes did
not disturb detection at normal conducting energy.

What it cannot show: whether gentle conducting improved. None of the 24
recordings are gentle play — right-hand beat counts run 13-55 per recording,
all well clear of the old 1.6 rad/s floor. The adaptive floor only engages
*below* that floor, where these recordings have nothing.

Right-hand beat counts, unchanged across all Phase 1 commits:

| class | lry | yyh | zzw |
|---|---|---|---|
| 三拍 | 36 | 34 | 38 |
| 四拍 | 41 | 41 | 55 |
| 握拳 | 21 | 19 | 19 |
| 指定 | 23 | 20 | 15 |
| 上升 | 29 | 20 | 27 |
| 下降 | 20 | 29 | 26 |
| 画圈选定 | 13 | 16 | 15 |
| 走路及日常 | 18 | 23 | 23 |

Fist detection (the reason `fistJerk` was left at 40000): fires 5-8 times per
握拳 recording, **zero** times across all three 走路及日常 recordings, once on
`指定/zzw`. It discriminates well; the problem was that a single detection
irreversibly ended a level, which Task 6 addresses.

## Hardware baseline (manual, TO DO)

The claim that the fixed floor caused 轻动识别不准 is still a **hypothesis**.
It cannot be settled from the recordings. Someone has to play.

Method, per level, with 「指环」 → 诊断信息 → 清零统计 first:

1. Play the level conducting normally. Record the 右手候选 counters.
2. Play it again conducting deliberately softly. Record them again.
3. Note Misses on cues you believe you conducted correctly — the subjective
   measure, and the one that matters most.

Counters (`input.js` `directionStats`, shown at `panel.js:213`): 有方向
`accepted`, 数据不足或断帧 `data`, 信号弱 `weak`, 校准差异大 `mismatch` /
`mismatchGap`, 方向相近 `ambiguous`, 未校准 `uncalibrated`, 回程抑制
`suppressed`.

### What the numbers would mean

- **有方向 up, 信号弱 down** — the adaptive floor is working: motion that
  previously fell below the trigger is now being seen.
- **信号弱 down without 有方向 up** — warning. The floor dropped too far and
  noise is being promoted into candidates rather than real beats recovered.
- **未校准 and 校准差异大 down** — the outlier-tolerance change (Task 3) is
  working: calibrations that used to be rejected now hold.
- **校准差异大 dominant** — the direction cutoff (0.8) is too strict for this
  wearer.
- **方向相近 dominant** — the runner-up margin (0.08) is too strict instead.
  These two distinguish which knob to turn; see the Task 7 note in the plan.

### Table to fill in

| level | conducting | 有方向 | 数据不足 | 信号弱 | 校准差异大 | 方向相近 | 未校准 | 回程抑制 | felt-wrong Misses |
|---|---|---|---|---|---|---|---|---|---|
| 晨光 | normal | | | | | | | | |
| 晨光 | gentle | | | | | | | | |
| 圆舞 | normal | | | | | | | | |
| 圆舞 | gentle | | | | | | | | |
| 凯旋 | normal | | | | | | | | |
| 凯旋 | gentle | | | | | | | | |

### Caveats

Counters only cover candidates that reached the detector. Motion too soft to
trigger at all is invisible to them — precisely the 轻动 case — which is why
the felt-wrong Miss count matters alongside them.

The adaptive floor constants (`restTau: 4`, `floorRest: 2.2`, clamp
`[0.65, 1.6]`) were tuned against a *synthetic* gentle signal, since no gentle
recording exists. The "does not break what works" side is bounded by real data;
the "catches soft beats" side is not. If gentle play still under-registers,
`floorRest` is the first constant to try lowering.
