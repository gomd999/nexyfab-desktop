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

// ─── Schema ─────────────────────────────────────────────────────────────────

export const NFAB_FORMAT_VERSION = 1 as const;
export const NFAB_MIME = 'application/x-nexyfab-project+json';
export const NFAB_EXTENSION = '.nfab';

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
    renderMode?: 'standard' | 'photorealistic';
  };

  /** Optional assembly snapshot — absent for single-part projects */
  assembly?: {
    bodies: unknown[];
    mates: unknown[];
  };

  /** Manufacturing process routing — persisted so re-opening the file restores
   * the last-used CAM post, sheet metal settings, currency, etc. */
  manufacturing?: NfabManufacturing;

  /** Free-form metadata (units, author, tags) */
  meta?: Record<string, unknown>;
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

// ─── Serialize ──────────────────────────────────────────────────────────────

export interface SerializeInput {
  name: string;
  history: FeatureHistory;
  scene: NfabProjectV1['scene'];
  assembly?: NfabProjectV1['assembly'];
  manufacturing?: NfabManufacturing;
  thumbnail?: string;
  meta?: Record<string, unknown>;
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
    assembly: input.assembly,
    manufacturing: input.manufacturing,
    meta: input.meta,
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
    return obj as unknown as NfabProjectV1;
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
}
