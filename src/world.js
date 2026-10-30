import * as THREE from "three"

// All scenery, people, instruments and UI geometry are original procedural assets.
const GOLD = 0xffd68a
const COOL = 0x87d9ff
const material = (color, roughness = 0.65, metalness = 0, emissive = 0x000000) => new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive })
const black = material(0x161a23)
const shoe = material(0x090c12, 0.3)
const white = material(0xf5eee0)
const brass = material(0xbb9353, 0.35, 0.7)
const silver = material(0xc5d8df, 0.24, 0.8)
const oak = material(0x743d1d, 0.4)
const bowWood = material(0xe0a85a, 0.38, 0.05, 0x3a240c)
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })
// Ink-and-gilt orchestra: one metal accent per section, graphic hair, tailored black.
const ink = material(0x1a1e28, 0.55, 0.06)
const inkDeep = material(0x10131a, 0.7)
const ivory = material(0xf4efe4, 0.68)
const gilt = material(0xe6c98a, 0.28, 0.8, 0x4a3210)
const lip = material(0x8a4b48, 0.55)
const eyeInk = material(0x140e0c, 0.35)
const skins = [0xd7a784, 0xa36d4d, 0xf0c7a6, 0xc48b62].map((color) => material(color, 0.8))
const hairColors = [0x1b140f, 0x6a432c, 0xb7aea4, 0x241816, 0x3a2418].map((color) => material(color, 0.5, 0.08))
const sectionMat = {
  violin: gilt,
  cello: material(0x7a2436, 0.5, 0.25, 0x2a0c12),
  flute: material(0xc5dde4, 0.25, 0.75, 0x1c3038),
  piano: gilt,
}

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
  g.fillStyle = '#f1e6cc'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#302a23'; g.font = '24px Georgia'; g.textAlign = 'center'; g.fillText('ÉTUDE  ·  I', w / 2, 45)
  for (let staff = 0; staff < 5; staff++) {
    const y = 85 + staff * 80
    g.strokeStyle = '#686052'; g.lineWidth = 1.5
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
    const eye = box(head, [0.042, 0.014, 0.008], eyeInk, s * 0.036, 0.02, 0.092)
    eye.rotation.z = s * -0.08
    oval(head, [0.008, 0.008, 0.005], glow(0xfff8ee), s * 0.046, 0.024, 0.098)
    const brow = box(head, [0.046, 0.008, 0.006], hair, s * 0.036, 0.052, 0.088)
    brow.rotation.z = s * -0.16
  }
  oval(head, [0.012, 0.024, 0.016], skin, 0, -0.004, 0.096)
  box(head, [0.03, 0.005, 0.005], lip, 0, -0.052, 0.084)
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
function buildLegs(group) {
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
  if (part === "piano") bench(group)
  else chair(group, accent)
  if (part !== "flute") buildLegs(group)
  const body = new THREE.Group(); group.add(body)
  buildTorso(body, part, accent, skin, index)
  const head = new THREE.Group(); head.position.y = 1.31; body.add(head)
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
  } else if (part === "flute") {
    rig.left = createLimb(body, ink, skin, 0.04)
    rig.right = createLimb(body, ink, skin, 0.04)
    applyLimb(rig.left, HOLDS.flute.left.s, HOLDS.flute.left.e, HOLDS.flute.left.w)
    applyLimb(rig.right, HOLDS.flute.right.s, HOLDS.flute.right.e, HOLDS.flute.right.w)
    addFlute(body, rig)
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
  const skin = material(0xb8744e, 0.78)
  rod(group, [0, -0.32, 0.16], [0, -0.07, 0.02], 0.052, ink, 0.04)
  rod(group, [0, -0.075, 0.028], [0, -0.04, 0.012], 0.046, ivory, 0.042)
  oval(group, [0.011, 0.011, 0.007], gilt, right ? 0.03 : -0.03, -0.045, 0.03)
  box(group, [0.1, 0.034, 0.1], skin, 0, 0.02, -0.02)
  oval(group, [0.048, 0.03, 0.04], skin, 0, 0.016, 0.035)
  const fingers = []
  const xs = right ? [-0.042, -0.014, 0.014, 0.042] : [0.042, 0.014, -0.014, -0.042]
  const lengths = [0.11, 0.124, 0.112, 0.086]
  const curl = right ? -1.15 : 0.42
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
    rod(batonLag, [-0.01, 0.08, -0.1], [-0.13, 0.46, -0.4], 0.005, ivory, 0.002)
    tip = oval(batonLag, [0.012, 0.012, 0.012], glow(GOLD), -0.13, 0.46, -0.4)
  }
  group.userData = { fingers, thumb, batonLag, tip }
  group.renderOrder = 6
  return group
}
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const smooth = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x) }
function ictus(u) {
  return Math.sin(Math.pow(clamp01(u), 0.36) * Math.PI)
}
function animatePlayers(players, seconds, playing) {
  const hz = 96 / 60
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
    const along = Math.sin(phase) * (active ? 1 : 0)
    body.position.y = breath * (active ? 0.01 : 0.004)
    body.rotation.set(
      (active ? 0.035 : 0.012) + breath * 0.008 + entrance * 0.07,
      active ? along * 0.045 : 0,
      active ? -along * 0.05 : breath * 0.006,
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
      const lift = breath * (active ? 0.016 : 0.004)
      const left = HOLDS.flute.left
      const right = HOLDS.flute.right
      applyLimb(rig.left, left.s, left.e, [left.w[0], left.w[1] + lift, left.w[2]])
      applyLimb(rig.right, right.s, right.e, [right.w[0], right.w[1] + lift * 0.6, right.w[2]])
      rig.right.hand.rotation.x = active ? Math.sin(phase) * 0.08 : 0
      rig.pads.forEach((pad, i) => {
        const down = active && Math.sin(seconds * hz * Math.PI * 2 + i * 0.7) > 0.1
        pad.position.y = pad.userData.restY + (down ? -0.007 : 0.003)
      })
    } else {
      const bob = active ? Math.sin(seconds * hz * Math.PI * 2) : 0
      const leftLift = Math.max(0, bob) * 0.04
      const rightLift = Math.max(0, -bob) * 0.04
      const left = HOLDS.piano.left
      const right = HOLDS.piano.right
      applyLimb(rig.left, left.s, [left.e[0], left.e[1] + leftLift, left.e[2]], [left.w[0], left.w[1] + leftLift, left.w[2]])
      applyLimb(rig.right, right.s, [right.e[0], right.e[1] + rightLift, right.e[2]], [right.w[0], right.w[1] + rightLift, right.w[2]])
      rig.left.hand.rotation.x = -0.35 - leftLift * 6
      rig.right.hand.rotation.x = -0.35 - rightLift * 6
      if (keys) {
        const eighth = Math.floor(seconds * hz * 2)
        keys.children.forEach((key, i) => {
          const play = active && (i % 8 === eighth % 8 || (i + 3) % 8 === eighth % 8)
          key.position.y = key.userData.restY - (play ? 0.012 : 0)
        })
      }
    }
  }
}
function arrowShape() {
  const s = new THREE.Shape()
  s.moveTo(-0.045, -0.14); s.lineTo(0.045, -0.14); s.lineTo(0.045, 0.025)
  s.lineTo(0.13, 0.025); s.lineTo(0, 0.16); s.lineTo(-0.13, 0.025); s.lineTo(-0.045, 0.025); s.closePath()
  return new THREE.ShapeGeometry(s)
}

