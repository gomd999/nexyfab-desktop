/**
 * mech-presets.mjs — 기계·장비·판금 분야 **결정론 파라메트릭 프리셋**(완벽화 Pillar ①).
 *
 * AI 없이 파라미터(슬라이더)→compose intent를 결정론적으로 생성한다. 표준 케이스는
 * 100% 유효·즉시·항상 manifold. compose(범용 AI)와 같은 intent 형식이라 이후 파이프라인
 * (emitComposite→렌더→검증→STEP/HTML→분야검증)이 그대로 이어진다.
 *
 * 각 템플릿: { id, labelKo/En, params[명세], build(params)→{name,features} }.
 * params 명세로 UI 폼을 생성하고, build로 형상을 만든다. 게이트·manifold는 self-test로 상시 보증.
 */

import { gearPoly, hexPts, sheetPoly, boltDims } from './reconstruct.mjs';

const num = (v, d) => (Number.isFinite(v) ? v : d);

/** 플레이트 + 모서리 볼트홀 4 + 중앙 관통. box 한 개 − 구멍 실린더들. */
function plateIntent(p) {
  const w = num(p.width, 300), d = num(p.depth, 200), t = num(p.thickness, 12);
  const hd = num(p.holeDia, 8), inset = num(p.holeInset, 20), cd = num(p.centerDia, 40);
  const features = [{ id: 'plate', kind: 'box', size: [w, d, t] }];
  const corners = [[inset, inset], [w - inset, inset], [inset, d - inset], [w - inset, d - inset]];
  corners.forEach(([x, y], i) => {
    if (hd > 0) features.push({ id: `hole${i}`, kind: 'cylinder', diameter: hd, height: t + 2, op: 'subtract', at: { translate: [x, y, -1] } });
  });
  if (cd > 0) features.push({ id: 'center', kind: 'cylinder', diameter: cd, height: t + 2, op: 'subtract', at: { translate: [w / 2, d / 2, -1] } });
  return { name: 'Plate', features };
}

/**
 * 절곡 L 브래킷(판금 1회 절곡). 3D=L단면 압출. 절곡 메타(bends·sheet)를 intent에 실어
 * fab.mjs가 K-factor 전개(평판 블랭크)를 계산하게 한다.
 */
function bentBracketIntent(p) {
  const legA = num(p.legA, 80), legB = num(p.legB, 60), width = num(p.width, 40);
  const t = num(p.thickness, 3);
  const R = num(p.bendRadius, t);
  const k = num(p.kFactor, 0.38);
  const angle = num(p.bendAngle, 90);
  // L 단면 폴리곤(XY) → Z로 width 압출.
  const profile = [[0, 0], [legA, 0], [legA, t], [t, t], [t, legB], [0, legB]];
  return {
    name: 'BentBracket',
    features: [{ id: 'bracket', kind: 'extrude', profile, height: width }],
    // 절곡 전개용 메타(형상엔 안 들어감 — fab.mjs 전용).
    sheet: { thickness: t, width, flanges: [legA, legB] },
    bends: [{ angle, radiusMm: R, k }],
  };
}

/** 정사각 각관: 외곽 box − 내부 box(관통). */
function squareTubeIntent(p) {
  const s = num(p.side, 50), wall = num(p.wall, 3), L = num(p.length, 1000);
  const inner = s - 2 * wall;
  const features = [{ id: 'outer', kind: 'box', size: [s, s, L] }];
  if (inner > 0) features.push({ id: 'bore', kind: 'box', size: [inner, inner, L + 2], op: 'subtract', at: { translate: [wall, wall, -1] } });
  return { name: 'SquareTube', features };
}

/**
 * 원통 용기(탱크): 원뿔 바닥 + 직관 벽 + 상부림. 벽 단면(폴리곤)을 Z축 revolve.
 * 옵션: 중앙 교반축(shaftDia>0). 바닥 드레인 개구(drainDia).
 */
