import * as THREE from "three"

// All scenery, people, instruments and UI geometry are original procedural assets.
const GOLD = 0xffd68a
const COOL = 0x87d9ff
const material = (color, roughness = 0.65, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
const black = material(0x161a23)
const shoe = material(0x090c12, 0.3)
const white = material(0xf5eee0)
const brass = material(0xbb9353, 0.35, 0.7)
const silver = material(0xc5d8df, 0.24, 0.8)
const oak = material(0x743d1d, 0.4)
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })

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
function chair(parent) {
  const seatMat = material(0x44212a, 0.9)
  box(parent, [0.43, 0.09, 0.43], seatMat, 0, 0.46)
  const back = box(parent, [0.43, 0.35, 0.07], seatMat, 0, 0.77, -0.2); back.rotation.x = -0.1
  for (const x of [-0.17, 0.17]) for (const z of [-0.17, 0.17]) rod(parent, [x, 0.45, z], [x * 1.2, 0.02, z * 1.2], 0.018, black)
  for (const x of [-0.17, 0.17]) rod(parent, [x, 0.45, -0.19], [x, 0.94, -0.19], 0.015, black)
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
  return group
}
function arm(parent, skin, shoulder, elbow, wrist) {
  const group = new THREE.Group(); parent.add(group)
  rod(group, shoulder, elbow, 0.061, black, 0.074)
  rod(group, elbow, wrist, 0.047, black, 0.058)
  oval(group, [0.049, 0.045, 0.055], skin, ...wrist)
  return group
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
  const skin = material([0xd2a07d, 0x9c674e, 0xf0c3a0, 0xbe8761][index % 4], 0.8)
  const hair = material([0x241911, 0x6e4830, 0xaaa299, 0x1c1618][index % 4])
  chair(group)
  const body = new THREE.Group(); group.add(body)
  // Tailored jacket, shirt front, lapels and bow tie over a seated pelvis.
  const torso = mesh(body, new THREE.CylinderGeometry(0.19, 0.155, 0.43, 12), black, 0, 0.88)
  torso.scale.z = 0.62
  box(body, [0.105, 0.28, 0.025], white, 0, 0.96, 0.122)
  for (const s of [-1, 1]) {
    const lapel = box(body, [0.055, 0.28, 0.028], material(0x2c3039), s * 0.074, 0.96, 0.134); lapel.rotation.z = s * -0.21
    oval(body, [0.033, 0.018, 0.016], shoe, s * 0.023, 1.07, 0.15)
    rod(group, [s * 0.11, 0.58, 0], [s * 0.17, 0.48, 0.30], 0.082, black)
    rod(group, [s * 0.17, 0.48, 0.30], [s * 0.19, 0.10, 0.32], 0.065, black)
    oval(group, [0.085, 0.053, 0.145], shoe, s * 0.19, 0.065, 0.39)
  }
  rod(body, [0, 1.06, 0], [0, 1.19, 0], 0.055, skin)
  const head = new THREE.Group(); head.position.y = 1.29; body.add(head)
  oval(head, [0.112, 0.145, 0.106], skin)
  oval(head, [0.119, 0.079, 0.112], hair, 0, 0.09, -0.014)
  oval(head, [0.108, 0.105, 0.044], hair, 0, 0.02, -0.08)
  if (index % 3 === 1) oval(head, [0.08, 0.09, 0.08], hair, 0, 0.075, -0.12)
  for (const s of [-1, 1]) {
    oval(head, [0.025, 0.036, 0.025], skin, s * 0.111, 0, 0)
    oval(head, [0.023, 0.012, 0.01], white, s * 0.04, 0.023, 0.095)
    oval(head, [0.009, 0.01, 0.006], shoe, s * 0.04, 0.023, 0.104)
    rod(head, [s * 0.018, 0.05, 0.10], [s * 0.06, 0.054, 0.096], 0.006, hair)
  }
  oval(head, [0.021, 0.032, 0.029], skin, 0, -0.005, 0.106)
  box(head, [0.038, 0.005, 0.005], material(0x815147), 0, -0.063, 0.095)
  let moving, keys
  if (part === 'violin' || part === 'cello') {
    const cello = part === 'cello'
    const inst = stringInstrument(body, cello)
    inst.position.set(cello ? 0 : -0.09, cello ? 0.58 : 1.13, cello ? 0.34 : 0.24)
    inst.rotation.z = cello ? -0.08 : -1.05
    arm(body, skin, [-0.18, 1.03, 0], [-0.31, 0.93, 0.22], cello ? [-0.05, 1.05, 0.4] : [-0.26, 1.17, 0.29])
    moving = new THREE.Group(); body.add(moving)
    arm(moving, skin, [0.18, 1.03, 0], [0.34, 0.83, 0.25], [0.14, cello ? 0.77 : 1.04, 0.43])
    const y = cello ? 0.75 : 1.06
    rod(moving, [-0.3, y + 0.06, 0.44], [0.45, y - 0.04, 0.44], 0.006, oak)
    rod(moving, [-0.3, y + 0.04, 0.45], [0.45, y - 0.06, 0.45], 0.0025, white)
  } else if (part === 'flute') {
    arm(body, skin, [-0.18, 1.03, 0], [-0.21, 0.98, 0.24], [0.12, 1.22, 0.28])
    moving = arm(body, skin, [0.18, 1.03, 0], [0.42, 1.03, 0.1], [0.4, 1.22, 0.27])
    rod(body, [-0.03, 1.23, 0.18], [0.59, 1.21, 0.26], 0.014, silver)
    for (let i = 0; i < 8; i++) oval(body, [0.018, 0.009, 0.02], silver, 0.1 + i * 0.056, 1.236, 0.22)
  } else {
    const piano = new THREE.Group(); piano.position.set(0, 0, 0.22); body.add(piano)
    keys = grandPiano(piano)
    moving = new THREE.Group(); body.add(moving)
    for (const s of [-1, 1]) arm(moving, skin, [s * 0.18, 1.03, 0], [s * 0.28, 0.83, 0.24], [s * 0.25, 0.88, 0.65])
  }
  if (part !== 'piano') stand(group, 0.12, 0.72, 0.9)
  group.userData = { part, body, head, moving, keys, index }
  return group
}
function hand(right) {
  const group = new THREE.Group()
  const skin = material(0xdfae89, 0.66)
  rod(group, [0, -0.28, 0.2], [0, -0.04, 0.025], 0.065, black, 0.052)
  rod(group, [0, -0.07, 0.052], [0, -0.005, 0.005], 0.054, white)
  oval(group, [0.069, 0.035, 0.09], skin, 0, 0, -0.04)
  const fingers = []
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Group(); finger.position.set(-0.047 + i * 0.03, 0, -0.103); group.add(finger)
    const length = [0.079, 0.095, 0.087, 0.065][i]
    rod(finger, [0, 0, 0], [0, 0.004, -length], 0.013, skin, 0.011)
    oval(finger, [0.011, 0.012, 0.017], skin, 0, 0.004, -length)
    finger.rotation.x = right ? -1.35 : -0.12
    fingers.push(finger)
  }
  rod(group, [right ? -0.057 : 0.057, 0, -0.03], [right ? -0.09 : 0.09, 0.025, -0.094], 0.021, skin, 0.016)
  if (right) {
    rod(group, [0.015, 0.025, -0.07], [-0.14, 0.44, -0.39], 0.006, white, 0.002)
    rod(group, [0.03, -0.018, -0.035], [-0.005, 0.07, -0.103], 0.016, oak, 0.012)
    oval(group, [0.009, 0.009, 0.009], glow(GOLD), -0.14, 0.44, -0.39)
  }
  group.userData.fingers = fingers
  group.renderOrder = 6
  return group
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
    players.forEach(person => {
      const { part, body, head, moving, keys, index } = person.userData
      const active = playing.has(part)
      const phase = seconds * (part === 'cello' ? 5 : 10) + index * 0.8
      body.rotation.z = active ? Math.sin(phase * 0.5) * 0.025 : 0
      head.rotation.x = active ? Math.sin(phase * 0.4) * 0.055 : 0
      if (moving) {
        moving.position.x = active && (part === 'violin' || part === 'cello') ? Math.sin(phase) * 0.075 : 0
        moving.rotation.z = active ? Math.sin(phase) * (part === 'piano' ? 0.025 : 0.035) : 0
        moving.position.y = active && part === 'piano' ? Math.sin(phase * 1.5) * 0.012 : 0
      }
      if (part === 'flute') body.scale.y = active ? 1 + Math.sin(phase * 0.5) * 0.018 : 1
      if (keys) keys.children.forEach((key, i) => { key.position.y = key.userData.restY - (active && Math.sin(seconds * 13 + i) > 0.8 ? 0.009 : 0) })
    })
    ;[left, right].forEach((hand, index) => {
      const state = handStates[index], active = t < state.until
      const rest = rests[index].clone(); rest.y *= Math.max(1, 1.4 / camera.aspect)
      if (active) {
        const shift = { down: [0, -0.11, 0], up: [0, 0.18, -0.04], left: [-0.18, 0.02, 0], right: [0.18, 0.02, 0], point: [0.02, 0.13, -0.18] }[state.pose]
        if (shift) rest.add(new THREE.Vector3(...shift))
        if (state.pose === 'point' && state.aimX !== undefined) rest.x = state.aimX
      }
      hand.position.lerp(rest, 0.25)
      const turn = !index && active ? state.pose === 'up' ? Math.PI * 0.8 : state.pose === 'down' ? 0.18 : -0.15 : 0
      hand.rotation.z = THREE.MathUtils.lerp(hand.rotation.z, index && active ? ({ left: 0.35, right: -0.35, down: 0.15, up: -0.15 }[state.pose] || 0) : 0, 0.22)
      hand.rotation.x = THREE.MathUtils.lerp(hand.rotation.x, turn, 0.2)
      if (!index) hand.userData.fingers.forEach((finger, i) => { finger.rotation.x = THREE.MathUtils.lerp(finger.rotation.x, active && state.pose === 'point' && i > 0 ? -1.6 : -0.12, 0.3) })
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
    state.pose = gesture; state.until = performance.now() / 1000 + (which === 'right' ? 0.32 : 0.9)
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
