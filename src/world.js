import * as THREE from "three"
import { beatFlight, laneLayout } from "./lane.js"

// All scenery, people, instruments and UI geometry are original procedural assets.
// Classical hall: black formal wear, one restrained accent per section, gold for the conductor.
const GOLD = 0xe6c98a
const WINE = 0x8d3a45
const CREAM = 0xf3ead7
const BRASS = 0xc4a15a
const SILVER = 0xc5d0d6
const PINK = GOLD
const MINT = SILVER
const LILAC = WINE
const BUTTER = BRASS
const SKY = SILVER
export const SECTION_COLOR = { violin: GOLD, flute: SILVER, horn: BRASS, cello: WINE, piano: CREAM }
const toonRamp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat)
toonRamp.minFilter = THREE.NearestFilter
toonRamp.magFilter = THREE.NearestFilter
toonRamp.needsUpdate = true
const material = (color, roughness = 0.65, metalness = 0, emissive = 0x000000) => new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive })
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex()
const black = material(0x161a23)
const shoe = material(0x090c12, 0.3)
const white = material(0xf5eee0)
const brass = material(0xbb9353, 0.35, 0.7)
const silver = material(0xc5d8df, 0.24, 0.8)
const oak = material(0x743d1d, 0.4)
const bowWood = material(0xe0a85a, 0.38, 0.05, 0x3a240c)
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })
const ivory = material(0xfffaf2)
const gilt = material(BUTTER, 0, 0, 0x3a2a00)
const lip = material(0xa8585f)
const eyeInk = material(0x2b2d3a)
const blush = glow(0xe39a96, 0.3)
const skins = [0xd7a784, 0xa36d4d, 0xf0c7a6, 0xc48b62].map((color) => material(color, 0.8))
const hairColors = [0x1b140f, 0x6a432c, 0xb7aea4, 0x241816, 0x3a2418].map((color) => material(color, 0.5, 0.08))
const suits = Object.fromEntries(Object.entries(SECTION_COLOR).map(([part, color]) => [part, {
  color: new THREE.Color(color),
  coat: material(0x1a1e28, 0.55, 0.06),
  deep: material(0x10131a, 0.7),
  pants: material(0x14161c, 0.6),
}]))
const sectionMat = Object.fromEntries(Object.entries(SECTION_COLOR).map(([part, color]) => [part, material(color)]))

