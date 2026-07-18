/**
 * detail-macros.mjs — 디테일 매크로 5종 (정교화 Phase 2, 260718).
 *
 * 매크로 = 프리미티브 부품 묶음을 방출하는 조립 함수 — 커널 무변경이라 기존
 * 게이트(간섭·부유·물량)가 그대로 적용된다. 치수는 detail-calibration.json 의
 * 코퍼스 실측 보정 상수(수치만 — 기하 없음, GrabCAD 라이선스 클린) + 카탈로그
 * 관례값. 근거 없는 값은 상수 테이블에 basis 로 명시.
 *
 * 배치 규약(assembly.mjs 검증 규약): box=min 모서리 · cylinder=단면 중심+축 시작.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAL = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'detail-calibration.json'), 'utf8'));

let seq = 0;
const uid = (p) => `${p}_${++seq}`;

/**
 * 캐스터 어셈블리 — 상판+포크 2판+휠(+스위블 링 옵션).
 * 코퍼스 도너: caster-wheel-5-inch(분해 구성 실측 — 상판/포크/휠/베어링).
 * @param {number} cx 휠 중심 x  @param {number} cy 휠 폭방향 시작 y(포크 안쪽)
 * @param {number} deckBottomZ 데크 하면 z — 상판이 이 면에 밀착
 */
export function casterAssembly({ cx, cy, deckBottomZ, wheelDia = CAL.caster.wheelDia, swivel = false, service = 'frame' }) {
  const c = CAL.caster;
  const parts = [];
  const plateZ = deckBottomZ - c.plateT;
  const axleZ = wheelDia / 2;
  const halfW = c.wheelW / 2;
  const forkTz = axleZ - c.forkDrop;          // 포크 하단(축심 아래 drop)
  const forkHgt = plateZ - forkTz;            // 포크: 하단 → 상판 하면
  // 상판(마운트 플레이트) — 데크 하면 밀착(z-접촉 지지)
  parts.push({ id: uid('caster_plate'), type: 'box', params: { width: c.plateW, depth: c.plateD, height: c.plateT }, at: { tx: cx - c.plateW / 2, ty: cy + halfW - c.plateD / 2, tz: plateZ }, role: 'support', service, material: 'steel' });
  // 포크 2판 — 휠 양측, 상판 하면에서 축심까지(휠과 축심 높이에서 측면 근접)
  for (const s of [-1, 1]) {
    const fy = cy + halfW + s * (halfW + c.forkGap) - (s > 0 ? 0 : c.forkT);
    parts.push({ id: uid('caster_fork'), type: 'box', params: { width: c.forkW, depth: c.forkT, height: forkHgt }, at: { tx: cx - c.forkW / 2, ty: fy, tz: forkTz }, role: 'support', service, material: 'steel' });
  }
  // 휠 — 접지(z0), 축=y
  parts.push({ id: uid('caster_wheel'), type: 'cylinder', params: { diameter: wheelDia, length: c.wheelW }, at: { tx: cx, ty: cy, tz: wheelDia / 2, rx: -90 }, role: 'support', service, material: 'steel' });
  // 스위블 링(옵션)
  if (swivel) parts.push({ id: uid('caster_swivel'), type: 'cylinder', params: { diameter: c.swivelDia, length: c.swivelT }, at: { tx: cx, ty: cy + halfW, tz: plateZ - c.swivelT }, role: 'support', service, material: 'steel' });
  return parts;
}

/**
 * 플랜지 노즐 — 노즐관+플랜지판+볼트 헤드 원형 배열(hex 근사=소원통).
 * 코퍼스 실측: flanged-elbows STEP — 플랜지 OD≈2.1×관경(레그 1.6D·R 1.1D 는 엘보 상수).
 * axis: 'z+'(상향)|'x+'|'x-'|'y+'|'y-' — 장비 면에서 바깥으로.
 */
