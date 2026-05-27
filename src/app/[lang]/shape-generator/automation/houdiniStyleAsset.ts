/**
 * houdiniStyleAsset.ts — Houdini-Digital-Asset-style parameter package.
 *
 * SideFX Houdini bundles a procedural network + an exposed parameter
 * interface as a single ".hda" file. End users see only the parameter
 * knobs; internals are locked.
 *
 * NexyFab's equivalent for CAD:
 *
 *   - **Asset definition** — name, version, author, parameter schema.
 *   - **Parameter schema** — typed parameters (number / enum / boolean
 *     / vec3 / curve) with min/max/step + groups + dependencies.
 *   - **Recipe** — opaque payload representing the feature graph
 *     that generates geometry from parameters (not interpreted by
 *     this module — handed off to the modeler).
 *   - **Inputs / outputs** — declared geometric inputs (e.g. profile
 *     curve) + outputs (the generated body).
 *
 * Use cases:
 *   - **Internal SKU library** — "screw_post_v3" → bake into any part.
 *   - **Supplier component** — vendor publishes a parametric clamp;
 *     customer drops it in with their dimensions.
 *   - **One-off variants** — author once, reuse with different
 *     parameter sets for many quotes.
 */

export type ParamKind = 'number' | 'integer' | 'enum' | 'boolean' | 'vec3' | 'curve' | 'string';

export interface ParamSpec<TKind extends ParamKind = ParamKind> {
  id: string;
  label: string;
  kind: TKind;
  /** Description / help text. */
  description?: string;
  /** Group id for UI panel organization. */
  group?: string;
  /** Default value. */
  defaultValue: ParamValueFor<TKind>;
  /** Validation rules (kind-specific). */
  validation?: ParamValidation;
  /** When this expression evaluates to false, hide the parameter. */
  showIfExpression?: string;
}

export type ParamValueFor<K extends ParamKind> =
  K extends 'number' ? number :
  K extends 'integer' ? number :
  K extends 'enum' ? string :
  K extends 'boolean' ? boolean :
  K extends 'vec3' ? [number, number, number] :
  K extends 'curve' ? Array<[number, number]> :
  K extends 'string' ? string :
  never;

export interface ParamValidation {
  min?: number;
  max?: number;
  step?: number;
  enumValues?: string[];
  /** Custom message when validation fails. */
  errorMessage?: string;
}

export interface GeometryInput {
  id: string;
  label: string;
  /** What kind of geometric input is expected. */
  kind: 'curve' | 'face' | 'edge' | 'body' | 'point';
  /** Is the input required? */
  required: boolean;
}

export interface GeometryOutput {
  id: string;
  label: string;
  kind: 'curve' | 'face' | 'body' | 'mesh';
}

export interface AssetDefinition {
  /** Asset identifier (e.g. "nexyfab.screwpost.v3"). */
  id: string;
  /** Display name. */
  name: string;
  /** Semantic version. */
  version: string;
  /** Author / vendor. */
  author?: string;
  /** Short description. */
  description?: string;
  /** Icon URL (optional). */
  iconUrl?: string;
  /** Parameter schema. */
  parameters: ParamSpec[];
  /** Parameter groups for UI organization. */
  groups: Array<{ id: string; label: string }>;
  /** Required geometric inputs. */
  inputs: GeometryInput[];
  /** Declared outputs. */
  outputs: GeometryOutput[];
  /** Recipe payload — opaque to this module, executed by the modeler. */
  recipe: unknown;
  /** When true, end users can't edit parameters or see recipe. */
  locked?: boolean;
}

export interface AssetInstance {
  /** Source asset id. */
  assetId: string;
  /** Source version (so we know if upgrade is available). */
  assetVersion: string;
  /** Concrete parameter values. */
  parameters: Record<string, unknown>;
  /** Optional override / annotation. */
  notes?: string;
}

// ── Validation ──────────────────────────────────────────────────

export interface ValidationIssue {
  paramId: string;
  message: string;
  severity: 'error' | 'warning';
}

export function validateParameters(asset: AssetDefinition, instance: AssetInstance): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const spec of asset.parameters) {
    const v = instance.parameters[spec.id];
    if (v === undefined) {
      issues.push({ paramId: spec.id, message: 'Missing value', severity: 'warning' });
      continue;
    }
    issues.push(...validateValue(spec, v));
  }
  // Unknown parameters?
  const known = new Set(asset.parameters.map(p => p.id));
  for (const key of Object.keys(instance.parameters)) {
    if (!known.has(key)) {
      issues.push({ paramId: key, message: 'Parameter not in asset schema', severity: 'warning' });
    }
  }
  return issues;
}

