/**
 * landscape-presets.mjs — 조경 구조·배수 결정론 파라메트릭 프리셋(Pillar ① 복제).
 * 데크 보(직사각 부재)·U형 측구(U 단면 압출). 검증=domain-verify landscape(배수, 형상무관),
 * 제조=U측구는 콘크리트 BOQ / 데크보는 목재(중량·부피).
 */
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** 데크 보(목재 각재): 직사각 단면 b×h, 길이 L. */
function deckJoistIntent(p) {
  const b = num(p.width, 100), h = num(p.height, 200), L = num(p.length, 3000);
  return { name: 'DeckJoist', features: [{ id: 'joist', kind: 'box', size: [b, h, L] }], material: 'timber' };
}

/** U형 측구: U 단면 압출(바닥 + 양 벽). 치수 mm. */
function uChannelIntent(p) {
  const iw = num(p.innerWidth, 300), depth = num(p.depth, 300), wall = num(p.wall, 50), L = num(p.length, 2000);
  const ow = iw + 2 * wall, oh = depth + wall; // 바닥 두께=wall
  // U 단면 폴리곤(외곽 → 내부 홈).
  const profile = [
    [0, 0], [ow, 0], [ow, oh], [ow - wall, oh], [ow - wall, wall], [wall, wall], [wall, oh], [0, oh],
  ];
  return { name: 'UChannel', features: [{ id: 'channel', kind: 'extrude', profile, height: L }], material: 'concrete' };
}

export const LANDSCAPE_TEMPLATES = [
  {
    id: 'deck_joist', labelKo: '데크 보 (목재)', labelEn: 'Deck joist (timber)', build: deckJoistIntent,
    params: [
      { name: 'width', labelKo: '폭', unit: 'mm', default: 100, min: 30, max: 300 },
      { name: 'height', labelKo: '높이', unit: 'mm', default: 200, min: 50, max: 400 },
      { name: 'length', labelKo: '길이', unit: 'mm', default: 3000, min: 500, max: 6000 },
    ],
  },
  {
    id: 'u_channel', labelKo: 'U형 측구', labelEn: 'U-channel drain', build: uChannelIntent,
    params: [
      { name: 'innerWidth', labelKo: '내폭', unit: 'mm', default: 300, min: 100, max: 1500 },
      { name: 'depth', labelKo: '깊이', unit: 'mm', default: 300, min: 100, max: 1500 },
      { name: 'wall', labelKo: '벽/바닥 두께', unit: 'mm', default: 50, min: 30, max: 300 },
      { name: 'length', labelKo: '연장', unit: 'mm', default: 2000, min: 500, max: 6000 },
    ],
  },
];
