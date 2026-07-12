/**
 * rack-presets.mjs — 가설·랙·경량철골 분야 **결정론 파라메트릭 프리셋**(Pillar ① 복제).
 *
 * 강재 부재(포스트·빔). mech-presets와 동일 사상(파라미터→compose intent, 항상 유효·manifold).
 * 검증은 domain-verify(좌굴·휨), 제조는 fab.mjs 강재 부재(중량·절단). 단면=중공 각형.
 */

const num = (v, d) => (Number.isFinite(v) ? v : d);

/** 랙 포스트: 정사각 각관(외곽 box − 내부 box). */
function rackPostIntent(p) {
  const s = num(p.side, 100), wall = num(p.wall, 4), h = num(p.height, 3000);
  const inner = s - 2 * wall;
  const features = [{ id: 'post', kind: 'box', size: [s, s, h] }];
  if (inner > 0) features.push({ id: 'bore', kind: 'box', size: [inner, inner, h + 2], op: 'subtract', at: { translate: [wall, wall, -1] } });
  return { name: 'RackPost', features };
}

/** 랙 빔: 직사각 중공(스텝빔형). 폭×높이×벽, 길이축=길이. */
function rackBeamIntent(p) {
  const w = num(p.width, 50), ht = num(p.height, 100), wall = num(p.wall, 3), L = num(p.length, 2400);
  const iw = w - 2 * wall, ih = ht - 2 * wall;
  const features = [{ id: 'beam', kind: 'box', size: [w, ht, L] }];
  if (iw > 0 && ih > 0) features.push({ id: 'bore', kind: 'box', size: [iw, ih, L + 2], op: 'subtract', at: { translate: [wall, wall, -1] } });
  return { name: 'RackBeam', features };
}

export const RACK_TEMPLATES = [
  {
    id: 'rack_post',
    labelKo: '랙 포스트 (각관)',
    labelEn: 'Rack post (square tube)',
    build: rackPostIntent,
    params: [
      { name: 'side', labelKo: '한 변', unit: 'mm', default: 100, min: 40, max: 400 },
      { name: 'wall', labelKo: '벽 두께', unit: 'mm', default: 4, min: 1.6, max: 20 },
      { name: 'height', labelKo: '높이', unit: 'mm', default: 3000, min: 500, max: 12000 },
    ],
  },
  {
    id: 'rack_beam',
    labelKo: '랙 빔 (직사각 중공)',
    labelEn: 'Rack beam (rect tube)',
    build: rackBeamIntent,
    params: [
      { name: 'width', labelKo: '폭', unit: 'mm', default: 50, min: 20, max: 300 },
      { name: 'height', labelKo: '높이', unit: 'mm', default: 100, min: 30, max: 400 },
      { name: 'wall', labelKo: '벽 두께', unit: 'mm', default: 3, min: 1.6, max: 16 },
      { name: 'length', labelKo: '길이', unit: 'mm', default: 2400, min: 300, max: 6000 },
    ],
  },
];
