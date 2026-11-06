export const PARTS = ["violin", "cello", "flute", "piano"]

export const PART_INFO = {
  violin: { name: "小提琴", badge: "提", key: "1" },
  cello: { name: "大提琴", badge: "大", key: "2" },
  flute: { name: "长笛", badge: "笛", key: "3" },
  piano: { name: "钢琴", badge: "琴", key: "4" },
}

// Accompaniment is lowered by this fraction while another section solos (λ in the design doc).
export const DUCK = 0.7
const LOCAL_MAX = 1.6
const LOCAL_STEP = 0.25

export function createMixer() {
  const parts = Object.fromEntries(PARTS.map((part) => [part, { on: false, pending: null, local: 1 }]))
  const selected = new Set()
  let solo = null

  function gainOf(part, assumeOn = parts[part].on) {
    if (!assumeOn) return 0
    const ducked = solo && !solo.has(part)
    return parts[part].local * (ducked ? 1 - DUCK : 1)
  }

  return {
    parts,
    selected,
    get solo() { return solo },
    gainOf,
    toggle(part) {
      if (selected.has(part)) selected.delete(part)
      else selected.add(part)
    },
    selectOnly(list) {
      selected.clear()
      list.forEach((part) => selected.add(part))
    },
    clearSelection() { selected.clear() },
    playing() { return new Set(PARTS.filter((part) => parts[part].on)) },
    anyOn() { return PARTS.some((part) => parts[part].on || parts[part].pending === "in") },
    // Marks a pending entry/exit; returns the parts whose state will actually change.
    request(list, open) {
      return list.filter((part) => {
        const p = parts[part]
        const target = open ? "in" : "out"
        if (p.pending === target) return false
        if (!p.pending && p.on === open) return false
        p.pending = target
        return true
      })
    },
    commit(part) {
      const p = parts[part]
      if (!p.pending) return
      p.on = p.pending === "in"
      p.pending = null
      if (!p.on && solo) {
        solo.delete(part)
        if (!solo.size) solo = null
      }
    },
    nudge(list, direction) {
      list.forEach((part) => {
        const p = parts[part]
        p.local = Math.min(LOCAL_MAX, Math.max(0, p.local + (direction === "up" ? LOCAL_STEP : -LOCAL_STEP)))
      })
    },
    toggleSolo(list) {
      const same = solo && list.length === solo.size && list.every((part) => solo.has(part))
      solo = !list.length || same ? null : new Set(list)
      return solo
    },
    reset() {
      PARTS.forEach((part) => Object.assign(parts[part], { on: false, pending: null, local: 1 }))
      selected.clear()
      solo = null
    },
  }
}
