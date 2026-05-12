/**
 * Z6 — Engineering knowledge catalog (RAG-lite).
 *
 * The agent makes design decisions that depend on domain knowledge it
 * doesn't carry intrinsically: which steel grade for the load case,
 * which O-ring for the gland geometry, what surface treatment fits the
 * application. A real RAG over engineering handbooks would need vector
 * embeddings + a vector store; for V1 this module is a curated structured
 * catalog the agent can query with a topic + free-text query.
 *
 * This is keyword retrieval, not semantic — but it's deterministic,
 * cite-able, and zero infra cost. Embeddings can replace the matcher
 * later without changing the agent-facing tool surface.
 */

export interface CatalogEntry {
  /** Stable id within the topic. */
  id: string;
  /** Short human title. */
  title: string;
  /** Body — concise factual content the agent injects into context. */
  body: string;
  /** Keywords for keyword-match retrieval. */
  keywords: string[];
  /** Citation — standard/handbook reference. */
  source: string;
}

export type CatalogTopic = 'materials' | 'seals' | 'surface_treatments' | 'fits_tolerances' | 'fasteners_guidance';

const CATALOG: Record<CatalogTopic, CatalogEntry[]> = {
  materials: [
    {
      id: 'aluminum_6061_t6',
      title: 'Aluminum 6061-T6',
      body: 'Yield 276 MPa, ultimate 310 MPa, density 2.70 g/cm³, modulus 69 GPa. Excellent machinability, weldable (filler ER4043). Common for brackets, frames, marine. Anodize-friendly. Avoid for sustained 100°C+.',
      keywords: ['aluminum', '6061', 'al', 'frame', 'bracket', 'machinable', 'anodize'],
      source: 'ASM Handbook Vol.2; AA 6061 datasheet',
    },
    {
      id: 'steel_a36',
      title: 'Steel A36 (mild structural)',
      body: 'Yield 250 MPa, ultimate 400-550 MPa, density 7.85 g/cm³. Cheap, weldable (E7018), good for non-critical frames + brackets. Rusts — needs paint or galvanizing. Not for fatigue or high stress.',
      keywords: ['steel', 'a36', 'mild', 'structural', 'weld', 'cheap'],
      source: 'ASTM A36-19',
    },
    {
      id: 'steel_4140',
      title: 'Steel 4140 (Cr-Mo alloy)',
      body: 'Yield 415-655 MPa (annealed → Q&T), tough, fatigue-resistant. Common for shafts, gears, fasteners. Heat-treatable to 56 HRC. Welds with preheat (200°C).',
      keywords: ['steel', '4140', 'shaft', 'gear', 'fatigue', 'heat treat'],
      source: 'AISI 4140 / SAE J404',
    },
    {
      id: 'stainless_304',
      title: 'Stainless 304 (austenitic)',
      body: 'Yield 215 MPa, ultimate 505 MPa. Good corrosion in food/water. Non-magnetic. Galls — use anti-seize on threads. Welds well, no preheat. Avoid chloride environments.',
      keywords: ['stainless', '304', 'corrosion', 'food', 'austenitic'],
      source: 'AISI 304 / EN 1.4301',
    },
    {
      id: 'pla',
      title: 'PLA (FDM 3D printing)',
      body: 'Tensile 50 MPa, modulus 3.5 GPa, glass transition 60°C. Easy print, low warp, biodegradable. Brittle for snap-fits. NOT for outdoor sun, not for >50°C service. Glue: cyanoacrylate.',
      keywords: ['pla', '3d print', 'fdm', 'prototype', 'plastic'],
      source: 'NatureWorks Ingeo datasheet',
    },
    {
      id: 'abs',
      title: 'ABS (FDM 3D printing)',
      body: 'Tensile 40 MPa, glass transition 105°C. Tough, less brittle than PLA. Warps badly — needs heated bed + enclosure. Acetone-weldable. Good for snap-fits, light enclosures.',
      keywords: ['abs', '3d print', 'fdm', 'enclosure', 'snap fit'],
      source: 'BASF Ultra ABS datasheet',
    },
  ],

  seals: [
    {
      id: 'o_ring_as568',
      title: 'O-ring AS568 standard',
      body: 'AS568 O-rings come in dash sizes -001 to -474. Dash size encodes ID + cross-section. Common: -210 (Ø18.7×3.53), -222 (Ø37.7×3.53), -325 (Ø35×5.33). Compression: 15-30% radial, 10-25% axial. Material: NBR (oil), EPDM (water/steam), Viton (chemicals/heat).',
      keywords: ['o-ring', 'oring', 'gland', 'seal', 'as568', 'nbr', 'viton'],
      source: 'AS568D / Parker O-ring Handbook',
    },
    {
      id: 'lip_seal_iso6194',
      title: 'Rotary lip seal (ISO 6194)',
      body: 'For rotating shafts. Single lip up to 1500 rpm in oil; double lip with dust lip outdoors. Shaft surface 0.2-0.8 μm Ra, hardness ≥45 HRC. Standard sizes (D×d×w mm): 25×40×7, 30×50×8, 40×62×10, 50×72×10.',
      keywords: ['lip seal', 'rotary', 'shaft seal', 'iso 6194', 'oil seal'],
      source: 'ISO 6194-1; SKF general catalog',
    },
  ],

  surface_treatments: [
    {
      id: 'anodize_type_ii',
      title: 'Aluminum anodize Type II (sulfuric)',
      body: 'Coating 5-25 μm. Decorative + corrosion. Color via dye. Increases dimensional sizes by ~half coating thickness — design hole +0.025mm if anodized 25μm. Spec: MIL-A-8625 / AAMA 611.',
      keywords: ['anodize', 'aluminum', 'corrosion', 'finish', 'color'],
      source: 'MIL-A-8625F Type II',
    },
    {
      id: 'zinc_plate',
      title: 'Zinc electroplate (steel)',
      body: 'Coating 5-25 μm, sacrificial corrosion protection. Yellow chromate adds ~150h salt spray. Hydrogen embrittlement risk on hardened steel >32 HRC — bake 4h @ 200°C after plating. Spec: ASTM B633.',
      keywords: ['zinc', 'plate', 'galvanize', 'corrosion', 'steel'],
      source: 'ASTM B633-19',
    },
    {
      id: 'black_oxide',
      title: 'Black oxide (steel)',
      body: 'Conversion coating (Fe3O4) ~1 μm. Mild corrosion + decorative. Almost no dimensional change. Cheap, but inferior corrosion vs zinc — needs oil. Common on tooling, fasteners.',
      keywords: ['black oxide', 'steel', 'tooling', 'finish'],
      source: 'MIL-DTL-13924D',
    },
  ],

  fits_tolerances: [
    {
      id: 'iso_286_h7_g6',
      title: 'ISO 286 fits — H7/g6 (sliding)',
      body: 'Clearance fit. Hole H7 = +0/+0.025 (Ø10), shaft g6 = -0.005/-0.014. Max clearance 0.039 mm. Use for sliding shafts, bushings, light loads. For heavier loads: H7/h6 (transition) or H7/k6 (interference).',
      keywords: ['fit', 'h7', 'g6', 'iso 286', 'sliding', 'tolerance'],
      source: 'ISO 286-1:2010',
    },
    {
      id: 'iso_286_h7_p6',
      title: 'ISO 286 fits — H7/p6 (press)',
      body: 'Interference fit. For permanent shaft-bushing or bearing inner race assembly. Requires press or shrink fit (heat housing or cool shaft). Will not transmit large torque alone — pair with key.',
      keywords: ['fit', 'h7', 'p6', 'press', 'interference', 'iso 286', 'shrink'],
      source: 'ISO 286-1:2010',
    },
  ],

  fasteners_guidance: [
    {
      id: 'thread_engagement',
      title: 'Thread engagement length (general)',
      body: 'Min thread engagement = 1×D for steel-into-steel, 1.5-2×D for steel-into-aluminum, 2.5-3×D for plastic. Below this, threads strip before bolt yields. For tapped blind holes add 1-2 pitches of relief at the bottom.',
      keywords: ['thread', 'engagement', 'tap', 'bolt', 'strip'],
      source: 'Shigley Mechanical Engineering Design Ch.8',
    },
    {
      id: 'bolt_preload_torque',
      title: 'Bolt preload via torque (K-factor method)',
      body: 'T = K × D × F where T=torque (N·m), D=nominal diameter (m), F=preload (N). K=0.20 dry, 0.16 oiled, 0.13 lubed. Target preload = 75% proof load for reusable joints, 90% for permanent. Use angle-of-turn or stretch for critical joints.',
      keywords: ['bolt', 'torque', 'preload', 'tightening', 'k factor'],
      source: 'VDI 2230; Shigley Ch.8',
    },
  ],
};

export function listTopics(): CatalogTopic[] {
  return Object.keys(CATALOG) as CatalogTopic[];
}

export function listEntries(topic: CatalogTopic): CatalogEntry[] {
  return CATALOG[topic] ?? [];
}

/**
 * Keyword retrieval — case-insensitive token overlap. Returns the top-k
 * entries ranked by match score (number of overlapping query tokens).
 * Ties broken by entry order.
 */
export function queryCatalog(topic: CatalogTopic, query: string, k = 3): CatalogEntry[] {
  const entries = CATALOG[topic] ?? [];
  if (!query.trim()) return entries.slice(0, k);

  const queryTokens = query
    .toLowerCase()
    .split(/[\s,;.!?\-_/]+/)
    .filter(t => t.length >= 2);

  const scored = entries.map(e => {
    const corpus = (
      e.title + ' ' + e.body + ' ' + e.keywords.join(' ')
    ).toLowerCase();
    const score = queryTokens.reduce((acc, tok) => acc + (corpus.includes(tok) ? 1 : 0), 0);
    return { entry: e, score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(x => x.entry);
}
