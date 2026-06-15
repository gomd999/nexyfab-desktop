/**
 * bomGenerator.ts — Track N: Bill-of-materials auto-generator.
 *
 * Turns an agent session's modules + composition into a structured BOM:
 * one line per unique part with quantity, optional material, optional
 * unit + line cost. The user gets a CSV they can paste into a sheet
 * (for purchase-order workflows) and a human-readable summary the agent
 * surfaces back in the chat.
 *
 * Input contract (v1):
 *   - Preferred: caller passes `partsList` (parsed parts from the
 *     compose_assembly args). This is exact — every entry's count is
 *     honored verbatim and repeated moduleNames sum.
 *   - Fallback: when `partsList` is omitted we scan `session.composition`
 *     (a SCAD string) for `moduleName(...)` call sites and count them.
 *     The regex tolerates a `count: N` hint adjacent to a moduleName so
 *     simple assemblies that were composed via the agent emit the right
 *     totals without an explicit partsList.
 *
 * Cost wiring is optional (`costLookup`) — when present, each line gets
 * unitCostUsd + lineTotalUsd and the report's totalCostUsd is the sum.
 * Without a cost lookup the report carries `hasCosts: false` so the
 * caller / formatter can skip the cost column.
 *
 * Pure / additive — no mutation of the session, no async, no network.
 */

import type { AgentSession } from './types';
import type { Material } from './costEstimation';

export interface BomLine {
  /** Module name (the agent's per-part identifier). */
  partName: string;
  /** How many of this part the assembly uses. */
  quantity: number;
  /** Optional material assignment (user/agent-set). */
  material?: Material;
  /** Optional per-part cost in USD (when estimateCost data is provided). */
  unitCostUsd?: number;
  /** Optional total = unitCost × quantity. */
  lineTotalUsd?: number;
  /** Optional notes (e.g. "from BOSL2 catalog"). */
  notes?: string[];
}

export interface BomReport {
  lines: BomLine[];
  /** Sum of quantities across all lines. */
  totalPartCount: number;
  /** Distinct part count (lines.length). */
  uniquePartCount: number;
  /** Optional total cost in USD when costLookup was provided. */
  totalCostUsd?: number;
  /** True when at least one line has a unitCost — callers use this to
   *  decide whether to render the cost column. */
  hasCosts: boolean;
  /** Free-form notes (e.g. "composition empty — used module list directly"). */
  notes: string[];
}

export interface GenerateBomOptions {
  /** Session whose modules + composition feed the BOM. */
  session: Pick<AgentSession, 'modules' | 'composition'>;
  /**
   * Preferred: structured parts list (e.g. the same array the agent
   * passed to compose_assembly). When given, the count field per entry
   * is summed directly; this beats scanning the composition string for
   * accuracy on patterned arrays.
   */
  partsList?: Array<{ moduleName: string; count?: number }>;
  /** Optional per-part cost lookup. When provided, lineTotalUsd populates. */
  costLookup?: Record<string, { unitCostUsd: number; material?: Material }>;
}

/**
 * Count module calls in a SCAD composition string. v1 strategy:
 *   1. For each known moduleName, build a regex that matches a top-level
 *      call site: `\bNAME\s*\(`. We don't try to parse the SCAD AST —
 *      `compose_assembly` emits one statement per line so a substring
 *      count is accurate enough for the rendered output.
 *   2. Honor a `count: N` hint adjacent to the moduleName (within ~80
 *      chars after) so a compose_assembly array entry whose `count: 4`
 *      lives in a comment / adjacent literal contributes the right total
 *      when the composition was hand-written.
 *
 * Returns {} when composition is null/empty.
 */
function countFromCompositionString(
  composition: string | null,
  moduleNames: string[],
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!composition || !composition.trim() || moduleNames.length === 0) return result;
  for (const name of moduleNames) {
    // Escape any regex-meta chars in moduleName (defensive — write_module
    // already restricts to identifier chars but a hostile caller might
    // bypass that).
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match: `name(` as a callsite. \b ensures we don't match `foo_name(`.
    const callRe = new RegExp(`\\b${safe}\\s*\\(`, 'g');
    const callCount = (composition.match(callRe) || []).length;
    if (callCount === 0) continue;
    // Look for a `count: N` hint within 80 chars after each call site,
    // letting arrays declared in comments (e.g. `/* count: 4 */ bolt();`)
    // contribute. The match is permissive: `count: 4`, `count=4`,
    // `count : 4`, `× 4`, `x 4` all work.
    const countHintRe = new RegExp(`\\b${safe}\\s*\\([^\\n]{0,120}?(?:count\\s*[:=]\\s*(\\d{1,3})|[x×]\\s*(\\d{1,3}))`, 'gi');
    let hintTotal = 0;
    let m: RegExpExecArray | null;
    while ((m = countHintRe.exec(composition)) !== null) {
      const n = parseInt(m[1] ?? m[2] ?? '1', 10);
      if (Number.isFinite(n) && n > 0) hintTotal += n;
    }
    // If we saw hints, use the hint sum (each hint represents an entire
    // patterned call). Otherwise fall back to raw call-site count.
    result[name] = hintTotal > 0 ? hintTotal : callCount;
  }
  return result;
}

/**
 * Build a BOM from the session. Pure — no mutation. The output `lines`
 * are sorted by descending quantity so the dominant parts surface first.
 */
