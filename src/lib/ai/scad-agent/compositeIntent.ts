/**
 * compositeIntent — express a non-whitelisted shape as a boolean composition
 * of whitelisted primitives (W1 of ADR-015). Each part is an existing
 * IntentInput (rendered by intentToScad) combined with add/subtract/intersect
 * and an optional translation, producing:
 *   - deterministic SCAD (union of adds, minus subtracts, ∩ intersects),
 *   - a computable expected bbox (union of placed add-part bboxes),
 * so the existing closed-loop spec verifier still gates correctness.
 *
 * Additive + pure: the primitive whitelist and intentToScad are untouched;
 * the agent only falls back to composition when no single primitive fits.
 */

import type { IntentInput } from '../../openscad-render/intentToScad';
import { intentToScad } from '../../openscad-render/intentToScad';
import { expectedBboxFromIntent, type ExpectedBbox } from './specVerification';

export type CompositeOp = 'add' | 'subtract' | 'intersect';

export interface CompositePart {
  intent: IntentInput;
  /** Combine mode; the first part must be (or defaults to) 'add'. */
  op?: CompositeOp;
  /** World translation applied to this part (mm). */
  at?: [number, number, number];
}

export type CompositeScadResult =
  | { ok: true; scad: string; warnings: string[] }
  | { ok: false; reason: string };

function num(n: number): string {
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}

function place(scad: string, at?: [number, number, number]): string {
  if (!at || (at[0] === 0 && at[1] === 0 && at[2] === 0)) return scad;
  return `translate([${num(at[0])}, ${num(at[1])}, ${num(at[2])}]) { ${scad} }`;
}

/**
 * Render a composite to OpenSCAD. Structure:
 *   intersection() { difference() { union(){ adds } subtracts } intersects }
 * Empty groups are omitted. Fails if any part fails to render or there is no
 * add part to anchor the body.
 */
export function compositeIntentToScad(parts: ReadonlyArray<CompositePart>): CompositeScadResult {
  if (parts.length === 0) return { ok: false, reason: 'composite needs at least one part' };

  const adds: string[] = [];
  const subtracts: string[] = [];
  const intersects: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const op: CompositeOp = part.op ?? 'add';
    const r = intentToScad(part.intent);
    if (!r.ok) return { ok: false, reason: `part ${i} (${String(part.intent?.shapeId)}): ${r.reason}` };
    if (r.warnings.length > 0) warnings.push(...r.warnings.map((w) => `part ${i}: ${w}`));
    const block = place(r.scad, part.at);
    if (op === 'subtract') subtracts.push(block);
    else if (op === 'intersect') intersects.push(block);
    else adds.push(block);
  }

  if (adds.length === 0) return { ok: false, reason: 'composite has no add part to anchor the body' };

  const indent = (s: string): string => s.split('\n').map((l) => `  ${l}`).join('\n');
  let body = adds.length === 1 ? adds[0] : `union() {\n${adds.map(indent).join('\n')}\n}`;
  if (subtracts.length > 0) {
    body = `difference() {\n${indent(body)}\n${subtracts.map(indent).join('\n')}\n}`;
  }
  if (intersects.length > 0) {
    body = `intersection() {\n${indent(body)}\n${intersects.map(indent).join('\n')}\n}`;
  }
  return { ok: true, scad: body, warnings };
}

/**
 * Expected bbox of a composite = union of the placed ADD parts' bboxes
 * (subtract / intersect never grow the envelope; this is conservative — it
 * never under-estimates, so verifier culling stays correct). Returns null if
 * any add part's bbox is unknown.
 */
export function compositeExpectedBbox(parts: ReadonlyArray<CompositePart>): ExpectedBbox | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let any = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const op: CompositeOp = part.op ?? 'add';
    if (op !== 'add') continue;
    const bb = expectedBboxFromIntent(part.intent);
    if (!bb) return null; // unknown add part → can't bound
    const [tx, ty, tz] = part.at ?? [0, 0, 0];
    // expectedBbox is centred at origin → half-extents are wMm/2 etc.
    minX = Math.min(minX, tx - bb.wMm / 2); maxX = Math.max(maxX, tx + bb.wMm / 2);
    minY = Math.min(minY, ty - bb.hMm / 2); maxY = Math.max(maxY, ty + bb.hMm / 2);
    minZ = Math.min(minZ, tz - bb.dMm / 2); maxZ = Math.max(maxZ, tz + bb.dMm / 2);
    any = true;
  }
  if (!any) return null;
  return { centered: false, wMm: maxX - minX, hMm: maxY - minY, dMm: maxZ - minZ };
}