export function flangedNozzle({ x, y, z, axis = 'z+', pipeDia, len = null, service = 'feed' }) {
  const f = CAL.flange;
  const L = len ?? pipeDia * f.stubLenRatio;
  const fd = pipeDia * f.odRatio;
  const ft = Math.max(8, pipeDia * f.thickRatio);
  const nBolt = pipeDia >= 80 ? 8 : 4;
  const bd = Math.max(8, pipeDia * f.boltDiaRatio);
  const pcd = (pipeDia + fd) / 2;
  const parts = [];
  const cyl = (id, dia, length, at, role = 'flange') => parts.push({ id: uid(id), type: 'cylinder', params: { diameter: dia, length }, at, role, service, material: 'steel' });
  if (axis === 'z+') {
    cyl('nozzle', pipeDia, L, { tx: x, ty: y, tz: z });
    cyl('flange', fd, ft, { tx: x, ty: y, tz: z + L });
    for (let k = 0; k < nBolt; k++) {
      const a = (2 * Math.PI * k) / nBolt;
      cyl('bolt', bd, ft + 6, { tx: x + (pcd / 2) * Math.cos(a), ty: y + (pcd / 2) * Math.sin(a), tz: z + L }, 'bolt');
    }
  } else {
    const hor = axis[0] === 'x';
    const sgn = axis[1] === '-' ? -1 : 1;
    const rot = hor ? { ry: 90 } : { rx: -90 };
    const start = sgn > 0 ? 0 : -L;
    cyl('nozzle', pipeDia, L, { tx: hor ? x + start : x, ty: hor ? y : y + start, tz: z, ...rot });
    const fs = sgn > 0 ? L : -L - ft;
    cyl('flange', fd, ft, { tx: hor ? x + fs : x, ty: hor ? y : y + fs, tz: z, ...rot });
    for (let k = 0; k < nBolt; k++) {
      const a = (2 * Math.PI * k) / nBolt;
      const u = (pcd / 2) * Math.cos(a), v = (pcd / 2) * Math.sin(a);
      const bs = sgn > 0 ? L - 3 : -L - ft - 3;
      cyl('bolt', bd, ft + 6, { tx: hor ? x + bs : x + u, ty: hor ? y + u : y + bs, tz: z + v, ...rot }, 'bolt');
    }
  }
  return parts;
}

/**
 * 캐비닛 디테일 — 본체 위에 문 패널(얕은 돌출판)+힌지 2+핸들+루버 슬릿+명판.
 * 도너: electrical-cabinet-21(x_t) 구성 관례. front = y- 면 기준.
 */
export function cabinetDetail({ x, y, z, w, d, h, service = 'panel' }) {
  const c = CAL.cabinet;
  const parts = [];
  const B = (id, params, at, role = 'cabinet') => parts.push({ id: uid(id), type: 'box', params, at, role, service, material: 'steel' });
  B('cab_body', { width: w, depth: d, height: h }, { tx: x, ty: y, tz: z });
  // 문 패널(전면 y- 로 돌출 t) — 본체와 접촉(면 부착이라 지지=본체 z 아님 → 하단을 본체 하단과 동일 z에서 시작해 자립)
  B('cab_door', { width: w - 2 * c.doorMargin, depth: c.doorT, height: h - 2 * c.doorMargin }, { tx: x + c.doorMargin, ty: y - c.doorT, tz: z }, 'cabinet');
  // 힌지 블록 2 — 문 측면
  for (const hz of [z + h * 0.2, z + h * 0.72]) B('cab_hinge', { width: c.hingeW, depth: c.doorT + 6, height: c.hingeH }, { tx: x + c.doorMargin - c.hingeW, ty: y - c.doorT - 6, tz: hz }, 'mount');
  // 핸들(세로 봉)
  parts.push({ id: uid('cab_handle'), type: 'cylinder', params: { diameter: c.handleDia, length: h * 0.25 }, at: { tx: x + w - c.doorMargin - 40, ty: y - c.doorT - c.handleDia / 2, tz: z + h * 0.38 }, role: 'mount', service, material: 'steel' });
  // 루버 슬릿(하부 환기 — 얕은 가로 판 3)
  for (let k = 0; k < 3; k++) B('cab_louver', { width: w * 0.4, depth: 4, height: 12 }, { tx: x + w * 0.3, ty: y - c.doorT - 4, tz: z + 60 + k * 30 }, 'mount');
  // 명판
  B('cab_plate', { width: 120, depth: 3, height: 40 }, { tx: x + w / 2 - 60, ty: y - c.doorT - 3, tz: z + h - 80 }, 'mount');
  return parts;
}

/**
 * 계기 세트 — 게이지(다이얼 원통+니플) n개를 패널 상면에 기립 배치.
 * (면 부착 부유 금지 규약 때문에 상면 기립 — P&ID 표기는 별도)
 */
