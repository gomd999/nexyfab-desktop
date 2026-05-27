/**
 * assemblyDiffComparator.ts — Compare two assembly states and report
 * added / removed / moved bodies.
 *
 * When the user opens a previously-saved assembly, the application
 * sometimes needs to highlight what changed: which sub-parts were
 * added, which were deleted, which moved (translation + rotation),
 * which had property changes.
 *
 * Algorithm:
 *
 *   1. Match bodies by id.
 *   2. For matched pairs, compare position + rotation; flag as moved
 *      if delta exceeds threshold.
 *   3. Flag property changes (material / color / hidden flag).
 *   4. Unmatched-in-B → removed.
 *   5. Unmatched-in-A → added.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface BodyState {
  id: string;
  position: Vec3;
  /** Euler angles XYZ in radians. */
  rotation: Vec3;
  /** Material id / name. */
  material?: string;
  /** RGB color packed as 0xRRGGBB. */
  color?: number;
  /** Hidden state. */
  hidden?: boolean;
  /** Optional name. */
  name?: string;
}

export interface MovedDelta {
  id: string;
  deltaPosition: Vec3;
  deltaRotationRad: Vec3;
  /** Linear distance moved (mm). */
  translationMagnitude: number;
  /** Total rotation magnitude (radians). */
  rotationMagnitude: number;
}

export interface PropertyChange {
  id: string;
  field: 'material' | 'color' | 'hidden' | 'name';
  before: string | number | boolean | undefined;
  after: string | number | boolean | undefined;
}

export interface DiffResult {
  addedIds: string[];
  removedIds: string[];
  unchangedIds: string[];
  movedBodies: MovedDelta[];
  propertyChanges: PropertyChange[];
}

export interface DiffOptions {
  /** Position delta below which we consider it unchanged (mm). */
  positionToleranceMm: number;
  /** Rotation delta below which we consider it unchanged (radians). */
  rotationToleranceRad: number;
}

export const DEFAULT_OPTIONS: DiffOptions = {
  positionToleranceMm: 0.001,
  rotationToleranceRad: 0.001,
};

// ── Top-level entry ────────────────────────────────────────────

export function compareAssemblies(
  before: BodyState[],
  after: BodyState[],
  options: Partial<DiffOptions> = {},
): DiffResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const beforeMap = new Map<string, BodyState>();
  const afterMap = new Map<string, BodyState>();
  for (const b of before) beforeMap.set(b.id, b);
  for (const a of after) afterMap.set(a.id, a);

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  const moved: MovedDelta[] = [];
  const propChanges: PropertyChange[] = [];

  // Walk after for added + moved.
  for (const [id, aBody] of afterMap) {
    const bBody = beforeMap.get(id);
    if (!bBody) {
      added.push(id);
      continue;
    }
    const dPos: Vec3 = {
      x: aBody.position.x - bBody.position.x,
      y: aBody.position.y - bBody.position.y,
      z: aBody.position.z - bBody.position.z,
    };
    const dRot: Vec3 = {
      x: aBody.rotation.x - bBody.rotation.x,
      y: aBody.rotation.y - bBody.rotation.y,
      z: aBody.rotation.z - bBody.rotation.z,
    };
    const tMag = Math.hypot(dPos.x, dPos.y, dPos.z);
    const rMag = Math.hypot(dRot.x, dRot.y, dRot.z);

    if (tMag > opts.positionToleranceMm || rMag > opts.rotationToleranceRad) {
      moved.push({
        id, deltaPosition: dPos, deltaRotationRad: dRot,
        translationMagnitude: tMag, rotationMagnitude: rMag,
      });
    } else {
      unchanged.push(id);
    }
    // Property checks.
    if (bBody.material !== aBody.material) {
      propChanges.push({ id, field: 'material', before: bBody.material, after: aBody.material });
    }
    if (bBody.color !== aBody.color) {
      propChanges.push({ id, field: 'color', before: bBody.color, after: aBody.color });
    }
    if (bBody.hidden !== aBody.hidden) {
      propChanges.push({ id, field: 'hidden', before: bBody.hidden, after: aBody.hidden });
    }
    if (bBody.name !== aBody.name) {
      propChanges.push({ id, field: 'name', before: bBody.name, after: aBody.name });
    }
  }
  // Walk before for removed.
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) removed.push(id);
  }

  return { addedIds: added, removedIds: removed, unchangedIds: unchanged, movedBodies: moved, propertyChanges: propChanges };
}

// ── Severity classification ───────────────────────────────────

export type ChangeSeverity = 'none' | 'minor' | 'major' | 'breaking';

export function classifySeverity(result: DiffResult): ChangeSeverity {
  if (result.addedIds.length === 0 && result.removedIds.length === 0 && result.movedBodies.length === 0 && result.propertyChanges.length === 0) {
    return 'none';
  }
  if (result.removedIds.length > 0) return 'breaking';
  if (result.addedIds.length > 0 || result.movedBodies.length > 5) return 'major';
  return 'minor';
}

// ── Summary ────────────────────────────────────────────────────

export interface DiffSummary {
  addedCount: number;
  removedCount: number;
  movedCount: number;
  unchangedCount: number;
  propertyChangeCount: number;
  severity: ChangeSeverity;
  totalDisplacementMm: number;
}

export function summarize(result: DiffResult): DiffSummary {
  const total = result.movedBodies.reduce((s, m) => s + m.translationMagnitude, 0);
  return {
    addedCount: result.addedIds.length,
    removedCount: result.removedIds.length,
    movedCount: result.movedBodies.length,
    unchangedCount: result.unchangedIds.length,
    propertyChangeCount: result.propertyChanges.length,
    severity: classifySeverity(result),
    totalDisplacementMm: total,
  };
}
