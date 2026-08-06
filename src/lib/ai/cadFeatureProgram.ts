import { authoritativeParams, gateDesignIntentIR, type DesignIntentIR } from './designIntentIR';
import type { ManufacturingVerificationContext } from './manufacturingContext';

export type CadFeatureType =
  | 'sketchExtrude' | 'hole' | 'circularPattern' | 'linearPattern'
  | 'rib' | 'fillet' | 'chamfer' | 'shell';

export interface CadFeature {
  id: string;
  type: CadFeatureType;
  shape?: 'rect' | 'circle';
  width?: number;
  depth?: number;
  height?: number;
  length?: number;
  alongY?: boolean;
  diameter?: number;
  posX?: number;
  posY?: number;
  feature?: string;
  count?: number;
  pcd?: number;
  spacing?: number;
  axis?: 'x' | 'y';
  radius?: number;
  distance?: number;
  wallThickness?: number;
  openFace?: 'top' | 'bottom';
}

export interface CadFeatureProgram {
  part: string;
  features: CadFeature[];
  intentIrVersion?: 1;
  verificationContext?: ManufacturingVerificationContext;
}

export interface FeatureProgramValidation {
  ok: boolean;
  errors: string[];
}

const finitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const FEATURE_TYPES = new Set<CadFeatureType>([
  'sketchExtrude', 'hole', 'circularPattern', 'linearPattern',
  'rib', 'fillet', 'chamfer', 'shell',
]);

