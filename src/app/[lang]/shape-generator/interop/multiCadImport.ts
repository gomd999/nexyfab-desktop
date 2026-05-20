/**
 * multiCadImport.ts — 3D Interconnect-style multi-format CAD import.
 *
 * SolidWorks 3D Interconnect maintains a *live link* to Inventor /
 * Catia / NX / Pro-E files: open them as if they were native, refresh
 * when the source changes, preserve assembly hierarchy + feature
 * names. The catch: actual format parsers for Catia .CATPart etc.
 * require licensed SDKs (Dassault, Siemens, PTC) we don't ship.
 *
 * What we *can* ship right now is the **framework**: an adapter
 * registry + neutral schema + change-detection. When a properly-
 * licensed parser is dropped in, it slots into this framework.
 *
 * Capabilities:
 *
 *   - **Adapter registry** — register a parser per file extension.
 *     STEP / IGES already covered by existing modules; the framework
 *     also supports stubs for .CATPart, .ipt, .prt (Pro-E/NX),
 *     and .3dm.
 *   - **Neutral imported-CAD schema** — bodies, assemblies, named
 *     features (with their original CAD-system ids preserved).
 *   - **Change detection** — hashed source file → reload trigger.
 *     Lets the linked file in the assembly stay current without
 *     a full re-import.
 *   - **Unit conversion** — every adapter declares its source units;
 *     the importer normalises to mm.
 *   - **Feature ID mapping** — the source CAD's feature ids are
 *     kept so PMI / mate references in the assembly can survive a
 *     source file update.
 */

export type CadFormat =
  | 'step' | 'iges' | 'stl' | 'obj' | '3mf' | 'gltf' | 'usdz'
  | 'catpart' | 'catproduct'
  | 'inventor-ipt' | 'inventor-iam'
  | 'nx-prt' | 'creo-prt' | 'creo-asm'
  | 'rhino-3dm' | 'solidedge-par';

export type Units = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export interface NeutralBody {
  /** Body id (unique within the imported file). */
  id: string;
  /** Display name. */
  name: string;
  /** Triangle mesh (Float32 flat positions). */
  positions: number[];
  /** Triangle indices. */
  indices: number[];
  /** Original CAD-system feature id (for round-trip). */
  sourceFeatureId?: string;
  /** Material name from source. */
  materialName?: string;
}

export interface NeutralAssembly {
  id: string;
  name: string;
  /** Children — bodies or sub-assemblies, with transforms. */
  children: Array<{
    refId: string;
    /** 4×4 transform (row-major). */
    transform: number[];
  }>;
}

export interface NeutralImport {
  format: CadFormat;
  sourceFileName: string;
  /** Source file size in bytes — used for change detection. */
  sourceFileSizeBytes: number;
  /** SHA-256 (or rolling) hash for content change detection. */
  sourceHash: string;
  units: Units;
  bodies: NeutralBody[];
  assemblies: NeutralAssembly[];
  /** Free-form metadata from source. */
  metadata: Record<string, string>;
  /** Warnings the adapter wants to surface. */
  warnings: string[];
}

// ── Adapter registry ─────────────────────────────────────────────

export interface ImportAdapter {
  format: CadFormat;
  /** File extensions this adapter handles (lowercase, including dot). */
  extensions: string[];
  /** Required source unit; framework converts to mm. */
  sourceUnits: Units;
  /** True when adapter requires a licensed external SDK. */
  requiresLicense: boolean;
  /** Human-readable provenance / vendor. */
  vendor: string;
  /** Implementation. */
  parse: (file: ArrayBuffer, fileName: string) => Promise<NeutralImport>;
}

const adapters = new Map<CadFormat, ImportAdapter>();

export function registerAdapter(adapter: ImportAdapter): void {
  adapters.set(adapter.format, adapter);
}

export function findAdapterForExtension(filename: string): ImportAdapter | null {
  const lower = filename.toLowerCase();
  for (const a of adapters.values()) {
    for (const ext of a.extensions) {
      if (lower.endsWith(ext)) return a;
    }
  }
  return null;
}

export function listAdapters(): ImportAdapter[] {
  return Array.from(adapters.values());
}

export function clearAdapters(): void {
  adapters.clear();
}

// ── Stub adapters for licensed formats ──────────────────────────

const LICENSED_STUB_NAMES: Record<string, { vendor: string; ext: string[]; format: CadFormat }> = {
  catpart: { vendor: 'Dassault Systèmes', ext: ['.catpart'], format: 'catpart' },
  catproduct: { vendor: 'Dassault Systèmes', ext: ['.catproduct'], format: 'catproduct' },
  'inventor-ipt': { vendor: 'Autodesk', ext: ['.ipt'], format: 'inventor-ipt' },
  'inventor-iam': { vendor: 'Autodesk', ext: ['.iam'], format: 'inventor-iam' },
  'nx-prt': { vendor: 'Siemens', ext: ['.prt'], format: 'nx-prt' },
  'creo-prt': { vendor: 'PTC', ext: ['.prt.1', '.prt.2', '.prt.3'], format: 'creo-prt' },
  'creo-asm': { vendor: 'PTC', ext: ['.asm.1', '.asm.2'], format: 'creo-asm' },
  'rhino-3dm': { vendor: 'McNeel', ext: ['.3dm'], format: 'rhino-3dm' },
  'solidedge-par': { vendor: 'Siemens', ext: ['.par'], format: 'solidedge-par' },
};

