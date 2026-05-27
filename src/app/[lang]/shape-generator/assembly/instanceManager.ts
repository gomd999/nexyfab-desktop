/**
 * instanceManager.ts — Track and manage instances of the same part
 * across an assembly.
 *
 * In CAD assemblies the same part can appear many times (e.g.,
 * "M6×20 bolt" used 8 places). Each instance has its own placement
 * but shares the part definition.
 *
 * The instance manager:
 *
 *   - Adds / removes / renames instances by their parent partNumber.
 *   - Returns where-used queries (which assemblies use this part).
 *   - Generates unique instance ids automatically.
 *   - Reports counts per part for the BOM page.
 */

export interface PartInstance {
  /** Unique instance id (auto-generated). */
  instanceId: string;
  /** Reference part number this is an instance of. */
  partNumber: string;
  /** Optional display name override. */
  name?: string;
  /** Optional parent assembly id (for nested where-used). */
  parentAssemblyId?: string;
}

export interface InstanceManagerState {
  instances: Map<string, PartInstance>;
  /** partNumber → instanceId[] */
  partIndex: Map<string, Set<string>>;
}

// ── Construction ───────────────────────────────────────────────

export function createManager(): InstanceManagerState {
  return { instances: new Map(), partIndex: new Map() };
}

// ── Instance CRUD ──────────────────────────────────────────────

export function addInstance(state: InstanceManagerState, partNumber: string, options: { name?: string; parentAssemblyId?: string } = {}): PartInstance {
  // Find next available id for this part: PN-1, PN-2, ...
  const idx = state.partIndex.get(partNumber) ?? new Set();
  let counter = idx.size + 1;
  let instanceId = `${partNumber}-${counter}`;
  while (state.instances.has(instanceId)) {
    counter++;
    instanceId = `${partNumber}-${counter}`;
  }
  const instance: PartInstance = {
    instanceId,
    partNumber,
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.parentAssemblyId !== undefined ? { parentAssemblyId: options.parentAssemblyId } : {}),
  };
  state.instances.set(instanceId, instance);
  idx.add(instanceId);
  state.partIndex.set(partNumber, idx);
  return instance;
}

export function removeInstance(state: InstanceManagerState, instanceId: string): boolean {
  const inst = state.instances.get(instanceId);
  if (!inst) return false;
  state.instances.delete(instanceId);
  const idx = state.partIndex.get(inst.partNumber);
  if (idx) {
    idx.delete(instanceId);
    if (idx.size === 0) state.partIndex.delete(inst.partNumber);
  }
  return true;
}

export function renameInstance(state: InstanceManagerState, instanceId: string, newName: string): boolean {
  const inst = state.instances.get(instanceId);
  if (!inst) return false;
  inst.name = newName;
  return true;
}

// ── Queries ────────────────────────────────────────────────────

export function getInstancesOf(state: InstanceManagerState, partNumber: string): PartInstance[] {
  const ids = state.partIndex.get(partNumber);
  if (!ids) return [];
  return [...ids].map(id => state.instances.get(id)!);
}

export function whereUsed(state: InstanceManagerState, partNumber: string): string[] {
  const list = getInstancesOf(state, partNumber);
  const assemblies = new Set<string>();
  for (const inst of list) {
    if (inst.parentAssemblyId) assemblies.add(inst.parentAssemblyId);
  }
  return [...assemblies];
}

export function countByPart(state: InstanceManagerState): Map<string, number> {
  const out = new Map<string, number>();
  for (const [pn, ids] of state.partIndex) {
    out.set(pn, ids.size);
  }
  return out;
}

// ── Bulk operations ────────────────────────────────────────────

export function addInstances(state: InstanceManagerState, partNumber: string, count: number, options: { parentAssemblyId?: string } = {}): PartInstance[] {
  const out: PartInstance[] = [];
  for (let i = 0; i < count; i++) {
    out.push(addInstance(state, partNumber, options));
  }
  return out;
}

export function removeAllOfPart(state: InstanceManagerState, partNumber: string): number {
  const list = getInstancesOf(state, partNumber);
  for (const inst of list) removeInstance(state, inst.instanceId);
  return list.length;
}

// ── Summary ────────────────────────────────────────────────────

export interface ManagerSummary {
  totalInstances: number;
  uniqueParts: number;
  mostInstancedPart: string;
  averageInstancesPerPart: number;
}

export function summarize(state: InstanceManagerState): ManagerSummary {
  const counts = countByPart(state);
  let bestPart = '';
  let bestCount = 0;
  for (const [pn, n] of counts) {
    if (n > bestCount) { bestCount = n; bestPart = pn; }
  }
  const total = state.instances.size;
  const unique = state.partIndex.size;
  return {
    totalInstances: total,
    uniqueParts: unique,
    mostInstancedPart: bestPart,
    averageInstancesPerPart: unique > 0 ? total / unique : 0,
  };
}
