/**
 * toolStandOffDetector.ts — Detect tool stand-off (overhang beyond
 * the toolholder) issues that risk deflection or chatter.
 *
 * For each tool, the stand-off length L_stick (distance from the
 * shank-collet interface to the bottom of the cutting flute) drives
 * stiffness:
 *
 *   stiffness k ∝ E·I / L³
 *   deflection δ = F · L³ / (3·E·I)
 *
 * Rules of thumb:
 *
 *   L/D ≤ 3: rigid (preferred).
 *   L/D 3-6: acceptable; reduce feed by 15-30%.
 *   L/D 6-10: high risk; use slender tool feeds.
 *   L/D > 10: redesign (smaller tool, longer holder).
 *
 * Module:
 *   - Per-tool stand-off measurement.
 *   - Estimated max deflection for given side force.
 *   - Recommends feed override + axial DOC clamp.
 */

export interface ToolUsage {
  id: string;
  toolDiameterMm: number;
  /** Length sticking out of collet (mm). */
  stickoutMm: number;
  /** Young's modulus (MPa). Carbide ~600e3; HSS ~210e3. */
  youngMpa: number;
  /** Max applied side force during cut (N). */
  sideForceN: number;
}

export interface StandOffOptions {
  /** L/D ratio above which feed-override required. */
  acceptableRatio: number;
  /** L/D ratio above which redesign recommended. */
  redesignRatio: number;
  /** Maximum allowable deflection (mm). */
  maxDeflectionMm: number;
}

export const DEFAULT_OPTIONS: StandOffOptions = {
  acceptableRatio: 3,
  redesignRatio: 10,
  maxDeflectionMm: 0.05,
};

export type Severity = 'ok' | 'reduce-feed' | 'slender-feed' | 'redesign';

export interface StandOffResult {
  toolId: string;
  lDRatio: number;
  /** Beam stiffness coefficient (N/mm). */
  stiffnessNPerMm: number;
  /** Predicted deflection (mm). */
  deflectionMm: number;
  severity: Severity;
  /** Recommended feed override factor (1.0 = no change). */
  feedOverride: number;
  /** Maximum advised axial depth of cut. */
  maxDocMm: number;
  notes: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function detectStandOff(tools: ToolUsage[], options: Partial<StandOffOptions> = {}): StandOffResult[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return tools.map(t => analyzeOne(t, opts));
}

function analyzeOne(tool: ToolUsage, opts: StandOffOptions): StandOffResult {
  const notes: string[] = [];
  if (tool.toolDiameterMm <= 0) {
    return {
      toolId: tool.id,
      lDRatio: Infinity, stiffnessNPerMm: 0, deflectionMm: Infinity,
      severity: 'redesign', feedOverride: 0.1, maxDocMm: 0,
      notes: ['Invalid tool diameter.'],
    };
  }
  const lD = tool.stickoutMm / tool.toolDiameterMm;
  const R = tool.toolDiameterMm / 2;
  const I = (Math.PI * R ** 4) / 4;
  const L = Math.max(0.001, tool.stickoutMm);
  const stiffness = (3 * tool.youngMpa * I) / Math.pow(L, 3);
  const deflection = tool.sideForceN / Math.max(0.001, stiffness);

  let severity: Severity;
  let feedOverride: number;
  let maxDoc: number;
  if (lD <= opts.acceptableRatio) {
    severity = 'ok';
    feedOverride = 1;
    maxDoc = tool.toolDiameterMm;
  } else if (lD <= 6) {
    severity = 'reduce-feed';
    feedOverride = 0.7;
    maxDoc = tool.toolDiameterMm * 0.7;
    notes.push('L/D 3-6: reduce feed by ~30%.');
  } else if (lD <= opts.redesignRatio) {
    severity = 'slender-feed';
    feedOverride = 0.4;
    maxDoc = tool.toolDiameterMm * 0.4;
    notes.push('L/D 6-10: slender-feed regime; reduce DOC and feed.');
  } else {
    severity = 'redesign';
    feedOverride = 0.2;
    maxDoc = tool.toolDiameterMm * 0.25;
    notes.push('L/D > 10: redesign (smaller tool / longer holder).');
  }
  if (deflection > opts.maxDeflectionMm) {
    notes.push(`Predicted deflection ${deflection.toFixed(3)} mm exceeds ${opts.maxDeflectionMm} mm allowed.`);
    if (severity === 'ok') severity = 'reduce-feed';
    feedOverride = Math.min(feedOverride, 0.5);
  }
  return {
    toolId: tool.id,
    lDRatio: lD,
    stiffnessNPerMm: stiffness,
    deflectionMm: deflection,
    severity,
    feedOverride,
    maxDocMm: maxDoc,
    notes,
  };
}

// ── Recommended stickout for target deflection ───────────────

export function recommendStickout(tool: ToolUsage, targetDeflectionMm: number): number {
  if (targetDeflectionMm <= 0) return 0;
  const R = tool.toolDiameterMm / 2;
  const I = (Math.PI * R ** 4) / 4;
  // δ = F·L³ / (3·E·I) → L = (3·E·I·δ / F)^(1/3)
  return Math.pow((3 * tool.youngMpa * I * targetDeflectionMm) / Math.max(0.001, tool.sideForceN), 1 / 3);
}

// ── Aggregate fleet ──────────────────────────────────────────

export interface FleetReport {
  worstToolId: string | null;
  worstLD: number;
  averageLD: number;
  redesignCount: number;
}

export function aggregateFleet(results: StandOffResult[]): FleetReport {
  let worstLD = 0;
  let worstId: string | null = null;
  let totalLD = 0;
  let redesign = 0;
  for (const r of results) {
    if (r.lDRatio > worstLD) {
      worstLD = r.lDRatio;
      worstId = r.toolId;
    }
    totalLD += r.lDRatio;
    if (r.severity === 'redesign') redesign++;
  }
  return {
    worstToolId: worstId,
    worstLD,
    averageLD: results.length === 0 ? 0 : totalLD / results.length,
    redesignCount: redesign,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface StandOffSummary {
  toolCount: number;
  worstLD: number;
  okCount: number;
  redesignCount: number;
}

export function summarize(results: StandOffResult[]): StandOffSummary {
  const okCount = results.filter(r => r.severity === 'ok').length;
  const redo = results.filter(r => r.severity === 'redesign').length;
  let worst = 0;
  for (const r of results) if (r.lDRatio > worst) worst = r.lDRatio;
  return {
    toolCount: results.length,
    worstLD: worst,
    okCount,
    redesignCount: redo,
  };
}
