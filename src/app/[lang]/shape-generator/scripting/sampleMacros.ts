/**
 * sampleMacros.ts — Starter macro library.
 *
 * Five common parametric scripts users can run unmodified or fork:
 *   1. M3-hole grid — 4x4 holes on a plate
 *   2. Bolt circle — N holes on a circle
 *   3. Stair / step bracket — 3 stepped extrudes
 *   4. Hex grid — honeycomb pattern of hexagons
 *   5. Bbox report — log dimensions of current model
 *
 * These also serve as docs by example for the Script API. Users
 * can read them in the editor before writing their own.
 */

export interface SampleMacro {
  id: string;
  name: string;
  description: string;
  source: string;
}

export const SAMPLE_MACROS: readonly SampleMacro[] = [
  {
    id: 'plate_4x4_holes',
    name: '4x4 M3 hole plate',
    description: '100×100 plate with a 4×4 grid of Ø3 mm holes',
    source: `// 4x4 plate of M3 holes
const PLATE = 100;
const SPACING = 20;
const D = 3;

nf.clearAll();
const plate = nf.addExtrude({
  profile: 'rect', width: PLATE, height: PLATE, depth: 5,
});
nf.log('Plate:', plate);

for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 4; j++) {
    const cx = -PLATE/2 + 20 + i * SPACING;
    const cy = -PLATE/2 + 20 + j * SPACING;
    const hole = nf.addFeature('hole', { diameter: D, depth: 5 });
    nf.log('Hole', i, j, '→', hole);
  }
}
return nf.getMeshStats();
`,
  },
  {
    id: 'bolt_circle',
    name: 'Bolt circle',
    description: 'N holes on a circle of given radius',
    source: `// Bolt circle pattern
const N = 6;
const PCD = 60;  // pitch circle diameter
const D = 4;

const base = nf.addExtrude({ profile: 'circle', radius: 40, depth: 8 });
nf.log('Base:', base);

for (let k = 0; k < N; k++) {
  const ang = (k / N) * 2 * Math.PI;
  const hole = nf.addFeature('hole', { diameter: D });
  // Position controls live on the feature; this is illustrative.
  nf.log('Hole', k, 'angle', (ang * 180 / Math.PI).toFixed(1), '°');
}
`,
  },
  {
    id: 'stepped_bracket',
    name: 'Stepped bracket',
    description: '3 stepped extrudes forming a stair shape',
    source: `// Stepped bracket
nf.clearAll();
for (let i = 0; i < 3; i++) {
  const id = nf.addExtrude({
    profile: 'rect',
    width: 40 - i * 10,
    height: 10,
    depth: 10,
    plane: 'xy',
  });
  nf.log('Step', i, id);
}
`,
  },
  {
    id: 'hex_grid',
    name: 'Hex grid (5×5)',
    description: 'Honeycomb arrangement of hexagonal extrudes',
    source: `// Hexagonal honeycomb
const COLS = 5, ROWS = 5;
const RADIUS = 10;
const PITCH = RADIUS * 2 * 0.866;

nf.clearAll();
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const id = nf.addExtrude({
      profile: 'polygon', radius: RADIUS, sides: 6,
      depth: 5,
    });
    nf.log('Hex', r, c, id);
  }
}
`,
  },
  {
    id: 'bbox_report',
    name: 'Bbox report',
    description: 'Log current model bounding box + mesh stats',
    source: `// Diagnostic only — no mutations
const bbox = nf.getBbox();
const stats = nf.getMeshStats();
nf.log('Bbox:', bbox);
nf.log('Mesh:', stats);
if (bbox && stats) {
  const w = bbox.max[0] - bbox.min[0];
  const h = bbox.max[1] - bbox.min[1];
  const d = bbox.max[2] - bbox.min[2];
  nf.log(\`Size: \${w.toFixed(1)} x \${h.toFixed(1)} x \${d.toFixed(1)} mm\`);
}
return { bbox, stats };
`,
  },
];

export function getSampleMacro(id: string): SampleMacro | null {
  return SAMPLE_MACROS.find(m => m.id === id) ?? null;
}
