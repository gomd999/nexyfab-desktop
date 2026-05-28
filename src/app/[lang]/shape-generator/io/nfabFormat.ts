/**
 * NexyFab native project format (.nfab)
 *
 * Full-fidelity serialization of a shape-generator project — feature tree,
 * sketches, base shape params, paramExpressions, material, render settings.
 * Designed so reopening the file reproduces the design exactly.
 *
 * Schema is versioned. Migrations go in `migrate()` below as the format evolves.
 *
 * Version history:
 *   v1 (initial)  — tree, scene, assembly, manufacturing, meta, configurations
 *   v2 (2026-05-07) — adds optional aiHistory + scadIntents for traceability
 *                     of AI-driven shape generation. Backward-compat: v1 files
 *                     auto-migrate (new fields default to empty).
 *   v3 (2026-05-28) — adds optional `referenceGeometry: ReferenceNode[]` for
 *                     Wave 2 Phase 2 Track D (reference-geometry plane/axis/
 *                     point/csys entities). Pre-v3 files load as
 *                     `referenceGeometry: []` via `migrateV2ToV3`.
 *
 * ⚠ Version-3 conflict surface (Wave 2 Phase 2 master tracker, D2 row):
 *   the v3 bump is **shared** with Track A1 (Configurations refactor). Track
 *   D2 is the first track to ship v3; Track A1 will land additional v3-only
 *   semantics for configurations (currently A1 only has a defensive
 *   `masterSnapshot` patch — see `configurations/masterSnapshot.ts` — and
 *   has NOT yet bumped LATEST_VERSION). When A1 ships, it should:
 *     1. Co-evolve v3 in-place (no v4 bump for an A1-only field).
 *     2. Add its new field as optional so D2-only files keep loading.
 *     3. Update this comment block + add A1 entries to `migrateV2ToV3`.
 *   The two field namespaces are disjoint: D2 owns `referenceGeometry`, A1
 *   owns whatever the Configurations-v3 shape settles on (likely
 *   `configurationsMaster` or an evolved `configurations[]` schema).
 *   Reserve v3 for shared use; don't claim ref-geom-only semantic.
 */

import type { HistoryNode, FeatureHistory } from '../useFeatureStack';
import type { SketchProfile, SketchConfig } from '../sketch/types';
import type { PlacedPart } from '../assembly/PartPlacementPanel';
import type { AssemblyMate } from '../assembly/AssemblyMates';
import type { BodyEntry } from '../panels/BodyPanel';
import type { ReferenceNode } from '../referenceGeometry/types';

// ─── Schema ─────────────────────────────────────────────────────────────────

/** Current schema version. v3 lands with Wave 2 Phase 2 Track D2
 *  (reference geometry). New writes always use this value. */
export const NFAB_FORMAT_VERSION = 3 as const;
export const NFAB_MIME = 'application/x-nexyfab-project+json';
export const NFAB_EXTENSION = '.nfab';

export type NfabFileVersion = 1 | 2 | 3;

/** AI conversation entry persisted in v2 — lets users replay how a part was designed. */
export interface NfabAiHistoryEntry {
  /** ISO timestamp */
  ts: number;
  /** User's natural-language prompt */
  prompt: string;
  /** AI provider that served the request (deepseek/anthropic/openai/local) */
  provider?: string;
  /** Resulting JSON intent that was passed to the deterministic SCAD converter */
  intent?: unknown;
  /** Brief one-line summary the AI provided */
  summary?: string;
}