function mesh(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, mat)
  item.position.set(x, y, z)
  item.castShadow = true
  item.receiveShadow = true
  parent.add(item)
  return item
}
function box(parent, size, mat, x = 0, y = 0, z = 0) {
  return mesh(parent, new THREE.BoxGeometry(...size), mat, x, y, z)
}
function oval(parent, size, mat, x = 0, y = 0, z = 0) {
  const item = mesh(parent, new THREE.SphereGeometry(1, 16, 12), mat, x, y, z)
  item.scale.set(...size)
  return item
}
function rod(parent, a, b, radius, mat, endRadius = radius) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b)
  const item = mesh(parent, new THREE.CylinderGeometry(endRadius, radius, from.distanceTo(to), 10), mat)
  item.position.copy(from).add(to).multiplyScalar(0.5)
  item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize())
  return item
}
function setRod(item, a, b) {
  const from = new THREE.Vector3(a[0], a[1], a[2])
  const to = new THREE.Vector3(b[0], b[1], b[2])
  const delta = new THREE.Vector3().subVectors(to, from)
  const len = Math.max(delta.length(), 0.001)
  item.position.copy(from).add(to).multiplyScalar(0.5)
  item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.multiplyScalar(1 / len))
  item.scale.y = len
}
function makeRod(parent, radius, mat, endRadius = radius) {
  const item = mesh(parent, new THREE.CylinderGeometry(endRadius, radius, 1, 12), mat)
  setRod(item, [0, 1, 0], [0, 0, 0])
  return item
}
function createLimb(parent, cloth, skin, radius) {
  const upper = makeRod(parent, radius, cloth, radius * 0.86)
  const fore = makeRod(parent, radius * 0.78, cloth, radius * 0.68)
  const joint = oval(parent, [radius * 1.05, radius, radius * 1.05], cloth)
  const cap = oval(parent, [radius * 1.35, radius * 1.05, radius * 1.15], cloth)
  const hand = new THREE.Group()
  parent.add(hand)
  oval(hand, [radius * 1.05, radius * 0.62, radius * 1.25], skin, 0, 0.01, 0.03)
  box(hand, [radius * 1.2, radius * 0.35, radius * 0.55], ivory, 0, 0.005, -0.045)
  return { upper, fore, joint, cap, hand }
}
function applyLimb(limb, shoulder, elbow, wrist) {
  setRod(limb.upper, shoulder, elbow)
  setRod(limb.fore, elbow, wrist)
  limb.joint.position.set(elbow[0], elbow[1], elbow[2])
  limb.cap.position.set(shoulder[0], shoulder[1], shoulder[2])
  limb.hand.position.set(wrist[0], wrist[1], wrist[2])
}
const HOLDS = {
  violin: {
    bow: { s: [0.17, 1.05, 0.02], e: [0.34, 0.8, 0.2], w: [0.16, 1.0, 0.34], travel: 0.18, rx: 0.45, ry: 0.25, rz: 0.5 },
    finger: { s: [-0.16, 1.06, 0.02], e: [-0.3, 0.98, 0.16], w: [-0.18, 1.2, 0.22] },
  },
  cello: {
    bow: { s: [0.18, 1.02, 0.04], e: [0.36, 0.68, 0.24], w: [0.18, 0.76, 0.42], travel: 0.15, rx: 0.15, ry: -0.1, rz: 0.28 },
    finger: { s: [-0.12, 1.02, 0.08], e: [-0.08, 0.9, 0.24], w: [-0.02, 1.06, 0.36] },
  },
  flute: {
    left: { s: [-0.15, 1.06, 0.04], e: [-0.04, 1.14, 0.16], w: [0.05, 1.21, 0.2] },
    right: { s: [0.16, 1.04, 0.02], e: [0.36, 1.08, 0.12], w: [0.42, 1.19, 0.24] },
  },
  piano: {
    left: { s: [-0.16, 1.02, 0.04], e: [-0.24, 0.76, 0.28], w: [-0.16, 0.86, 0.58] },
    right: { s: [0.16, 1.02, 0.04], e: [0.26, 0.74, 0.3], w: [0.18, 0.86, 0.6] },
  },

}
function texture(draw, width = 512, height = 512) {
  const canvas = document.createElement("canvas")
  canvas.width = width; canvas.height = height
  draw(canvas.getContext("2d"), width, height)
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  return map
}
const scoreMap = () => texture((g, w, h) => {
  g.fillStyle = '#f7f1e6'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#4a4d5e'; g.font = 'bold 26px "Arial Rounded MT Bold", sans-serif'; g.textAlign = 'center'; g.fillText('♪ ÉTUDE · I ♪', w / 2, 45)
  g.fillStyle = '#3d4050'
  for (let staff = 0; staff < 5; staff++) {
    const y = 85 + staff * 80
    g.strokeStyle = '#a9a39a'; g.lineWidth = 1.5
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(32, y + i * 9); g.lineTo(w - 32, y + i * 9); g.stroke() }
    for (let n = 0; n < 12; n++) {
      const x = 52 + n * 35, ny = y + ((n * 7 + staff * 3) % 9) * 4.5
      g.beginPath(); g.ellipse(x, ny, 5, 3, -0.4, 0, Math.PI * 2); g.fill()
      g.fillRect(x + 4, ny - 24, 1.5, 24)
    }
  }
})
let paper
function stand(parent, x, z, scale = 1) {
  const group = new THREE.Group(); group.position.set(x, 0, z); group.scale.setScalar(scale); parent.add(group)
  rod(group, [0, 0.05, 0], [0, 0.94, 0], 0.017, black)
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3
    rod(group, [0, 0.16, 0], [Math.cos(a) * 0.25, 0.025, Math.sin(a) * 0.25], 0.012, black)
  }
  const desk = box(group, [0.57, 0.36, 0.025], black, 0, 1.04, 0)
  desk.rotation.x = -0.35
  const page = mesh(desk, new THREE.PlaneGeometry(0.49, 0.30), new THREE.MeshStandardMaterial({ map: paper, side: THREE.DoubleSide }), 0, 0.005, -0.016)
  page.rotation.y = Math.PI
  return group
}
function chair(parent, accent) {
  const seatMat = material(0x44212a, 0.9)
  box(parent, [0.43, 0.09, 0.43], seatMat, 0, 0.46)
  const back = box(parent, [0.43, 0.35, 0.07], seatMat, 0, 0.77, -0.2); back.rotation.x = -0.1
  for (const x of [-0.17, 0.17]) for (const z of [-0.17, 0.17]) rod(parent, [x, 0.45, z], [x * 1.2, 0.02, z * 1.2], 0.018, black)
  for (const x of [-0.17, 0.17]) rod(parent, [x, 0.45, -0.19], [x, 0.94, -0.19], 0.015, black)
  if (accent) {
    const band = box(parent, [0.4, 0.016, 0.018], accent, 0, 0.9, -0.18)
    band.rotation.x = -0.1
  }
}
function bench(parent) {
  box(parent, [0.72, 0.07, 0.34], material(0x3a2428, 0.85), 0, 0.48)
  for (const x of [-0.28, 0.28]) for (const z of [-0.12, 0.12]) rod(parent, [x, 0.45, z], [x, 0.03, z], 0.02, black)
}
function stringInstrument(parent, cello) {
  const group = new THREE.Group(); parent.add(group)
  const s = cello ? 1 : 0.44
  group.scale.setScalar(s)
  // The paired bouts and narrow waist give the instrument its violin silhouette.
  oval(group, [0.18, 0.21, 0.063], oak, 0, -0.14)
  oval(group, [0.135, 0.155, 0.06], oak, 0, 0.11)
  oval(group, [0.088, 0.14, 0.057], oak, 0, 0)
  box(group, [0.042, 0.48, 0.038], shoe, 0, 0.32, 0.05)
  oval(group, [0.045, 0.065, 0.032], oak, 0, 0.58)
  box(group, [0.10, 0.018, 0.033], white, 0, -0.025, 0.066)
  for (let i = 0; i < 4; i++) rod(group, [(i - 1.5) * 0.009, -0.26, 0.077], [(i - 1.5) * 0.009, 0.53, 0.077], 0.0015, silver)
  for (const x of [-0.078, 0.078]) {
    const f = box(group, [0.012, 0.11, 0.005], shoe, x, -0.01, 0.063); f.rotation.z = x > 0 ? -0.2 : 0.2
    for (const y of [-0.055, 0.055]) oval(group, [0.013, 0.012, 0.005], shoe, x, y - 0.01, 0.063)
  }
  if (cello) rod(group, [0, -0.32, 0], [0, -0.56, 0], 0.007, silver)
  oval(group, [0.038, 0.05, 0.028], oak, 0, 0.67, 0.02)
  oval(group, [0.026, 0.026, 0.018], shoe, 0.028, 0.69, 0.02)
  box(group, [0.046, 0.028, 0.01], oak, 0, -0.08, 0.072)
  box(group, [0.036, 0.07, 0.012], shoe, 0, -0.28, 0.074)
  if (!cello) oval(group, [0.05, 0.028, 0.026], shoe, -0.09, -0.18, 0.05)
  return group
}
function hairStyle(head, hair, index) {
  const style = index % 5
  if (style === 0) {
    oval(head, [0.13, 0.08, 0.12], hair, 0, 0.09, -0.012)
    oval(head, [0.11, 0.05, 0.05], hair, 0, 0.03, -0.08)
  } else if (style === 1) {
    oval(head, [0.135, 0.086, 0.12], hair, 0.03, 0.09, -0.01)
    oval(head, [0.08, 0.07, 0.06], hair, 0.09, 0.015, 0.02)
  } else if (style === 2) {
    oval(head, [0.125, 0.07, 0.12], hair, 0, 0.095, -0.02)
    oval(head, [0.06, 0.062, 0.06], hair, 0.01, 0.15, -0.06)
  } else if (style === 3) {
    oval(head, [0.14, 0.12, 0.12], hair, 0, 0.03, -0.015)
    box(head, [0.055, 0.12, 0.05], hair, -0.11, -0.02, 0.02)
    box(head, [0.055, 0.12, 0.05], hair, 0.11, -0.02, 0.02)
  } else {
    oval(head, [0.132, 0.09, 0.13], hair, 0, 0.08, -0.02)
    for (const s of [-1, 1]) oval(head, [0.05, 0.11, 0.055], hair, s * 0.11, -0.03, 0.03)
  }
}
function buildHead(head, skin, hair, index, part) {
  oval(head, [0.104, 0.128, 0.096], skin)
  oval(head, [0.084, 0.05, 0.068], skin, 0, -0.055, 0.018)
  hairStyle(head, hair, index)
  for (const s of [-1, 1]) {
    oval(head, [0.018, 0.032, 0.014], skin, s * 0.104, -0.008, 0)
    oval(head, [0.017, 0.021, 0.008], eyeInk, s * 0.038, 0.012, 0.09)
    oval(head, [0.0065, 0.0065, 0.004], glow(0xffffff), s * 0.038 + 0.006, 0.02, 0.098)
    oval(head, [0.024, 0.012, 0.006], blush, s * 0.064, -0.026, 0.082)
  }
  const smile = mesh(head, new THREE.TorusGeometry(0.014, 0.0032, 6, 14, Math.PI), lip, 0, -0.036, 0.091)
  smile.rotation.z = Math.PI
  if (part === "piano") {
    for (const s of [-1, 1]) {
      const rim = mesh(head, new THREE.TorusGeometry(0.026, 0.003, 6, 14), gilt, s * 0.038, 0.018, 0.09)
      rim.rotation.y = s * -0.35
    }
    rod(head, [-0.012, 0.02, 0.098], [0.012, 0.02, 0.098], 0.003, gilt)
  }
}
function buildTorso(body, part, accent, skin, index) {
  const flute = part === "flute"
  const ink = suits[part].coat
  const inkDeep = suits[part].deep
  oval(body, [0.15, 0.07, 0.11], ink, 0, 0.64, 0.02)
  const torso = mesh(body, new THREE.CylinderGeometry(0.15, 0.12, 0.4, 12), ink, 0, 0.9, 0)
  torso.scale.z = 0.68
  box(body, [0.44, 0.05, 0.17], ink, 0, 1.08, 0.01)
  box(body, [0.12, 0.3, 0.02], ivory, 0, 0.94, 0.128)
  for (const s of [-1, 1]) {
    const lapel = box(body, [0.055, 0.28, 0.016], inkDeep, s * 0.078, 0.96, 0.132)
    lapel.rotation.z = s * -0.28
    const facing = box(body, [0.038, 0.24, 0.012], accent, s * 0.052, 0.97, 0.148)
    facing.rotation.z = s * -0.16
  }
  rod(body, [0, 1.1, 0], [0, 1.24, 0], 0.046, skin)
  if (flute) {
    const gown = mesh(body, new THREE.CylinderGeometry(0.17, 0.27, 0.62, 14), ink, 0, 0.4, 0.02)
    gown.scale.z = 0.7
    box(body, [0.2, 0.016, 0.016], accent, 0, 0.7, 0.145)
  } else {
    for (const s of [-1, 1]) {
      const wing = box(body, [0.038, 0.02, 0.01], ivory, s * 0.024, 1.118, 0.148)
      wing.rotation.z = s * 0.4
      const tail = box(body, [0.1, 0.34, 0.016], inkDeep, s * 0.08, 0.5, -0.07)
      tail.rotation.x = 0.2
    }
    oval(body, [0.012, 0.012, 0.01], gilt, 0, 1.108, 0.156)
    if (index === 9) oval(body, [0.016, 0.016, 0.01], gilt, 0.1, 1.02, 0.14)
  }
}
function buildLegs(group, part) {
  const ink = suits[part].pants
  for (const s of [-1, 1]) {
    rod(group, [s * 0.09, 0.58, 0.02], [s * 0.15, 0.3, 0.24], 0.062, ink)
    rod(group, [s * 0.15, 0.3, 0.24], [s * 0.17, 0.08, 0.36], 0.05, ink)
    oval(group, [0.06, 0.032, 0.11], shoe, s * 0.17, 0.05, 0.42)
  }
}
function addBow(hand, cello) {
  const reach = cello ? 0.58 : 0.5
  rod(hand, [0.04, 0.01, 0.04], [-reach, 0.03, 0.08], cello ? 0.016 : 0.013, bowWood, 0.007)
  rod(hand, [0.02, -0.008, 0.045], [-reach + 0.06, 0.004, 0.085], 0.004, ivory)
  box(hand, [0.045, 0.02, 0.016], shoe, 0, 0.01, 0.045)
}
function addNubs(hand, skin) {
  for (let i = 0; i < 4; i++) oval(hand, [0.011, 0.012, 0.016], skin, 0.008, 0.006 + i * 0.01, 0.045)
}
function addFlute(body, rig) {
  rod(body, [-0.02, 1.22, 0.16], [0.62, 1.2, 0.28], 0.015, silver, 0.012)
  oval(body, [0.028, 0.012, 0.02], silver, 0.02, 1.236, 0.15)
  oval(body, [0.018, 0.018, 0.018], gilt, 0.62, 1.198, 0.28)
  rig.pads = []
  for (let i = 0; i < 8; i++) {
    const pad = oval(body, [0.016, 0.008, 0.016], silver, 0.12 + i * 0.055, 1.232, 0.2)
    pad.userData.restY = pad.position.y
    rig.pads.push(pad)
  }
}
function grandPiano(parent) {
  const body = new THREE.Shape()
  body.moveTo(-0.65, 0); body.lineTo(0.65, 0); body.lineTo(0.65, -0.65)
  body.bezierCurveTo(0.65, -1.7, -0.25, -1.75, -0.37, -0.95)
  body.bezierCurveTo(-0.4, -0.6, -0.65, -0.5, -0.65, 0)
  const shell = mesh(parent, new THREE.ExtrudeGeometry(body, { depth: 0.2, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2, steps: 1 }), material(0x10121a, 0.2))
  shell.rotation.x = -Math.PI / 2; shell.position.set(0, 0.77, 0.75)
  const lid = mesh(parent, new THREE.ShapeGeometry(body), material(0x1c1a19, 0.23))
  lid.rotation.set(-Math.PI / 2, 0.42, 0); lid.position.set(0, 1.04, 0.75); lid.material.side = THREE.DoubleSide
  rod(parent, [0.48, 0.94, 1.25], [0.48, 1.37, 1.25], 0.012, brass)
  for (const [x, z] of [[-0.55, 0.6], [0.55, 0.6], [0.18, 1.85]]) {
    rod(parent, [x, 0.75, z], [x, 0.09, z], 0.045, shoe)
    oval(parent, [0.06, 0.04, 0.06], brass, x, 0.07, z)
  }
  box(parent, [1.3, 0.09, 0.25], shoe, 0, 0.79, 0.48)
  const keys = new THREE.Group(); parent.add(keys)
  for (let i = 0; i < 28; i++) {
    const key = box(keys, [0.039, 0.025, 0.18], white, -0.58 + i * 0.043, 0.85, 0.46)
    if (![2, 6].includes(i % 7)) box(keys, [0.023, 0.03, 0.1], shoe, key.position.x + 0.02, 0.874, 0.5)
  }
  keys.children.forEach(key => { key.userData.restY = key.position.y })
  return keys
}
function musician(part, x, z, index) {
  const group = new THREE.Group(); group.position.set(x, 0, z)
  const skin = skins[index % skins.length]
  const hair = hairColors[index % hairColors.length]
  const accent = sectionMat[part]
  const ink = suits[part].coat
  if (part === "piano") bench(group)
  else chair(group, ink)
  if (part !== "flute") buildLegs(group, part)
  const body = new THREE.Group(); group.add(body)
  buildTorso(body, part, accent, skin, index)
  const head = new THREE.Group(); head.position.y = 1.31; head.scale.setScalar(1); body.add(head)
  buildHead(head, skin, hair, index, part)
  const rig = {}
  let moving = null
  let keys = null
  if (part === "violin" || part === "cello") {
    const cello = part === "cello"
    const inst = stringInstrument(body, cello)
    inst.position.set(cello ? 0.02 : -0.08, cello ? 0.5 : 1.08, cello ? 0.32 : 0.18)
    inst.rotation.set(cello ? 0.1 : 0.25, cello ? 0.25 : 0.1, cello ? 0.18 : 1.12)
    const hold = cello ? HOLDS.cello : HOLDS.violin
    rig.bow = createLimb(body, ink, skin, 0.046)
    rig.finger = createLimb(body, ink, skin, 0.042)
    addBow(rig.bow.hand, cello)
    addNubs(rig.finger.hand, skin)
    applyLimb(rig.bow, hold.bow.s, hold.bow.e, hold.bow.w)
    applyLimb(rig.finger, hold.finger.s, hold.finger.e, hold.finger.w)
    moving = rig.bow.hand
  } else if (part === "flute" || part === "horn") {
    rig.left = createLimb(body, ink, skin, 0.04)
    rig.right = createLimb(body, ink, skin, 0.04)
    applyLimb(rig.left, HOLDS.flute.left.s, HOLDS.flute.left.e, HOLDS.flute.left.w)
    applyLimb(rig.right, HOLDS.flute.right.s, HOLDS.flute.right.e, HOLDS.flute.right.w)
    if (part === "flute") addFlute(body, rig)
    else {
      const bell = new THREE.Group(); body.add(bell)
      bell.position.set(0.04, 1.14, 0.16)
      const coil = mesh(bell, new THREE.TorusGeometry(0.07, 0.016, 8, 18), brass)
      coil.rotation.y = 0.9
      rod(bell, [0.05, 0, 0.02], [0.34, 0.08, 0.22], 0.015, brass, 0.05)
      rig.bell = bell
    }
    moving = rig.right.hand
  } else {
    const piano = new THREE.Group(); piano.position.set(0, 0, 0.22); body.add(piano)
    keys = grandPiano(piano)
    rig.left = createLimb(body, ink, skin, 0.044)
    rig.right = createLimb(body, ink, skin, 0.044)
    applyLimb(rig.left, HOLDS.piano.left.s, HOLDS.piano.left.e, HOLDS.piano.left.w)
    applyLimb(rig.right, HOLDS.piano.right.s, HOLDS.piano.right.e, HOLDS.piano.right.w)
    moving = rig.right.hand
  }
  if (part !== "piano") stand(group, part === "flute" ? 0.02 : 0.18, 0.78, 0.86)
  group.userData = { part, body, head, moving, keys, index, rig, wasActive: false, entered: null }
  return group
}
function addFinger(group, skin, x, length, curl) {
  const finger = new THREE.Group()
  finger.position.set(x, 0.028, -0.078)
  group.add(finger)
  const proximal = length * 0.52
  rod(finger, [0, 0, 0], [0, 0, -proximal], 0.015, skin, 0.013)
  const mid = new THREE.Group()
  mid.position.set(0, 0, -proximal)
  finger.add(mid)
  rod(mid, [0, 0, 0], [0, 0, -(length - proximal)], 0.013, skin, 0.011)
  oval(mid, [0.012, 0.013, 0.014], skin, 0, 0.002, -(length - proximal))
  finger.rotation.x = curl
  finger.userData.mid = mid
  return finger
}
function hand(right) {
  const group = new THREE.Group()
  const skin = material(0xf0c8ad)
  const ink = material(0x3a3f58)
  const forearm = makeRod(group, 0.052, ink, 0.04)
  const cuff = makeRod(group, 0.046, ivory, 0.042)
  oval(group, [0.011, 0.011, 0.007], gilt, right ? 0.03 : -0.03, -0.045, 0.03)
  box(group, [0.1, 0.034, 0.1], skin, 0, 0.02, -0.02)
  oval(group, [0.048, 0.03, 0.04], skin, 0, 0.016, 0.035)
  if (!right) oval(group, [0.038, 0.042, 0.035], skin, 0, -0.022, 0.025)
  const fingers = []
  const xs = right ? [-0.042, -0.014, 0.014, 0.042] : [0.042, 0.014, -0.014, -0.042]
  const lengths = [0.11, 0.124, 0.112, 0.086]
  const curl = right ? -1.15 : -0.12
  xs.forEach((x) => oval(group, [0.016, 0.014, 0.016], skin, x, 0.04, -0.07))
  for (let i = 0; i < 4; i++) fingers.push(addFinger(group, skin, xs[i], lengths[i], curl))
  const thumb = new THREE.Group()
  thumb.position.set(right ? -0.055 : 0.055, 0.016, -0.02)
  group.add(thumb)
  rod(thumb, [0, 0, 0], [right ? -0.05 : 0.05, -0.005, -0.05], 0.015, skin, 0.012)
  oval(thumb, [0.014, 0.014, 0.016], skin, right ? -0.05 : 0.05, -0.005, -0.05)
  thumb.rotation.set(right ? -0.85 : -0.4, 0, right ? 0.45 : -0.45)
  let batonLag = null
  let tip = null
  if (right) {
    batonLag = new THREE.Group()
    group.add(batonLag)
    rod(batonLag, [0.02, -0.01, -0.04], [-0.01, 0.08, -0.1], 0.014, oak, 0.011)
    tip = rod(batonLag, [-0.01, 0.08, -0.1], [-0.12, 0.43, -0.38], 0.007, material(0xf3ece0), 0.005)
  }
  group.userData = { fingers, thumb, batonLag, tip, forearm, cuff }
  group.renderOrder = 6
  return group
}
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const smooth = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x) }
function ictus(u) {
  return Math.sin(Math.pow(clamp01(u), 0.36) * Math.PI)
}
function animatePlayers(players, seconds, playing, sections, wall) {
  const hz = sections.beatHz ?? 96 / 60
  for (const person of players) {
    const { part, body, head, keys, index, rig } = person.userData
    const active = playing.has(part)
    if (active && !person.userData.wasActive) person.userData.entered = seconds
    if (!active) person.userData.entered = null
    person.userData.wasActive = active
    const since = person.userData.entered == null ? 8 : seconds - person.userData.entered
    const entrance = Math.exp(-Math.max(0, since) * 2.4)
    const breath = Math.sin(seconds * Math.PI * 2 * 0.42 + index * 0.7)
    const phase = seconds * Math.PI * 2 * hz / (part === "cello" ? 2 : 1) + index * 0.05
    // A player only moves while their own part is sounding a note. The stroke is one
    // gesture per note: its length is the note's length, its size is the note's velocity.
    const stroke = person.userData.stroke
    const age = stroke ? wall - stroke.start : 0
    const sounding = active && Boolean(stroke) && age >= 0 && age <= stroke.dur
    const waiting = sections.pending.has(part) && !active
    const closing = sections.prompt?.kind === "cut" && active
    // A sounding note is one bow. Between notes an active player keeps a smaller stroke,
    // so the last bars do not freeze just because a long note has reached its end.
    const phrase = Math.sin(seconds * Math.PI * 2 * hz + index * 0.4)
    const swelling = sections.prompt?.kind === "swell" && sections.pending.has(part)
    const swellLift = sections.prompt?.lift ?? sections.prompt?.progress ?? 0
    const rising = sections.prompt?.dir !== "down"
    const along = sounding
      ? Math.sin((age / stroke.dur) * Math.PI) * (0.45 + 0.55 * stroke.vel)
      : active ? phrase * 0.42 + (swelling && rising ? swellLift * 0.6 : 0) : waiting ? 0.7 : 0
    // Waiting players lift the instrument. A swell lifts or settles the body. A cut bows.
    const eager = waiting ? Math.abs(Math.sin(wall * 3 + index)) * 0.02 : 0
    const bounce = active && !closing ? entrance * Math.abs(Math.sin(since * 14)) * 0.06 : 0
    body.position.y = breath * (active ? 0.01 : 0.004) + eager + bounce + (swelling && rising ? swellLift * 0.04 : 0)
    body.rotation.set(
      closing ? 0.32 : swelling ? (rising ? -0.2 * swellLift : 0.26) : waiting ? 0.1 : (active ? 0.035 : 0.012) + breath * 0.008 + entrance * 0.07,
      active && !closing ? along * 0.045 : 0,
      active && !closing ? -along * 0.05 : breath * 0.006,
    )
    head.rotation.set(
      active ? 0.04 - along * 0.05 : 0.03,
      active ? along * 0.07 : Math.sin(seconds * 0.35 + index) * 0.045,
      active ? -along * 0.04 : 0,
    )
    if (part === "violin" || part === "cello") {
      const hold = part === "cello" ? HOLDS.cello : HOLDS.violin
      const elbow = [
        hold.bow.e[0] + along * hold.bow.travel * 0.28,
        hold.bow.e[1] + Math.cos(phase) * 0.02 * (active ? 1 : 0),
        hold.bow.e[2],
      ]
      const wrist = [hold.bow.w[0] + along * hold.bow.travel, hold.bow.w[1] + Math.abs(along) * 0.012, hold.bow.w[2]]
      applyLimb(rig.bow, hold.bow.s, elbow, wrist)
      rig.bow.hand.rotation.set(hold.bow.rx, hold.bow.ry + along * 0.2, along * hold.bow.rz)
      const vib = active ? Math.sin(seconds * 26 + index) * 0.01 : 0
      const fingerWrist = [hold.finger.w[0], hold.finger.w[1] + vib, hold.finger.w[2] + vib * 0.4]
      applyLimb(rig.finger, hold.finger.s, hold.finger.e, fingerWrist)
    } else if (part === "flute") {
      const lift = waiting ? 0.07 : breath * (active ? 0.016 : 0.004)
      const left = HOLDS.flute.left
      const right = HOLDS.flute.right
      applyLimb(rig.left, left.s, left.e, [left.w[0], left.w[1] + lift, left.w[2]])
      applyLimb(rig.right, right.s, right.e, [right.w[0], right.w[1] + lift * 0.6, right.w[2]])
      rig.right.hand.rotation.x = sounding ? along * 0.12 : 0
      if (rig.bell) rig.bell.rotation.z = sounding ? -along * 0.5 : 0
      rig.pads.forEach((pad, i) => {
        const down = sounding && ((i + Math.floor(age * 8)) % 3 === 0)
        pad.position.y = pad.userData.restY + (down ? -0.007 : 0.003)
      })
    } else if (part === "horn") {
      const lift = along * 0.05
      const left = HOLDS.flute.left
      const right = HOLDS.flute.right
      applyLimb(rig.left, left.s, left.e, [left.w[0], left.w[1] + lift, left.w[2]])
      applyLimb(rig.right, right.s, right.e, [right.w[0], right.w[1] + lift, right.w[2]])
      if (rig.bell) rig.bell.rotation.x = -along * 0.35
    } else {
      const leftLift = along * 0.045
      const rightLift = along * 0.045
      const left = HOLDS.piano.left
      const right = HOLDS.piano.right
      applyLimb(rig.left, left.s, [left.e[0], left.e[1] + leftLift, left.e[2]], [left.w[0], left.w[1] + leftLift, left.w[2]])
      applyLimb(rig.right, right.s, [right.e[0], right.e[1] + rightLift, right.e[2]], [right.w[0], right.w[1] + rightLift, right.w[2]])
      rig.left.hand.rotation.x = -0.35 - leftLift * 6
      rig.right.hand.rotation.x = -0.35 - rightLift * 6
      if (keys) {
        keys.children.forEach((key, i) => {
          const play = sounding && (i % 8 === Math.floor((stroke.pitch || 0) / 2) % 8 || (i + 3) % 8 === Math.floor(age * 6) % 8)
          key.position.y = key.userData.restY - (play ? 0.012 : 0)
        })
      }
    }
  }
}

