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

/**
 * 포털 프레임(다부재): 좌우 포스트 2 + 상부 빔 1(중공 각관). 부재가 코너에서 겹쳐 manifold.
 * fab는 이를 부재 스케줄(BOM: 부재별 길이·중량·본수)로 산출한다.
 */
function portalFrameIntent(p) {
  const W = num(p.bayWidth, 2400), H = num(p.height, 3000), s = num(p.member, 100), wall = num(p.wall, 4);
  const inner = s - 2 * wall;
  const tube = (id, size, translate) => {
    const f = [{ id, kind: 'box', size, at: { translate } }];
    const bs = size.map((d) => (d === Math.max(...size) ? d + 2 : d - 2 * wall));
    if (bs.every((v) => v > 0)) f.push({ id: id + '_bore', kind: 'box', size: bs, op: 'subtract', at: { translate: translate.map((t, i) => t + (size[i] === Math.max(...size) ? -1 : wall)) } });
    return f;
  };
  return {
    name: 'PortalFrame',
    features: [
      ...tube('postL', [s, s, H], [0, 0, 0]),
      ...tube('postR', [s, s, H], [W - s, 0, 0]),
      ...tube('beam', [W, s, s], [0, 0, H - s]),
    ],
    assembly: [
      { id: 'postL', kind: 'post', section: [s, s], wall, length: H },
      { id: 'postR', kind: 'post', section: [s, s], wall, length: H },
      { id: 'beam', kind: 'beam', section: [s, s], wall, length: W },
    ],
    material: 'steel',
  };
}

export const RACK_TEMPLATES = [
  {
    id: 'portal_frame', labelKo: '포털 프레임 (다부재)', labelEn: 'Portal frame (assembly)', build: portalFrameIntent,
    params: [
      { name: 'bayWidth', labelKo: '스팬', unit: 'mm', default: 2400, min: 500, max: 8000 },
      { name: 'height', labelKo: '높이', unit: 'mm', default: 3000, min: 500, max: 8000 },
      { name: 'member', labelKo: '부재 한 변', unit: 'mm', default: 100, min: 40, max: 300 },
      { name: 'wall', labelKo: '벽 두께', unit: 'mm', default: 4, min: 1.6, max: 16 },
    ],
  },
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
