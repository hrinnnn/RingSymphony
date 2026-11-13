# Phase 1 baseline

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
