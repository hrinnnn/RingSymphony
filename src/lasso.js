export function inside(point, polygon) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

// A section counts as circled when any of its players' heads falls inside the loop.
export function lassoParts(polygon, positions) {
  if (polygon.length < 3) return []
  const parts = []
  for (const { part, x, y } of positions) {
    if (!parts.includes(part) && inside({ x, y }, polygon)) parts.push(part)
  }
  return parts
}

export function pathLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return total
}