export function createWorld(canvas) {
  paper = scoreMap()
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.35
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x080b12)
  scene.fog = new THREE.FogExp2(0x0c0e16, 0.036)
  const camera = new THREE.PerspectiveCamera(53, 1, 0.05, 60)
  camera.position.set(0, 2.2, 4.7)
  camera.lookAt(0, 1.25, -3)
  scene.add(camera)
  scene.add(new THREE.HemisphereLight(0xd9e6ff, 0x6d4224, 1.65))
  const key = new THREE.DirectionalLight(0xffdfad, 3.3); key.position.set(-3, 7, 4)
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 25 })
  key.shadow.bias = -0.001; scene.add(key)
  const rim = new THREE.DirectionalLight(0x8baaff, 1.8); rim.position.set(4, 4, -7); scene.add(rim)
  for (const x of [-4, 0, 4]) {
    const spot = new THREE.SpotLight(0xffd3a0, 45, 18, 0.51, 0.8, 1.5)
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
  const floor = mesh(scene, new THREE.PlaneGeometry(19, 23, 19, 23), new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.48 }), 0, -0.01, -3)
  floor.rotation.x = -Math.PI / 2
  box(scene, [19, 0.35, 20], material(0x38251c), 0, -0.2, -4)
  // Layered concert hall: timber shell, organ pipes, fluted curtains, side balconies.
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
  const players = []
  const layout = [
    ['flute', -2.9, -5.6], ['flute', -1.8, -5.9], ['flute', -0.7, -6],
    ['piano', 3.2, -5.5],
    ['cello', -1.5, -3.65], ['cello', 0, -3.9], ['cello', 1.5, -3.65],
    ['violin', -3.1, -1.9], ['violin', -1.9, -1.25], ['violin', -0.7, -1.05],
    ['violin', 0.7, -1.05], ['violin', 1.9, -1.25], ['violin', 3.1, -1.9],
  ]
  layout.forEach(([part, x, z], i) => {
    const person = musician(part, x, z, i)
    person.rotation.y = part === "piano" ? -0.95 : Math.atan2(-x, 4.7 - z) * 0.65
    scene.add(person); players.push(person)
  })
  const left = hand(false), right = hand(true)
  const rests = [new THREE.Vector3(-0.38, -0.36, -0.95), new THREE.Vector3(0.4, -0.35, -0.98)]
  left.position.copy(rests[0]); right.position.copy(rests[1]); camera.add(left, right)
  const handStates = [{ until: 0, pose: 'rest' }, { until: 0, pose: 'rest' }]

  // Camera-space approach keeps EVERY direction crossing the same horizontal hit line.
  const lane = new THREE.Group(); camera.add(lane)
  const lineY = 0.035, lineZ = -1.65
  box(lane, [1.53, 0.006, 0.003], glow(GOLD, 0.9), 0.08, lineY, lineZ)
  box(lane, [1.53, 0.025, 0.002], glow(GOLD, 0.07), 0.08, lineY, lineZ + 0.001)
  for (const x of [-0.68, 0.84]) {
    const diamond = box(lane, [0.018, 0.018, 0.004], glow(GOLD), x, lineY, lineZ); diamond.rotation.z = Math.PI / 4
  }
  const live = [], cueRings = []
  const arrowGeo = arrowShape()
  function resize() {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    renderer.setSize(rect.width, rect.height, false)
    camera.aspect = rect.width / rect.height
    // Keep the full orchestra in portrait layouts too.
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(53 / 2)) * Math.max(1, 1.4 / camera.aspect)))
    camera.updateProjectionMatrix()
    lane.scale.x = 1
  }
  function spawn(cue) {
    if (cue.kind === 'cue') {
      const people = players.filter(p => p.userData.part === cue.part)
      const rings = people.map(person => {
        const ring = mesh(scene, new THREE.RingGeometry(0.21, 0.235, 64), glow(cue.part === 'flute' ? COOL : GOLD))
        const center = new THREE.Vector3(); person.getWorldPosition(center)
        ring.position.copy(center).add(new THREE.Vector3(0, 1.34, 0.12))
        ring.lookAt(camera.position)
        ring.userData = { person }
        return ring
      })
      cueRings.push({ cue, rings }); return
    }
    const group = new THREE.Group(); lane.add(group)
    if (cue.kind === 'beat') {
      const color = cue.direction === 'down' ? GOLD : 0xf8eee0
      const arrow = mesh(group, arrowGeo, glow(color))
      arrow.rotation.z = { up: 0, down: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[cue.direction]
      arrow.scale.setScalar(0.55)
      const halo = mesh(group, new THREE.RingGeometry(0.078, 0.081, 48), glow(color, 0.24))
      halo.position.z = -0.003
      group.userData.arrow = arrow
    } else {
      const warm = cue.direction === 'up'
      // A curved ramp of light, warm rising / cool falling, independent of the beat lane.
      const points = Array.from({ length: 28 }, (_, i) => {
        const t = i / 27
        return new THREE.Vector3(-0.08 + t * 0.16, (warm ? 1 : -1) * (t * t * 0.43 - 0.2), 0)
      })
      for (let i = 0; i < 5; i++) {
        const streak = mesh(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 28, i === 0 ? 0.009 : 0.004, 6, false), glow(warm ? GOLD : COOL, i === 0 ? 0.95 : 0.2))
        streak.position.x = (i - 2) * 0.014
      }
      const arrow = mesh(group, arrowGeo, glow(warm ? GOLD : COOL)); arrow.scale.setScalar(0.38)
      arrow.position.set(0.08, warm ? 0.23 : -0.23, 0); arrow.rotation.z = warm ? 0 : Math.PI
    }
    group.userData.cue = cue; live.push(group)
  }
  function remove(group) {
    group.removeFromParent()
    group.traverse(obj => {
      if (obj.geometry && obj.geometry !== arrowGeo) obj.geometry.dispose()
      if (obj.material) obj.material.dispose()
    })
  }
  function reset() {
    live.forEach(remove); live.length = 0
    cueRings.forEach(entry => entry.rings.forEach(remove)); cueRings.length = 0
    handStates.forEach(state => { state.until = 0; state.pose = 'rest' })
  }
  function update(seconds, playing) {
    const t = performance.now() / 1000
    animatePlayers(players, seconds, playing)
    ;[left, right].forEach((item, index) => {
      const state = handStates[index], active = t < state.until
      const rest = rests[index].clone(); rest.y *= Math.max(1, 1.4 / camera.aspect)
      const age = t - (state.from || 0)
      const u = age / (index ? 0.46 : 0.9)
      let rx = 0, ry = 0, rz = 0
      if (!active) rest.y += Math.sin(t * 1.6 + index) * 0.01
      if (active && index) {
        const a = ictus(u)
        const flick = Math.sin(Math.pow(clamp01(u), 0.22) * Math.PI)
        if (state.pose === "down") { rest.y -= 0.15 * a; rest.z += 0.05 * a; rx = 0.7 * flick; rz = 0.1 * a }
        else if (state.pose === "up") { rest.y += 0.16 * a; rest.z -= 0.04 * a; rx = -0.5 * flick; rz = -0.12 * a }
        else if (state.pose === "left") { rest.x -= 0.22 * a; rest.y += 0.045 * Math.sin(clamp01(u) * Math.PI); rz = 0.62 * flick; ry = 0.15 * a }
        else if (state.pose === "right") { rest.x += 0.22 * a; rest.y += 0.045 * Math.sin(clamp01(u) * Math.PI); rz = -0.62 * flick; ry = -0.15 * a }
      } else if (active) {
        const a = smooth(Math.min(1, age / 0.16))
        if (state.pose === "up") { rest.y += 0.2 * a; rest.z -= 0.05 * a; rx = -1.05 * a }
        else if (state.pose === "down") { rest.y -= 0.12 * a; rx = 0.7 * a }
        else if (state.pose === "point") {
          rest.y += 0.14 * a; rest.z -= 0.18 * a; rx = -0.3 * a
          if (state.aimX !== undefined) rest.x = state.aimX
        }
      }
      item.position.lerp(rest, index ? 0.5 : 0.28)
      item.rotation.x = THREE.MathUtils.lerp(item.rotation.x, rx, 0.32)
      item.rotation.y = THREE.MathUtils.lerp(item.rotation.y, ry, 0.32)
      item.rotation.z = THREE.MathUtils.lerp(item.rotation.z, rz, 0.32)
      const poseName = active ? state.pose : "rest"
      if (!index) {
        const table = {
          rest: { curl: 0.42, spread: 0.14, thumb: 0.15 },
          up: { curl: 0.2, spread: 0.32, thumb: 0.45 },
          down: { curl: 0.7, spread: 0.04, thumb: -0.35 },
          point: { curl: -1.35, spread: 0.03, thumb: -0.95, indexCurl: 0.25 },
        }
        const spec = table[poseName] || table.rest
        item.userData.fingers.forEach((finger, i) => {
          const curl = poseName === "point" && i === 0 ? spec.indexCurl : spec.curl
          finger.rotation.x = THREE.MathUtils.lerp(finger.rotation.x, curl, 0.3)
          finger.rotation.y = THREE.MathUtils.lerp(finger.rotation.y, (i - 1.5) * spec.spread, 0.3)
          finger.userData.mid.rotation.x = Math.min(0, curl) * 0.85
        })
        item.userData.thumb.rotation.x = THREE.MathUtils.lerp(item.userData.thumb.rotation.x, spec.thumb, 0.3)
      } else {
        const squeeze = active ? ictus(u) * 0.22 : 0
        item.userData.fingers.forEach((finger) => {
          const curl = -1.22 - squeeze
          finger.rotation.x = THREE.MathUtils.lerp(finger.rotation.x, curl, 0.35)
          finger.userData.mid.rotation.x = Math.min(0, curl) * 0.9
        })
        if (item.userData.batonLag) {
          item.userData.batonLag.rotation.z = THREE.MathUtils.lerp(item.userData.batonLag.rotation.z, -rz * 0.45, 0.14)
          item.userData.batonLag.rotation.x = THREE.MathUtils.lerp(item.userData.batonLag.rotation.x, -rx * 0.2, 0.14)
        }
      }
    })
    for (let i = live.length - 1; i >= 0; i--) {
      const group = live[i], cue = group.userData.cue, remain = cue.time - seconds
      if (remain < -0.25 || cue.result) { remove(group); live.splice(i, 1); continue }
      const progress = 1 - remain / 2
      // z approaches the player, y approaches the line; all four arrows share one target.
      const z = THREE.MathUtils.lerp(-4.1, lineZ, progress)
      const x = cue.kind === 'beat' ? 0.3 : -0.6
      group.position.set(x, cue.kind === 'beat' ? THREE.MathUtils.lerp(1.15 * Math.max(1, 1.4 / camera.aspect), lineY, progress) : 0.15, z)
      const size = cue.kind === 'beat' ? 1 : 0.7
      group.scale.setScalar(size)
      group.visible = remain <= 2
    }
    for (let i = cueRings.length - 1; i >= 0; i--) {
      const { cue, rings } = cueRings[i], remain = cue.time - seconds
      if (remain < -0.25 || cue.result) { rings.forEach(remove); cueRings.splice(i, 1); continue }
      rings.forEach(ring => {
        ring.scale.setScalar(1 + Math.sin(t * 7) * 0.08)
        ring.material.opacity = 0.65 + Math.sin(t * 7) * 0.3
      })
    }
    renderer.render(scene, camera)
  }
  function pose(which, gesture, part) {
    const state = handStates[which === 'right' ? 1 : 0]
    const now = performance.now() / 1000
    state.pose = gesture; state.from = now; state.until = now + (which === 'right' ? 0.46 : 0.9)
    if (part) {
      const person = players.find(p => p.userData.part === part)
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
    const hit = ray.intersectObjects(players, true)[0]
    let node = hit?.object
    while (node && !node.userData.part) node = node.parent
    return node?.userData.part || null
  }
  return { resize, update, spawn, pose, pick, reset, players }
}
