/**
 * Stage 1 — derive the actual SCAD source we feed to OpenSCAD.
 *
 * Priority: composition (multi-module path) > scadSource (single-file).
 * The renderer wires this into both the `render` tool and the route that
 * surfaces the final source to the UI for "show in canvas".
 *
 * Kept as its own tiny module so `tools.ts` can call it without a cycle
 * back to `runScadAgent.ts` (which references the tool executor types).
 */
import type { AgentSession } from './types';

export function effectiveScadSource(session: Pick<AgentSession, 'scadSource' | 'modules' | 'composition'>): string {
  const moduleNames = Object.keys(session.modules);
  const hasComposition = !!session.composition && session.composition.trim().length > 0;
  if (!hasComposition && moduleNames.length === 0) {
    return session.scadSource;
  }
  const blocks: string[] = [];
  for (const name of moduleNames) {
    blocks.push(`// ── module: ${name} ──`);
    blocks.push(session.modules[name]);
    blocks.push('');
  }
  if (hasComposition) {
    blocks.push(`// ── composition ──`);
    blocks.push(session.composition!);
  } else {
    // No composition set yet — instantiate each module once at origin so
    // the user gets *some* preview while the agent is still working.
    blocks.push(`// ── auto preview (no composition set) ──`);
    for (const name of moduleNames) blocks.push(`${name}();`);
  }
  return blocks.join('\n');
}
