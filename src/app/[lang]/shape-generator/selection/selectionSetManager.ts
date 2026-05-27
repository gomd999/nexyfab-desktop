/**
 * selectionSetManager.ts — Named selection sets for repeated ops.
 *
 * In SolidWorks/Inventor, "selection sets" let users save a list of
 * faces/edges/vertices under a name, then re-apply a feature (fillet,
 * chamfer, hole) to that set later. This is huge for:
 *
 *   - **Bulk operations** — fillet "All Outer Edges" once.
 *   - **Macros** — record once, replay against the saved set.
 *   - **Cross-config consistency** — same set works across part
 *     configurations (variants).
 *
 * Selection sets carry:
 *   - An ID + display name + element kind.
 *   - A list of element IDs (face, edge, or vertex IDs).
 *   - Optional **rules** — auto-membership predicates that re-evaluate
 *     when the model changes (e.g. "all planar faces facing +Z").
 *
 * Rules cover the limitation of plain ID lists: after a topological
 * edit the saved IDs may no longer exist; a rule re-derives.
 */

export type ElementKind = 'face' | 'edge' | 'vertex';

export interface SelectionSet {
  id: string;
  name: string;
  kind: ElementKind;
  /** Explicit element IDs. */
  elementIds: Set<string>;
  /** Optional rule for auto-membership. */
  rule?: SelectionRule;
  /** When the set was last manually edited or rule-resolved. */
  updatedAt?: number;
}

export type SelectionRule =
  | { kind: 'all-elements' }
  | { kind: 'by-tag'; tag: string }
  | { kind: 'planar-facing'; direction: [number, number, number]; toleranceDeg: number }
  | { kind: 'edge-convexity'; convexity: 'convex' | 'concave' | 'smooth' }
  | { kind: 'min-area'; minMm2: number }
  | { kind: 'max-area'; maxMm2: number };

export interface ElementMetadata {
  id: string;
  kind: ElementKind;
  /** Optional tags. */
  tags?: string[];
  /** Surface normal (face) or edge tangent. */
  direction?: [number, number, number];
  /** Surface area (mm²). */
  areaMm2?: number;
  /** Edge convexity classification. */
  convexity?: 'convex' | 'concave' | 'smooth' | 'tangent' | 'unknown';
}

export class SelectionSetManager {
  private sets = new Map<string, SelectionSet>();

  // ── CRUD ──────────────────────────────────────────────────────

  createSet(set: Omit<SelectionSet, 'elementIds'> & { elementIds?: Iterable<string> }): SelectionSet {
    const stored: SelectionSet = {
      id: set.id,
      name: set.name,
      kind: set.kind,
      elementIds: new Set(set.elementIds ?? []),
      updatedAt: Date.now(),
      ...(set.rule !== undefined ? { rule: set.rule } : {}),
    };
    this.sets.set(stored.id, stored);
    return stored;
  }

  deleteSet(setId: string): boolean {
    return this.sets.delete(setId);
  }

  renameSet(setId: string, name: string): void {
    const s = this.sets.get(setId);
    if (!s) return;
    s.name = name;
    s.updatedAt = Date.now();
  }

  get(setId: string): SelectionSet | null {
    return this.sets.get(setId) ?? null;
  }

  list(): SelectionSet[] {
    return [...this.sets.values()];
  }

  listByKind(kind: ElementKind): SelectionSet[] {
    return this.list().filter(s => s.kind === kind);
  }

  // ── Membership manipulation ───────────────────────────────────

  addToSet(setId: string, elementIds: Iterable<string>): void {
    const s = this.sets.get(setId);
    if (!s) return;
    for (const id of elementIds) s.elementIds.add(id);
    s.updatedAt = Date.now();
  }

  removeFromSet(setId: string, elementIds: Iterable<string>): void {
    const s = this.sets.get(setId);
    if (!s) return;
    for (const id of elementIds) s.elementIds.delete(id);
    s.updatedAt = Date.now();
  }

  setMembership(setId: string, elementIds: Iterable<string>): void {
    const s = this.sets.get(setId);
    if (!s) return;
    s.elementIds = new Set(elementIds);
    s.updatedAt = Date.now();
  }

  // ── Rule resolution ───────────────────────────────────────────

  /** Apply a set's rule against a list of element metadata to populate
   *  membership. Mutates the set. */
  resolveRule(setId: string, allElements: ElementMetadata[]): string[] {
    const s = this.sets.get(setId);
    if (!s) return [];
    if (!s.rule) return [...s.elementIds];
    const matched = filterByRule(s.rule, s.kind, allElements);
    s.elementIds = new Set(matched);
    s.updatedAt = Date.now();
    return [...s.elementIds];
  }

