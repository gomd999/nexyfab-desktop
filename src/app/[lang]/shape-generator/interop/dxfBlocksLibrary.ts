/**
 * dxfBlocksLibrary.ts — DXF BLOCK definition library + nested INSERT
 * instance resolution.
 *
 * The existing `io/dxfParser.ts` reads flat entities (LINE/CIRCLE/etc).
 * DXF also has BLOCK/INSERT which is its reusable-component mechanism —
 * a stamp + nested transform tree. Real shop drawings make heavy use
 * of BLOCKs (frame templates, fastener stamps, callouts).
 *
 * This module:
 *
 *   - Stores BLOCK definitions in a typed library.
 *   - Resolves an INSERT entity (or chain of nested INSERTs) into
 *     the flat list of base entities with their accumulated transforms.
 *   - Supports uniform/non-uniform scale + rotation + translation.
 *   - Detects circular block references and breaks them safely.
 *
 * Output: a flat list of resolved entities the renderer can draw
 * with no further block awareness.
 */

export type DxfBaseEntity =
  | { type: 'LINE'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'CIRCLE'; cx: number; cy: number; r: number }
  | { type: 'ARC'; cx: number; cy: number; r: number; startDeg: number; endDeg: number }
  | { type: 'POINT'; x: number; y: number }
  | { type: 'INSERT'; blockName: string; x: number; y: number; rotationDeg: number; scaleX: number; scaleY: number };

export interface DxfBlockDefinition {
  /** Block name (key into the library). */
  name: string;
  /** Origin point — INSERTs reference this as the local (0,0). */
  origin: { x: number; y: number };
  /** Base entities (may include nested INSERTs). */
  entities: DxfBaseEntity[];
}

export interface ResolvedEntity {
  /** The flattened base entity (never INSERT). */
  entity: Exclude<DxfBaseEntity, { type: 'INSERT' }>;
  /** Chain of block names traversed (outer-most first). */
  blockPath: string[];
}

export interface ResolveOptions {
  /** Maximum nesting depth before giving up. */
  maxDepth: number;
}

export const DEFAULT_OPTIONS: ResolveOptions = {
  maxDepth: 32,
};

// ── Library ─────────────────────────────────────────────────────

export class DxfBlocksLibrary {
  private blocks = new Map<string, DxfBlockDefinition>();

  /** Register a block. Overwrites any prior definition with the same name. */
  add(block: DxfBlockDefinition): void {
    this.blocks.set(block.name, block);
  }

  /** Remove a block by name. */
  remove(name: string): boolean {
    return this.blocks.delete(name);
  }

  /** Lookup. */
  get(name: string): DxfBlockDefinition | null {
    return this.blocks.get(name) ?? null;
  }

  /** All defined names. */
  names(): string[] {
    return [...this.blocks.keys()];
  }

  /** Count. */
  size(): number {
    return this.blocks.size;
  }

  /** Does inserting block A eventually reach block B (circular check)? */
  hasCycle(): boolean {
    for (const name of this.blocks.keys()) {
      if (detectCycle(this.blocks, name, new Set(), new Set())) return true;
    }
    return false;
  }
}

function detectCycle(
  blocks: Map<string, DxfBlockDefinition>,
  cur: string,
  visited: Set<string>,
  stack: Set<string>,
): boolean {
  if (stack.has(cur)) return true;
  if (visited.has(cur)) return false;
  visited.add(cur);
  stack.add(cur);
  const def = blocks.get(cur);
  if (def) {
    for (const e of def.entities) {
      if (e.type === 'INSERT' && detectCycle(blocks, e.blockName, visited, stack)) return true;
    }
  }
  stack.delete(cur);
  return false;
}

// ── Resolve an INSERT (or root-level entity list) ──────────────

export interface ResolveResult {
  resolved: ResolvedEntity[];
  /** Missing block references encountered. */
  missing: string[];
  /** Did a cycle break? */
  cycleDetected: boolean;
  /** Max depth observed. */
  maxDepthObserved: number;
}

