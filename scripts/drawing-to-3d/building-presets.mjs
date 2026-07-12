/**
 * building-presets.mjs — 건축 부재(RC) 결정론 파라메트릭 프리셋(Pillar ① 복제).
 * RC 보·기둥(직사각 단면). 검증=domain-verify building-member(rc_beam, b·d 형상 파생),
 * 제조=콘크리트 BOQ. 단면=솔리드 직사각(box).
 */
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** RC 보: 직사각 단면 b×h, 길이 L. */
function rcBeamIntent(p) {
  const b = num(p.width, 300), h = num(p.height, 600), L = num(p.length, 6000);
  return { name: 'RCBeam', features: [{ id: 'beam', kind: 'box', size: [b, h, L] }], material: 'concrete' };
}

/** RC 기둥: 정사각/직사각 단면 b×h, 높이 H. */
function rcColumnIntent(p) {
  const b = num(p.width, 500), h = num(p.depth, 500), H = num(p.height, 3000);
  return { name: 'RCColumn', features: [{ id: 'col', kind: 'box', size: [b, h, H] }], material: 'concrete' };
}

export const BUILDING_TEMPLATES = [
  {
    id: 'rc_beam', labelKo: 'RC 보', labelEn: 'RC beam', build: rcBeamIntent,
    params: [
      { name: 'width', labelKo: '폭 b', unit: 'mm', default: 300, min: 150, max: 1200 },
      { name: 'height', labelKo: '높이 h', unit: 'mm', default: 600, min: 200, max: 2000 },
      { name: 'length', labelKo: '길이', unit: 'mm', default: 6000, min: 1000, max: 15000 },
    ],
  },
  {
    id: 'rc_column', labelKo: 'RC 기둥', labelEn: 'RC column', build: rcColumnIntent,
    params: [
      { name: 'width', labelKo: '폭 b', unit: 'mm', default: 500, min: 200, max: 1500 },
      { name: 'depth', labelKo: '깊이 h', unit: 'mm', default: 500, min: 200, max: 1500 },
      { name: 'height', labelKo: '높이', unit: 'mm', default: 3000, min: 1000, max: 8000 },
    ],
  },
];
