/**
 * contactBondingSelector.ts — Pick the appropriate FEA contact /
 * bonding type for a pair of bodies.
 *
 * Contact types (Abaqus / Ansys convention):
 *
 *   - bonded: surfaces glued. No slip, no separation.
 *   - tied: bonded but with optional offset.
 *   - rough: no slip but separation allowed.
 *   - no-separation: separation prevented but slip allowed.
 *   - frictionless: slip + separation OK.
 *   - friction: slip with Coulomb friction.
 *
 * Decision rules:
 *
 *   - Permanent assembly (weld / glue / press fit): bonded
 *   - Bolted joint with preload: bonded across washer, friction
 *     at thread
 *   - Sliding interface: friction
 *   - Hinge / rotating contact: friction or rough
 *   - Heat-shrink: no-separation
 *
 * Module classifies the pair + emits the contact definition.
 */

export type ContactType = 'bonded' | 'tied' | 'rough' | 'no-separation' | 'frictionless' | 'friction';

export type JointKind = 'weld' | 'glue' | 'press-fit' | 'shrink-fit' | 'bolted' | 'sliding' | 'hinge' | 'frictionless';

export interface ContactPairInput {
  id: string;
  /** Joint kind classifies geometric setup. */
  joint: JointKind;
  /** Whether large deformation expected. */
  largeDeformation: boolean;
  /** Static friction coefficient (used for friction type). */
  frictionCoefficient: number;
  /** Whether thermal loading present. */
  thermal: boolean;
}

export interface ContactRecommendation {
  pairId: string;
  type: ContactType;
  frictionCoefficient?: number;
  /** Whether tangential stiffness must be specified. */
  needsTangentialK: boolean;
  /** Whether self-contact (closed loop) applies. */
  selfContact: boolean;
  /** Rationale. */
  rationale: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function selectContact(pair: ContactPairInput): ContactRecommendation {
  const rec = byJoint(pair);
  rec.selfContact = false;
  // Adjust for large deformation / thermal expansion.
  if (pair.thermal && rec.type === 'bonded') {
    rec.type = 'tied';
    rec.rationale += ' Thermal load → switch to tied to allow offset growth.';
  }
  if (pair.largeDeformation && rec.type === 'bonded') {
    rec.type = 'tied';
    rec.rationale += ' Large deformation → tied (allows offset variation).';
  }
  return rec;
}

function byJoint(pair: ContactPairInput): ContactRecommendation {
  switch (pair.joint) {
    case 'weld':
      return { pairId: pair.id, type: 'bonded', needsTangentialK: false, selfContact: false, rationale: 'Welded joint → bonded contact.' };
    case 'glue':
      return { pairId: pair.id, type: 'bonded', needsTangentialK: false, selfContact: false, rationale: 'Glued joint → bonded contact.' };
    case 'press-fit':
      return { pairId: pair.id, type: 'no-separation', needsTangentialK: true, selfContact: false, rationale: 'Press-fit → no-separation (interference holds).' };
    case 'shrink-fit':
      return { pairId: pair.id, type: 'no-separation', needsTangentialK: true, selfContact: false, rationale: 'Shrink-fit → no-separation.' };
    case 'bolted':
      return {
        pairId: pair.id, type: 'friction', frictionCoefficient: pair.frictionCoefficient,
        needsTangentialK: true, selfContact: false,
        rationale: 'Bolted joint → friction contact at faying surface with preload.',
      };
    case 'sliding':
      return {
        pairId: pair.id, type: 'friction', frictionCoefficient: pair.frictionCoefficient,
        needsTangentialK: true, selfContact: false,
        rationale: 'Sliding interface → friction contact.',
      };
    case 'hinge':
      return {
        pairId: pair.id, type: 'friction', frictionCoefficient: pair.frictionCoefficient,
        needsTangentialK: true, selfContact: false,
        rationale: 'Hinge → friction contact (allow rotation).',
      };
    case 'frictionless':
      return { pairId: pair.id, type: 'frictionless', needsTangentialK: false, selfContact: false, rationale: 'Frictionless override.' };
  }
}

// ── Batch ─────────────────────────────────────────────────────

export function selectMultiple(pairs: ContactPairInput[]): ContactRecommendation[] {
  return pairs.map(selectContact);
}

// ── Emit Abaqus contact definition (text fragment) ────────────

export function emitAbaqusDefinition(rec: ContactRecommendation): string[] {
  const lines: string[] = [];
  lines.push(`*Contact Pair, interaction=${rec.type.toUpperCase()}_${rec.pairId}`);
  switch (rec.type) {
    case 'bonded':
    case 'tied':
      lines.push(`*Tie, name=TIE-${rec.pairId}`);
      break;
    case 'frictionless':
      lines.push(`*Surface Interaction, name=INT-${rec.pairId}`);
      break;
    case 'friction':
      lines.push(`*Surface Interaction, name=INT-${rec.pairId}`);
      lines.push(`*Friction`);
      lines.push(`${rec.frictionCoefficient ?? 0.2}`);
      break;
    case 'no-separation':
      lines.push(`*Surface Interaction, name=INT-${rec.pairId}`);
      lines.push(`*Cohesive Behavior`);
      break;
    case 'rough':
      lines.push(`*Surface Interaction, name=INT-${rec.pairId}`);
      lines.push(`*Friction, rough`);
      break;
  }
  return lines;
}

// ── Tangential stiffness recommendation ───────────────────────

export function recommendTangentialStiffness(rec: ContactRecommendation, normalKnPerMm: number): number {
  if (!rec.needsTangentialK) return 0;
  // Rule of thumb: K_t = K_n / (2(1+ν)) ≈ 0.4·K_n for ν = 0.3.
  return normalKnPerMm * 0.4;
}

// ── Summary ────────────────────────────────────────────────────

export interface SelectorSummary {
  pairCount: number;
  byType: Record<ContactType, number>;
  needsTangentialKCount: number;
}

export function summarize(results: ContactRecommendation[]): SelectorSummary {
  const byType: Record<ContactType, number> = {
    bonded: 0, tied: 0, rough: 0, 'no-separation': 0, frictionless: 0, friction: 0,
  };
  let needsTK = 0;
  for (const r of results) {
    byType[r.type]++;
    if (r.needsTangentialK) needsTK++;
  }
  return {
    pairCount: results.length,
    byType,
    needsTangentialKCount: needsTK,
  };
}
