// Replays the recorded IMU data through the detectors and prints per-gesture event counts.
// Usage: node tools/eval-detectors.mjs
import { readFile } from "node:fs/promises"
import { createHandDetector } from "../src/ring/detectors.js"

const dir = new URL("../recordings/", import.meta.url)
const people = ["lry", "yyh", "zzw"]
const classes = ["三拍", "四拍", "握拳", "指定", "上升", "下降", "画圈选定", "走路及日常"]

export async function load(cls, person) {
  const raw = JSON.parse(await readFile(new URL(`${cls}/${person}.json`, dir), "utf8"))
  return raw.t.map((t, i) => ({ t, acc: raw.acc[i], gyr: raw.gyr[i] }))
}

export function run(frames, hand) {
  const detector = createHandDetector(hand)
  const events = []
  for (const frame of frames) events.push(...detector.push(frame))
  return events
}

if (process.argv[1].endsWith("eval-detectors.mjs")) {
  const kinds = ["beat", "fist", "strike", "palm-up", "palm-down"]
  const label = (e) => (e.type === "palm" ? `palm-${e.dir}` : e.type)
  for (const hand of ["right", "left"]) {
    console.log(`\n== ${hand} ring`)
    console.log("class".padEnd(10), "person", ...kinds.map((k) => k.padStart(10)))
    for (const cls of classes) {
      for (const person of people) {
        const frames = await load(cls, person)
        const events = run(frames, hand)
        const count = Object.fromEntries(kinds.map((k) => [k, events.filter((e) => label(e) === k).length]))
        console.log(cls.padEnd(10), person.padEnd(6), ...kinds.map((k) => String(count[k]).padStart(10)))
      }
    }
  }
}
