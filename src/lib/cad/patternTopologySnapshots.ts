import type { TopologyEntitySnapshot } from "./topologyRemap";
import type { LinearPatternFeature, CircularPatternFeature } from "./pattern";

type PatternFeature = LinearPatternFeature | CircularPatternFeature;

/** Occurrence-qualified topology for a pattern without fusing its instances. */
export function patternTopologySnapshots(
  patternId: string,
  pattern: PatternFeature,
  seed: readonly TopologyEntitySnapshot[],
): TopologyEntitySnapshot[] {
  if (!patternId.trim()) throw new Error("patternId is required");
  if (!Number.isInteger(pattern.count) || pattern.count < 1)
    throw new Error("pattern count must be positive");
  return Array.from({ length: pattern.count }, (_, occurrence) =>
    seed.map((entity) => {
      const centroid = transformPoint(entity.centroid, pattern, occurrence);
      const direction = entity.direction
        ? transformDirection(entity.direction, pattern, occurrence)
        : undefined;
      return {
        ...entity,
        persistentRef: `${patternId}/occurrence:${occurrence}/${entity.persistentRef}`,
        semanticRole: entity.semanticRole
          ? `occurrence:${occurrence}/${entity.semanticRole}`
          : undefined,
        centroid,
        direction,
      };
    }),
  ).flat();
}

function transformPoint(
  point: [number, number, number],
  pattern: PatternFeature,
  index: number,
): [number, number, number] {
  if (pattern.kind === "linear_pattern") {
    const length = Math.hypot(
      pattern.direction.x,
      pattern.direction.y,
      pattern.direction.z,
    );
    const distance = (pattern.spacing * index) / length;
    return [
      point[0] + pattern.direction.x * distance,
      point[1] + pattern.direction.y * distance,
      point[2] + pattern.direction.z * distance,
    ];
  }
  const step =
    pattern.totalAngleDegrees === 360
      ? 360 / pattern.count
      : pattern.totalAngleDegrees / (pattern.count - 1);
  const local: [number, number, number] = [
    point[0] - pattern.axisOrigin.x,
    point[1] - pattern.axisOrigin.y,
    point[2] - pattern.axisOrigin.z,
  ];
  const rotated = rotateAroundAxis(local, pattern.axisDirection, step * index);
  return [
    rotated[0] + pattern.axisOrigin.x,
    rotated[1] + pattern.axisOrigin.y,
    rotated[2] + pattern.axisOrigin.z,
  ];
}

function transformDirection(
  direction: [number, number, number],
  pattern: PatternFeature,
  index: number,
): [number, number, number] {
  return pattern.kind === "linear_pattern"
    ? [...direction]
    : rotateAroundAxis(
        direction,
        pattern.axisDirection,
        (pattern.totalAngleDegrees === 360
          ? 360 / pattern.count
          : pattern.totalAngleDegrees / (pattern.count - 1)) * index,
      );
}

function rotateAroundAxis(
  point: [number, number, number],
  axis: { x: number; y: number; z: number },
  degrees: number,
): [number, number, number] {
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (length < 1e-9) throw new Error("pattern axis is zero-length");
  const [x, y, z] = [axis.x / length, axis.y / length, axis.z / length];
  const angle = (degrees * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const [px, py, pz] = point,
    dot = x * px + y * py + z * pz;
  return [
    px * c + (y * pz - z * py) * s + x * dot * (1 - c),
    py * c + (z * px - x * pz) * s + y * dot * (1 - c),
    pz * c + (x * py - y * px) * s + z * dot * (1 - c),
  ];
}