export function validateCadFeatureProgram(program: CadFeatureProgram): FeatureProgramValidation {
  const errors: string[] = [];
  const features = Array.isArray(program?.features) ? program.features : [];
  const ids = new Set<string>();
  const bases = features.filter(feature => feature.type === 'sketchExtrude');
  if (bases.length !== 1 || features[0]?.type !== 'sketchExtrude') {
    errors.push('Program must start with exactly one sketchExtrude base.');
  }

  for (const [index, feature] of features.entries()) {
    const label = feature.id || `feature[${index}]`;
    if (!FEATURE_TYPES.has(feature.type)) errors.push(`${label}.type is unsupported.`);
    if (!feature.id?.trim()) errors.push(`feature[${index}] requires an id.`);
    else if (ids.has(feature.id)) errors.push(`Duplicate feature id: ${feature.id}.`);
    else ids.add(feature.id);

    if (feature.type === 'sketchExtrude') {
      if (feature.shape !== 'rect' && feature.shape !== 'circle') errors.push(`${label}.shape is invalid.`);
      if (!finitePositive(feature.width)) errors.push(`${label}.width must be a positive explicit dimension.`);
      if (feature.shape === 'rect' && !finitePositive(feature.depth)) errors.push(`${label}.depth must be a positive explicit dimension.`);
      if (!finitePositive(feature.height)) errors.push(`${label}.height must be a positive explicit dimension.`);
    } else if (feature.type === 'hole') {
      if (!finitePositive(feature.diameter)) errors.push(`${label}.diameter must be positive.`);
      if (typeof feature.posX !== 'number' || !Number.isFinite(feature.posX)) errors.push(`${label}.posX must be explicit.`);
      if (typeof feature.posY !== 'number' || !Number.isFinite(feature.posY)) errors.push(`${label}.posY must be explicit.`);
    } else if (feature.type === 'circularPattern' || feature.type === 'linearPattern') {
      if (!feature.feature?.trim()) errors.push(`${label}.feature reference is required.`);
      if (!Number.isInteger(feature.count) || (feature.count ?? 0) < 2) errors.push(`${label}.count must be an integer >= 2.`);
      if (feature.type === 'circularPattern' && !finitePositive(feature.pcd)) errors.push(`${label}.pcd must be positive.`);
      if (feature.type === 'linearPattern' && !finitePositive(feature.spacing)) errors.push(`${label}.spacing must be positive.`);
      if (feature.type === 'linearPattern' && feature.axis !== 'x' && feature.axis !== 'y') errors.push(`${label}.axis is invalid.`);
    } else if (feature.type === 'rib') {
      for (const key of ['width', 'height', 'length'] as const) {
        if (!finitePositive(feature[key])) errors.push(`${label}.${key} must be positive.`);
      }
      if (typeof feature.posX !== 'number' || typeof feature.posY !== 'number') errors.push(`${label} position must be explicit.`);
    } else if (feature.type === 'fillet' && !finitePositive(feature.radius)) {
      errors.push(`${label}.radius must be positive.`);
    } else if (feature.type === 'chamfer' && !finitePositive(feature.distance)) {
      errors.push(`${label}.distance must be positive.`);
    } else if (feature.type === 'shell') {
      if (!finitePositive(feature.wallThickness)) errors.push(`${label}.wallThickness must be positive.`);
      if (feature.openFace !== 'top' && feature.openFace !== 'bottom') errors.push(`${label}.openFace is invalid.`);
    }
  }

  for (const feature of features) {
    if ((feature.type === 'circularPattern' || feature.type === 'linearPattern') && !ids.has(feature.feature ?? '')) {
      errors.push(`${feature.id}.feature references a missing id.`);
    }
  }

  const base = bases[0];
  if (base) {
    const minSpan = base.shape === 'circle' ? base.width : Math.min(base.width ?? 0, base.depth ?? 0);
    for (const feature of features) {
      if (feature.type === 'hole' && finitePositive(feature.diameter) && finitePositive(minSpan) && feature.diameter >= minSpan) {
        errors.push(`${feature.id}.diameter removes the entire base.`);
      }
      if (feature.type === 'shell' && finitePositive(feature.wallThickness) && finitePositive(minSpan) && feature.wallThickness * 2 >= minSpan) {
        errors.push(`${feature.id}.wallThickness leaves no interior.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

const PROGRAM_DIMENSION_KEYS: ReadonlyArray<keyof CadFeature> = [
  'width', 'depth', 'height', 'length', 'diameter', 'posX', 'posY',
  'count', 'pcd', 'spacing', 'radius', 'distance', 'wallThickness',
];

/** Initial generation may use only explicit numbers, except documented metric clearances. */
export function findUngroundedProgramDimensions(prompt: string, program: CadFeatureProgram): string[] {
  const promptNumbers = [...prompt.matchAll(/-?\d+(?:\.\d+)?/g)]
    .map(match => Number(match[0]))
    .filter(Number.isFinite);
  const grounded = (value: number) => promptNumbers.some(number => Math.abs(number - value) < 1e-9);
  const metric = /\bM\s*(3|4|5|6|8)\b/i.exec(prompt)?.[1];
  const clearanceByMetric: Record<string, number> = { '3': 3.4, '4': 4.5, '5': 5.5, '6': 6.5, '8': 9 };
  const allowedClearance = metric ? clearanceByMetric[metric] : undefined;
  const issues: string[] = [];
  for (const feature of program.features) {
    for (const key of PROGRAM_DIMENSION_KEYS) {
      const value = feature[key];
      if (typeof value !== 'number' || value === 0) continue;
      if (grounded(value)) continue;
      if (key === 'diameter' && value === allowedClearance) continue;
      issues.push(`${feature.id}.${key}=${value} has no numeric evidence in the prompt.`);
    }
  }
  return issues;
}

export function clarificationQuestions(details: string[]): string[] {
  const questions = details.map(detail => {
    const field = /^([\w-]+)\.([\w]+)(?:=([^ ]+))?/.exec(detail);
    if (!field) return `Please clarify: ${detail}`;
    const [, featureId, key, value] = field;
    if (detail.includes('no numeric evidence')) {
      return `Please confirm the ${key} for ${featureId}${value ? ` (the generated value was ${value})` : ''}.`;
    }
    if (detail.includes('must be')) return `What should the ${key} of ${featureId} be?`;
    return `Please clarify ${key} for ${featureId}.`;
  });
  return [...new Set(questions)].slice(0, 5);
}

export interface AnalyticFeatureExpectation {
  expectedCylinderFaces: number;
  expectedThroughHoles: number;
  unsupportedFeatureIds: string[];
}

/** Surface-level signature currently measurable from an OCCT B-Rep. */
export function expectedAnalyticFeatureSignature(program: CadFeatureProgram): AnalyticFeatureExpectation {
  const base = program.features.find(feature => feature.type === 'sketchExtrude');
  let expectedThroughHoles = 0;
  const unsupportedFeatureIds: string[] = [];
  for (const feature of program.features) {
    if (feature.type === 'hole') {
      const pattern = program.features.find(item =>
        (item.type === 'circularPattern' || item.type === 'linearPattern') && item.feature === feature.id,
      );
      expectedThroughHoles += pattern ? (pattern.count ?? 0) : 1;
    } else if (!['sketchExtrude', 'circularPattern', 'linearPattern'].includes(feature.type)) {
      unsupportedFeatureIds.push(feature.id);
    }
  }
  return {
    expectedCylinderFaces: expectedThroughHoles + (base?.shape === 'circle' ? 1 : 0),
    expectedThroughHoles,
    unsupportedFeatureIds,
  };
}

export type IntentBaseShape = 'rect' | 'circle';

/** Deterministic v1 compiler: one confirmed IR component to one analytic base feature. */
export function compileIntentIRToBaseProgram(
  ir: DesignIntentIR,
  componentId: string,
  shape: IntentBaseShape,
): { ok: true; program: CadFeatureProgram } | { ok: false; errors: string[] } {
  const gate = gateDesignIntentIR(ir);
  if (!gate.ready) return { ok: false, errors: gate.reasons };
  const params = authoritativeParams(ir, componentId);
  const width = Number(shape === 'circle' ? (params.diameter ?? params.width) : params.width);
  const depth = shape === 'rect' ? Number(params.depth) : undefined;
  const height = Number(params.height ?? params.thickness);
  const feature: CadFeature = { id: 'base', type: 'sketchExtrude', shape, width, height };
  if (shape === 'rect') feature.depth = depth;
  const program: CadFeatureProgram = {
    part: ir.title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '_').replace(/^_|_$/g, '') || 'part',
    features: [feature],
    intentIrVersion: ir.version,
  };
  const validation = validateCadFeatureProgram(program);
  return validation.ok ? { ok: true, program } : { ok: false, errors: validation.errors };
}
