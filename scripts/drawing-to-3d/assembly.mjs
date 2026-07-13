/**
 * 2D→3D 복합 어셈블리 — 어휘 5종 단품을 배치·결합해 다부품 제품을 만든다.
 *
 * 텍스트/편집으로 "부품 목록 + 상대 배치"를 정하면, 각 부품은 기존 결정론
 * 재구성(reconstruct)으로 만들고 translate/rotate로 배치해 union한다. AI는
 * 어셈블리 계획(부품·배치)까지만, 형상·게이트·간섭검사는 결정론.
 *
 * 어셈블리 intent:
 *   { name, parts: [{ id, type, params, at:{ tx,ty,tz, rx,ry,rz } }] }
 *
 * 검증 2단:
 *   ① 부품별 기하 게이트(범위·판재성·구멍 내접)
 *   ② 부품쌍 AABB 간섭 — 접촉(용접/체결)은 허용, 겹침 침투는 경고
 *      (skid 파일럿의 machine-level AABB 방식과 동일 사상)
 *
 * usage: node assembly.mjs '<assembly.json>'
 */
import { readFileSync } from 'node:fs';
import { gate, scadBody, partAabb } from './reconstruct.mjs';

const DEG = Math.PI / 180;
/** OpenSCAD rotate([rx,ry,rz]) 순서(X→Y→Z)로 점 회전. */
function rotatePoint([x, y, z], rx, ry, rz) {
  let p = [x, y, z];
  if (rx) { const c = Math.cos(rx * DEG), s = Math.sin(rx * DEG); p = [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
  if (ry) { const c = Math.cos(ry * DEG), s = Math.sin(ry * DEG); p = [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
  if (rz) { const c = Math.cos(rz * DEG), s = Math.sin(rz * DEG); p = [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }
  return p;
}

/**
 * 배치 후 정확한 AABB — 회전이 있으면 로컬 박스 8코너를 회전변환한 뒤 min/max로
 * 실제 경계상자를 계산한다(임의 각도 배치의 간섭검사가 정확해짐). 축정렬은 그대로.
 */
function placedAabb(part) {
  const a = partAabb({ type: part.type, ...part.params });
  const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = part.at ?? {};
  const rotated = !!(rx || ry || rz);
  if (!rotated) {
    return { min: [a.min[0] + tx, a.min[1] + ty, a.min[2] + tz], max: [a.max[0] + tx, a.max[1] + ty, a.max[2] + tz], rotated: false };
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const cx of [a.min[0], a.max[0]]) for (const cy of [a.min[1], a.max[1]]) for (const cz of [a.min[2], a.max[2]]) {
    const [px, py, pz] = rotatePoint([cx, cy, cz], rx, ry, rz);
    const w = [px + tx, py + ty, pz + tz];
    for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
  }
  return { min, max, rotated: true };
}

function overlapVolume(a, b) {
  const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  if (ox <= 0 || oy <= 0 || oz <= 0) return 0;
  return ox * oy * oz;
}

/**
 * 어셈블리 intent를 결정론적으로 빌드·검증한다 (Gemini 불필요, 순수).
 * @returns { ok, openscad, parts, gateErrors, interferences }
 */
export function buildAssembly(asm) {
  if (!asm || !Array.isArray(asm.parts) || asm.parts.length === 0) {
    return { ok: false, gateErrors: ['assembly: parts[] 비어있음'], interferences: [] };
  }
  const gateErrors = [];
  const bodies = [];
  const boxes = [];

  for (const p of asm.parts) {
    const intent = { type: p.type, ...p.params };
    const errs = gate(intent);
    if (errs.length) { gateErrors.push(`${p.id ?? p.type}: ${errs.join(', ')}`); continue; }
    const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = p.at ?? {};
    const wrap =
      `translate([${tx}, ${ty}, ${tz}]) ` +
      ((rx || ry || rz) ? `rotate([${rx}, ${ry}, ${rz}]) ` : '') +
      `{\n${scadBody(intent)}\n}`;
    bodies.push(`// ${p.id ?? p.type} (${p.type})\n${wrap}`);
    boxes.push({ id: p.id ?? p.type, box: placedAabb(p) });
  }
  if (gateErrors.length) return { ok: false, gateErrors, interferences: [] };

  // ② 부품쌍 간섭 — 겹침 부피가 유의미하면 경고(접촉/미세 오버랩은 통과).
  const interferences = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const v = overlapVolume(boxes[i].box, boxes[j].box);
      const rotated = boxes[i].box.rotated || boxes[j].box.rotated;
      if (v > 1) { // 1mm³ 초과 겹침
        interferences.push({
          a: boxes[i].id, b: boxes[j].id, overlapMm3: Math.round(v),
          note: rotated ? '회전 AABB 겹침(보수적 — 실솔리드는 더 작을 수 있음)' : 'AABB 겹침',
        });
      }
    }
  }

  // ③ 용접 조인트 개산 — 면접촉(2축 겹침 + 1축 gap≈0) 부품쌍을 조인트로 보고
  //    전둘레 필렛 용접선 길이·목두께 면적을 AABB 근사로 산정한다(비법정 개산).
  //    정밀 용접선은 실제 접촉 기하(면/엣지)에서 나온다 — 여기선 배치 기반 1차 추정.
  const welds = [];
  const TOL = 2; // mm — 면접촉 허용오차
  const FILLET_LEG = 6; // mm — 기본 필렛 다리(개산)
  const throat = +(0.707 * FILLET_LEG).toFixed(2);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i].box, B = boxes[j].box;
      const ov = [0, 1, 2].map((k) => Math.min(A.max[k], B.max[k]) - Math.max(A.min[k], B.min[k]));
      const touch = [0, 1, 2].filter((k) => Math.abs(ov[k]) <= TOL);
      const over = [0, 1, 2].filter((k) => ov[k] > TOL);
      if (touch.length === 1 && over.length === 2) {
        const perim = 2 * (ov[over[0]] + ov[over[1]]);
        welds.push({
          a: boxes[i].id, b: boxes[j].id,
          lengthMm: Math.round(perim), legMm: FILLET_LEG, throatMm: throat,
          throatAreaMm2: Math.round(perim * throat),
          note: '전둘레 필렛 개산 · AABB 접촉 기준 · 비법정',
        });
      }
    }
  }
  const weldTotalMm = welds.reduce((s, w) => s + w.lengthMm, 0);

  const openscad =
    `// assembly: ${asm.name ?? 'unnamed'} — drawing-to-3d (deterministic)\n` +
    `// parts: ${asm.parts.length}\n$fn = 64;\nunion() {\n${bodies.join('\n')}\n}\n`;

  return { ok: true, openscad, parts: boxes.map((b) => ({ id: b.id, aabb: b.box })), gateErrors: [], interferences, welds, weldTotalMm };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('assembly.mjs');
if (isMain && process.argv[2]) {
  const asm = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const r = buildAssembly(asm);
  console.log(JSON.stringify({ ok: r.ok, gateErrors: r.gateErrors, interferences: r.interferences, scadBytes: r.openscad?.length }, null, 1));
}
