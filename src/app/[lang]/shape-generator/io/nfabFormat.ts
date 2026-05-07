/**
 * NexyFab native project format (.nfab)
 *
 * Full-fidelity serialization of a shape-generator project — feature tree,
 * sketches, base shape params, paramExpressions, material, render settings.
 * Designed so reopening the file reproduces the design exactly.
 *
 * Schema is versioned. Migrations go in `migrate()` below as the format evolves.
 */

import type { HistoryNode, FeatureHistory } from '../useFeatureStack';
import type { SketchProfile, SketchConfig } from '../sketch/types';
import type { PlacedPart } from '../assembly/PartPlacementPanel';
import type { AssemblyMate } from '../assembly/AssemblyMates';
import type { BodyEntry } from '../panels/BodyPanel';

// ─── Schema ─────────────────────────────────────────────────────────────────

export const NFAB_FORMAT_VERSION = 1 as const;
export const NFAB_MIME = 'application/x-nexyfab-project+json';
export const NFAB_EXTENSION = '.nfab';

/** Persisted viewport section + sketch slice palette (no THREE objects) */
export interface NfabStudioViewV1 {
  sectionActive: boolean;
  sectionAxis: 'x' | 'y' | 'z';
  /** 0–1 along bbox for section clip */
  sectionOffset: number;
  sketchSlicePalette: boolean;
  sketchSlicePlaneMm: number;
  /** Toolbar split-view (optional — omitted when false) */
  multiView?: boolean;
  /** Last main 3D orbit camera in world mm (optional) */
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
}

export interface NfabProjectV1 {
  /** Schema discriminator — always 'nfab' so we can detect foreign JSON */
  magic: 'nfab';
  version: 1;
  createdAt: number;
  updatedAt: number;
  /** Free-form name shown in project lists */
  name: string;
  /** Optional thumbnail as data URL (base64 PNG) — capped to ~50 KB */
  thumbnail?: string;

  tree: {
    nodes: HistoryNode[];
    rootId: string;
    activeNodeId: string;
  };

  scene: {
    selectedId: string;
    params: Record<string, number>;
    paramExpressions: Record<string, string>;
    materialId: string;
    color: string;
    isSketchMode: boolean;
    sketchPlane: 'xy' | 'xz' | 'yz';
    sketchProfile: SketchProfile;
    sketchConfig: SketchConfig;
    /** Design vs topology tab — optional on legacy files (default design). */
    activeTab?: 'design' | 'optimize';
    /** Ribbon workspace id — optional on legacy files. */
    cadWorkspace?: string;
    renderMode?: 'standard' | 'photorealistic';
    /** Assembly explode slider (0–1), persisted for studio reopen */
    explodeFactor?: number;
    sketchViewMode?: '2d' | '3d' | 'drawing';
    ribbonTheme?: 'dark' | 'lightRibbon';
    /** Section plane + sketch slice guide (viewport studio chrome) */
    studioView?: NfabStudioViewV1;
  };

  /** Optional assembly snapshot — absent for single-part projects */
  assembly?: NfabAssemblySnapshotV1;

  /** Manufacturing process routing — persisted so re-opening the file restores
   * the last-used CAM post, sheet metal settings, currency, etc. */
  manufacturing?: NfabManufacturing;

  /** Free-form metadata (units, author, tags). Reserved: `nexyfabPdm` — see `io/nfabPdmMeta.ts`. */
  meta?: Record<string, unknown>;

  /** Named param + suppression variants (optional) */
  configurations?: NfabConfigurationV1[];
  /** Last-selected variant id, or null = working master matches `scene` */
  activeConfigurationId?: string | null;
}

/** All state needed to reproduce the manufacturing workflow without re-clicking. */
export interface NfabManufacturing {
  /** CAM post-processor id ('linuxcnc' | 'fanuc' | 'mazak' | 'haas') */
  camPostProcessorId?: string;
  /** CAM operation params last used */
  camOperation?: {
    type: string;
    toolDiameter: number;
    stepover: number;
    stepdown: number;
    feedRate: number;
    spindleSpeed: number;
  };
  /** Sheet metal material key (see sheetMetalTables) */
  smMaterial?: string;
  /** Sheet metal thickness (mm) */
  smThickness?: number;
  /** Manual K-factor override (0-1); null = use table */
  smKFactorOverride?: number | null;
  /** Preferred cost currency ('USD' | 'KRW') */
  currency?: string;
  /** Last quantity used in cost panel */
  quoteQuantity?: number;
}

