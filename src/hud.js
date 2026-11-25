import { PART_INFO, PARTS } from "./mixer.js"

function el(tag, className, text) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// One card per section; built once and then only re-labelled each frame so clicks are never lost.
export function createMixerHud(container, onPick) {
  const cards = {}
  for (const part of PARTS) {
    const info = PART_INFO[part]
    const card = el("button", `part ${part}`)
    card.type = "button"
    const badge = el("i", "badge", info.badge)
    const text = el("span", "label")
    const name = el("b", "name", info.name)
    const state = el("small", "state", "休息中")
    const meter = el("span", "meter")
    const fill = el("span", "fill")
    const key = el("kbd", "key", info.key)
    meter.append(fill)
    text.append(name, state)
    card.append(badge, text, meter, key)
    card.addEventListener("click", () => onPick(part))
    container.append(card)
    cards[part] = { card, state, fill, name, key, last: "", lastName: info.name }
  }

  return {
    // view[part] = { label, on, selected, pending, solo, ducked, level, volume }
    update(view) {
      for (const part of PARTS) {
        const v = view[part]
        const c = cards[part]
        c.card.hidden = !v
        if (!v) continue
        c.card.disabled = Boolean(v.readOnly)
        c.key.hidden = Boolean(v.readOnly)
        c.card.classList.toggle("on", Boolean(v.on))
        c.card.classList.toggle("selected", Boolean(v.selected))
        c.card.classList.toggle("pending", Boolean(v.pending))
        c.card.classList.toggle("solo", Boolean(v.solo))
        c.card.classList.toggle("ducked", Boolean(v.ducked))
        const name = v.name || PART_INFO[part].name
        if (c.lastName !== name) {
          c.name.textContent = name
          c.lastName = name
        }
        if (c.last !== v.label) {
          c.state.textContent = v.label
          c.last = v.label
        }
        c.fill.style.transform = `scaleX(${Math.max(0.04, Math.min(1, v.level ?? 0)).toFixed(3)})`
      }
    },
  }
}
