import {
  SUPPORTED_FEATURES as SUPPORTED_FEATURES_SET,
  SUPPORTED_SHAPES as SUPPORTED_SHAPES_SET,
  type AssemblyPartInput,
  type IntentFeature,
} from '@/lib/openscad-render/intentToScad';

export const SUPPORTED_SHAPES: readonly string[] = Object.freeze([...SUPPORTED_SHAPES_SET]);
export const SUPPORTED_FEATURES: readonly string[] = Object.freeze([...SUPPORTED_FEATURES_SET]);

export function numParams(value: unknown): Record<string, number> {
  const output: Record<string, number> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === 'number' && Number.isFinite(item)) output[key] = item;
    }
  }
  return output;
}

export function parseFeatures(value: unknown): IntentFeature[] {
  const allowed = new Set<string>(SUPPORTED_FEATURES);
  if (!Array.isArray(value)) return [];
  return value.filter((feature): feature is IntentFeature => {
    if (!feature || typeof feature !== 'object' || Array.isArray(feature)) return false;
    const type = (feature as Record<string, unknown>).type;
    return typeof type === 'string' && allowed.has(type);
  });
}

export function parseProfile(value: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((point): point is { x: number; y: number } =>
      !!point && typeof point === 'object'
      && typeof (point as Record<string, unknown>).x === 'number'
      && Number.isFinite((point as Record<string, unknown>).x as number)
      && typeof (point as Record<string, unknown>).y === 'number'
      && Number.isFinite((point as Record<string, unknown>).y as number))
    .map(point => ({ x: point.x, y: point.y }));
}

function vec3(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  if (!value.every(item => typeof item === 'number' && Number.isFinite(item))) return undefined;
  return [value[0] as number, value[1] as number, value[2] as number];
}

/** Parse and whitelist an assembly parts list from untrusted model output. */
export function parseAssemblyParts(value: unknown): AssemblyPartInput[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>([...SUPPORTED_SHAPES, 'sketch']);
  const output: AssemblyPartInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.shapeId !== 'string' || !allowed.has(record.shapeId)) continue;
    const part: AssemblyPartInput = {
      shapeId: record.shapeId,
      params: numParams(record.params),
      features: parseFeatures(record.features),
    };
    if (typeof record.name === 'string') part.name = record.name;
    if (record.shapeId === 'sketch') {
      const profile = parseProfile(record.profile);
      if (profile.length >= 3) part.profile = profile;
    }
    const position = vec3(record.position);
    if (position) part.position = position;
    const rotation = vec3(record.rotation);
    if (rotation) part.rotation = rotation;
    output.push(part);
  }
  return output;
}

export function normalizeFreeformScad(raw: string): string {
  let scad = raw.replace(/^```(?:openscad|scad|c)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const fenced = scad.match(/```(?:openscad|scad|c)?\s*([\s\S]*?)```/i);
  if (fenced) scad = fenced[1]!.trim();
  return scad.replace(/\r\n?/g, '\n');
}

export function looksLikeOpenScad(scad: string): boolean {
  return /include\s*<BOSL2|\b(module|function|cube|cylinder|cyl|cuboid|sphere|spheroid|polyhedron|polygon|linear_extrude|rotate_extrude|hull|minkowski|union|difference|intersection|translate|rotate|scale|mirror|prismoid|tube|torus|wedge|text)\b/i.test(scad);
}