export type NfabProject = NfabProjectV1;

/**
 * Named design variant (Configuration v0.1): base shape params + which
 * timeline nodes are enabled. Used for BOM/quote-style alternates later.
 */
export interface NfabConfigurationV1 {
  id: string;
  name: string;
  params: Record<string, number>;
  paramExpressions?: Record<string, string>;
  /** History node id → timeline enabled (excludes root/base; missing = unchanged on old files) */
  featureEnabled: Record<string, boolean>;
}

/** Serializable assembly state — no THREE.js objects */
export interface NfabAssemblySnapshotV1 {
  placedParts: PlacedPart[];
  mates: AssemblyMate[];
  /** Multi-body panel rows (metadata only — mesh comes from feature tree) */
  bodies?: BodyEntry[];
  activeBodyId?: string | null;
  selectedBodyIds?: string[];
}

// ─── Serialize ──────────────────────────────────────────────────────────────

export interface SerializeInput {
  name: string;
  history: FeatureHistory;
  scene: NfabProjectV1['scene'];
  assembly?: NfabAssemblySnapshotV1;
  manufacturing?: NfabManufacturing;
  thumbnail?: string;
  meta?: Record<string, unknown>;
  configurations?: NfabConfigurationV1[];
  activeConfigurationId?: string | null;
}

export function serializeProject(input: SerializeInput): NfabProjectV1 {
  const now = Date.now();
  return {
    magic: 'nfab',
    version: NFAB_FORMAT_VERSION,
    createdAt: now,
    updatedAt: now,
    name: input.name,
    thumbnail: input.thumbnail,
    tree: {
      nodes: input.history.nodes.map(stripRuntimeFields),
      rootId: input.history.rootId,
      activeNodeId: input.history.activeNodeId,
    },
    scene: input.scene,
    assembly:
      input.assembly &&
      (input.assembly.placedParts.length > 0 ||
        input.assembly.mates.length > 0 ||
        (input.assembly.bodies && input.assembly.bodies.length > 0))
        ? input.assembly
        : undefined,
    manufacturing: input.manufacturing,
    meta: input.meta,
    ...(input.configurations && input.configurations.length > 0
      ? {
          configurations: input.configurations,
          activeConfigurationId: input.activeConfigurationId ?? null,
        }
      : {}),
  };
}

function stripRuntimeFields(node: HistoryNode): HistoryNode {
  // `error`, `editingActive` are runtime-only — not part of the persisted project
  const { error: _e, editingActive: _ea, ...rest } = node;
  return { ...rest, editingActive: false };
}

export function toJsonString(project: NfabProjectV1, pretty = false): string {
  return pretty ? JSON.stringify(project, null, 2) : JSON.stringify(project);
}

// ─── Deserialize & Migrate ──────────────────────────────────────────────────

export class NfabParseError extends Error {
  constructor(message: string, public raw?: unknown) {
    super(message);
    this.name = 'NfabParseError';
  }
}

export function parseProject(json: string): NfabProjectV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new NfabParseError('Invalid JSON', e);
  }
  return migrate(raw);
}

function migrate(raw: unknown): NfabProjectV1 {
  if (!raw || typeof raw !== 'object') {
    throw new NfabParseError('Project payload is not an object', raw);
  }
  const obj = raw as Record<string, unknown>;

  if (obj.magic !== 'nfab') {
    throw new NfabParseError('Not a .nfab project file (missing magic "nfab")', raw);
  }

  const version = typeof obj.version === 'number' ? obj.version : 0;

  // Future versions chain through migrations here:
  //   if (version === 1) return raw as NfabProjectV1;
  //   if (version === 2) return migrateV2toV1(raw);
  if (version === NFAB_FORMAT_VERSION) {
    validateV1(obj);
    return normalizeProjectV1(obj);
  }

  throw new NfabParseError(
    `Unsupported .nfab version: ${version} (this build understands v${NFAB_FORMAT_VERSION})`,
    raw,
  );
}

