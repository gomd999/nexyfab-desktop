/**
 * toolpathSafety.ts — Pre-flight sanity checks on a CAM toolpath.
 *
 * The user picks a tool, draws a pocket, gets a toolpath. Before
 * shipping the G-code to a partner shop, NexyFab runs this check to
 * catch obvious failure modes the simulator would otherwise discover
 * at the spindle:
 *
 *   - depth-of-cut exceeds tool's rated maxDepthOfCutMm
 *   - feed-move Z descends below stock bottom (over-travel)
 *   - any vertex is outside the machine's work envelope
 *   - any rapid move passes below the safe Z clearance
 *
 * Verdicts are 'pass' / 'warn' / 'fail' — fail blocks order; warn
 * surfaces a confirmation prompt.
 */

import type { ToolpathSegment } from './pocketToolpath';
import type { ToolDefinition } from './toolLibrary';

export interface WorkEnvelope {
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  zMin: number; zMax: number;
}

export interface SafetyContext {
  tool: ToolDefinition;
  /** Machine work envelope in workpiece coordinates. */
  envelope: WorkEnvelope;
  /** Minimum Z for rapids — going below this risks collision. */
  safeZ: number;
  /** Bottom of stock (Z). Cut moves below this = over-travel. */
  stockBottomZ: number;
}

export type SafetyVerdict = 'pass' | 'warn' | 'fail';

export interface SafetyIssue {
  severity: SafetyVerdict;
  code: 'depth-exceeds-tool' | 'over-travel-z' | 'outside-envelope-x' | 'outside-envelope-y' | 'outside-envelope-z' | 'rapid-below-safe-z';
  message: string;
  /** First segment index that triggered the issue, when applicable. */
  segmentIndex?: number;
}

export interface SafetyReport {
  verdict: SafetyVerdict;
  issues: SafetyIssue[];
}

/** Run safety checks. Issue list is capped to the first occurrence of
 *  each code so a single error doesn't flood the report. */
export function checkToolpathSafety(
  segments: ToolpathSegment[],
  ctx: SafetyContext,
): SafetyReport {
  const issues: SafetyIssue[] = [];
  const seen = new Set<SafetyIssue['code']>();
  const flag = (issue: SafetyIssue): void => {
    if (seen.has(issue.code)) return;
    seen.add(issue.code);
    issues.push(issue);
  };

  // Compute max axial depth of cut from the feed/plunge segments.
  let maxCutZBelow = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.kind === 'rapid' && s.end[2] < ctx.safeZ) {
      flag({
        severity: 'fail', code: 'rapid-below-safe-z',
        message: `Rapid move ends at Z=${s.end[2].toFixed(2)}, below the safe-Z clearance ${ctx.safeZ.toFixed(2)}.`,
        segmentIndex: i,
      });
    }
    for (const p of [s.start, s.end]) {
      if (p[0] < ctx.envelope.xMin || p[0] > ctx.envelope.xMax) {
        flag({
          severity: 'fail', code: 'outside-envelope-x',
          message: `Point X=${p[0].toFixed(2)} outside machine envelope [${ctx.envelope.xMin}, ${ctx.envelope.xMax}].`,
          segmentIndex: i,
        });
      }
      if (p[1] < ctx.envelope.yMin || p[1] > ctx.envelope.yMax) {
        flag({
          severity: 'fail', code: 'outside-envelope-y',
          message: `Point Y=${p[1].toFixed(2)} outside machine envelope [${ctx.envelope.yMin}, ${ctx.envelope.yMax}].`,
          segmentIndex: i,
        });
      }
      if (p[2] < ctx.envelope.zMin || p[2] > ctx.envelope.zMax) {
        flag({
          severity: 'fail', code: 'outside-envelope-z',
          message: `Point Z=${p[2].toFixed(2)} outside machine envelope [${ctx.envelope.zMin}, ${ctx.envelope.zMax}].`,
          segmentIndex: i,
        });
      }
      if ((s.kind === 'feed' || s.kind === 'plunge') && p[2] < ctx.stockBottomZ - 1e-6) {
        flag({
          severity: 'fail', code: 'over-travel-z',
          message: `Cut move descends to Z=${p[2].toFixed(2)} below stock bottom ${ctx.stockBottomZ.toFixed(2)}.`,
          segmentIndex: i,
        });
      }
      // Track deepest cut for depth-of-cut warning.
      if ((s.kind === 'feed' || s.kind === 'plunge') && -p[2] > maxCutZBelow) {
        maxCutZBelow = -p[2];
      }
    }
  }

  // Depth-of-cut vs tool capability.
  if (maxCutZBelow > ctx.tool.maxDepthOfCutMm) {
    flag({
      severity: 'warn', code: 'depth-exceeds-tool',
      message: `Cut depth ${maxCutZBelow.toFixed(2)}mm exceeds tool max DOC ${ctx.tool.maxDepthOfCutMm}mm. Split into multiple passes or change tool.`,
    });
  }

  const verdict = issues.some(i => i.severity === 'fail') ? 'fail'
              : issues.some(i => i.severity === 'warn') ? 'warn'
              : 'pass';
  return { verdict, issues };
}
