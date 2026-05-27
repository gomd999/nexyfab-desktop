/**
 * cannedCycleLibrary.ts — Library of standard G-code canned cycles.
 *
 * G-code canned cycles compress repetitive operations (drilling,
 * boring, tapping) into single-line commands. Each control vendor
 * uses different syntax but ISO conventions share common codes:
 *
 *   G81 — straight drill cycle (no peck)
 *   G82 — drill with dwell at bottom
 *   G83 — peck drill (deep hole)
 *   G84 — tap (right-hand)
 *   G74 — tap (left-hand)
 *   G85 — bore (feed in / feed out)
 *   G86 — bore (feed in / rapid out, spindle stop)
 *   G87 — back bore
 *   G89 — bore with dwell at bottom
 *
 * The module:
 *   - Looks up a cycle definition by code or operation name.
 *   - Generates a parametric G-code block for that cycle.
 *   - Verifies that parameters are compatible (e.g., G83 needs Q peck).
 *   - Adapts output to a control dialect (Fanuc / Siemens / Heidenhain).
 */

export type CycleCode = 'G81' | 'G82' | 'G83' | 'G84' | 'G74' | 'G85' | 'G86' | 'G87' | 'G89';
export type Operation = 'drill' | 'spot-drill' | 'peck-drill' | 'tap-rh' | 'tap-lh' | 'bore' | 'bore-stop' | 'back-bore' | 'bore-dwell';
export type ControlDialect = 'fanuc' | 'siemens' | 'heidenhain' | 'haas';

export interface CycleDef {
  code: CycleCode;
  operation: Operation;
  description: string;
  /** Required parameters. */
  required: ('z' | 'r' | 'f' | 'q' | 'p')[];
  /** Optional parameters. */
  optional: ('q' | 'p' | 's')[];
}

export const CYCLE_LIBRARY: Record<CycleCode, CycleDef> = {
  G81: { code: 'G81', operation: 'drill', description: 'Drill (no peck)', required: ['z', 'r', 'f'], optional: [] },
  G82: { code: 'G82', operation: 'spot-drill', description: 'Spot drill with dwell', required: ['z', 'r', 'f', 'p'], optional: [] },
  G83: { code: 'G83', operation: 'peck-drill', description: 'Peck drill (deep hole)', required: ['z', 'r', 'f', 'q'], optional: [] },
  G84: { code: 'G84', operation: 'tap-rh', description: 'Right-hand tap', required: ['z', 'r', 'f'], optional: ['s'] },
  G74: { code: 'G74', operation: 'tap-lh', description: 'Left-hand tap', required: ['z', 'r', 'f'], optional: ['s'] },
  G85: { code: 'G85', operation: 'bore', description: 'Bore (feed-in / feed-out)', required: ['z', 'r', 'f'], optional: [] },
  G86: { code: 'G86', operation: 'bore-stop', description: 'Bore with rapid retract, spindle stop', required: ['z', 'r', 'f'], optional: [] },
  G87: { code: 'G87', operation: 'back-bore', description: 'Back bore', required: ['z', 'r', 'f'], optional: ['q'] },
  G89: { code: 'G89', operation: 'bore-dwell', description: 'Bore with dwell at bottom', required: ['z', 'r', 'f', 'p'], optional: [] },
};

export interface CycleParameters {
  /** Hole depth (absolute Z). */
  z?: number;
  /** Reference plane (rapid plane). */
  r?: number;
  /** Feed rate (mm/min). */
  f?: number;
  /** Peck depth (G83) or shift offset (G87). */
  q?: number;
  /** Dwell time in ms or s depending on dialect. */
  p?: number;
  /** Spindle override for tap. */
  s?: number;
}

export interface CycleBlock {
  code: CycleCode;
  /** Position list (X, Y) for hole pattern. */
  positions: { x: number; y: number }[];
  parameters: CycleParameters;
}

// ── Lookup ─────────────────────────────────────────────────────

export function lookupCycle(codeOrOp: string): CycleDef | undefined {
  const upperCode = codeOrOp.toUpperCase();
  if (upperCode in CYCLE_LIBRARY) return CYCLE_LIBRARY[upperCode as CycleCode];
  // Try by operation.
  for (const def of Object.values(CYCLE_LIBRARY)) {
    if (def.operation === codeOrOp.toLowerCase()) return def;
  }
  return undefined;
}

// ── Validation ─────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  missingParameters: string[];
  warnings: string[];
}

export function validateBlock(block: CycleBlock): ValidationResult {
  const def = CYCLE_LIBRARY[block.code];
  const missing: string[] = [];
  const warnings: string[] = [];
  for (const r of def.required) {
    if (block.parameters[r] === undefined) {
      missing.push(r.toUpperCase());
    }
  }
  if (block.parameters.z !== undefined && block.parameters.r !== undefined) {
    if (block.parameters.r <= block.parameters.z) {
      warnings.push(`R-plane (${block.parameters.r}) at or below Z target (${block.parameters.z}) — likely wrong sign convention.`);
    }
  }
  if (block.code === 'G83' && block.parameters.q !== undefined && block.parameters.q <= 0) {
    warnings.push('G83 peck depth Q must be positive.');
  }
  if (block.positions.length === 0) {
    warnings.push('Cycle has no positions — no holes will be made.');
  }
  return { ok: missing.length === 0, missingParameters: missing, warnings };
}

// ── G-code emission ───────────────────────────────────────────

