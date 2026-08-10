/**
 * Fail-closed recognition of the sampled-circle transport format used by AI
 * and FeatureTree payloads. A match requires one radius, one winding direction
 * and exactly one turn; a round-looking bounding box is never sufficient.
 */
export function detectSampledCircle(
  loop: ReadonlyArray<{ x: number; y: number }>,
): { center: { x: number; y: number }; radius: number } | null {
  if (loop.length < 16) return null;
  let cx = 0;
  let cy = 0;
  for (const point of loop) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    cx += point.x;
    cy += point.y;
  }
  cx /= loop.length;
  cy /= loop.length;

  const radii: number[] = [];
  let radius = 0;
  for (const point of loop) {
    const value = Math.hypot(point.x - cx, point.y - cy);
    if (!Number.isFinite(value) || !(value > 0)) return null;
    radii.push(value);
    radius += value;
  }
  radius /= loop.length;
  const tolerance = Math.max(1e-7, radius * 1e-6);
  if (radii.some(value => Math.abs(value - radius) > tolerance)) return null;

  let direction = 0;
  let total = 0;
  for (let index = 0; index < loop.length; index++) {
    const next = (index + 1) % loop.length;
    const angle = Math.atan2(loop[index]!.y - cy, loop[index]!.x - cx);
    const nextAngle = Math.atan2(loop[next]!.y - cy, loop[next]!.x - cx);
    let delta = nextAngle - angle;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    if (Math.abs(delta) < 1e-9) return null;
    const sign = delta > 0 ? 1 : -1;
    if (direction === 0) direction = sign;
    else if (sign !== direction) return null;
    total += delta;
  }
  if (Math.abs(Math.abs(total) - 2 * Math.PI) > 1e-6) return null;
  return { center: { x: cx, y: cy }, radius };
}
