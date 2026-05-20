/**
 * fastenerTorqueSequencer.ts — Generate the torque-up sequence for a
 * bolt circle / bolt pattern, in passes of escalating torque.
 *
 * Industry standard practice (e.g., ASME PCC-1 for flanges, automotive
 * head bolts) is to torque in a *star* or *crisscross* sequence so the
 * gasket / mating face seats evenly. We support:
 *
 *   - circular  → standard 1-of-N star (skip-N/2)
 *   - linear    → outside-in for a row of bolts
 *   - rectangular → diagonal-first then perimeter
 *
 * Then a multi-pass schedule (e.g., 30%/60%/100% of target) is applied,
 * with a final check pass at 100%.
 */

export interface BoltPosition {
  id: string;
  position: { x: number; y: number };
}

export type SequencePattern = 'star-circular' | 'outside-in-linear' | 'diagonal-rectangular';

export interface TorqueSequencerInput {
  bolts: BoltPosition[];
  targetTorqueNm: number;
  pattern: SequencePattern;
  passFractions?: number[]; // default [0.3, 0.6, 1.0]
}

export interface TorquePass {
  passIndex: number; // 1-based
  fractionOfTarget: number;
  torqueNm: number;
  order: string[]; // bolt id sequence
}

export interface TorqueSequenceResult {
  passes: TorquePass[];
  finalCheckPass: TorquePass;
  patternUsed: SequencePattern;
  warnings: string[];
}

export function buildSequence(input: TorqueSequencerInput): TorqueSequenceResult {
  const warnings: string[] = [];
  if (input.bolts.length < 2) warnings.push('Pattern needs at least 2 bolts.');
  if (input.targetTorqueNm <= 0) warnings.push('Target torque must be positive.');

  const fractions = input.passFractions && input.passFractions.length > 0
    ? input.passFractions
    : [0.3, 0.6, 1.0];

  const order = computeOrder(input.bolts, input.pattern);
  const passes: TorquePass[] = fractions.map((frac, idx) => ({
    passIndex: idx + 1,
    fractionOfTarget: frac,
    torqueNm: input.targetTorqueNm * frac,
    order,
  }));

  const finalCheckPass: TorquePass = {
    passIndex: passes.length + 1,
    fractionOfTarget: 1.0,
    torqueNm: input.targetTorqueNm,
    order, // final check at full torque, same order
  };

  return { passes, finalCheckPass, patternUsed: input.pattern, warnings };
}

function computeOrder(bolts: BoltPosition[], pattern: SequencePattern): string[] {
  if (bolts.length === 0) return [];
  switch (pattern) {
    case 'star-circular':
      return starCircular(bolts);
    case 'outside-in-linear':
      return outsideInLinear(bolts);
    case 'diagonal-rectangular':
      return diagonalRectangular(bolts);
  }
}

/** Standard N-bolt star: skip N/2 each step, mod N. */
function starCircular(bolts: BoltPosition[]): string[] {
  const n = bolts.length;
  const cx = bolts.reduce((s, b) => s + b.position.x, 0) / n;
  const cy = bolts.reduce((s, b) => s + b.position.y, 0) / n;
  const sorted = [...bolts].sort((a, b) =>
    Math.atan2(a.position.y - cy, a.position.x - cx)
    - Math.atan2(b.position.y - cy, b.position.x - cx),
  );
  const order: string[] = [];
  const visited = new Set<number>();
  const skip = Math.max(1, Math.floor(n / 2));
  let i = 0;
  while (order.length < n) {
    if (!visited.has(i)) {
      order.push(sorted[i]!.id);
      visited.add(i);
    }
    i = (i + skip) % n;
    // safety: if cycle traps us, advance linearly
    if (visited.has(i) && order.length < n) {
      let next = (i + 1) % n;
      while (visited.has(next) && order.length < n) next = (next + 1) % n;
      i = next;
    }
  }
  return order;
}

function outsideInLinear(bolts: BoltPosition[]): string[] {
  const sorted = [...bolts].sort((a, b) => a.position.x - b.position.x);
  const order: string[] = [];
  let left = 0, right = sorted.length - 1;
  while (left <= right) {
    if (left === right) { order.push(sorted[left]!.id); break; }
    order.push(sorted[left]!.id);
    order.push(sorted[right]!.id);
    left++; right--;
  }
  return order;
}

function diagonalRectangular(bolts: BoltPosition[]): string[] {
  if (bolts.length < 4) return bolts.map(b => b.id);
  const cx = bolts.reduce((s, b) => s + b.position.x, 0) / bolts.length;
  const cy = bolts.reduce((s, b) => s + b.position.y, 0) / bolts.length;
  const sorted = [...bolts].sort((a, b) => {
    const da = Math.hypot(a.position.x - cx, a.position.y - cy);
    const db = Math.hypot(b.position.x - cx, b.position.y - cy);
    return db - da; // outermost first
  });
  return sorted.map(b => b.id);
}

export function checkBalance(result: TorqueSequenceResult, bolts: BoltPosition[]): { balanced: boolean; maxGapDeg: number } {
  if (bolts.length < 2 || result.passes.length === 0) return { balanced: false, maxGapDeg: 0 };
  const cx = bolts.reduce((s, b) => s + b.position.x, 0) / bolts.length;
  const cy = bolts.reduce((s, b) => s + b.position.y, 0) / bolts.length;
  const angles = result.passes[0]!.order.map(id => {
    const b = bolts.find(x => x.id === id)!;
    return Math.atan2(b.position.y - cy, b.position.x - cx);
  });
  // Sort the actual traversal angles to find largest gap.
  let maxGap = 0;
  for (let i = 1; i < angles.length; i++) {
    const a = angles[i - 1]!;
    const b = angles[i]!;
    let diff = Math.abs(b - a);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    maxGap = Math.max(maxGap, diff);
  }
  const maxGapDeg = maxGap * 180 / Math.PI;
  // Star pattern should *skip* across the diameter → individual gap ≈ 180°.
  // Balanced means no two consecutive steps are right next to each other.
  return { balanced: maxGapDeg > 60, maxGapDeg };
}

export function summarize(r: TorqueSequenceResult): { passes: number; bolts: number; pattern: SequencePattern } {
  return {
    passes: r.passes.length + 1, // include final check pass
    bolts: r.passes[0]?.order.length ?? 0,
    pattern: r.patternUsed,
  };
}
