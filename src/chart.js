const DIRS_BY_METER = {
  3: ["down", "right", "up"],
  4: ["down", "left", "right", "up"],
}

// Every level is data: the chart (what the player hits) and the music (score.js) are both generated from it,
// so a cue and the sound it belongs to always sit on the same beat grid.
// `entries[].bar` / `dynamics[].bar` are 0-based playing bars; `hits[bar]` lists the beats that carry a right-hand cue (default: all).
export const STUDIES = [
  {
    id: "dawn", meter: 4, bpm: 80, bars: 8, style: "ballad",
    title: "第一乐章 · 晨光", sub: "MOVEMENT I　/　4:4　/　80 BPM", tag: "入门 · 4/4",
    blurb: "下、左、右、上，四拍一圈<br>第 3 小节点小提琴，第 5 小节点长笛",
    chords: ["C", "G", "Am", "F", "C", "G", "Am", "F"],
    entries: [{ part: "violin", bar: 2 }, { part: "flute", bar: 4 }],
    dynamics: [{ direction: "up", bar: 5, beat: 0 }, { direction: "down", bar: 6, beat: 2 }],
  },
  {
    id: "waltz", meter: 3, bpm: 92, bars: 8, style: "waltz",
    title: "第二乐章 · 圆舞", sub: "MOVEMENT II　/　3:4　/　92 BPM", tag: "进阶 · 3/4",
    blurb: "三拍子：下、右、上<br>大提琴一拍，钢琴两拍，像在转圈",
    chords: ["Am", "F", "C", "G", "Am", "Dm", "G", "C"],
    entries: [{ part: "violin", bar: 2 }, { part: "flute", bar: 4 }],
    dynamics: [{ direction: "up", bar: 5, beat: 0 }, { direction: "down", bar: 6, beat: 1 }],
  },
  {
    id: "march", meter: 4, bpm: 108, bars: 12, style: "march",
    title: "第三乐章 · 凯旋", sub: "MOVEMENT III　/　4:4　/　108 BPM", tag: "挑战 · 4/4",
    blurb: "更快的进行曲，第 7、8 小节只打 1、3、4 拍<br>两次渐强，两次渐弱",
    chords: ["C", "C", "F", "G", "C", "Am", "Dm", "G", "Em", "Am", "F", "C"],
    entries: [{ part: "violin", bar: 2 }, { part: "flute", bar: 4 }],
    dynamics: [{ direction: "up", bar: 5, beat: 0 }, { direction: "down", bar: 7, beat: 2 }, { direction: "up", bar: 8, beat: 3 }, { direction: "down", bar: 11, beat: 1 }],
    hits: { 6: [0, 2, 3], 7: [0, 2, 3] },
  },
]

export function buildChart(study = STUDIES[0]) {
  const { meter, bpm, bars } = study
  const dirs = DIRS_BY_METER[meter]
  const beat = 60 / bpm
  const countIn = meter * beat
  const at = (bar, inBar) => countIn + (bar * meter + inBar) * beat
  const cues = []
  for (let bar = 0; bar < bars; bar += 1) {
    const hits = study.hits?.[bar] ?? dirs.map((_, i) => i)
    for (const i of hits) cues.push({ kind: "beat", hand: "right", direction: dirs[i], time: at(bar, i) })
  }
  // A section cue is given half a beat ahead of the bar line the section actually enters on.
  for (const { part, bar } of study.entries) cues.push({ kind: "cue", hand: "left", part, time: at(bar, 0) - beat * 0.5 })
  for (const { direction, bar, beat: inBar } of study.dynamics) cues.push({ kind: "dynamics", hand: "left", direction, time: at(bar, inBar) })
  cues.sort((a, b) => a.time - b.time)
  return { bpm, meter, beat, countIn, bars, cues, duration: countIn + bars * meter * beat, study }
}
