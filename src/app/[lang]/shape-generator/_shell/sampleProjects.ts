'use client';

// Curated sample projects — surfaced from Hub's empty-state so a first-touch
// user can open a realistic CAD scene without setting anything up. Each
// sample resolves to a `?from=sample&intent=...` URL that the modeler
// understands as a pre-seeded SCAD intent.

export interface SampleProject {
  id: string;
  titleKo: string;
  titleEn: string;
  descKo: string;
  descEn: string;
  thumbnailHue: number;
  intent: Record<string, unknown>;
}

export const SAMPLE_PROJECTS: SampleProject[] = [
  {
    id: 'sample-bracket',
    titleKo: '알루미늄 브라켓',
    titleEn: 'Aluminum Bracket',
    descKo: '∅6.5 홀 4개 · 5mm 두께 · 80×50mm',
    descEn: '4× ∅6.5 holes · 5mm thick · 80×50mm',
    thumbnailHue: 215,
    intent: {
      shapeId: 'lBracket',
      params: { width_mm: 80, height_mm: 50, thickness_mm: 5, hole_diameter_mm: 6.5, hole_count: 4 },
    },
  },
  {
    id: 'sample-gear',
    titleKo: '스퍼 기어 24T',
    titleEn: 'Spur Gear 24T',
    descKo: 'Module 1 · 24 teeth · 5mm 두께',
    descEn: 'Module 1 · 24 teeth · 5mm thick',
    thumbnailHue: 145,
    intent: {
      shapeId: 'gear',
      params: { teeth_count: 24, module_mm: 1, thickness_mm: 5 },
    },
  },
  {
    id: 'sample-enclosure',
    titleKo: '전자 부품 박스',
    titleEn: 'PCB Enclosure',
    descKo: '100×60×30mm · 벽두께 2mm · 모서리 R3',
    descEn: '100×60×30mm · wall 2mm · R3 corners',
    thumbnailHue: 285,
    intent: {
      shapeId: 'roundedBox',
      params: { length_mm: 100, width_mm: 60, height_mm: 30, thickness_mm: 2, fillet_radius_mm: 3 },
    },
  },
];

/** Build the modeler href for a sample project. */
export function sampleHref(lang: string, sample: SampleProject): string {
  const encoded = encodeURIComponent(JSON.stringify(sample.intent));
  return `/${lang}/shape-generator?from=sample&sampleId=${sample.id}&intent=${encoded}`;
}