export interface EmitOptions {
  dialect: ControlDialect;
  /** Modal: emit code once for all positions, vs explicit per-line. */
  modal: boolean;
  /** Optional G98/G99 retract specifier. */
  retract: 'g98' | 'g99';
}

export const DEFAULT_EMIT: EmitOptions = { dialect: 'fanuc', modal: true, retract: 'g98' };

export function emitGcode(block: CycleBlock, options: Partial<EmitOptions> = {}): string[] {
  const opts = { ...DEFAULT_EMIT, ...options };
  const lines: string[] = [];
  const p = block.parameters;

  if (opts.dialect === 'fanuc' || opts.dialect === 'haas') {
    // Standard ISO syntax.
    const retract = opts.retract.toUpperCase();
    const firstPos = block.positions[0];
    if (firstPos) {
      const paramStr = formatFanucParams(block.code, p);
      lines.push(`${retract} ${block.code} X${firstPos.x.toFixed(3)} Y${firstPos.y.toFixed(3)} ${paramStr}`.trim());
      if (opts.modal) {
        for (let i = 1; i < block.positions.length; i++) {
          const pos = block.positions[i]!;
          lines.push(`X${pos.x.toFixed(3)} Y${pos.y.toFixed(3)}`);
        }
      } else {
        for (let i = 1; i < block.positions.length; i++) {
          const pos = block.positions[i]!;
          lines.push(`${block.code} X${pos.x.toFixed(3)} Y${pos.y.toFixed(3)} ${paramStr}`.trim());
        }
      }
      lines.push('G80');
    }
  } else if (opts.dialect === 'siemens') {
    // CYCLE82 / CYCLE83 syntax.
    const cyName = block.code === 'G81' ? 'CYCLE81' : block.code === 'G82' ? 'CYCLE82' : block.code === 'G83' ? 'CYCLE83' : 'CYCLE85';
    for (const pos of block.positions) {
      const args = [p.r ?? 0, 0, 0, p.z ?? 0, 0];
      if (p.p !== undefined) args.push(p.p);
      lines.push(`G0 X${pos.x.toFixed(3)} Y${pos.y.toFixed(3)}`);
      lines.push(`${cyName}(${args.map(a => a.toFixed(3)).join(', ')})`);
    }
  } else if (opts.dialect === 'heidenhain') {
    // CYCL DEF 200 syntax.
    lines.push(`CYCL DEF 200 DRILLING`);
    lines.push(`  Q200=2 ; SET-UP CLEARANCE`);
    if (p.z !== undefined) lines.push(`  Q201=${(-Math.abs(p.z)).toFixed(3)} ; DEPTH`);
    if (p.f !== undefined) lines.push(`  Q206=${p.f.toFixed(3)} ; FEED RATE FOR PLNGNG`);
    if (block.code === 'G83' && p.q !== undefined) lines.push(`  Q202=${p.q.toFixed(3)} ; PLUNGING DEPTH`);
    for (const pos of block.positions) {
      lines.push(`L X${pos.x.toFixed(3)} Y${pos.y.toFixed(3)} R0 FMAX M99`);
    }
  }
  return lines;
}

function formatFanucParams(code: CycleCode, p: CycleParameters): string {
  const parts: string[] = [];
  if (p.z !== undefined) parts.push(`Z${p.z.toFixed(3)}`);
  if (p.r !== undefined) parts.push(`R${p.r.toFixed(3)}`);
  if (p.q !== undefined && (code === 'G83' || code === 'G87')) parts.push(`Q${p.q.toFixed(3)}`);
  if (p.p !== undefined && (code === 'G82' || code === 'G89')) parts.push(`P${Math.round(p.p)}`);
  if (p.f !== undefined) parts.push(`F${p.f.toFixed(1)}`);
  return parts.join(' ');
}

// ── Cycle time estimate ───────────────────────────────────────

export function estimateCycleTimeSec(block: CycleBlock): number {
  const p = block.parameters;
  if (p.z === undefined || p.r === undefined || p.f === undefined || p.f <= 0) return 0;
  const depth = Math.abs(p.r - p.z);
  const feedTimePerHoleMin = depth / p.f;
  const rapidTimePerHoleMin = 0.05; // ~3 sec rapid + position move (rough)
  let dwellSec = 0;
  if (p.p !== undefined && (block.code === 'G82' || block.code === 'G89')) {
    dwellSec = p.p / 1000;
  }
  // G83 pecks add overhead — model as 1 extra second per Q peck.
  let peckOverheadSec = 0;
  if (block.code === 'G83' && p.q !== undefined && p.q > 0) {
    const pecks = Math.ceil(depth / p.q);
    peckOverheadSec = pecks * 0.5;
  }
  const perHoleSec = feedTimePerHoleMin * 60 + rapidTimePerHoleMin * 60 + dwellSec + peckOverheadSec;
  return perHoleSec * block.positions.length;
}

// ── Summary ────────────────────────────────────────────────────

export interface CycleSummary {
  code: CycleCode;
  operation: Operation;
  holeCount: number;
  estimatedTimeSec: number;
  validationOk: boolean;
}

export function summarize(block: CycleBlock): CycleSummary {
  const def = CYCLE_LIBRARY[block.code];
  const v = validateBlock(block);
  return {
    code: block.code,
    operation: def.operation,
    holeCount: block.positions.length,
    estimatedTimeSec: estimateCycleTimeSec(block),
    validationOk: v.ok,
  };
}