function tankIntent(p) {
  const ri = num(p.innerDia, 500) / 2;
  const wall = num(p.wall, 5);
  const straightH = num(p.straightHeight, 800);
  const aDeg = num(p.coneAngleDeg, 45);
  const drainR = num(p.drainDia, 40) / 2;
  const shaftDia = num(p.shaftDia, 0);
  const ro = ri + wall;
  const a = (Math.max(15, Math.min(80, aDeg)) * Math.PI) / 180;
  const coneH = ri / Math.tan(a); // 원뿔 깊이(꼭지 반경 0 기준 근사)
  const drainOuterR = Math.min(drainR + wall, ro - 0.5);

  // 벽 단면 폴리곤 (r,z) — 내면(바닥→상부)→상부림→외면(상부→바닥)→드레인 폐합.
  const profile = [
    [drainR, 0],
    [ri, coneH],
    [ri, coneH + straightH],
    [ro, coneH + straightH],
    [ro, coneH],
    [drainOuterR, 0],
  ];
  const features = [{ id: 'wall', kind: 'revolve', profile }];
  if (shaftDia > 0) {
    features.push({ id: 'shaft', kind: 'cylinder', diameter: shaftDia, height: straightH * 0.9, at: { translate: [0, 0, coneH + straightH * 0.05] } });
  }
  return { name: 'Tank', features };
}

/** 인벌류트 스퍼기어: 결정론 치형 폴리곤 압출 − 보어. (#3 어휘확장) */
function spurGearIntent(p) {
  const m = num(p.module, 2), z = Math.round(num(p.teeth, 24)), t = num(p.thickness, 10), bore = num(p.boreDia, 12);
  const features = [{ id: 'gear', kind: 'extrude', profile: gearPoly({ module: m, teeth: z }), height: t }];
  if (bore > 0) features.push({ id: 'bore', kind: 'cylinder', diameter: bore, height: t + 2, op: 'subtract', at: { translate: [0, 0, -1] } });
  return { name: 'SpurGear', features };
}

/** 육각볼트(ISO 표준 머리치수): 자루 원통 + 육각머리 압출. 나사산 미형상(도면 관례). */
function hexBoltIntent(p) {
  const d = num(p.threadDia, 12), L = num(p.length, 60);
  const { af, hh } = boltDims({ threadDia: d });
  const AF = num(p.headFlats, af ?? d * 1.6), HH = num(p.headHeight, hh ?? d * 0.63);
  return {
    name: 'HexBolt',
    features: [
      { id: 'shank', kind: 'cylinder', diameter: d, height: L },
      { id: 'head', kind: 'extrude', profile: hexPts(AF), height: HH, at: { translate: [0, 0, L] } },
    ],
  };
}

/** 햇채널(다단 절곡 판금 대표형): sheet_profile 단면(플랜지-웹-톱-웹-플랜지) 압출. */
function hatChannelIntent(p) {
  const t = num(p.thickness, 2), flange = num(p.flange, 20), h = num(p.height, 40), top = num(p.top, 60), L = num(p.length, 1000);
  const spec = { thickness: t, segments: [flange, h, top, h, flange], angles: [90, -90, -90, 90] };
  return {
    name: 'HatChannel',
    features: [{ id: 'hat', kind: 'extrude', profile: sheetPoly(spec), height: L }],
    sheet: { thickness: t, width: L, flanges: spec.segments },
    bends: spec.angles.map((a) => ({ angle: Math.abs(a), radiusMm: t, k: 0.38 })),
  };
}