/** Maps a feature-tree node id → the SCAD intent that produced its base shape. */
export type NfabScadIntentMap = Record<string, unknown>;

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
  /** Format version. v1 (legacy) or v2 (current). New writes are v2. */
  version: NfabFileVersion;
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
    /** Phase-2 "Sketch on tilted face" frame. Optional on legacy files
     *  (and on saves taken before a sketch-on-face was started). When
     *  present, restored sketches reconstruct on the same arbitrary plane
     *  they were authored on, not collapsed back to XY/XZ/YZ. */
    sketchFaceFrame?: {
      origin: [number, number, number];
      normal: [number, number, number];
      uAxis: [number, number, number];
      vAxis: [number, number, number];
    } | null;
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

  // ─── v2 additions (optional; absent on legacy v1 files) ────────────────────
  /** AI prompts and resulting intents that contributed to this design. */
  aiHistory?: NfabAiHistoryEntry[];
  /** Per-feature-node SCAD intents — lets the server regenerate STL deterministically. */
  scadIntents?: NfabScadIntentMap;

  // ─── v3 additions (optional; absent on legacy v1/v2 files) ─────────────────
  /** Wave 2 Phase 2 Track D — reference-geometry entities (planes / axes /
   *  points / coord-systems). Stored in insertion order; the dep solver
   *  toposorts on load. Topology refs (`face`/`edge`/`vertex` kinds inside
   *  params) hold worker-side ids; they'll round-trip stably for files
   *  saved and reopened by the same build, but inter-build stability is a
   *  W4 topology-naming concern.
   *
   *  Absent or empty on v1/v2 documents and on v3 documents the user
   *  never authored ref geom into. New writes emit `[]` only when the
   *  user has actually authored ref geom (keeps file size minimal). */
  referenceGeometry?: ReferenceNode[];
}

/** Alias for clarity at call-sites that handle v3 specifically. The
 *  runtime type is identical to `NfabProjectV1` (which has v2 + v3 fields
 *  as optional) — we keep the V1 name as the in-memory shape and use the
 *  V3 alias when documenting the *current* schema. */
export type NfabProjectV3 = NfabProjectV1;
/** Alias used internally during migration — a v2 document is structurally
 *  a `NfabProjectV1` with `version: 2`. */
export type NfabProjectV2 = NfabProjectV1;

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
  hiddenParts?: string[];
  transparentParts?: string[];
  partColors?: Record<string, string>;
}

// ─── Serialize ──────────────────────────────────────────────────────────────

