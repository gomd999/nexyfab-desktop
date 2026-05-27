/**
 * featureParamSchema.ts — lightweight, dependency-free parameter ranges for the
 * common features, so AI-generated feature specs can be clamped to valid,
 * in-range values WITHOUT importing the heavy feature graph (THREE / OCCT) into
 * a server route.
 *
 * The generic shape-chat sanitizer only caps hostile magnitudes (≤10 m); it
 * doesn't know that a fillet radius maxes at 20 mm or that `segments` is an
 * integer 1–5. An LLM that emits `radius: 50` on a 10 mm part would otherwise
 * produce a feature that fails at pipeline time. Clamping to the real schema
 * keeps the AI's output buildable.
 *
 * These ranges MUST mirror the FeatureDefinition.params in the feature modules;
 * featureParamSchema.sync.test.ts imports the real registry and fails if they
 * drift, so the pure runtime copy stays correct without the heavy import.
 */

export interface ParamRange {
  min: number;
  max: number;
  default: number;
  integer?: boolean;
}

export const FEATURE_PARAM_RANGES: Record<string, Record<string, ParamRange>> = {
  fillet: {
    radius: { min: 0.5, max: 20, default: 3 },
    segments: { min: 1, max: 5, default: 3, integer: true },
    engine: { min: 0, max: 1, default: 1, integer: true },
  },
  chamfer: {
    distance: { min: 0.5, max: 20, default: 2 },
    engine: { min: 0, max: 1, default: 1, integer: true },
  },
  shell: {
    wallThickness: { min: 0.5, max: 50, default: 3 },
    openFace: { min: 0, max: 2, default: 1, integer: true },
    engine: { min: 0, max: 1, default: 1, integer: true },
  },
  hole: {
    holeType: { min: 0, max: 2, default: 0, integer: true },
    diameter: { min: 1, max: 100, default: 10 },
    posX: { min: -200, max: 200, default: 0 },
    posZ: { min: -200, max: 200, default: 0 },
    depth: { min: 1, max: 500, default: 999 },
    counterboreDia: { min: 1, max: 150, default: 18 },
    counterboreDepth: { min: 1, max: 50, default: 5 },
    countersinkAngle: { min: 60, max: 120, default: 90 },
    engine: { min: 0, max: 1, default: 1, integer: true },
  },
  linearPattern: {
    axis: { min: 0, max: 2, default: 0, integer: true },
    count: { min: 2, max: 20, default: 3, integer: true },
    spacing: { min: 1, max: 500, default: 60 },
  },
  circularPattern: {
    axis: { min: 0, max: 2, default: 1, integer: true },
    count: { min: 2, max: 36, default: 6, integer: true },
    totalAngle: { min: 10, max: 360, default: 360 },
  },
  mirror: {
    plane: { min: 0, max: 2, default: 0, integer: true },
  },
  draft: {
    angle: { min: 1, max: 30, default: 5 },
    direction: { min: 0, max: 1, default: 0, integer: true },
  },
  rib: {
    startX: { min: -500, max: 500, default: -25 },
    startZ: { min: -500, max: 500, default: 0 },
    endX: { min: -500, max: 500, default: 25 },
    endZ: { min: -500, max: 500, default: 0 },
    thickness: { min: 0.5, max: 20, default: 2 },
    height: { min: 1, max: 100, default: 10 },
    direction: { min: 0, max: 1, default: 0, integer: true },
  },
};

export function isSchemaKnownFeature(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(FEATURE_PARAM_RANGES, type);
}

/**
 * Every feature type the modeler can actually build (mirrors the FeatureType
 * union: FEATURE_MAP keys + the pipeline-handled sketch types). An AI response
 * referencing a type outside this set can't be built, so the sanitizer drops it
 * rather than handing the pipeline a no-op. featureParamSchema.test's drift
 * guard fails if a real FEATURE_MAP feature is missing here.
 */
export const KNOWN_FEATURE_TYPES: ReadonlySet<string> = new Set([
  'fillet', 'chamfer', 'shell', 'hole', 'linearPattern', 'circularPattern',
  'mirror', 'boolean', 'draft', 'scale', 'moveCopy', 'splitBody', 'bend',
  'flange', 'hem', 'jog', 'flatPattern', 'variableFillet', 'boundarySurface',
  'revolve', 'sweep', 'loft', 'thread', 'moldTools', 'weldment', 'nurbsSurface',
  'helix', 'variableShell', 'rib',
  // sketch types are materialised in the pipeline, not via FEATURE_MAP
  'sketch', 'sketchExtrude',
]);

export function isBuildableFeatureType(type: string): boolean {
  return KNOWN_FEATURE_TYPES.has(type);
}

/**
 * Clamp an AI-supplied param block for a known feature type to its schema:
 * every schema key is filled (clamped value if supplied, else default), and
 * params not in the schema are dropped. Returns null for unknown feature types
 * (caller should fall back to its generic sanitizer).
 */
export function clampFeatureParams(
  type: string,
  params: Record<string, unknown>,
): Record<string, number> | null {
  const schema = FEATURE_PARAM_RANGES[type];
  if (!schema) return null;
  const out: Record<string, number> = {};
  for (const [key, r] of Object.entries(schema)) {
    const raw = params[key];
    let v = typeof raw === 'number' && Number.isFinite(raw) ? raw : r.default;
    v = Math.max(r.min, Math.min(r.max, v));
    if (r.integer) v = Math.round(v);
    out[key] = v;
  }
  return out;
}