/** 파라미터 명세 + 빌더 레지스트리(UI 폼 생성용). unit·기본값·범위는 mm. */
export const MECH_TEMPLATES = [
  {
    id: 'tank',
    labelKo: '원통 용기 (원뿔 바닥)',
    labelEn: 'Cylindrical vessel (cone bottom)',
    build: tankIntent,
    params: [
      { name: 'innerDia', labelKo: '내경', unit: 'mm', default: 500, min: 100, max: 3000 },
      { name: 'straightHeight', labelKo: '직관 높이', unit: 'mm', default: 800, min: 100, max: 5000 },
      { name: 'wall', labelKo: '벽 두께', unit: 'mm', default: 5, min: 1, max: 40 },
      { name: 'coneAngleDeg', labelKo: '원뿔각', unit: '°', default: 45, min: 15, max: 80 },
      { name: 'drainDia', labelKo: '드레인 지름', unit: 'mm', default: 40, min: 0, max: 300 },
      { name: 'shaftDia', labelKo: '교반축 지름(0=없음)', unit: 'mm', default: 25, min: 0, max: 200 },
    ],
  },
  {
    id: 'plate',
    labelKo: '플레이트 (볼트홀)',
    labelEn: 'Plate (bolt holes)',
    build: plateIntent,
    params: [
      { name: 'width', labelKo: '가로', unit: 'mm', default: 300, min: 20, max: 2000 },
      { name: 'depth', labelKo: '세로', unit: 'mm', default: 200, min: 20, max: 2000 },
      { name: 'thickness', labelKo: '두께', unit: 'mm', default: 12, min: 1, max: 100 },
      { name: 'holeDia', labelKo: '볼트홀 지름(0=없음)', unit: 'mm', default: 8, min: 0, max: 100 },
      { name: 'holeInset', labelKo: '모서리 여백', unit: 'mm', default: 20, min: 5, max: 300 },
      { name: 'centerDia', labelKo: '중앙 관통(0=없음)', unit: 'mm', default: 40, min: 0, max: 500 },
    ],
  },
  {
    id: 'bent_bracket',
    labelKo: '절곡 브래킷 (L, 판금)',
    labelEn: 'Bent bracket (L, sheet)',
    build: bentBracketIntent,
    params: [
      { name: 'legA', labelKo: '다리 A', unit: 'mm', default: 80, min: 10, max: 1000 },
      { name: 'legB', labelKo: '다리 B', unit: 'mm', default: 60, min: 10, max: 1000 },
      { name: 'width', labelKo: '폭', unit: 'mm', default: 40, min: 5, max: 1000 },
      { name: 'thickness', labelKo: '두께', unit: 'mm', default: 3, min: 0.5, max: 20 },
      { name: 'bendRadius', labelKo: '절곡 반경', unit: 'mm', default: 3, min: 0.5, max: 50 },
      { name: 'kFactor', labelKo: 'K-factor', unit: '', default: 0.38, min: 0.2, max: 0.5 },
      { name: 'bendAngle', labelKo: '절곡 각도', unit: '°', default: 90, min: 30, max: 150 },
    ],
  },
  {
    id: 'square_tube',
    labelKo: '각관 (정사각 중공)',
    labelEn: 'Square tube (hollow)',
    build: squareTubeIntent,
    params: [
      { name: 'side', labelKo: '한 변', unit: 'mm', default: 50, min: 10, max: 400 },
      { name: 'wall', labelKo: '벽 두께', unit: 'mm', default: 3, min: 1, max: 40 },
      { name: 'length', labelKo: '길이', unit: 'mm', default: 1000, min: 50, max: 6000 },
    ],
  },
  {
    id: 'spur_gear',
    labelKo: '스퍼기어 (인벌류트)',
    labelEn: 'Spur gear (involute)',
    build: spurGearIntent,
    params: [
      { name: 'module', labelKo: '모듈', unit: 'mm', default: 2, min: 0.5, max: 20 },
      { name: 'teeth', labelKo: '잇수', unit: '', default: 24, min: 8, max: 150 },
      { name: 'thickness', labelKo: '치폭', unit: 'mm', default: 10, min: 2, max: 200 },
      { name: 'boreDia', labelKo: '보어(0=없음)', unit: 'mm', default: 12, min: 0, max: 200 },
    ],
  },
  {
    id: 'hex_bolt',
    labelKo: '육각볼트 (ISO)',
    labelEn: 'Hex bolt (ISO)',
    build: hexBoltIntent,
    params: [
      { name: 'threadDia', labelKo: '호칭경 M', unit: 'mm', default: 12, min: 3, max: 36 },
      { name: 'length', labelKo: '자루 길이', unit: 'mm', default: 60, min: 8, max: 400 },
    ],
  },
  {
    id: 'hat_channel',
    labelKo: '햇채널 (다단 절곡)',
    labelEn: 'Hat channel (multi-bend)',
    build: hatChannelIntent,
    params: [
      { name: 'thickness', labelKo: '판두께', unit: 'mm', default: 2, min: 0.5, max: 6 },
      { name: 'flange', labelKo: '플랜지', unit: 'mm', default: 20, min: 8, max: 100 },
      { name: 'height', labelKo: '높이', unit: 'mm', default: 40, min: 10, max: 200 },
      { name: 'top', labelKo: '상면 폭', unit: 'mm', default: 60, min: 15, max: 300 },
      { name: 'length', labelKo: '길이', unit: 'mm', default: 1000, min: 50, max: 6000 },
    ],
  },
];

