import assert from "node:assert/strict"
import { phraseEvents } from "../src/saints.js"
import { createSwingEar } from "../src/ring/detectors.js"

const solo = phraseEvents(0, { flute: "solo", violin: "off", piano: "off" }, 1)
assert.ok(solo.some((event) => event.part === "flute" && event.note === "B4"), "sax solo plays the downloaded melody")
assert.ok(solo.some((event) => event.part === "cello"), "bass is present on the opening phrase")
assert.ok(solo.some((event) => event.drum === "kick"), "the march pulse is always scheduled")
assert.ok(!solo.some((event) => event.part === "violin" || event.part === "piano"))

const bed = phraseEvents(4, { flute: "off", violin: "off", piano: "off" }, 0.8)
assert.ok(bed.some((event) => event.part === "cello"))
assert.ok(bed.some((event) => event.drum === "kick"))
assert.ok(!bed.some((event) => event.part === "flute" || event.part === "violin" || event.part === "piano"))

const comp = phraseEvents(4, { flute: "comp", violin: "comp", piano: "solo" }, 1)
assert.ok(comp.some((event) => event.part === "piano"))
assert.ok(comp.some((event) => event.part === "violin"))
assert.ok(comp.filter((event) => event.part === "violin").every((event) => event.vel < 0.55), "comp thins while someone solos")
const stopped = phraseEvents(4, { cello: "off", horn: "off", flute: "off", violin: "off", piano: "off" }, 1)
assert.ok(!stopped.some((event) => event.part === "cello" || event.drum), "stopped bass and drums schedule nothing")
const quiet = phraseEvents(4, {}, 0.9).filter((event) => event.drum === "kick").length
const loud = phraseEvents(4, {}, 1.4).filter((event) => event.drum === "kick").length
assert.ok(loud > quiet, "a bigger swing thickens the drums at the phrase boundary")

const gentle = createSwingEar()
for (let i = 0; i < 6; i += 1) assert.equal(gentle.hear(i, 1).accept, true, "even swings still count")
const ear = createSwingEar()
for (let i = 0; i < 4; i += 1) ear.hear(i * 0.5, i % 2 ? 0.4 : 2.2)
assert.equal(ear.hear(3, 0.45).accept, false, "a short wobble is not a beat")
const big = ear.hear(3.6, 2.1)
assert.equal(big.accept, true)
assert.ok(big.energy > 0.8 && big.energy < 1.3, `energy follows the tall swings (got ${big.energy})`)

console.log("Saints phrases and the relative swing ear: pass")
