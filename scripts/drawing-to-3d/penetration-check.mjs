/**
 * penetration-check.mjs — 설비 관통 ↔ 구조 개구 정합 (260729b, 계획 P1-7).
 *
 * ## 무엇이 문제였나
 * 덕트·배관이 슬래브나 벽을 지나가면 **개구(슬리브)를 뚫어야** 한다. 그런데 지금 그
 * 교차는 `buildAssembly` 의 **간섭(interference)** 으로만 나오고, 간섭은 「부딪히면 안 되는
 * 것이 부딪혔다」는 뜻으로 읽힌다. 설비 관통은 **정상 설계**이고 필요한 것은 개구 선언이다.
 * 둘을 구별하지 않으면, 정상 설계가 오류로 읽히거나(과탐) 개구 누락이 간섭 목록에
 * 묻힌다(누락). 현장에서는 개구 누락이 곧 재시공이다.
 *
 * `slab_with_openings` 어휘가 생겼으므로(260729) **선언된 개구와 실제 관통 위치를 대조**할
 * 수 있게 됐다 — 그 경로를 여기서 잇는다.
 *
 * ## 지어내지 않는 것
 *  · 관통 여부는 **AABB 겹침**으로만 판단한다. 실형상 부울이 아니라 보수측(과탐 가능)이며
 *    그 사실을 적는다. 겹치지 않으면 관통이 아니다 — 이건 확실하다.
 *  · 슬리브 여유(관경+50mm 등)는 **기준이 용도·계통마다 달라** 판정하지 않는다.
 *    개구가 관통 단면을 덮는지만 본다.
 *  · 벽 관통은 `wall_with_openings` 의 개구가 (x, sill) 이라 슬래브와 규약이 다르다 —
 *    현재는 슬래브만 대조하고 벽은 **관통 사실만** 보고한다(대조 미실시를 명시).
 */

import { partAabb } from './reconstruct.mjs';

const SERVICE_RE = /duct|pipe|배관|덕트|sleeve|vent|hvac/i;

/** 부품이 설비 계통인가 — role·service 우선, 없으면 id 키워드. */
function isService(p) {
  const role = String(p.role ?? '');
  if (role === 'duct' || role === 'pipe') return true;
  if (p.service) return true;
  return SERVICE_RE.test(String(p.id ?? ''));
}

/**
 * 축정렬 월드 AABB. 회전이 축정렬이 아니면 null — 판정하지 않는다.
 *
 * ⚠ 치수를 `params.width/depth/height` 로 직접 읽으면 **어휘마다 필드명이 달라 조용히
 * 꺼진다.** 실측: `slab_with_openings` 는 `length/depth/thickness` 라 AABB 가 null 이 됐고,
 * 그 결과 **개구를 선언할수록 관통 검사가 사라졌다** — 고치라고 안내한 바로 그 행동이
 * 검사를 끄는 최악의 형태다. `partAabb` 는 전 어휘의 로컬 경계를 알고 있으므로 그걸 쓴다.
 */
function aabb(p) {
  const rz = ((Number(p.at?.rz ?? 0) % 360) + 360) % 360;
  const axis = [0, 90, 180, 270].some((a) => Math.abs(rz - a) < 1);
  if (!axis || Number(p.at?.rx) || Number(p.at?.ry)) return null;
  let lb = null;
  try { lb = partAabb({ type: p.type, ...(p.params ?? {}) }); } catch { return null; }
  if (!lb || !Array.isArray(lb.min) || !Array.isArray(lb.max)) return null;
  const w = lb.max[0] - lb.min[0], d = lb.max[1] - lb.min[1], h = lb.max[2] - lb.min[2];
  if (!(w > 0) || !(d > 0) || !(h > 0)) return null;
  const swap = Math.abs(rz - 90) < 1 || Math.abs(rz - 270) < 1;
  const dx = swap ? d : w, dy = swap ? w : d;
  const x = Number(p.at?.tx ?? 0), y = Number(p.at?.ty ?? 0), z = Number(p.at?.tz ?? 0);
  return { min: [x, y, z], max: [x + dx, y + dy, z + h] };
}

const overlap1 = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1);

/**
 * 설비 관통 검토. 건축 어셈블리가 아니거나 설비·구조 중 하나가 없으면 **null**(해당 없음).
 */