function validateV1(obj: Record<string, unknown>) {
  const tree = obj.tree as Record<string, unknown> | undefined;
  if (!tree || !Array.isArray(tree.nodes) || typeof tree.rootId !== 'string') {
    throw new NfabParseError('Project tree missing or malformed', obj);
  }
  const scene = obj.scene as Record<string, unknown> | undefined;
  if (!scene || typeof scene.selectedId !== 'string') {
    throw new NfabParseError('Project scene missing or malformed', obj);
  }
  if (obj.assembly !== undefined && (typeof obj.assembly !== 'object' || obj.assembly === null)) {
    throw new NfabParseError('Project assembly malformed', obj);
  }
}

const MATE_TYPES = new Set<string>([
  'coincident',
  'concentric',
  'distance',
  'angle',
  'parallel',
  'perpendicular',
  'tangent',
]);

function isPlacedPartLike(p: unknown): p is PlacedPart {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.shapeId !== 'string') return false;
  if (!o.params || typeof o.params !== 'object') return false;
  if (typeof o.qty !== 'number') return false;
  if (!Array.isArray(o.position) || o.position.length !== 3) return false;
  if (!o.position.every((x: unknown) => typeof x === 'number')) return false;
  if (!Array.isArray(o.rotation) || o.rotation.length !== 3) return false;
  if (!o.rotation.every((x: unknown) => typeof x === 'number')) return false;
  return true;
}

function isMateLike(m: unknown): m is AssemblyMate {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.type === 'string' &&
    MATE_TYPES.has(o.type) &&
    typeof o.partA === 'string' &&
    typeof o.partB === 'string' &&
    typeof o.locked === 'boolean'
  );
}

function isBodyEntryLike(b: unknown): b is BodyEntry {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (
    typeof o.id !== 'string' ||
    typeof o.name !== 'string' ||
    typeof o.color !== 'string' ||
    typeof o.visible !== 'boolean' ||
    typeof o.locked !== 'boolean'
  ) {
    return false;
  }
  if (o.mergedFrom !== undefined) {
    if (!Array.isArray(o.mergedFrom) || !o.mergedFrom.every((x: unknown) => typeof x === 'string')) return false;
  }
  if (o.splitFrom !== undefined) {
    if (!o.splitFrom || typeof o.splitFrom !== 'object') return false;
    const s = o.splitFrom as Record<string, unknown>;
    if (typeof s.bodyId !== 'string' || typeof s.plane !== 'number' || typeof s.offset !== 'number') return false;
  }
  return true;
}

/** Coerce legacy `{ bodies, mates }` and loose JSON into `NfabAssemblySnapshotV1`. */
export function normalizeAssemblySnapshot(raw: unknown): NfabAssemblySnapshotV1 {
  if (!raw || typeof raw !== 'object') {
    return { placedParts: [], mates: [] };
  }
  const a = raw as Record<string, unknown>;
  const placedParts: PlacedPart[] = [];
  if (Array.isArray(a.placedParts)) {
    for (const p of a.placedParts) {
      if (isPlacedPartLike(p)) placedParts.push(p);
    }
  }
  const mates: AssemblyMate[] = [];
  if (Array.isArray(a.mates)) {
    for (const m of a.mates) {
      if (isMateLike(m)) mates.push(m);
    }
  }
  const bodies: BodyEntry[] = [];
  if (Array.isArray(a.bodies)) {
    for (const b of a.bodies) {
      if (isBodyEntryLike(b)) bodies.push(b);
    }
  }
  let activeBodyId: string | null | undefined;
  if ('activeBodyId' in a) {
    const v = a.activeBodyId;
    if (v === null) activeBodyId = null;
    else if (typeof v === 'string') activeBodyId = v;
  }
  const selectedBodyIds: string[] = [];
  if (Array.isArray(a.selectedBodyIds)) {
    for (const id of a.selectedBodyIds) {
      if (typeof id === 'string') selectedBodyIds.push(id);
    }
  }
  const out: NfabAssemblySnapshotV1 = { placedParts, mates };
  if (bodies.length > 0) {
    out.bodies = bodies;
    if (activeBodyId !== undefined) out.activeBodyId = activeBodyId;
    if (selectedBodyIds.length > 0) out.selectedBodyIds = selectedBodyIds;
  }
  return out;
}