export function instrumentSet({ x, y, topZ, count = 3, service = 'panel' }) {
  const g = CAL.gauge;
  const parts = [];
  for (let k = 0; k < count; k++) {
    const gx = x + k * (g.dialDia + 30);
    parts.push({ id: uid('gauge_nipple'), type: 'cylinder', params: { diameter: g.nippleDia, length: g.nippleLen }, at: { tx: gx, ty: y, tz: topZ }, role: 'mount', service, material: 'steel' });
    parts.push({ id: uid('gauge_dial'), type: 'cylinder', params: { diameter: g.dialDia, length: g.dialT }, at: { tx: gx, ty: y, tz: topZ + g.nippleLen }, role: 'mount', service, material: 'steel' });
  }
  return parts;
}

/** RO 압력용기 端 플랜지 캡 2개(새들 지지 열의 용기에 — 축방향 접촉 체결 선언용 role=joint). */
export function vesselEndCaps({ x0, len, cy, cz, dia, service }) {
  const f = CAL.flange;
  const capD = dia * f.vesselCapRatio;
  const capT = Math.max(20, dia * 0.12);
  return [
    { id: uid('ro_cap'), type: 'cylinder', params: { diameter: capD, length: capT }, at: { tx: x0 - capT, ty: cy, tz: cz, ry: 90 }, role: 'mount', ...(service ? { service } : {}), material: 'steel' },
    { id: uid('ro_cap'), type: 'cylinder', params: { diameter: capD, length: capT }, at: { tx: x0 + len, ty: cy, tz: cz, ry: 90 }, role: 'mount', ...(service ? { service } : {}), material: 'steel' },
  ];
}

// ── 탈-프리미티브 형상 헬퍼(260718o — "원통·네모 조합" 탈피): revolve 전면 활용 ──

/** 양단 돔(2:1 타원 근사) 압력용기 프로파일 — RO 베셀·필터 하우징용. z0~length. */
export function domedVesselProfile({ dia, length, headRatio = 0.25, seg = 6 }) {
  const r = dia / 2;
  const h = r * headRatio * 2; // 경판 깊이(2:1 → r/2)
  const prof = [[0, 0]];
  for (let k = seg; k >= 0; k--) {
    const th = (Math.PI / 2) * (k / seg);
    prof.push([+(r * Math.cos(th)).toFixed(2), +(h - h * Math.sin(th)).toFixed(2)]);
  }
  for (let k = 0; k <= seg; k++) {
    const th = (Math.PI / 2) * (k / seg);
    prof.push([+(r * Math.cos(th)).toFixed(2), +(length - h + h * Math.sin(th)).toFixed(2)]);
  }
  prof.push([0, length]);
  return prof;
}

/** 수직 다단 펌프 실루엣 — 단(stage) 링이 보이는 회전체 프로파일. */
export function multistagePumpProfile({ dia, stages = 5, stageH = 80, baseH = 60, topH = 50 }) {
  const r = dia / 2, ri = r * 0.86;
  const prof = [[0, 0], [r, 0], [r, baseH]];
  let z = baseH;
  for (let s = 0; s < stages; s++) {
    prof.push([ri, z + 6], [ri, z + stageH - 6], [r, z + stageH]);
    z += stageH;
  }
  prof.push([r * 0.7, z + topH], [0, z + topH]);
  return prof;
}

/** 곡관 엘보(쿼터 토러스) — revolve 부분각. bendR=중심선 곡률반경(코퍼스 실측 1.1D). */
export function curvedElbowPart({ id, pipeDia, bendR = null, at, rot = {}, angleDeg = 90, service, material = 'steel' }) {
  const R = bendR ?? pipeDia * CAL.flange.elbowRadiusRatio;
  const r = pipeDia / 2;
  const seg = 8;
  const prof = [];
  for (let k = 0; k <= seg; k++) {
    const th = (2 * Math.PI * k) / seg;
    prof.push([+(R + r * Math.cos(th)).toFixed(2), +(r + r * Math.sin(th)).toFixed(2)]);
  }
  return { id: id ?? uid('elbow'), type: 'revolve', params: { profile: prof, angleDeg }, at: { ...at, ...rot }, role: 'pipe', ...(service ? { service } : {}), material };
}