export function penetrationCheck(assembly) {
  const parts = (assembly?.parts ?? []).filter((p) => p.unverified !== true);
  const services = parts.filter(isService);
  const slabs = parts.filter((p) => p.role === 'slab');
  const walls = parts.filter((p) => p.role === 'wall');
  if (!services.length || (!slabs.length && !walls.length)) return null;

  const hits = [];          // 실제 관통(겹침)
  const unresolved = [];    // 회전 등으로 AABB 를 못 낸 것 — 판정 불가
  for (const s of services) {
    const sb = aabb(s);
    if (!sb) { unresolved.push(s.id ?? s.type); continue; }
    for (const st of [...slabs, ...walls]) {
      const tb = aabb(st);
      if (!tb) { unresolved.push(st.id ?? st.type); continue; }
      const ox = overlap1(sb.min[0], sb.max[0], tb.min[0], tb.max[0]);
      const oy = overlap1(sb.min[1], sb.max[1], tb.min[1], tb.max[1]);
      const oz = overlap1(sb.min[2], sb.max[2], tb.min[2], tb.max[2]);
      if (!(ox > 0 && oy > 0 && oz > 0)) continue;
      const isSlab = st.role === 'slab';
      // 슬래브 관통이면 선언된 개구가 그 자리를 덮는지 본다(개구는 슬래브 로컬 좌표).
      let covered = null;
      if (isSlab && st.type === 'slab_with_openings') {
        const ops = st.params?.openings ?? [];
        covered = ops.some((o) => {
          const ax0 = tb.min[0] + Number(o.x), ax1 = ax0 + Number(o.w);
          const ay0 = tb.min[1] + Number(o.y), ay1 = ay0 + Number(o.d);
          // 관통 단면이 개구 안에 **들어가야** 한다(부분 겹침은 덮은 것이 아니다).
          return sb.min[0] >= ax0 - 1e-6 && sb.max[0] <= ax1 + 1e-6
            && sb.min[1] >= ay0 - 1e-6 && sb.max[1] <= ay1 + 1e-6;
        });
      }
      hits.push({
        service: s.id ?? s.type, target: st.id ?? st.type, kind: isSlab ? 'slab' : 'wall',
        overlapMm: { x: +ox.toFixed(1), y: +oy.toFixed(1), z: +oz.toFixed(1) },
        covered,
      });
    }
  }

  if (!hits.length) {
    return {
      labelKo: '설비 관통 ↔ 구조 개구', pass: null,
      detail: [
        `설비 ${services.length}개와 구조(슬래브 ${slabs.length}·벽 ${walls.length})가 **겹치지 않는다** — 관통이 없다.`,
        '천장 아래 매달린 덕트·노출 배관은 관통이 아니다(해당 없음).',
        ...(unresolved.length ? [`⚠ ${[...new Set(unresolved)].length}개 부품은 회전이 축정렬이 아니라 관통을 판정하지 못했다.`] : []),
      ],
    };
  }

  const missing = hits.filter((h) => h.covered !== true);
  const wallHits = missing.filter((h) => h.kind === 'wall');
  const slabMissing = missing.filter((h) => h.kind === 'slab');
  return {
    labelKo: `설비 관통 ↔ 구조 개구 (관통 ${hits.length}개소)`,
    // 벽 관통은 대조 규약이 달라 **판정하지 않는다** — 슬래브 누락이 없으면 판정 보류.
    pass: slabMissing.length ? false : (wallHits.length ? null : true),
    detail: [
      ...slabMissing.slice(0, 6).map((h) =>
        `${h.service} 가 ${h.target} 를 관통하는데 **개구가 선언되지 않았다**`
        + `(겹침 ${h.overlapMm.x}×${h.overlapMm.y}×${h.overlapMm.z}mm)`
        + (h.covered === false ? ' — 개구는 있으나 관통 단면을 덮지 못한다.' : ' — `slab_with_openings` 로 개구를 선언해야 한다.')),
      ...(slabMissing.length > 6 ? [`… 외 ${slabMissing.length - 6}개소`] : []),
      ...(wallHits.length ? [`벽 관통 ${wallHits.length}개소 — 벽 개구는 (x, sill) 규약이라 여기서 **대조하지 않았다**(관통 사실만 보고).`] : []),
      ...(hits.length - missing.length ? [`개구가 확인된 관통 ${hits.length - missing.length}개소.`] : []),
      '⚠ 관통 판정은 **AABB 겹침**이다(실형상 부울 아님 — 보수측). 슬리브 여유는 계통·용도가 정하므로 판정하지 않는다.',
      ...(unresolved.length ? [`⚠ ${[...new Set(unresolved)].length}개 부품은 회전이 축정렬이 아니라 제외했다 — 판정 불가.`] : []),
    ],
  };
}