function vec3Tuple(raw: unknown): [number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) return undefined;
  const a = raw.map(x => (typeof x === 'number' && Number.isFinite(x) ? x : NaN));
  if (a.some(Number.isNaN)) return undefined;
  return [a[0], a[1], a[2]];
}

function normalizeStudioView(raw: unknown): NfabStudioViewV1 | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const ax =
    o.sectionAxis === 'x' || o.sectionAxis === 'y' || o.sectionAxis === 'z' ? o.sectionAxis : 'y';
  let off = typeof o.sectionOffset === 'number' && Number.isFinite(o.sectionOffset) ? o.sectionOffset : 0.5;
  off = Math.max(0, Math.min(1, off));
  const pm =
    typeof o.sketchSlicePlaneMm === 'number' && Number.isFinite(o.sketchSlicePlaneMm)
      ? o.sketchSlicePlaneMm
      : 60;
  const out: NfabStudioViewV1 = {
    sectionActive: !!o.sectionActive,
    sectionAxis: ax,
    sectionOffset: off,
    sketchSlicePalette: !!o.sketchSlicePalette,
    sketchSlicePlaneMm: pm,
  };
  if (o.multiView === true) out.multiView = true;
  const cp = vec3Tuple(o.cameraPosition);
  const ct = vec3Tuple(o.cameraTarget);
  if (cp && ct) {
    out.cameraPosition = cp;
    out.cameraTarget = ct;
  }
  return out;
}

function normalizeConfigurations(raw: unknown): NfabConfigurationV1[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: NfabConfigurationV1[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue;
    const paramsRaw = o.params && typeof o.params === 'object' && o.params !== null ? (o.params as Record<string, unknown>) : {};
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(paramsRaw)) {
      if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
    }
    const feRaw =
      o.featureEnabled && typeof o.featureEnabled === 'object' && o.featureEnabled !== null
        ? (o.featureEnabled as Record<string, unknown>)
        : {};
    const featureEnabled: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(feRaw)) {
      if (typeof v === 'boolean') featureEnabled[k] = v;
    }
    let paramExpressions: Record<string, string> | undefined;
    if (o.paramExpressions && typeof o.paramExpressions === 'object' && o.paramExpressions !== null) {
      const pe: Record<string, string> = {};
      for (const [k, v] of Object.entries(o.paramExpressions as Record<string, unknown>)) {
        if (typeof v === 'string') pe[k] = v;
      }
      if (Object.keys(pe).length > 0) paramExpressions = pe;
    }
    out.push({
      id: o.id,
      name: o.name.trim().slice(0, 120) || 'Variant',
      params,
      featureEnabled,
      ...(paramExpressions ? { paramExpressions } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function normalizeProjectV1(obj: Record<string, unknown>): NfabProjectV1 {
  const assembly =
    obj.assembly !== undefined ? normalizeAssemblySnapshot(obj.assembly) : undefined;
  const sceneRaw = obj.scene as Record<string, unknown> | undefined;
  if (!sceneRaw || typeof sceneRaw !== 'object') {
    const configsOnly = normalizeConfigurations(obj.configurations);
    const base = { ...obj, assembly } as Record<string, unknown>;
    if (configsOnly) base.configurations = configsOnly;
    if ('activeConfigurationId' in obj) {
      const a = obj.activeConfigurationId;
      if (a === null) base.activeConfigurationId = null;
      else if (typeof a === 'string') base.activeConfigurationId = a;
    }
    return base as unknown as NfabProjectV1;
  }
  const sceneNext = { ...sceneRaw };
  if (sceneNext.studioView !== undefined) {
    const sv = normalizeStudioView(sceneNext.studioView);
    if (sv) sceneNext.studioView = sv;
    else delete sceneNext.studioView;
  }
  const configs = normalizeConfigurations(obj.configurations);
  const next: Record<string, unknown> = { ...obj, assembly, scene: sceneNext };
  if (configs) next.configurations = configs;
  if ('activeConfigurationId' in obj) {
    const a = obj.activeConfigurationId;
    if (a === null) next.activeConfigurationId = null;
    else if (typeof a === 'string') next.activeConfigurationId = a;
  } else if (configs) {
    next.activeConfigurationId = null;
  }
  return next as unknown as NfabProjectV1;
}
