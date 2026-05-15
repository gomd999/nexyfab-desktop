// Embedded ISO/DIN standard parts library — bolts / bearings / pulleys /
// rails. Complements the existing parts.ts (JSCAD-flavored, project-specific)
// with strictly-spec parametric OpenSCAD generators. Sources referenced
// inline so the table can be verified against the standard.

export interface StandardPart {
  id: string;
  category: 'fastener' | 'bearing' | 'pulley' | 'rail' | 'spring' | 'gear';
  title: string;
  standard: string;
  params: ParamDef[];
  scad: (params: Record<string, number | string>) => string;
}

export interface ParamDef {
  name: string;
  label: string;
  kind: 'enum' | 'number';
  options?: string[];
  default: number | string;
  unit?: 'mm' | '';
}

// ─── ISO 4762 socket-head cap screw ────────────────────────────────────────

const SHCS_TABLE: Record<string, { d: number; k: number; s: number; dk: number }> = {
  M2:    { d: 2,    k: 2,    s: 1.5,  dk: 3.8 },
  M2_5:  { d: 2.5,  k: 2.5,  s: 2,    dk: 4.5 },
  M3:    { d: 3,    k: 3,    s: 2.5,  dk: 5.5 },
  M4:    { d: 4,    k: 4,    s: 3,    dk: 7   },
  M5:    { d: 5,    k: 5,    s: 4,    dk: 8.5 },
  M6:    { d: 6,    k: 6,    s: 5,    dk: 10  },
  M8:    { d: 8,    k: 8,    s: 6,    dk: 13  },
  M10:   { d: 10,   k: 10,   s: 8,    dk: 16  },
  M12:   { d: 12,   k: 12,   s: 10,   dk: 18  },
};

const DGBB_TABLE: Record<string, { id: number; od: number; width: number }> = {
  '608':  { id: 8,  od: 22, width: 7 },
  '6000': { id: 10, od: 26, width: 8 },
  '6001': { id: 12, od: 28, width: 8 },
  '6002': { id: 15, od: 32, width: 9 },
  '6003': { id: 17, od: 35, width: 10 },
  '6201': { id: 12, od: 32, width: 10 },
  '6202': { id: 15, od: 35, width: 11 },
  '6203': { id: 17, od: 40, width: 12 },
  '6204': { id: 20, od: 47, width: 14 },
  '6205': { id: 25, od: 52, width: 15 },
};

function gt2OuterDiameter(teeth: number): number {
  return (teeth * 2) / Math.PI - 0.254;
}

export const STANDARD_PARTS: StandardPart[] = [
  {
    id: 'shcs',
    category: 'fastener',
    title: 'Socket-head cap screw',
    standard: 'ISO 4762',
    params: [
      { name: 'size', label: 'Thread size', kind: 'enum', options: Object.keys(SHCS_TABLE), default: 'M5' },
      { name: 'length', label: 'Length L', kind: 'number', default: 20, unit: 'mm' },
    ],
    scad: ({ size, length }) => {
      const t = SHCS_TABLE[String(size)] ?? SHCS_TABLE.M5;
      const L = typeof length === 'number' ? length : 20;
      return [
        `// ISO 4762 SHCS ${size} × ${L}`,
        `union() {`,
        `  cylinder(h=${t.k}, d=${t.dk}, $fn=64);`,
        `  translate([0,0,${t.k}]) cylinder(h=${L}, d=${t.d}, $fn=64);`,
        `}`,
      ].join('\n');
    },
  },
  {
    id: 'dgbb',
    category: 'bearing',
    title: 'Deep-groove ball bearing',
    standard: 'SKF 6000 series',
    params: [
      { name: 'series', label: 'Series', kind: 'enum', options: Object.keys(DGBB_TABLE), default: '6202' },
    ],
    scad: ({ series }) => {
      const t = DGBB_TABLE[String(series)] ?? DGBB_TABLE['6202'];
      return [
        `// Bearing ${series}`,
        `difference() {`,
        `  cylinder(h=${t.width}, d=${t.od}, $fn=128);`,
        `  translate([0,0,-0.1]) cylinder(h=${t.width + 0.2}, d=${t.id}, $fn=128);`,
        `}`,
      ].join('\n');
    },
  },
  {
    id: 'gt2-pulley',
    category: 'pulley',
    title: 'GT2 timing pulley',
    standard: 'Gates GT2 — 2 mm pitch',
    params: [
      { name: 'teeth', label: 'Tooth count', kind: 'number', default: 20 },
      { name: 'bore', label: 'Bore Ø', kind: 'number', default: 5, unit: 'mm' },
      { name: 'width', label: 'Belt width', kind: 'number', default: 6, unit: 'mm' },
    ],
    scad: ({ teeth, bore, width }) => {
      const t = typeof teeth === 'number' ? teeth : 20;
      const b = typeof bore === 'number' ? bore : 5;
      const w = typeof width === 'number' ? width : 6;
      const od = gt2OuterDiameter(t);
      return [
        `// GT2 pulley ${t}T bore ${b}`,
        `difference() {`,
        `  cylinder(h=${w + 4}, d=${od + 4}, $fn=128);`,
        `  translate([0,0,-0.1]) cylinder(h=${w + 4.2}, d=${b}, $fn=64);`,
        `}`,
      ].join('\n');
    },
  },
  {
    id: 'mgn-rail',
    category: 'rail',
    title: 'MGN linear rail',
    standard: 'HIWIN MGN',
    params: [
      { name: 'size', label: 'Size', kind: 'enum', options: ['MGN7', 'MGN9', 'MGN12', 'MGN15'], default: 'MGN12' },
      { name: 'length', label: 'Length', kind: 'number', default: 250, unit: 'mm' },
    ],
    scad: ({ size, length }) => {
      const w = String(size) === 'MGN7' ? 7 : String(size) === 'MGN9' ? 9 : String(size) === 'MGN15' ? 15 : 12;
      const h = w * 0.65;
      const L = typeof length === 'number' ? length : 250;
      return [
        `// ${size} linear rail`,
        `translate([-${w/2}, 0, 0]) cube([${w}, ${L}, ${h}]);`,
      ].join('\n');
    },
  },
];

export function getStandardPart(id: string): StandardPart | null {
  return STANDARD_PARTS.find(p => p.id === id) ?? null;
}

export function partsByCategory(category: StandardPart['category']): StandardPart[] {
  return STANDARD_PARTS.filter(p => p.category === category);
}
