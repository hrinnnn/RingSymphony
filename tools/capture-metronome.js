const arrows = { down: "↓ 下", left: "← 左", right: "→ 右", up: "↑ 上" }

export function timedTrials(item, tempo, random = Math.random) {
  const period = 60000 / tempo
  const directions = Array.from({ length: item.count }, (_, i) => item.pattern[i % item.pattern.length])
  if (item.single) {
    for (let i = directions.length - 1; i > 0; i--) {
      const other = Math.floor(random() * (i + 1))
      const direction = directions[i]
      directions[i] = directions[other]
      directions[other] = direction
    }
  }
  let at = 3000 + period
  return directions.map((direction, i) => {
    const marker = {
      number: i + 1, direction, beatAtMs: Math.round(at), cueAtMs: Math.round(at - period),
      shownAtMs: Math.round(at - Math.min(180, period / 2)),
      endedAtMs: Math.round(at + Math.min(230, period * 0.45)),
    }
    at += period + (item.single ? 1500 + random() * 1000 : 0)
    return marker
  })
}

export function renderMetronome(recording, item, elapsed, { phase, progress, time, beatRing, beep }) {
  const takes = recording.trials
  const end = takes.at(-1).endedAtMs + 500
  progress.value = Math.min(1, elapsed / end)
  if (elapsed >= end) return true
  while (recording.audioQueued < takes.length && takes[recording.audioQueued].beatAtMs - elapsed <= 120) {
    const trial = takes[recording.audioQueued++]
    if (trial.beatAtMs >= elapsed - 30 && beep(Math.max(0, (trial.beatAtMs - elapsed) / 1000),
      !item.single && (trial.number - 1) % item.pattern.length === 0)) trial.audioQueuedAtMs = Math.round(elapsed)
  }
  const active = takes.find(trial => elapsed >= trial.cueAtMs && elapsed <= trial.beatAtMs + 65)
  const target = active ?? takes.find(trial => trial.beatAtMs > elapsed)
  beatRing.hidden = !active
  if (active) {
    active.cueRenderedAtMs ??= Math.round(elapsed)
    const fraction = (elapsed - active.cueAtMs) / (active.beatAtMs - active.cueAtMs)
    beatRing.style.setProperty("--beat-progress", `${Math.min(100, fraction * 100)}%`)
  }
  phase.textContent = active ? arrows[active.direction] : elapsed < 3000 ? "准备" : "放松，等下一拍"
  phase.dataset.action = String(Boolean(active && Math.abs(elapsed - active.beatAtMs) < 90))
  time.textContent = target ? `第 ${target.number} / ${takes.length} 拍 · ${recording.bpm} BPM` : "完成最后一拍"
  return false
}