  /** Re-resolve all rules. Useful after a topology edit. */
  resolveAllRules(allElements: ElementMetadata[]): void {
    for (const s of this.sets.values()) {
      if (s.rule) this.resolveRule(s.id, allElements);
    }
  }

  // ── Set operations (union/intersect/subtract) ─────────────────

  union(setIdA: string, setIdB: string, targetId: string, targetName: string): SelectionSet | null {
    const a = this.sets.get(setIdA), b = this.sets.get(setIdB);
    if (!a || !b || a.kind !== b.kind) return null;
    return this.createSet({
      id: targetId, name: targetName, kind: a.kind,
      elementIds: new Set([...a.elementIds, ...b.elementIds]),
    });
  }

  intersect(setIdA: string, setIdB: string, targetId: string, targetName: string): SelectionSet | null {
    const a = this.sets.get(setIdA), b = this.sets.get(setIdB);
    if (!a || !b || a.kind !== b.kind) return null;
    const ids = [...a.elementIds].filter(id => b.elementIds.has(id));
    return this.createSet({ id: targetId, name: targetName, kind: a.kind, elementIds: ids });
  }

  subtract(setIdA: string, setIdB: string, targetId: string, targetName: string): SelectionSet | null {
    const a = this.sets.get(setIdA), b = this.sets.get(setIdB);
    if (!a || !b || a.kind !== b.kind) return null;
    const ids = [...a.elementIds].filter(id => !b.elementIds.has(id));
    return this.createSet({ id: targetId, name: targetName, kind: a.kind, elementIds: ids });
  }

  // ── Serialization ─────────────────────────────────────────────

  serialize(): SerializedManager {
    return {
      version: 1,
      sets: this.list().map(s => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        elementIds: [...s.elementIds],
        ...(s.rule ? { rule: s.rule } : {}),
        ...(s.updatedAt !== undefined ? { updatedAt: s.updatedAt } : {}),
      })),
    };
  }

  load(data: SerializedManager): void {
    if (data.version !== 1) throw new Error(`Unsupported version ${data.version}`);
    this.sets.clear();
    for (const s of data.sets) {
      this.createSet({
        id: s.id,
        name: s.name,
        kind: s.kind,
        elementIds: new Set(s.elementIds),
        ...(s.rule ? { rule: s.rule } : {}),
      });
      const stored = this.sets.get(s.id)!;
      if (s.updatedAt) stored.updatedAt = s.updatedAt;
    }
  }
}

export interface SerializedManager {
  version: number;
  sets: Array<{
    id: string;
    name: string;
    kind: ElementKind;
    elementIds: string[];
    rule?: SelectionRule;
    updatedAt?: number;
  }>;
}

// ── Rule evaluator ──────────────────────────────────────────────

export function filterByRule(rule: SelectionRule, kind: ElementKind, elements: ElementMetadata[]): string[] {
  const sameKind = elements.filter(e => e.kind === kind);
  switch (rule.kind) {
    case 'all-elements':
      return sameKind.map(e => e.id);
    case 'by-tag':
      return sameKind.filter(e => e.tags?.includes(rule.tag)).map(e => e.id);
    case 'planar-facing': {
      const cosTol = Math.cos((rule.toleranceDeg * Math.PI) / 180);
      const target = rule.direction;
      return sameKind.filter(e => {
        if (!e.direction) return false;
        const dot = e.direction[0] * target[0] + e.direction[1] * target[1] + e.direction[2] * target[2];
        return dot >= cosTol;
      }).map(e => e.id);
    }
    case 'edge-convexity':
      return sameKind.filter(e => e.convexity === rule.convexity).map(e => e.id);
    case 'min-area':
      return sameKind.filter(e => (e.areaMm2 ?? 0) >= rule.minMm2).map(e => e.id);
    case 'max-area':
      return sameKind.filter(e => (e.areaMm2 ?? 0) <= rule.maxMm2).map(e => e.id);
  }
}

// ── Stats ──────────────────────────────────────────────────────

export interface SelectionStats {
  setCount: number;
  totalElementReferences: number;
  setsWithRules: number;
}

export function summarize(manager: SelectionSetManager): SelectionStats {
  const sets = manager.list();
  return {
    setCount: sets.length,
    totalElementReferences: sets.reduce((s, x) => s + x.elementIds.size, 0),
    setsWithRules: sets.filter(s => s.rule !== undefined).length,
  };
}
