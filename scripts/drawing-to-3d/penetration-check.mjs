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
 *  · 벽·슬래브는 **개구 좌표 규약이 다르다** — 벽은 수직면이라 `(x, sill)`, 슬래브는
 *    수평면이라 `(x, y)` 다. 260729c 에 각각의 좌표계로 대조하도록 나눴다(회전 반영).
 *    한쪽 규약을 다른 쪽에 들이대면 **sill 을 y 로 읽어** 엉뚱한 자리를 검사하게 된다.
 */

import { placedAabb } from './assembly.mjs';

const SERVICE_RE = /duct|pipe|배관|덕트|sleeve|vent|hvac/i;

/** 부품이 설비 계통인가 — role·service 우선, 없으면 id 키워드. */
function isService(p) {
  const role = String(p.role ?? '');
  if (role === 'duct' || role === 'pipe') return true;
  if (p.service) return true;
  return SERVICE_RE.test(String(p.id ?? ''));
}

/**
 * 부품의 **월드 AABB**. 배치·회전을 그대로 반영한다.
 *
 * ⚠ 치수를 `params.width/depth/height` 로 직접 읽으면 **어휘마다 필드명이 달라 조용히
 * 꺼진다.** 실측: `slab_with_openings` 는 `length/depth/thickness` 라 AABB 가 null 이 됐고,
 * 그 결과 **개구를 선언할수록 관통 검사가 사라졌다** — 고치라고 안내한 바로 그 행동이
 * 검사를 끄는 최악의 형태였다.
 *
 * ⚠ 260729c: 직접 짠 축정렬 계산이 **rx/ry 회전을 통째로 제외**하고 있었다. 그런데
 * `cylinder` 는 길이가 Z축이라 **수평 배관은 반드시 ry(또는 rx) 회전**이 붙는다 —
 * 실무에서 가장 흔한 벽 관통이 검사에서 빠져 있던 것이다(plant_room 실측: 관통 3개소 중
 * 2개소만 잡힘). `placedAabb` 는 8코너를 회전시켜 월드 AABB 를 내므로 전 회전을 다룬다.
 * 비축정렬 회전에서는 AABB 가 부풀지만 **보수측**(과탐)이고, 관통은 겹침으로 판단하므로
 * 놓치는 쪽보다 낫다.
 */
function aabb(p) {
  try {
    const b = placedAabb(p);
    if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) return null;
    if (![0, 1, 2].every((k) => Number.isFinite(b.min[k]) && b.max[k] > b.min[k])) return null;
    return { min: [...b.min], max: [...b.max] };
  } catch { return null; }
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
      let covered = null;
      if (isSlab && st.type === 'slab_with_openings') {
        // 슬래브는 수평판이라 개구가 **평면 (x, y)** 이고 두께 전체를 관통한다.
        const ops = st.params?.openings ?? [];
        covered = ops.some((o) => {
          const ax0 = tb.min[0] + Number(o.x), ax1 = ax0 + Number(o.w);
          const ay0 = tb.min[1] + Number(o.y), ay1 = ay0 + Number(o.d);
          // 관통 단면이 개구 안에 **들어가야** 한다(부분 겹침은 덮은 것이 아니다).
          return sb.min[0] >= ax0 - 1e-6 && sb.max[0] <= ax1 + 1e-6
            && sb.min[1] >= ay0 - 1e-6 && sb.max[1] <= ay1 + 1e-6;
        });
      } else if (!isSlab && st.type === 'wall_with_openings') {
        /**
         * 벽 개구 대조 (260729c) — 슬래브와 **좌표 규약이 다르다**.
         *
         * 벽은 수직면이라 개구가 `(x, sill)` 이다: x=벽 길이방향, sill=바닥에서의 높이,
         * 두께방향(로컬 Y)은 언제나 관통한다. 슬래브의 `(x, y)` 를 그대로 들이대면
         * **sill 을 y 로 읽어** 엉뚱한 자리를 검사하게 된다 — 그래서 앞서는 대조를
         * 보류하고 관통 사실만 보고했다.
         *
         * ⚠ 회전을 반영해야 한다. rz=90/270 이면 벽 길이방향이 월드 Y 다.
         *   개구의 x 는 **벽 로컬 좌표**이므로 월드로 옮길 때 그 축을 골라야 한다.
         */
        const ops = st.params?.openings ?? [];
        const rz = ((Number(st.at?.rz ?? 0) % 360) + 360) % 360;
        const swapped = Math.abs(rz - 90) < 1 || Math.abs(rz - 270) < 1;
        const lenAxis = swapped ? 1 : 0;          // 벽 길이방향의 월드 축
        covered = ops.some((o) => {
          const l0 = tb.min[lenAxis] + Number(o.x), l1 = l0 + Number(o.w);
          const z0 = tb.min[2] + Number(o.sill ?? 0), z1 = z0 + Number(o.h);
          return sb.min[lenAxis] >= l0 - 1e-6 && sb.max[lenAxis] <= l1 + 1e-6
            && sb.min[2] >= z0 - 1e-6 && sb.max[2] <= z1 + 1e-6;
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
  // 대조 규약이 없는 어휘(개구를 못 담는 `box` 슬래브·벽)는 「개구 미선언」이고,
  // 개구 어휘인데 안 덮으면 「개구 부족」이다 — 둘 다 FAIL 이지만 조치가 다르다.
  const undeclared = missing.filter((h) => h.covered === null);
  const notCovered = missing.filter((h) => h.covered === false);
  return {
    labelKo: `설비 관통 ↔ 구조 개구 (관통 ${hits.length}개소)`,
    pass: missing.length ? false : true,
    detail: [
      ...missing.slice(0, 6).map((h) =>
        `${h.service} 가 ${h.target}(${h.kind === 'slab' ? '슬래브' : '벽'})를 관통하는데 `
        + (h.covered === false ? '**개구가 관통 단면을 덮지 못한다**' : '**개구가 선언되지 않았다**')
        + `(겹침 ${h.overlapMm.x}×${h.overlapMm.y}×${h.overlapMm.z}mm)`
        + (h.covered === null
          ? ` — \`${h.kind === 'slab' ? 'slab_with_openings' : 'wall_with_openings'}\` 로 개구를 선언해야 한다.`
          : '')),
      ...(missing.length > 6 ? [`… 외 ${missing.length - 6}개소(미선언 ${undeclared.length} · 부족 ${notCovered.length})`] : []),
      ...(hits.length - missing.length ? [`개구가 확인된 관통 ${hits.length - missing.length}개소.`] : []),
      '벽 개구는 (x, sill) · 슬래브 개구는 (x, y) 규약이라 **각각의 좌표계로** 대조했다(회전 반영).',
      '⚠ 관통 판정은 **AABB 겹침**이다(실형상 부울 아님 — 보수측). 슬리브 여유는 계통·용도가 정하므로 판정하지 않는다.',
      ...(unresolved.length ? [`⚠ ${[...new Set(unresolved)].length}개 부품은 회전이 축정렬이 아니라 제외했다 — 판정 불가.`] : []),
    ],
  };
}
