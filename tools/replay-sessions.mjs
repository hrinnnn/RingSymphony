// Replays exported gesture logs through the real fusion code and compares against what the game
// actually scored at the time. This is the only honest regression test for a fusion change: the
// recordings in recordings/ have no video, so they cannot exercise the camera at all.
//
// Usage: node tools/replay-sessions.mjs [dir]
import { readdir, readFile } from "node:fs/promises"
import { createFusion } from "../src/camera/fuse.js"

const dir = new URL(process.argv[2] ?? "../docs/superpowers/specs/", import.meta.url)
const files = (await readdir(dir)).filter((f) => f.startsWith("gestures-") && f.endsWith(".json")).sort()
if (!files.length) {
  console.log("no exported sessions found")
  process.exit(0)
}

let liveTotal = 0
let replayTotal = 0
let cues = 0
let regressed = 0
console.log("session                        cues  as-played  replayed  change")
for (const file of files) {
  const data = JSON.parse(await readFile(new URL(file, dir), "utf8"))
  const strokes = data.strokes.filter((s) => s.want)
  const fusion = createFusion()
  let replayed = 0
  for (const stroke of strokes) {
    const verdict = stroke.camera
      ? { dir: stroke.camera, displacement: stroke.displacement ?? 0 }
      : null
    if (fusion.fuse(stroke.ring ?? null, verdict).dir === stroke.want) replayed += 1
  }
  const live = strokes.filter((s) => s.fused === s.want).length
  const delta = replayed - live
  if (delta < 0) regressed += 1
  liveTotal += live
  replayTotal += replayed
  cues += strokes.length
  console.log(`${file.slice(9, 28).padEnd(30)} ${String(strokes.length).padStart(4)}  ${String(live).padStart(9)}  ${String(replayed).padStart(8)}  ${delta > 0 ? "+" + delta : delta || "="}`)
}
const pct = (n) => `${((100 * n) / cues).toFixed(0)}%`
console.log(`\ntotal ${cues} labelled strokes: as-played ${liveTotal} (${pct(liveTotal)}), replayed ${replayTotal} (${pct(replayTotal)})`)
console.log(`sessions regressed: ${regressed}`)
// A fusion change that loses strokes on a real session is a regression however good the total is.
if (regressed) {
  console.error("\nFAIL: a session scored worse than it did when played")
  process.exit(1)
}
console.log("OK: no session scored worse than it did when played")
