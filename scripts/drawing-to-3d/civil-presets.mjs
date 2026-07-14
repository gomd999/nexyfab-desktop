/**
 * civil-presets.mjs — 토목 소구조물 결정론 파라메트릭 프리셋(Pillar ① 복제).
 * 옹벽(L 단면 압출)·박스 암거(box−box). 검증=domain-verify civil, 제조=콘크리트 BOQ.
 */
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** 캔틸레버 옹벽: L 단면 압출(저판 + 벽체). 치수 mm. */
function retainingWallIntent(p) {
  const H = num(p.H, 3000), baseW = num(p.baseWidth, 2000), baseT = num(p.baseThickness, 400);
  const stemT = num(p.stemThickness, 300), toe = num(p.toeLength, 600), L = num(p.length, 1000);
  const sx = toe; // 벽체 앞면 위치
  const profile = [
    [0, 0], [baseW, 0], [baseW, baseT],
    [sx + stemT, baseT], [sx + stemT, H], [sx, H], [sx, baseT], [0, baseT],
  ];
  return {
    name: 'RetainingWall',
    features: [{ id: 'wall', kind: 'extrude', profile, height: L }],
    material: 'concrete',
    // C1: 형상→검증 자동 파생 메타(m 단위) — domain-verify retaining_wall_stability가
    // 이 값을 geom 입력으로 쓴다(사용자 덮어쓰기 불가 → 형상↔검증 정합).
    retainingWall: { H: H / 1000, stemThickness: stemT / 1000, baseWidth: baseW / 1000, baseThickness: baseT / 1000, toeLength: toe / 1000, length: L / 1000 },
  };
}

/** 박스 암거: 외곽 box − 내부 box(중공). 치수 mm. */
function boxCulvertIntent(p) {
  const iw = num(p.innerWidth, 1500), ih = num(p.innerHeight, 1500), wall = num(p.wall, 200), L = num(p.length, 2000);
  const ow = iw + 2 * wall, oh = ih + 2 * wall;
  return {
    name: 'BoxCulvert',
    features: [
      { id: 'outer', kind: 'box', size: [ow, oh, L] },
      { id: 'bore', kind: 'box', size: [iw, ih, L + 2], op: 'subtract', at: { translate: [wall, wall, -1] } },
    ],
    material: 'concrete',
  };
}

export const CIVIL_TEMPLATES = [
  {
    id: 'retaining_wall', labelKo: '옹벽 (L 캔틸레버)', labelEn: 'Retaining wall (L)', build: retainingWallIntent,
    params: [
      { name: 'H', labelKo: '벽고', unit: 'mm', default: 3000, min: 500, max: 8000 },
      { name: 'baseWidth', labelKo: '저판 폭', unit: 'mm', default: 2000, min: 500, max: 6000 },
      { name: 'baseThickness', labelKo: '저판 두께', unit: 'mm', default: 400, min: 150, max: 1200 },
      { name: 'stemThickness', labelKo: '벽체 두께', unit: 'mm', default: 300, min: 150, max: 1000 },
      { name: 'toeLength', labelKo: '앞굽 길이', unit: 'mm', default: 600, min: 0, max: 3000 },
      { name: 'length', labelKo: '연장', unit: 'mm', default: 1000, min: 500, max: 6000 },
    ],
  },
  {
    id: 'box_culvert', labelKo: '박스 암거', labelEn: 'Box culvert', build: boxCulvertIntent,
    params: [
      { name: 'innerWidth', labelKo: '내폭', unit: 'mm', default: 1500, min: 300, max: 6000 },
      { name: 'innerHeight', labelKo: '내고', unit: 'mm', default: 1500, min: 300, max: 6000 },
      { name: 'wall', labelKo: '벽 두께', unit: 'mm', default: 200, min: 100, max: 600 },
      { name: 'length', labelKo: '연장', unit: 'mm', default: 2000, min: 500, max: 6000 },
    ],
  },
];