export function generateBom(opts: GenerateBomOptions): BomReport {
  const notes: string[] = [];
  if (!opts || !opts.session) {
    throw new Error('generateBom requires { session: { modules, composition } }');
  }
  const session = opts.session;
  const moduleNames = Object.keys(session.modules ?? {});

  // ─── Quantity aggregation ────────────────────────────────────────────
  // Build {moduleName -> count} from whichever input source we have.
  const counts: Record<string, number> = {};

  if (opts.partsList && Array.isArray(opts.partsList) && opts.partsList.length > 0) {
    for (const entry of opts.partsList) {
      if (!entry || typeof entry.moduleName !== 'string') continue;
      const q = Math.max(1, Math.round(entry.count ?? 1));
      counts[entry.moduleName] = (counts[entry.moduleName] ?? 0) + q;
    }
    notes.push(`built from explicit partsList (${opts.partsList.length} entries)`);
  } else if (moduleNames.length === 0) {
    // Empty session — return a clean empty report with a note.
    return {
      lines: [],
      totalPartCount: 0,
      uniquePartCount: 0,
      hasCosts: false,
      notes: ['session has no modules — no BOM to generate'],
    };
  } else {
    // Fallback: scan composition string for callsites + count hints.
    const fromString = countFromCompositionString(session.composition ?? null, moduleNames);
    Object.assign(counts, fromString);
    if (Object.keys(counts).length === 0) {
      // No composition — assume one of each module (single instance).
      for (const name of moduleNames) counts[name] = 1;
      notes.push('composition empty — assumed one of each module');
    } else {
      notes.push('built from composition string scan (no partsList provided)');
    }
  }

  // ─── Line emission ───────────────────────────────────────────────────
  const costLookup = opts.costLookup ?? {};
  let hasCosts = false;
  let totalCostUsd = 0;
  let totalPartCount = 0;

  const lines: BomLine[] = Object.entries(counts).map(([partName, quantity]) => {
    const line: BomLine = { partName, quantity };
    const cost = costLookup[partName];
    if (cost && typeof cost.unitCostUsd === 'number') {
      line.unitCostUsd = cost.unitCostUsd;
      line.lineTotalUsd = cost.unitCostUsd * quantity;
      totalCostUsd += line.lineTotalUsd;
      hasCosts = true;
      if (cost.material) line.material = cost.material;
    } else if (cost && cost.material) {
      // Material assigned but no cost — still record it.
      line.material = cost.material;
    }
    totalPartCount += quantity;
    return line;
  });

  // Sort descending by quantity so dominant parts surface first.
  lines.sort((a, b) => b.quantity - a.quantity);

  return {
    lines,
    totalPartCount,
    uniquePartCount: lines.length,
    totalCostUsd: hasCosts ? totalCostUsd : undefined,
    hasCosts,
    notes,
  };
}

/**
 * Escape a single CSV cell — wrap in quotes when it contains a comma,
 * a quote, or a newline; double up any embedded quotes per RFC 4180.
 */
function csvCell(v: string | number | undefined): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Render the report as CSV (RFC 4180). Columns: Part, Quantity, Material,
 * Cost (USD). Empty cells where the data is absent. Suitable for paste
 * into Excel / Google Sheets / Numbers.
 */
export function bomToCSV(report: BomReport): string {
  const rows: string[] = ['Part,Quantity,Material,Cost (USD)'];
  for (const line of report.lines) {
    const costCell = line.lineTotalUsd !== undefined
      ? line.lineTotalUsd.toFixed(2)
      : '';
    rows.push([
      csvCell(line.partName),
      csvCell(line.quantity),
      csvCell(line.material),
      csvCell(costCell),
    ].join(','));
  }
  return rows.join('\n');
}

/**
 * Human-readable summary the tool wrapper hands back to the agent. One
 * line per BOM entry with quantity + optional material + optional cost.
 * Skip the cost line when hasCosts=false so the output stays clean for
 * pre-cost BOMs.
 */
export function formatBomReport(report: BomReport): string {
  if (report.lines.length === 0) {
    return report.notes.length > 0
      ? `No BOM lines (${report.notes.join('; ')}).`
      : 'No BOM lines.';
  }
  const header = report.hasCosts && report.totalCostUsd !== undefined
    ? `BOM (${report.uniquePartCount} unique parts, ${report.totalPartCount} total, $${report.totalCostUsd.toFixed(2)}):`
    : `BOM (${report.uniquePartCount} unique parts, ${report.totalPartCount} total):`;
  const lines: string[] = [header];
  for (const line of report.lines) {
    const matTag = line.material ? ` [${line.material}]` : '';
    let costTag = '';
    if (line.unitCostUsd !== undefined && line.lineTotalUsd !== undefined) {
      costTag = line.quantity > 1
        ? ` (${line.quantity}×$${line.unitCostUsd.toFixed(2)} = $${line.lineTotalUsd.toFixed(2)})`
        : ` ($${line.unitCostUsd.toFixed(2)})`;
    }
    lines.push(`  - ${line.partName} × ${line.quantity}${matTag}${costTag}`);
  }
  if (report.notes.length > 0) {
    lines.push(`  (notes: ${report.notes.join('; ')})`);
  }
  return lines.join('\n');
}