export interface SerializeInput {
  name: string;
  history: FeatureHistory;
  scene: NfabProjectV1['scene'];
  aiHistory?: NfabAiHistoryEntry[];
  scadIntents?: NfabScadIntentMap;
  assembly?: NfabAssemblySnapshotV1;
  manufacturing?: NfabManufacturing;
  thumbnail?: string;
  meta?: Record<string, unknown>;
  configurations?: NfabConfigurationV1[];
  activeConfigurationId?: string | null;
  /** v3 — reference-geometry nodes (Wave 2 Phase 2 Track D). Omit or pass
   *  `[]` for documents with no ref-geom; the serializer drops the field
   *  in that case so a v2-equivalent file stays slim. */
  referenceGeometry?: ReferenceNode[];
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
    // v2 fields — only emit when populated to keep file size minimal.
    ...(input.aiHistory && input.aiHistory.length > 0 ? { aiHistory: input.aiHistory } : {}),
    ...(input.scadIntents && Object.keys(input.scadIntents).length > 0 ? { scadIntents: input.scadIntents } : {}),
    // v3 fields — same "emit only when populated" rule.
    ...(input.referenceGeometry && input.referenceGeometry.length > 0
      ? { referenceGeometry: input.referenceGeometry }
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

  // Migration chain. Each step takes the previous version's object and
  // returns the next version. We walk the chain explicitly so a v1 file
  // goes v1 → v2 → v3 in one parse pass. New writes always use
  // `NFAB_FORMAT_VERSION` (currently 3).
  let current = obj;
  if (version === 1) {
    current = migrateV1ToV2(current);
    current = migrateV2ToV3(current);
  } else if (version === 2) {
    current = migrateV2ToV3(current);
  } else if (version > NFAB_FORMAT_VERSION) {
    // Forward-compat: file is from a newer build. Tell the user to upgrade
    // instead of failing with a cryptic "unsupported version" message —
    // this is the most common cause of silent file-loss in the wild.
    throw new NfabParseError(
      `This .nfab file was created by a newer version of NexyFab (v${version}). ` +
      `Please update NexyFab to open it. Current build supports up to v${NFAB_FORMAT_VERSION}.`,
      raw,
    );
  } else if (version < 1) {
    throw new NfabParseError(
      `Invalid .nfab version: ${version}. Expected a positive integer.`,
      raw,
    );
  } else if (version !== NFAB_FORMAT_VERSION) {
    throw new NfabParseError(
      `Unsupported .nfab version: ${version} ` +
      `(this build understands v1, v2, v${NFAB_FORMAT_VERSION})`,
      raw,
    );
  }

  validateProject(current);
  return normalizeProjectV1(current);
}

function migrateV1ToV2(v1: Record<string, unknown>): Record<string, unknown> {
  // v1→v2: add empty aiHistory + scadIntents. Existing fields untouched.
  return {
    ...v1,
    version: 2,
    aiHistory: Array.isArray(v1.aiHistory) ? v1.aiHistory : [],
    scadIntents: v1.scadIntents && typeof v1.scadIntents === 'object' ? v1.scadIntents : {},
  };
}

/** v2 → v3 migration (Wave 2 Phase 2 Track D2).
 *
 *  Adds the `referenceGeometry` field (defaulted to `[]` for pre-v3 files)
 *  and bumps `version` to 3. All existing v2 fields are preserved exactly.
 *
 *  Note: this is the **first track-shared v3 migration**. When Track A1
 *  (Configurations refactor) lands its v3 semantics, it should *extend*
 *  this function rather than introduce a v4 bump — see the conflict-
 *  surface block at the top of this file.
 */
export function migrateV2ToV3(v2: Record<string, unknown>): Record<string, unknown> {
  return {
    ...v2,
    version: 3,
    referenceGeometry: Array.isArray(v2.referenceGeometry) ? v2.referenceGeometry : [],
  };
}

function validateProject(obj: Record<string, unknown>) {
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
  // v2 fields are optional; if present, they must be the right shape.
  if (obj.aiHistory !== undefined && !Array.isArray(obj.aiHistory)) {
    throw new NfabParseError('aiHistory must be an array', obj);
  }
  if (obj.scadIntents !== undefined && (typeof obj.scadIntents !== 'object' || obj.scadIntents === null || Array.isArray(obj.scadIntents))) {
    throw new NfabParseError('scadIntents must be an object', obj);
  }
  // v3 — referenceGeometry, when present, must be an array. We don't deep-
  // validate node shapes here (the ref-geom subsystem's load path runs
  // `findAllCycles` + per-node validation; we just gate on the outer
  // type so a malformed file fails fast).
  if (obj.referenceGeometry !== undefined && !Array.isArray(obj.referenceGeometry)) {
    throw new NfabParseError('referenceGeometry must be an array', obj);
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
  const hiddenParts: string[] = [];
  if (Array.isArray(a.hiddenParts)) {
    for (const id of a.hiddenParts) {
      if (typeof id === 'string') hiddenParts.push(id);
    }
  }
  const transparentParts: string[] = [];
  if (Array.isArray(a.transparentParts)) {
    for (const id of a.transparentParts) {
      if (typeof id === 'string') transparentParts.push(id);
    }
  }
  const partColors: Record<string, string> = {};
  if (a.partColors && typeof a.partColors === 'object') {
    for (const [k, v] of Object.entries(a.partColors as Record<string, unknown>)) {
      if (typeof v === 'string') partColors[k] = v;
    }
  }

  const out: NfabAssemblySnapshotV1 = { placedParts, mates };
  if (bodies.length > 0) {
    out.bodies = bodies;
    if (activeBodyId !== undefined) out.activeBodyId = activeBodyId;
    if (selectedBodyIds.length > 0) out.selectedBodyIds = selectedBodyIds;
  }
  if (hiddenParts.length > 0) out.hiddenParts = hiddenParts;
  if (transparentParts.length > 0) out.transparentParts = transparentParts;
  if (Object.keys(partColors).length > 0) out.partColors = partColors;
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
