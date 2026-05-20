/**
 * bosl2Grounding.ts — curated reference of the verified BOSL2 vocabulary this
 * project uses for equipment / finished products.
 *
 * NOTE on intended use: NexyFab deliberately does NOT let the AI write raw
 * OpenSCAD (it emits whitelisted JSON intent → deterministic intentToScad →
 * SCAD, for ~0% syntax errors). So this is NOT wired as an "AI writes raw
 * BOSL2" grounding prompt — that would conflict with the reliability-first
 * design. The right lever for richer products is to EXPAND the deterministic
 * intentToScad vocabulary (its SUPPORTED_SHAPES/emit), and this file documents
 * the verified call patterns to grow from. (`buildBosl2GroundingPrompt` is
 * retained for a possible future raw-SCAD agent, but unused by the default,
 * deterministic pipeline.)
 *
 * ACCURACY: every signature is sourced from the patterns intentToScad already
 * emits + compiles against the Dockerfile BOSL2 install — verified, not
 * invented. All BOSL2 use requires `include <BOSL2/std.scad>` at the top.
 */

export const BOSL2_INCLUDE = 'include <BOSL2/std.scad>';

export interface Bosl2Entry {
  /** BOSL2 function name. */
  name: string;
  /** Canonical signature (verified pattern). */
  signature: string;
  /** What it makes. */
  summary: string;
  category: 'solid' | 'fastener' | 'gear' | 'profile' | 'sweep';
}

/** Verified BOSL2 calls (mirrors intentToScad's emit patterns). */
export const BOSL2_REFERENCE: Bosl2Entry[] = [
  {
    name: 'cuboid',
    signature: 'cuboid([w, h, d], rounding=r)   // also: chamfer=c, edges=...',
    summary: 'Box with rounded (or chamfered) edges — the workhorse for enclosures/bodies.',
    category: 'solid',
  },
  {
    name: 'spur_gear',
    signature: 'spur_gear(mod=m, teeth=n, thickness=t, pressure_angle=20, helical=0)',
    summary: 'Involute spur (or helical) gear. mod = module (mm/tooth).',
    category: 'gear',
  },
  {
    name: 'threaded_rod',
    signature: 'threaded_rod(d=dia, l=length, pitch=p)   // internal=true cuts a tapped hole',
    summary: 'ISO metric threaded rod; with internal=true it is a threaded bore to subtract.',
    category: 'fastener',
  },
  {
    name: 'screw',
    signature: 'screw("M8x1.25,30", length=L, head="hex")   // or socket/button/flat/none',
    summary: 'ISO standard screw with accurate threads + head; spec is "M<dia>x<pitch>,<len>".',
    category: 'fastener',
  },
  {
    name: 'rect',
    signature: 'rect([w, h], rounding=r)',
    summary: '2D rounded rectangle — feed to linear_extrude or path_sweep for profiles.',
    category: 'profile',
  },
  {
    name: 'path_sweep',
    signature: 'path_sweep(profile2d, path3d)   // e.g. path_sweep(rect([a,b],rounding=1), path3d(...))',
    summary: 'Sweep a 2D profile along a 3D path — blades, ribs, tubing, organic forms.',
    category: 'sweep',
  },
];

/**
 * Build the grounding snippet injected into the AI prompt. Keep it compact —
 * it primes the model on the available verified vocabulary + the mandatory
 * include header, without dumping the full (huge) BOSL2 API.
 */
export function buildBosl2GroundingPrompt(): string {
  const lines = [
    'You may use BOSL2 for parametric hardware. Always start with:',
    `  ${BOSL2_INCLUDE}`,
    'Prefer these verified BOSL2 calls over hand-built geometry:',
    ...BOSL2_REFERENCE.map(e => `  - ${e.signature}\n      ${e.summary}`),
    'For assemblies, BOSL2 parts are attachable: use attach()/position() with',
    'anchors (TOP, BOTTOM, LEFT, RIGHT, FWD, BACK, CENTER) to place children',
    'relative to a parent instead of manual translate/rotate.',
  ];
  return lines.join('\n');
}
