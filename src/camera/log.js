// Records what the ring and the camera disagreed about, so it can be labelled later.
//
// This exists because of an honest gap, stated in phase1-baseline.md: the repo contains no
// labelled dataset for measuring direction accuracy, and the 24 recordings carry no video, so
// they cannot validate camera fusion at all. Playing the game with the camera on is the cheapest
// route to that dataset — but only if what it observes outlives the page.
//
// So this persists: across refreshes, closing the tab, and reopening the game. Only an explicit
// clear removes it.

export const LOG_KEY = "ringsymphony.cameralog.v1"

// Measured, for a 300ms window at 30fps (~9 frames per entry): storing all 21 landmarks costs
// ~4.8KB per entry and would exhaust a 5MB localStorage quota in about 1,100 disagreements — a
// few sessions. Storing the wrist and the middle-finger base costs ~0.5KB, so 500 entries is
// ~258KB. Displacement is what the verdict is made of and two points recover it; the other
// nineteen landmarks matter for 自由模式's open-palm detection, not for "did the hand go up".
export const LOG_CAP = 500

export function createCameraLog({ storage = globalThis.localStorage, cap = LOG_CAP } = {}) {
  // Memory is the source of truth and storage is a mirror, so a storage failure costs persistence
  // and nothing else. The same shape as readJson in ring/input.js, for the same reason.
  let entries = read()

  function read() {
    try {
      const raw = storage?.getItem(LOG_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      return Array.isArray(parsed?.entries) ? parsed.entries : []
    } catch {
      return []
    }
  }

  function write() {
    try {
      storage?.setItem(LOG_KEY, JSON.stringify({ version: 1, entries }))
    } catch {
      // Private mode, a denied origin, or a full quota. The log is still usable for this session,
      // and a beat must never fail because a diagnostic could not be saved.
    }
  }

  return {
    record(entry) {
      entries.push(entry)
      // Oldest first: a long session's later disagreements are the more interesting ones, since
      // by then the player has settled into their real conducting rather than finding the frame.
      if (entries.length > cap) entries = entries.slice(entries.length - cap)
      write()
    },
    entries: () => entries.map((entry) => ({ ...entry })),
    clear() {
      entries = []
      try {
        storage?.removeItem(LOG_KEY)
      } catch {
        // As above. The in-memory clear has already happened, which is what the player asked for.
      }
    },
    // The export carries its own version and date because the file outlives this build, and
    // whoever labels it needs to know which schema they are looking at.
    toJSON: () => JSON.stringify({ version: 1, exported: new Date().toISOString(), entries }, null, 2),
  }
}