export function resolveInsert(
  insert: DxfBaseEntity,
  library: DxfBlocksLibrary,
  options: Partial<ResolveOptions> = {},
): ResolveResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const out: ResolvedEntity[] = [];
  const missing: string[] = [];
  let cycle = false;
  let maxDepth = 0;
  const visiting = new Set<string>();

  function recurse(e: DxfBaseEntity, transform: Transform, path: string[], depth: number): void {
    if (depth > maxDepth) maxDepth = depth;
    if (depth >= opts.maxDepth) return;
    if (e.type !== 'INSERT') {
      out.push({ entity: applyTransform(e, transform), blockPath: path });
      return;
    }
    if (visiting.has(e.blockName)) {
      cycle = true;
      return;
    }
    const def = library.get(e.blockName);
    if (!def) {
      missing.push(e.blockName);
      return;
    }
    visiting.add(e.blockName);
    const childT = composeTransform(transform, {
      tx: e.x - def.origin.x,
      ty: e.y - def.origin.y,
      sx: e.scaleX,
      sy: e.scaleY,
      rotDeg: e.rotationDeg,
    });
    for (const child of def.entities) {
      recurse(child, childT, [...path, e.blockName], depth + 1);
    }
    visiting.delete(e.blockName);
  }

  recurse(insert, IDENTITY, [], 0);

  return { resolved: out, missing, cycleDetected: cycle, maxDepthObserved: maxDepth };
}

// ── Transform algebra ──────────────────────────────────────────

interface Transform {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  rotDeg: number;
}

const IDENTITY: Transform = { tx: 0, ty: 0, sx: 1, sy: 1, rotDeg: 0 };

function composeTransform(a: Transform, b: Transform): Transform {
  // Apply b in a's local frame (i.e., result = a ∘ b).
  const cos = Math.cos((a.rotDeg * Math.PI) / 180);
  const sin = Math.sin((a.rotDeg * Math.PI) / 180);
  return {
    tx: a.tx + (b.tx * cos - b.ty * sin) * a.sx,
    ty: a.ty + (b.tx * sin + b.ty * cos) * a.sy,
    sx: a.sx * b.sx,
    sy: a.sy * b.sy,
    rotDeg: a.rotDeg + b.rotDeg,
  };
}

function applyTransform(
  e: Exclude<DxfBaseEntity, { type: 'INSERT' }>,
  t: Transform,
): Exclude<DxfBaseEntity, { type: 'INSERT' }> {
  const cos = Math.cos((t.rotDeg * Math.PI) / 180);
  const sin = Math.sin((t.rotDeg * Math.PI) / 180);
  const tx = (x: number, y: number): [number, number] => [
    t.tx + (x * cos - y * sin) * t.sx,
    t.ty + (x * sin + y * cos) * t.sy,
  ];
  switch (e.type) {
    case 'LINE': {
      const [x0, y0] = tx(e.x0, e.y0);
      const [x1, y1] = tx(e.x1, e.y1);
      return { type: 'LINE', x0, y0, x1, y1 };
    }
    case 'CIRCLE': {
      const [cx, cy] = tx(e.cx, e.cy);
      const r = e.r * Math.abs(t.sx);
      return { type: 'CIRCLE', cx, cy, r };
    }
    case 'ARC': {
      const [cx, cy] = tx(e.cx, e.cy);
      const r = e.r * Math.abs(t.sx);
      return { type: 'ARC', cx, cy, r, startDeg: e.startDeg + t.rotDeg, endDeg: e.endDeg + t.rotDeg };
    }
    case 'POINT': {
      const [x, y] = tx(e.x, e.y);
      return { type: 'POINT', x, y };
    }
  }
}

// ── Whole-drawing flatten ──────────────────────────────────────

/** Resolve a flat list of root entities + nested INSERTs into a fully
 *  flattened entity list. */
export function flatten(
  entities: DxfBaseEntity[],
  library: DxfBlocksLibrary,
  options: Partial<ResolveOptions> = {},
): ResolveResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const resolved: ResolvedEntity[] = [];
  const missing: string[] = [];
  let cycle = false;
  let maxDepth = 0;
  for (const e of entities) {
    if (e.type !== 'INSERT') {
      resolved.push({ entity: e, blockPath: [] });
      continue;
    }
    const r = resolveInsert(e, library, opts);
    resolved.push(...r.resolved);
    missing.push(...r.missing);
    cycle = cycle || r.cycleDetected;
    if (r.maxDepthObserved > maxDepth) maxDepth = r.maxDepthObserved;
  }
  return { resolved, missing: dedup(missing), cycleDetected: cycle, maxDepthObserved: maxDepth };
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

// ── Summary ────────────────────────────────────────────────────

export interface LibrarySummary {
  blockCount: number;
  entityCount: number;
  nestedInsertCount: number;
  hasCycle: boolean;
}

export function summarize(library: DxfBlocksLibrary): LibrarySummary {
  let entities = 0;
  let nested = 0;
  for (const name of library.names()) {
    const def = library.get(name)!;
    entities += def.entities.length;
    for (const e of def.entities) {
      if (e.type === 'INSERT') nested++;
    }
  }
  return {
    blockCount: library.size(),
    entityCount: entities,
    nestedInsertCount: nested,
    hasCycle: library.hasCycle(),
  };
}