function validateValue(spec: ParamSpec, v: unknown): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  switch (spec.kind) {
    case 'number':
    case 'integer': {
      if (typeof v !== 'number') {
        out.push({ paramId: spec.id, message: 'Expected number', severity: 'error' });
        break;
      }
      if (spec.kind === 'integer' && !Number.isInteger(v)) {
        out.push({ paramId: spec.id, message: 'Expected integer', severity: 'error' });
      }
      if (spec.validation?.min !== undefined && v < spec.validation.min) {
        out.push({ paramId: spec.id, message: `Below min ${spec.validation.min}`, severity: 'error' });
      }
      if (spec.validation?.max !== undefined && v > spec.validation.max) {
        out.push({ paramId: spec.id, message: `Above max ${spec.validation.max}`, severity: 'error' });
      }
      break;
    }
    case 'enum':
      if (typeof v !== 'string') {
        out.push({ paramId: spec.id, message: 'Expected string', severity: 'error' });
      } else if (spec.validation?.enumValues && !spec.validation.enumValues.includes(v)) {
        out.push({ paramId: spec.id, message: `Not in enum ${spec.validation.enumValues.join(', ')}`, severity: 'error' });
      }
      break;
    case 'boolean':
      if (typeof v !== 'boolean') out.push({ paramId: spec.id, message: 'Expected boolean', severity: 'error' });
      break;
    case 'vec3':
      if (!Array.isArray(v) || v.length !== 3 || !v.every(x => typeof x === 'number')) {
        out.push({ paramId: spec.id, message: 'Expected [x, y, z]', severity: 'error' });
      }
      break;
    case 'curve':
      if (!Array.isArray(v) || !v.every(p => Array.isArray(p) && p.length === 2)) {
        out.push({ paramId: spec.id, message: 'Expected curve [[t, v], ...]', severity: 'error' });
      }
      break;
    case 'string':
      if (typeof v !== 'string') out.push({ paramId: spec.id, message: 'Expected string', severity: 'error' });
      break;
  }
  return out;
}

// ── Instance defaults ───────────────────────────────────────────

/** Create a parameter dict pre-populated with defaults. */
export function createInstance(asset: AssetDefinition, overrides?: Record<string, unknown>): AssetInstance {
  const params: Record<string, unknown> = {};
  for (const spec of asset.parameters) {
    params[spec.id] = spec.defaultValue;
  }
  if (overrides) Object.assign(params, overrides);
  return {
    assetId: asset.id,
    assetVersion: asset.version,
    parameters: params,
  };
}

// ── Version upgrade ─────────────────────────────────────────────

export interface MigrationResult {
  /** Updated instance. */
  instance: AssetInstance;
  /** Notes about what changed. */
  notes: string[];
}

/** Migrate an instance from an older asset version to the new schema.
 *  Parameters that no longer exist are dropped (notes recorded);
 *  new parameters get default values. */
export function migrateInstance(
  oldInstance: AssetInstance,
  newAsset: AssetDefinition,
): MigrationResult {
  const notes: string[] = [];
  const out: Record<string, unknown> = {};
  for (const spec of newAsset.parameters) {
    if (spec.id in oldInstance.parameters) {
      out[spec.id] = oldInstance.parameters[spec.id];
    } else {
      out[spec.id] = spec.defaultValue;
      notes.push(`Added new parameter '${spec.id}' with default`);
    }
  }
  for (const oldKey of Object.keys(oldInstance.parameters)) {
    if (!newAsset.parameters.some(p => p.id === oldKey)) {
      notes.push(`Dropped removed parameter '${oldKey}'`);
    }
  }
  return {
    instance: {
      assetId: newAsset.id,
      assetVersion: newAsset.version,
      parameters: out,
      ...(oldInstance.notes ? { notes: oldInstance.notes } : {}),
    },
    notes,
  };
}

// ── Serialization ───────────────────────────────────────────────

export function serializeAsset(asset: AssetDefinition): string {
  return JSON.stringify(asset);
}

export function deserializeAsset(json: string): AssetDefinition {
  return JSON.parse(json) as AssetDefinition;
}

// ── Asset library ───────────────────────────────────────────────

export class AssetLibrary {
  private assets = new Map<string, AssetDefinition>();

  register(asset: AssetDefinition): void {
    const key = `${asset.id}@${asset.version}`;
    this.assets.set(key, asset);
  }

  get(id: string, version: string): AssetDefinition | null {
    return this.assets.get(`${id}@${version}`) ?? null;
  }

  /** Get the highest semver of a given asset id. */
  latest(id: string): AssetDefinition | null {
    let best: AssetDefinition | null = null;
    for (const a of this.assets.values()) {
      if (a.id !== id) continue;
      if (!best || compareVersions(a.version, best.version) > 0) best = a;
    }
    return best;
  }

  list(): AssetDefinition[] {
    return [...this.assets.values()];
  }
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(n => parseInt(n, 10) || 0);
  const bParts = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const ai = aParts[i] ?? 0;
    const bi = bParts[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}