/** templateId + params → intent(결정론). 알 수 없는 id면 null. */
export function buildMechPreset(templateId, params = {}) {
  const t = MECH_TEMPLATES.find((x) => x.id === templateId);
  if (!t) return null;
  return t.build(params);
}

/** UI용 메타(빌더 제외). */
export function listMechTemplates() {
  return MECH_TEMPLATES.map((t) => ({ id: t.id, labelKo: t.labelKo, labelEn: t.labelEn, params: t.params }));
}

/**
 * templateId + params → { intent, scad, verify } (결정론, AI 없음).
 * compose와 같은 산출 형식이라 설계 페이지가 동일하게 렌더/검증/내보내기한다.
 * verify = openscad-wasm 실렌더 manifold(compose의 검증층 재사용).
 */
export async function presetWithVerify(templateId, params = {}) {
  const intent = buildMechPreset(templateId, params);
  if (!intent) return { ok: false, error: `unknown template: ${templateId}` };
  const { gateComposite, emitComposite } = await import('./compose.mjs');
  const errs = gateComposite(intent);
  if (errs.length) return { ok: false, gatePassed: false, gateErrors: errs, intent };
  const scad = emitComposite(intent);
  let verify = null;
  try {
    const { renderStl } = await import('./verify.mjs');
    const stl = await renderStl(scad);
    const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    const tri = dv.getUint32(80, true);
    const edges = new Map();
    let off = 84;
    const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const vkey = (o) => `${dv.getFloat32(o, true).toFixed(3)},${dv.getFloat32(o + 4, true).toFixed(3)},${dv.getFloat32(o + 8, true).toFixed(3)}`;
    for (let i = 0; i < tri; i++) {
      const b = off + 12;
      const v = [vkey(b), vkey(b + 12), vkey(b + 24)];
      for (let e = 0; e < 3; e++) { const k = key(v[e], v[(e + 1) % 3]); edges.set(k, (edges.get(k) || 0) + 1); }
      off += 50;
    }
    let bad = 0;
    for (const c of edges.values()) if (c !== 2) bad++;
    verify = { triangles: tri, manifold: bad === 0, nonManifoldEdges: bad };
  } catch (e) {
    verify = { error: e.message };
  }
  return { ok: true, intent, scad, verify };
}

// --- self-test: 각 템플릿 기본값 → 게이트 + 실렌더 manifold 보증 ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('mech-presets.mjs');
if (isMain) {
  const { gateComposite, emitComposite } = await import('./compose.mjs');
  const { renderStl } = await import('./verify.mjs');
  const analyzeStl = (buf) => {
    // 간이 non-manifold 엣지 카운트(verify.mjs와 동일 사상): 삼각형 파싱 후 엣지 짝맞춤.
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const tri = dv.getUint32(80, true);
    const edges = new Map();
    let off = 84;
    const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const vkey = (o) => `${dv.getFloat32(o, true).toFixed(3)},${dv.getFloat32(o + 4, true).toFixed(3)},${dv.getFloat32(o + 8, true).toFixed(3)}`;
    for (let i = 0; i < tri; i++) {
      const b = off + 12;
      const v = [vkey(b), vkey(b + 12), vkey(b + 24)];
      for (let e = 0; e < 3; e++) { const k = key(v[e], v[(e + 1) % 3]); edges.set(k, (edges.get(k) || 0) + 1); }
      off += 50;
    }
    let bad = 0;
    for (const c of edges.values()) if (c !== 2) bad++;
    return { tri, bad };
  };

  let pass = 0, fail = 0;
  for (const t of MECH_TEMPLATES) {
    const defaults = Object.fromEntries(t.params.map((p) => [p.name, p.default]));
    const intent = t.build(defaults);
    const errs = gateComposite(intent);
    if (errs.length) { fail++; console.log('FAIL gate', t.id, errs.join('; ')); continue; }
    const scad = emitComposite(intent);
    const stl = await renderStl(scad);
    if (!stl || !stl.length) { fail++; console.log('FAIL render', t.id); continue; }
    const { tri, bad } = analyzeStl(stl);
    if (bad === 0) { pass++; console.log(`OK ${t.id}: ${tri} tri, manifold`); }
    else { fail++; console.log(`FAIL manifold ${t.id}: ${bad} non-manifold edges`); }
  }
  console.log(`mech-presets self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
