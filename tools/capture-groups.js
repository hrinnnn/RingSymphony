export function captureGroupKey({ playerId, exercise, performingHand, bpm, wearNote }) {
  return JSON.stringify([playerId?.trim(), exercise, performingHand, bpm ?? null, wearNote?.trim() ?? ""])
}

export function rememberGroup(groups, group) {
  const key = captureGroupKey(group)
  const previous = groups.get(key)
  const order = previous && Date.parse(group.startedAt) - Date.parse(previous.startedAt)
  if (!previous || order > 0 || (order === 0 && group.file > previous.file)) groups.set(key, group)
}
