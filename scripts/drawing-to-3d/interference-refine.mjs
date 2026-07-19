/**
 * interference-refine.mjs — 의심쌍 메시 부울 2차 간섭(정확도 B1, 260719).
 *
 * AABB/폐형 규칙이 보수적으로 남긴 간섭쌍만 openscad `intersection()` 실기하 부울로
 * 재판정 — 회전·사면·revolve·자유곡면 전 조합에서 정확(근사 아님·실렌더).
 * 교집합 부피 ≤ ε(기본 1mm³) = 실분리 → 간섭 해제(정제 내역 공개). > ε = 간섭 확정
 * (실측 부피 동봉 — AABB 추정보다 정확한 관통량).
 *
 * 비용: 쌍당 openscad 1회(수백 ms) — 의심쌍 한정 호출이 전제(전수 아님 명시).
 */
import { assemblyToComposeIntent } from './assembly.mjs';
import { emitComposite } from './compose.mjs';
import { renderStl } from './verify.mjs';

/** 바이너리 STL 부피(부호 사면체 — 닫힌 메시 전제, openscad 산출은 닫힘). */
export function stlVolume(bytes) {
  if (!bytes || bytes.length < 84) return 0;
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  const n = dv.getUint32(80, true);
  let vol6 = 0;
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    const ax = dv.getFloat32(o, true), ay = dv.getFloat32(o + 4, true), az = dv.getFloat32(o + 8, true);
    const bx = dv.getFloat32(o + 12, true), by = dv.getFloat32(o + 16, true), bz = dv.getFloat32(o + 20, true);
    const cx = dv.getFloat32(o + 24, true), cy = dv.getFloat32(o + 28, true), cz = dv.getFloat32(o + 32, true);
    vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return Math.abs(vol6 / 6);
}

/**
 * 간섭 목록(의심쌍) → 메시 부울 재판정.
 * @param asm 어셈블리(parts[])
 * @param interferences buildAssembly 산출 간섭 배열({a,b,...})
 * @returns { interferences(확정만·intersectMm3 동봉), demoted(해제 내역), checked }
 */
export async function refineInterferencesMesh(asm, interferences, { epsMm3 = 1 } = {}) {
  const intent = assemblyToComposeIntent(asm);
  const pidOf = new Map((asm.parts ?? []).map((p, i) => [p.id ?? p.type, i]));
  const confirmed = [];
  const demoted = [];
  let checked = 0;
  for (const rec of interferences ?? []) {
    const ia = pidOf.get(rec.a), ib = pidOf.get(rec.b);
    if (ia == null || ib == null) { confirmed.push(rec); continue; }
    const fa = intent.features.filter((f) => f._pid === ia);
    const fb = intent.features.filter((f) => f._pid === ib);
    if (!fa.length || !fb.length) { confirmed.push(rec); continue; }
    checked++;
    // 마커 큐브(1e-6mm³, AABB 밖) — 빈 교집합이면 openscad 가 STL 자체를 안 써서(FS error)
    // 실분리가 실패로 오인됨 → 항상 지오메트리 보장, 마커 부피는 ε 대비 무시 가능(명시)
    const scad = `module __A(){\n${emitComposite({ name: 'a', features: fa })}\n}\nmodule __B(){\n${emitComposite({ name: 'b', features: fb })}\n}\nunion(){ intersection(){ __A(); __B(); } translate([1e6,1e6,1e6]) cube([0.01,0.01,0.01]); }`;
    let vol = null;
    try {
      const stl = await renderStl(scad);
      vol = stlVolume(stl);
    } catch (e) {
      confirmed.push({ ...rec, note: `${rec.note ?? ''} · 메시 부울 실패(${String(e?.message ?? e).slice(0, 40)}) — 보수 유지(정직)` });
      continue;
    }
    if (vol <= epsMm3) {
      demoted.push({ a: rec.a, b: rec.b, intersectMm3: +vol.toFixed(3), note: '메시 부울 실기하 — 실분리(AABB/폐형 보수 과탐 해제)' });
    } else {
      confirmed.push({ ...rec, intersectMm3: +vol.toFixed(1), note: `${rec.note ?? ''} · 메시 부울 확정(교집합 ${vol.toFixed(1)}mm³)`.trim() });
    }
  }
  return { interferences: confirmed, demoted, checked, note: '의심쌍 한정 2차(전수 아님) — ε=' + epsMm3 + 'mm³' };
}