// Vertical colour bands instead of canvas gradients, so textures also build headless.
function bands(g, w, h, stops) {
  const steps = 64
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    const k = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)))
    const local = t * (stops.length - 1) - k
    g.fillStyle = '#' + new THREE.Color(stops[k]).lerp(new THREE.Color(stops[k + 1]), local).getHexString()
    g.fillRect(0, Math.floor(i * h / steps), w, Math.ceil(h / steps) + 1)
  }
}
function noteTexture(color, glyph) {
  return texture((g, w, h) => {
    g.font = `bold ${w * 0.78}px "Arial Rounded MT Bold", "Apple Symbols", sans-serif`
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.lineJoin = 'round'; g.lineWidth = w * 0.1; g.strokeStyle = '#ffffff'
    g.strokeText(glyph, w / 2, h * 0.54)
    g.fillStyle = '#' + new THREE.Color(color).getHexString()
    g.fillText(glyph, w / 2, h * 0.54)
  }, 128, 128)
}

export function createWorld(canvas, laneCanvas) {
  paper = scoreMap()
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  renderer.shadowMap.enabled = false
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x080b12)
  scene.fog = new THREE.FogExp2(0x0c0e16, 0.036)
  const camera = new THREE.PerspectiveCamera(53, 1, 0.05, 60)
  camera.position.set(0, 2.2, 4.7)
  camera.lookAt(0, 1.25, -3)
  scene.add(camera)
  scene.add(new THREE.HemisphereLight(0xd9e6ff, 0x6d4224, 0.82))
  const key = new THREE.DirectionalLight(0xffdfad, 3.55); key.position.set(-3, 7, 4)
  key.castShadow = false
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 25 })
  key.shadow.bias = -0.001; scene.add(key)
  const rim = new THREE.DirectionalLight(0x8baaff, 1.15); rim.position.set(4, 4, -7); scene.add(rim)
  for (const x of [-4, 0, 4]) {
    const spot = new THREE.SpotLight(0xffd3a0, 30, 17, 0.51, 0.82, 1.7)
    spot.position.set(x, 6, -1); spot.target.position.set(x * 0.7, 0, -3)
    scene.add(spot, spot.target)
    oval(scene, [0.09, 0.045, 0.09], glow(0xffe9bd), x, 5.8, -1)
  }
  const floorMap = texture((g, w, h) => {
    g.fillStyle = '#84502e'; g.fillRect(0, 0, w, h)
    let seed = 42
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (let row = 0; row < 8; row++) {
      g.fillStyle = `hsl(29 38% ${32 + rand() * 11}%)`; g.fillRect(0, row * 64, w, 63)
      g.fillStyle = '#372519'; g.fillRect(0, row * 64, w, 2)
      for (let n = 0; n < 45; n++) {
        g.strokeStyle = `rgba(32,18,9,${rand() * 0.15})`; g.beginPath()
        const y = row * 64 + rand() * 64
        g.moveTo(0, y); g.bezierCurveTo(150, y + rand() * 7, 340, y - rand() * 7, w, y); g.stroke()
      }
      g.fillStyle = '#46301f'; g.fillRect(row % 2 ? 120 : 360, row * 64, 2, 64)
    }
  })
  floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping; floorMap.repeat.set(4, 5); floorMap.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const floor = mesh(scene, new THREE.PlaneGeometry(19, 23, 19, 23), new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.62 }), 0, -0.01, -3)
  floor.rotation.x = -Math.PI / 2
  box(scene, [19, 0.35, 20], material(0x38251c), 0, -0.2, -4)
  // Timber hall, brass organ pipes, burgundy curtains. The first version of the room.
  box(scene, [18, 7, 0.3], material(0x241c1a), 0, 3.4, -10)
  for (let i = -8; i <= 8; i++) {
    box(scene, [0.79, 5.4, 0.15], material(i % 2 ? 0x4e3426 : 0x5e3e2c), i * 0.96, 2.8, -9.75)
    rod(scene, [i * 0.96 - 0.42, 0, -9.6], [i * 0.96 - 0.42, 5.6, -9.6], 0.023, brass)
  }
  for (let i = -10; i <= 10; i++) {
    const h = 2.3 + (1 - Math.abs(i) / 11) * 1.9
    rod(scene, [i * 0.17, 1.5, -9.35], [i * 0.17, 1.5 + h, -9.35], 0.064, material(0xa99c7c, 0.37, 0.65))
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 18; i++) {
      const curtain = mesh(scene, new THREE.CylinderGeometry(0.22, 0.24, 7.5, 12), material(i % 2 ? 0x401624 : 0x591e2d), s * (6.3 + i * 0.16), 3.5, -7.6 + Math.sin(i) * 0.12)
      curtain.scale.z = 0.8
    }
    box(scene, [0.6, 6, 15], material(0x171620), s * 9, 3, -2)
    for (const y of [2.9, 5.1]) {
      box(scene, [0.7, 0.2, 14], oak, s * 8.4, y, -2.5)
      rod(scene, [s * 8, y + 0.55, -9], [s * 8, y + 0.55, 4], 0.035, brass)
      for (let z = -9; z < 4; z += 0.5) rod(scene, [s * 8, y, z], [s * 8, y + 0.55, z], 0.014, brass)
    }
  }
  const podium = box(scene, [2.8, 0.19, 4.2], oak, 0, 0.095, 3.3)
  box(podium, [2.64, 0.018, 4.03], material(0x5f2630), 0, 0.105, 0)
  for (const x of [-1.35, 1.35]) box(scene, [0.025, 0.012, 4.15], brass, x, 0.2, 3.3)
  box(scene, [2.72, 0.012, 0.025], brass, 0, 0.2, 1.23)
  const desk = stand(scene, 0, 2.6, 1.18)
  desk.rotation.y = Math.PI
  let conductorPage = null
  desk.traverse((obj) => { if (obj.material?.map === paper) conductorPage = obj })
  const players = []
  // Fan, left to right as the conductor sees it: violins, flutes, horns, cellos, piano.
  const layout = [
    ['violin', -3.3, -1.55], ['violin', -2.15, -1.05], ['violin', -1.0, -0.85], ['violin', 0.15, -1.05], ['violin', 1.3, -1.6],
    ['flute', -2.75, -3.7], ['flute', -1.5, -4.0],
    ['horn', -0.2, -4.45], ['horn', 1.15, -4.25],
    ['cello', 1.85, -2.25], ['cello', 2.85, -1.7], ['cello', 3.55, -2.55],
    ['piano', 3.2, -5.2],
  ]
  const RISER = { violin: 0, cello: 0.16, flute: 0.4, horn: 0.55, piano: 0.55 }
  for (const [x, height, z, depth, width, color] of [[0, 0.55, -4.7, 2.4, 8.2, 0x3a2a22], [2.7, 0.16, -2.15, 1.5, 2.6, 0x4a3428]]) {
    const riser = box(scene, [width, height, depth], material(color), x, height / 2, z)
      box(riser, [width + 0.02, 0.03, 0.04], glow(0xe6c98a, 0.65), 0, height / 2 - 0.01, depth / 2)
  }
  layout.forEach(([part, x, z], i) => {
    const person = musician(part, x, z, i)
    person.position.y = RISER[part]
    person.rotation.y = part === "piano" ? -0.95 : Math.atan2(-x, 4.7 - z) * 0.65
    scene.add(person); players.push(person)
  })
  const left = hand(false), right = hand(true)
  const laneDepth = 1.65
  const laneTexture = new THREE.CanvasTexture(laneCanvas)
  laneTexture.colorSpace = THREE.SRGBColorSpace
  let laneWidth = laneCanvas.width, laneHeight = laneCanvas.height
  const lanePlane = mesh(camera, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: laneTexture, transparent: true, depthWrite: false, toneMapped: false,
  }), 0, 0, -laneDepth)
  lanePlane.castShadow = false
  lanePlane.receiveShadow = false
  lanePlane.visible = false
  const freeRests = [new THREE.Vector3(-0.26, -0.26, -0.95), new THREE.Vector3(0.4, -0.35, -0.98)]
  const rests = freeRests.map(rest => rest.clone())
  let levelHands = false
  left.position.copy(rests[0]); right.position.copy(rests[1]); camera.add(left, right)
  const handStates = [{ until: 0, pose: 'rest' }, { until: 0, pose: 'rest' }]

  const soloPiano = musician("piano", 0.45, -2.0, 9)
  soloPiano.rotation.y = -0.85
  soloPiano.visible = false
  scene.add(soloPiano)
  const soloPlayers = [soloPiano]
  const halos = players.map((person) => {
    const color = SECTION_COLOR[person.userData.part]
    const disc = mesh(scene, new THREE.CircleGeometry(0.5, 40), glow(color, 0), person.position.x, person.position.y + 0.025, person.position.z)
    disc.rotation.x = -Math.PI / 2; disc.castShadow = false; disc.receiveShadow = false
    const ring = mesh(disc, new THREE.RingGeometry(0.5, 0.58, 48), glow(0xffffff, 0))
    ring.castShadow = false; ring.receiveShadow = false
    disc.userData = { halo: true, part: null, of: person.userData.part, ring }
    disc.renderOrder = 1
    return disc
  })
  const noteMaps = Object.fromEntries(Object.entries(SECTION_COLOR).map(([part, color]) => [part, ['♪', '♫', '♩'].map((glyph) => noteTexture(color, glyph))]))
  const notes = []
  const noteGeo = new THREE.PlaneGeometry(0.26, 0.26)
  let lastFrame = performance.now() / 1000

  const cueRings = []
  const band = mesh(scene, new THREE.PlaneGeometry(1.4, 1.6), glow(0xe6c98a, 0))
  band.castShadow = false
  band.receiveShadow = false
  band.visible = false
  const sectionOrder = Object.keys(SECTION_COLOR)
  const beacons = sectionOrder.map(() => {
    const group = new THREE.Group()
    const gem = mesh(group, new THREE.OctahedronGeometry(0.16, 0), glow(0xfff1cc, 1), 0, 0.22, 0)
    const stem = mesh(group, new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8), glow(0xe6c98a, 0.95), 0, -0.18, 0)
    gem.castShadow = false
    stem.castShadow = false
    gem.receiveShadow = false
    stem.receiveShadow = false
    group.visible = false
    scene.add(group)
    return group
  })
  const shafts = sectionOrder.map(() => {
    const shaft = mesh(scene, new THREE.CylinderGeometry(0.035, 0.09, 1, 8), glow(0xffe3a8, 0.28))
    shaft.castShadow = false
    shaft.receiveShadow = false
    shaft.visible = false
    return shaft
  })
  const lamps = sectionOrder.map(() => {
    const lamp = new THREE.PointLight(0xffe3a8, 0, 5.5, 1.2)
    scene.add(lamp)
    return lamp
  })
  const arch = mesh(scene, new THREE.TorusGeometry(1, 0.055, 8, 32, Math.PI), glow(0xfff1cc, 0.96))
  arch.castShadow = false
  arch.receiveShadow = false
  arch.visible = false
  function arrowShape() {
    const shape = new THREE.Shape()
    shape.moveTo(0, 0.36)
    shape.lineTo(0.24, 0.05)
    shape.lineTo(0.09, 0.05)
    shape.lineTo(0.09, -0.3)
    shape.lineTo(-0.09, -0.3)
    shape.lineTo(-0.09, 0.05)
    shape.lineTo(-0.24, 0.05)
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }
  const arrowGeo = arrowShape()
  const arrowFace = glow(0xfff6df, 1)
  const arrowRim = glow(0x6b5124, 1)
  const beatRoot = new THREE.Group()
  beatRoot.visible = false
  camera.add(beatRoot)
  const hitLine = box(beatRoot, [1.7, 0.01, 0.006], glow(0xe6c98a, 0.95), 0, -0.32, -1.58)
  const hitGlow = box(beatRoot, [1.7, 0.045, 0.002], glow(0xe6c98a, 0.16), 0, -0.32, -1.55)
  // A soft warm-dark shadow under the gold line, not an outline on it: it
  // seats the line on the floor without drawing a black edge of its own.
  const hitEdge = box(beatRoot, [1.72, 0.022, 0.004], glow(0x2b1d0f, 0.3), 0, -0.325, -1.588)
  hitEdge.castShadow = false
  hitEdge.receiveShadow = false
  hitLine.castShadow = false
  hitGlow.castShadow = false
  hitLine.receiveShadow = false
  hitGlow.receiveShadow = false
  const BEAT_ROT = { up: 0, right: -Math.PI / 2, down: Math.PI, left: Math.PI / 2 }
  function makeArrow() {
    const group = new THREE.Group()
    const rim = mesh(group, arrowGeo, arrowRim)
    rim.scale.setScalar(1.18)
    rim.position.z = -0.02
    const face = mesh(group, arrowGeo, arrowFace)
    for (const layer of [rim, face]) {
      layer.castShadow = false
      layer.receiveShadow = false
    }
    group.visible = false
    beatRoot.add(group)
    return group
  }
  const flyers = Array.from({ length: 12 }, makeArrow)
  const swellSign = makeArrow()
  swellSign.removeFromParent()
  scene.add(swellSign)
  const meter = new THREE.Group()
  const rail = mesh(meter, new THREE.BoxGeometry(1.35, 0.09, 0.03), glow(0x3a3124, 0.92))
  const fill = mesh(meter, new THREE.BoxGeometry(1.35, 0.09, 0.04), glow(0xfff1cc, 1), 0, 0, 0.012)
  const head = mesh(meter, new THREE.SphereGeometry(0.09, 12, 10), glow(0xfff6df, 1))
  for (const piece of [rail, fill, head]) {
    piece.castShadow = false
    piece.receiveShadow = false
  }
  meter.visible = false
  scene.add(meter)
  function beatHands(cue) {
    if (cue.hand === "both") return ["left", "right"]
    return [cue.hand === "left" ? "left" : "right"]
  }
  function placeArrow(group, hand, remain, lead, direction, mul = 1) {
    const flight = beatFlight(hand, remain, lead)
    group.visible = true
    group.position.set(flight.x, flight.y, flight.z)
    group.scale.setScalar(Math.max(0.18, flight.scale * mul))
    group.rotation.z = BEAT_ROT[direction] || 0
  }
  function syncBeats(now, cues = [], beat = 0.6) {
    for (const group of flyers) group.visible = false
    const lead = Math.max(0.25, beat) * 3.4
    const visible = (cues || []).filter((cue) => cue.kind === "beat" && cue.direction && cue.time - now < lead && now - cue.time < 0.3 && (!cue.result || cue.result === "miss"))
    let slot = 0
    for (const cue of visible) {
      for (const hand of beatHands(cue)) {
        if (slot >= flyers.length) break
        const remain = cue.time - now
        placeArrow(flyers[slot], hand, remain, lead, cue.direction, 1.15)
        slot += 1
      }
    }
  }
  const scoreCanvas = document.createElement("canvas")
  scoreCanvas.width = 512
  scoreCanvas.height = 256
  const scoreContext = scoreCanvas.getContext("2d")
  const scoreTexture = new THREE.CanvasTexture(scoreCanvas)
  scoreTexture.colorSpace = THREE.SRGBColorSpace
  if (conductorPage) {
    conductorPage.material = conductorPage.material.clone()
    conductorPage.material.map = scoreTexture
  }
  let painted = ""
  function paintScore(line) {
    if (!scoreContext || line === painted) return
    painted = line
    scoreContext.fillStyle = "#f7f1e6"
    scoreContext.fillRect(0, 0, 512, 256)
    scoreContext.fillStyle = "#4a4d5e"
    scoreContext.font = '28px "Iowan Old Style", Palatino, serif'
    scoreContext.textAlign = "center"
    scoreContext.fillText(line || "指挥谱", 256, 148)
    scoreTexture.needsUpdate = true
  }
  paintScore("指挥谱")
  function resize() {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    renderer.setSize(rect.width, rect.height, false)
    camera.aspect = rect.width / rect.height
    // Keep the full orchestra in portrait layouts too.
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(53 / 2)) * Math.max(1, 1.4 / camera.aspect)))
    camera.updateProjectionMatrix()
    const planeHeight = 2 * laneDepth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    lanePlane.scale.set(planeHeight * camera.aspect, planeHeight, 1)
    rests.forEach((rest, index) => {
      rest.copy(freeRests[index])
      if (!levelHands) {
        rest.y *= Math.max(1, 1.4 / camera.aspect)
        return
      }
      const target = laneLayout(rect.width, rect.height)[index ? "right" : "left"].target
      const palm = new THREE.Vector3(0, 0.02, -0.02).applyAxisAngle(new THREE.Vector3(1, 0, 0), index ? 0 : 0.45)
      const depth = -(rest.z + palm.z)
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth
      rest.x = (target.x / rect.width * 2 - 1) * halfHeight * camera.aspect - palm.x
      rest.y = (1 - (target.y + rect.height * 0.1) / rect.height * 2) * halfHeight - palm.y
    })
  }
  // The lane canvas is composited on a plane behind the hands; the hall marks who is due to enter.
  function spawn(cue) {
    if (cue.kind !== 'cue') return
    const people = players.filter(p => p.userData.part === cue.part)
    const rings = people.map(person => {
      const ring = mesh(scene, new THREE.RingGeometry(0.24, 0.31, 64), glow(SECTION_COLOR[cue.part]))
      mesh(ring, new THREE.RingGeometry(0.315, 0.34, 64), glow(0xffffff, 0.9))
      const center = new THREE.Vector3(); person.getWorldPosition(center)
      ring.position.copy(center).add(new THREE.Vector3(0, 1.42, 0.12))
      ring.lookAt(camera.position)
      ring.userData = { person }
      return ring
    })
    cueRings.push({ cue, rings })
  }
  const pitchTextures = new Map()
  function pitchTexture(pitch) {
    const letter = String(pitch).replace(/[0-9]/g, "") || "♪"
    if (pitchTextures.has(letter)) return pitchTextures.get(letter)
    const map = texture((g, w, h) => {
      g.clearRect(0, 0, w, h)
      g.font = `bold ${w * 0.62}px Georgia, "Times New Roman", serif`
      g.textAlign = "center"
      g.textBaseline = "middle"
      g.fillStyle = "#f4ead4"
      g.fillText(letter, w / 2, h * 0.54)
    }, 128, 128)
    pitchTextures.set(letter, map)
    return map
  }
  // The pitch itself, rising off the player who just sounded it. A handful of letters,
  // not a new mesh for every note of a full score.
  function emit(part, pitch) {
    if (!pitch || notes.length > 16) return
    const people = (soloPiano.visible ? soloPlayers : players).filter((person) => person.userData.part === part)
    const person = people[0]
    if (!person) return
    const note = mesh(scene, noteGeo, new THREE.MeshBasicMaterial({
      map: pitchTexture(pitch), transparent: true, depthWrite: false, toneMapped: false,
    }))
    note.castShadow = false
    note.receiveShadow = false
    const center = new THREE.Vector3()
    person.getWorldPosition(center)
    note.position.copy(center).add(new THREE.Vector3((Math.random() - 0.5) * 0.18, 1.62, 0.25))
    note.userData = { age: 0, sway: Math.random() * 6, drift: (Math.random() - 0.5) * 0.12 }
    notes.push(note)
  }
  function remove(group) {
    group.removeFromParent()
    group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) obj.material.dispose()
    })
  }
  function reset() {
    cueRings.forEach(entry => entry.rings.forEach(remove)); cueRings.length = 0
    notes.forEach(note => { note.removeFromParent(); note.material.dispose() }); notes.length = 0
    handStates.forEach((state, index) => {
      state.until = 0
      state.pose = 'rest'
      const item = index ? right : left
      item.position.copy(rests[index])
      item.rotation.set(index ? 0 : 0.45, 0, 0)
    })
    syncBeats(0, [], 1)
    swellSign.visible = false
    meter.visible = false
  }
  const NO_SECTIONS = { selected: new Set(), pending: new Map(), solo: null }
  function update(seconds, playing, sections = NO_SECTIONS) {
    const t = performance.now() / 1000
    const dt = Math.min(0.1, Math.max(0, t - lastFrame)); lastFrame = t
    animatePlayers(players, seconds, playing, sections, t)
    if (soloPiano.visible) animatePlayers(soloPlayers, seconds, playing, sections, t)
    for (const part of Object.keys(suits)) {
      const mood = Math.min(1.6, Math.max(0.55, sections.dynamics ?? 1))
      const energy = (mood - 0.55) / 1.05
      const phase = sections.beatPhase ?? 0
      const pulse = Math.exp(-phase * 6)
      const living = playing.has(part) ? 0.22 + energy * 0.5 + pulse * 0.28 : 0
      const lit = sections.pending.has(part) ? 1.15 : sections.selected.has(part) ? Math.max(0.45, living) : living
      suits[part].coat.emissive.copy(suits[part].color).multiplyScalar(lit)
      suits[part].deep.emissive.copy(suits[part].color).multiplyScalar(lit * 0.85)
      suits[part].pants.emissive.copy(suits[part].color).multiplyScalar(lit * 0.65)
    }
    halos.forEach((disc) => {
      const part = disc.userData.of
      const selected = sections.selected.has(part)
      const pending = sections.pending.has(part)
      const soloing = sections.solo?.has(part)
      const mood = Math.min(1.6, Math.max(0.55, sections.dynamics ?? 1))
      const energy = (mood - 0.55) / 1.05
      const pulse = Math.exp(-(sections.beatPhase ?? 0) * 6)
      const living = playing.has(part) ? 0.2 + energy * 0.38 + pulse * 0.22 : 0
      const target = selected ? Math.max(0.55, living) : pending ? 0.85 : soloing ? 0.4 : living
      disc.material.opacity = THREE.MathUtils.lerp(disc.material.opacity, target, 0.25)
      disc.userData.ring.material.opacity = selected || pending ? 1 : soloing ? 0.6 : playing.has(part) ? 0.25 + energy * 0.35 : 0
      disc.scale.setScalar(pending ? 1.6 : playing.has(part) ? 1 + pulse * 0.08 : 1)
    })
    for (let i = notes.length - 1; i >= 0; i--) {
      const note = notes[i], data = note.userData
      data.age += dt
      if (data.age > 1.6) { note.removeFromParent(); note.material.dispose(); notes.splice(i, 1); continue }
      note.position.y += dt * 0.55
      note.position.x += Math.sin(data.age * 5 + data.sway) * dt * 0.25 + data.drift * dt
      note.quaternion.copy(camera.quaternion)
      note.rotateZ(Math.sin(data.age * 4 + data.sway) * 0.3)
      note.scale.setScalar(Math.min(1, data.age * 6) * (1 + 0.15 * Math.sin(data.age * 10)))
      note.material.opacity = 1 - Math.max(0, data.age - 0.9) / 0.7
    }
    ;[left, right].forEach((item, index) => {
      const state = handStates[index], active = t < state.until
      const rest = rests[index].clone()
      const age = t - (state.from || 0)
      const gesture = active ? state.pose : "rest"
      const u = active ? clamp01(age / (state.until - state.from)) : 0
      const direction = state.direction
      let rz = 0

      if (gesture === "beat") {
        const stroke = ictus(u)
        if (direction === "down" || direction === "up") {
          rest.y += (direction === "up" ? 1 : -1) * 0.22 * stroke
        } else {
          const side = direction === "right" ? 1 : -1
          rest.x += side * 0.24 * stroke
          rz = -side * 0.42 * stroke
        }
      } else if (gesture === "palm") {
        const lift = smooth(age / 0.85) * (1 - smooth((age - 1.05) / 0.85))
        rest.y += (direction === "up" ? 0.17 : -0.12) * lift
      } else if (gesture === "point") {
        const reach = smooth(age / 0.2) * (1 - smooth((age - 0.55) / 0.35))
        rest.y += 0.06 * reach
        rest.z -= 0.17 * reach
        if (state.aimX !== undefined) rest.x += (state.aimX - rest.x) * reach
      } else if (gesture === "circle") {
        const angle = smooth(u) * 2 * Math.PI
        const side = index ? -1 : 1
        rest.x += side * 0.13 * Math.sin(angle)
        rest.y += 0.12 * (1 - Math.cos(angle))
        rz = side * 0.22 * Math.sin(angle)
      } else if (gesture === "fist") {
        const close = smooth(age / 0.16) * (1 - smooth((age - 0.48) / 0.32))
        rest.y += 0.07 * close
        rz = (index ? -1 : 1) * 0.28 * close
      }

      item.position.lerp(rest, index ? 0.5 : 0.4)
      item.rotation.z = THREE.MathUtils.lerp(item.rotation.z, rz, 0.32)
      const base = rests[index]
      const anchor = new THREE.Vector3(base.x + (index ? 0.03 : -0.03), base.y - (index ? 0.32 : 0.42), base.z + 0.16)
        .sub(item.position).applyQuaternion(item.quaternion.clone().invert())
      const wrist = new THREE.Vector3(0, -0.04, 0.012)
      const cuffStart = wrist.clone().lerp(anchor, 0.1)
      setRod(item.userData.forearm, anchor.toArray(), cuffStart.toArray())
      setRod(item.userData.cuff, cuffStart.toArray(), wrist.toArray())

      const pointing = gesture === "point" || gesture === "circle"
      const grip = index ? -1.22 : -0.12
      const curl = gesture === "fist" ? -1.65 : pointing ? -1.05 : grip
      const spread = index ? 0 : 0.04
      item.userData.fingers.forEach((finger, i) => {
        const target = pointing && i === 0 ? -0.08 : curl
        finger.rotation.x = THREE.MathUtils.lerp(finger.rotation.x, target, 0.35)
        finger.rotation.y = THREE.MathUtils.lerp(finger.rotation.y, (i - 1.5) * spread, 0.3)
        finger.userData.mid.rotation.x = Math.min(0, finger.rotation.x) * 0.85
      })
      const thumb = gesture === "fist" ? -1.15 : pointing ? -0.65 : index ? -0.85 : -0.4
      item.userData.thumb.rotation.x = THREE.MathUtils.lerp(item.userData.thumb.rotation.x, thumb, 0.3)
      if (item.userData.batonLag) {
        const baton = item.userData.batonLag
        baton.rotation.z = THREE.MathUtils.lerp(baton.rotation.z, -rz * 0.45, 0.18)
      }
    })
    const asked = sections.prompt
    const askedNames = asked ? (asked.parts === "all" ? Object.keys(SECTION_COLOR) : [].concat(asked.part || asked.parts || [])) : []
    if (asked) {
      halos.forEach((disc) => {
        if (!askedNames.includes(disc.userData.of)) return
        const lifted = asked.kind === "swell" ? 0.2 + (asked.lift ?? asked.progress ?? 0) * 0.55 : 0.72
        disc.material.opacity = Math.max(disc.material.opacity, lifted)
        disc.userData.ring.material.opacity = 0.95
      })
    }
    const marked = new Set([...sections.pending.keys(), ...askedNames])
    const shown = []
    const ensemble = soloPiano.visible ? soloPlayers : players
    sectionOrder.forEach((part, index) => {
      const beacon = beacons[index]
      const shaft = shafts[index]
      const lamp = lamps[index]
      const people = marked.has(part) ? players.filter((person) => person.userData.part === part) : []
      if (!people.length) {
        beacon.visible = false
        shaft.visible = false
        const crew = playing.has(part) ? ensemble.filter((person) => person.userData.part === part) : []
        if (!crew.length) { lamp.intensity = 0; return }
        const spot = crew.reduce((sum, person) => sum.add(person.position), new THREE.Vector3()).multiplyScalar(1 / crew.length)
        const mood = Math.min(1.6, Math.max(0.55, sections.dynamics ?? 1))
        const pulse = Math.exp(-(sections.beatPhase ?? 0) * 6)
        lamp.intensity = 3 + ((mood - 0.55) / 1.05) * 8 + pulse * 5
        lamp.position.set(spot.x, spot.y + 1.45, spot.z + 0.3)
        return
      }
      const center = people.reduce((sum, person) => sum.add(person.position), new THREE.Vector3()).multiplyScalar(1 / people.length)
      const swelling = asked?.kind === "swell"
      lamp.intensity = asked?.kind === "cut" ? 5 : 24
      lamp.position.set(center.x, center.y + 1.5, center.z + 0.35)
      if (swelling) {
        beacon.visible = false
        shaft.visible = false
      } else {
        beacon.visible = true
        beacon.position.set(center.x, center.y + 2.35 + Math.sin(t * 3 + index) * 0.07, center.z)
        beacon.rotation.x = asked?.kind === "cut" ? Math.PI : 0
        beacon.scale.setScalar(1.5 + Math.sin(t * 4 + index) * 0.12)
        shaft.visible = asked?.kind !== "cut"
        shaft.scale.set(1, 1.4, 1)
        shaft.position.set(center.x, center.y + 1.55, center.z)
      }
      shown.push(center.clone())
    })
    if (asked?.kind === "circle" && shown.length >= 2) {
      const left = shown.reduce((best, spot) => spot.x < best.x ? spot : best)
      const right = shown.reduce((best, spot) => spot.x > best.x ? spot : best)
      const span = Math.max(0.8, right.x - left.x)
      arch.visible = true
      arch.position.set((left.x + right.x) / 2, Math.max(left.y, right.y) + 2.65, (left.z + right.z) / 2)
      arch.scale.set(span / 2, span * 0.22, 1)
      arch.rotation.set(0, 0, 0)
    } else arch.visible = false
    const arrive = Math.min(1, Math.max(0, sections.arrive ?? 0))
    if (asked && shown.length) {
      const center = shown.reduce((sum, spot) => sum.add(spot), new THREE.Vector3()).multiplyScalar(1 / shown.length)
      meter.visible = true
      meter.position.set(center.x, center.y + 2.85, center.z)
      fill.scale.x = Math.max(0.02, arrive)
      fill.position.x = -0.675 + 0.675 * arrive
      head.position.set(-0.675 + 1.35 * arrive, 0, 0.06)
      head.scale.setScalar(arrive > 0.92 ? 1.45 : 1)
      if (shown.length === 1) {
        const only = sectionOrder.findIndex((part) => marked.has(part))
        if (only >= 0 && beacons[only].visible) {
          beacons[only].position.set(center.x + 0.675, center.y + 2.85, center.z)
        }
      }
    } else meter.visible = false
    const targets = players.filter((person) => askedNames.includes(person.userData.part))
    if (asked?.kind === "swell" && targets.length) {
      const center = targets.reduce((sum, person) => sum.add(person.position), new THREE.Vector3()).multiplyScalar(1 / targets.length)
      const lift = Math.max(0.15, asked.lift ?? asked.progress ?? 0)
      const column = 0.5 + lift * 2.4
      band.visible = true
      band.position.set(center.x, center.y + column / 2, center.z + 0.25)
      band.scale.set(Math.max(0.9, targets.length * 0.28), column / 1.6, 1)
      band.material.opacity = 0.34 + lift * 0.45
      swellSign.visible = true
      swellSign.rotation.set(0, 0, asked.dir === "down" ? Math.PI : 0)
      swellSign.position.set(center.x, center.y + 1.25 + lift * 2.2, center.z + 0.75)
      swellSign.scale.setScalar(1.7)
    } else {
      band.visible = false
      swellSign.visible = false
    }
    if (sections.score !== undefined) paintScore(sections.score)
    for (let i = cueRings.length - 1; i >= 0; i--) {
      const { cue, rings } = cueRings[i], remain = cue.time - seconds
      if (remain < -0.25 || cue.result) { rings.forEach(remove); cueRings.splice(i, 1); continue }
      rings.forEach(ring => {
        ring.scale.setScalar(1 + Math.sin(t * 7) * 0.08)
        ring.material.opacity = 0.18 + Math.sin(t * 7) * 0.06
      })
    }
    if (lanePlane.visible) {
      if (laneCanvas.width !== laneWidth || laneCanvas.height !== laneHeight) {
        laneTexture.dispose()
        laneWidth = laneCanvas.width
        laneHeight = laneCanvas.height
      }
      laneTexture.needsUpdate = true
    }
    renderer.render(scene, camera)
  }
  function screenPositions() {
    const rect = canvas.getBoundingClientRect()
    const pool = soloPiano.visible ? soloPlayers : players
    return pool.map((person) => {
      const p = person.position.clone().add(new THREE.Vector3(0, 1.4, 0)).project(camera)
      return { part: person.userData.part, x: (p.x + 1) / 2 * rect.width, y: (1 - p.y) / 2 * rect.height }
    })
  }
  const poseDurations = { beat: 0.30, palm: 1.9, point: 0.9, circle: 0.92, fist: 0.8 }
  function pose(which, gesture, detail) {
    const state = handStates[which === "right" ? 1 : 0]
    state.pose = gesture
    state.from = performance.now() / 1000
    state.until = state.from + poseDurations[gesture]
    state.direction = gesture === "beat" || gesture === "palm" ? detail : undefined
    state.aimX = undefined
    if (gesture === "point" && detail) {
      const pool = soloPiano.visible ? soloPlayers : players
      const person = pool.find(p => p.userData.part === detail)
      const position = person.position.clone().add(new THREE.Vector3(0, 1.3, 0)).project(camera)
      state.aimX = THREE.MathUtils.clamp(position.x * 0.65, -0.65, 0.45)
    }
  }
  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect()
    const mouse = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1)
    const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, camera)
    const ringHit = ray.intersectObjects(cueRings.flatMap(entry => entry.rings), false)[0]
    if (ringHit) return ringHit.object.userData.person.userData.part
    const pool = soloPiano.visible ? soloPlayers : players
    const hit = ray.intersectObjects(pool, true)[0]
    let node = hit?.object
    while (node && !node.userData.part) node = node.parent
    return node?.userData.part || null
  }
  function setLevelHands(value) {
    levelHands = value
    lanePlane.visible = value
    beatRoot.visible = value
    if (!value) {
      swellSign.visible = false
      meter.visible = false
    }
  }
  // One bow, breath or key-press per note. `dur` is seconds, `vel` is 0..1.
  function note(part, info = {}) {
    const start = performance.now() / 1000
    const dur = Math.max(0.12, info.dur || 0.4)
    const vel = Math.min(1, Math.max(0, info.vel ?? 0.6))
    const mark = (person, i) => {
      if (person.userData.part === part) person.userData.stroke = { start: start + (i % 3) * 0.03, dur, vel, pitch: info.pitch || 0 }
    }
    players.forEach(mark)
    mark(soloPiano, 0)
  }
  function showSoloPiano(on) {
    soloPiano.visible = on
    players.forEach((person) => { person.visible = !on })
    halos.forEach((disc) => { disc.visible = !on })
  }
  // Which section a horizontal screen position is pointing at. Used by the camera hand.
  function sectionAt(clientX) {
    const mids = {}
    for (const spot of screenPositions()) {
      const bucket = mids[spot.part] || (mids[spot.part] = [])
      bucket.push(spot.x)
    }
    let best = null
    let dist = Infinity
    for (const [part, xs] of Object.entries(mids)) {
      const mid = xs.reduce((sum, x) => sum + x, 0) / xs.length
      const gap = Math.abs(mid - clientX)
      if (gap < dist) { dist = gap; best = part }
    }
    return best
  }
  return { resize, update, spawn, emit, note, sectionAt, pose, pick, reset, setLevelHands, syncBeats, screenPositions, showSoloPiano, players }
}