/** Register placeholder adapters for licensed formats. Each returns
 *  an error directing the user to license the corresponding SDK. */
export function registerLicensedStubs(): void {
  for (const [, info] of Object.entries(LICENSED_STUB_NAMES)) {
    registerAdapter({
      format: info.format,
      extensions: info.ext,
      sourceUnits: 'mm',
      requiresLicense: true,
      vendor: info.vendor,
      parse: async () => {
        throw new Error(
          `${info.vendor} ${info.ext.join('/')} import requires a licensed SDK. ` +
          `Export to STEP / IGES / 3MF from the source CAD until then.`,
        );
      },
    });
  }
}

// ── Unit conversion ─────────────────────────────────────────────

const UNIT_SCALE_TO_MM: Record<Units, number> = {
  mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8,
};

export function convertImportToMm(imp: NeutralImport): NeutralImport {
  if (imp.units === 'mm') return imp;
  const scale = UNIT_SCALE_TO_MM[imp.units];
  const scaledBodies = imp.bodies.map(b => ({
    ...b,
    positions: b.positions.map(p => p * scale),
  }));
  const scaledAssemblies = imp.assemblies.map(a => ({
    ...a,
    children: a.children.map(c => ({
      refId: c.refId,
      transform: c.transform.map((t, i) => {
        // Scale translation (3rd column) only.
        return i % 4 === 3 && i < 12 ? t * scale : t;
      }),
    })),
  }));
  return { ...imp, units: 'mm', bodies: scaledBodies, assemblies: scaledAssemblies };
}

// ── Change detection ────────────────────────────────────────────

export interface LinkedFileRef {
  /** Workspace-local path or URL. */
  sourcePath: string;
  format: CadFormat;
  /** Hash captured at the last import. */
  lastSeenHash: string;
  lastSeenSizeBytes: number;
  lastImportedAt: string;
}

/** Cheap rolling hash (32-bit FNV-1a). Production should use SHA-256. */
export function rollingHash(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function detectChange(ref: LinkedFileRef, file: ArrayBuffer): {
  changed: boolean;
  reason: 'size-differs' | 'content-differs' | 'unchanged';
} {
  if (file.byteLength !== ref.lastSeenSizeBytes) {
    return { changed: true, reason: 'size-differs' };
  }
  const hash = rollingHash(file);
  if (hash !== ref.lastSeenHash) {
    return { changed: true, reason: 'content-differs' };
  }
  return { changed: false, reason: 'unchanged' };
}

// ── Feature ID preservation ──────────────────────────────────────

/** Track the source-system feature ids alongside our internal body
 *  ids, so a future re-import can map old PMI / mates onto the new
 *  geometry by source id rather than by mesh index. */
export class FeatureIdMap {
  private internalToSource = new Map<string, string>();
  private sourceToInternal = new Map<string, string>();

  set(internalId: string, sourceId: string): void {
    this.internalToSource.set(internalId, sourceId);
    this.sourceToInternal.set(sourceId, internalId);
  }

  getInternal(sourceId: string): string | null {
    return this.sourceToInternal.get(sourceId) ?? null;
  }

  getSource(internalId: string): string | null {
    return this.internalToSource.get(internalId) ?? null;
  }

  size(): number {
    return this.internalToSource.size;
  }

  /** Build the map from a NeutralImport — every body's sourceFeatureId
   *  becomes the lookup. */
  static fromImport(imp: NeutralImport): FeatureIdMap {
    const map = new FeatureIdMap();
    for (const body of imp.bodies) {
      if (body.sourceFeatureId) map.set(body.id, body.sourceFeatureId);
    }
    return map;
  }
}

// ── Refresh workflow ────────────────────────────────────────────

export interface RefreshResult {
  /** Number of bodies that already existed in the previous import. */
  matched: number;
  /** Bodies added since the last import. */
  added: string[];
  /** Bodies removed since the last import. */
  removed: string[];
  /** Newly imported snapshot. */
  newImport: NeutralImport;
}

/** Compare two imports of the same file by source feature id. */
export function refreshImport(
  previous: NeutralImport,
  fresh: NeutralImport,
): RefreshResult {
  const prevIds = new Set(previous.bodies.map(b => b.sourceFeatureId ?? b.id));
  const freshIds = new Set(fresh.bodies.map(b => b.sourceFeatureId ?? b.id));
  const added: string[] = [];
  const removed: string[] = [];
  for (const id of freshIds) if (!prevIds.has(id)) added.push(id);
  for (const id of prevIds) if (!freshIds.has(id)) removed.push(id);
  return {
    matched: prevIds.size - removed.length,
    added, removed,
    newImport: fresh,
  };
}
