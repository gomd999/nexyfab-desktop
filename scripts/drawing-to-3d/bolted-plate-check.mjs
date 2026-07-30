/**
 * bolted-plate-check.mjs — 볼트 접합 판재 검토 (260801b, 계획 ⑤).
 *
 * ## 왜 필요한가
 * 이 세션에 템플릿을 4종 추가했는데(`gusset_bracket`·`masonry_wall`·`motor_mount`
 * ·조적) **판정이 하나도 붙지 않았다.** 「어휘를 추가하고 소비자를 안 만들었다」의
 * 한 층 위 판이고, 어휘 층 회귀(`vocab-consumers`)는 이걸 잡지 못한다.
 *
 * 볼트 접합판은 **형상이 답을 갖고 있다** — 홀 좌표·지름·판 외곽이 다 선언돼 있으므로
 * 연단거리·볼트 간격은 계산만 하면 된다. 계산 안 하고 두는 것이 결함이었다.
 *
 * ## 무엇을 판정하는가 — 형상 파생만
 *  · **연단거리** — 홀 중심에서 판 외곽까지의 최단거리 ≥ 규정 하한
 *  · **볼트 간격** — 홀 중심 간 최단거리 ≥ 3d(표준 하한)
 *  · **홀 지름 대비 볼트** — 표준 여유(볼트경 + 1~2mm) 범위인지
 *
 * ## 지어내지 않는 것
 *  · **볼트 강도·접합부 내력** — 하중이 선언돼 있지 않다. 연단거리가 적합해도
 *    하중을 못 버티면 무의미하다 — 안 했다고 적는다.
 *  · **순단면 인장·블록 전단** — 같은 이유(하중 미선언).
 *  · 판 두께 대비 좌굴·와셔 사양은 판정하지 않는다.
 *
 * ## 기준
 * KDS 14 31 25 §4.4(볼트 접합) — 연단거리 하한은 **볼트경과 가공법(전단연·압연연)** 이
 * 정한다. 여기서는 널리 쓰이는 **1.5d(가공연) / 1.25d(압연·절단연)** 두 값을 함께 보고
 * 어느 쪽에 걸리는지를 밝힌다 — 가공법이 선언돼 있지 않으므로 우리가 정하지 않는다.
 * 볼트 간격 하한 **3d** 는 표준 관례값이며 원문 표 절점이 아니다(그렇게 적는다).
 */

import { expandHoles } from './reconstruct.mjs';

/**
 * ⚠ 패턴 전개는 `reconstruct.mjs` 의 `expandHoles` 를 **그대로 쓴다.**
 *   처음엔 이 파일에 최소 구현을 복제했다 — 그러면 규칙이 갈리는 순간 **판정이 형상과
 *   다른 홀을 보게 된다**(이 세션 내내 고쳐 온 안티패턴을 내가 다시 만든 것이었다).
 */

const r1 = (v) => +Number(v).toFixed(1);

/** 점에서 폴리곤 변까지의 최단거리(폴리곤 내부 가정). */
function distToPolygon(px, py, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/**
 * 볼트 접합 판재 검토. `extrude_profile` 판재(홀 보유)가 없으면 **null**(해당 없음).
 *
 * ⚠ `composite` 안의 하위 판재도 본다 — 복합 부품이라고 볼트가 사라지지 않는다.
 *   처음에 최상위 부품만 보게 짜면 `motor_mount` 가 통째로 빠진다(실측으로 확인).
 */
export function boltedPlateCheck(assembly, params = {}) {
  const flat = [];
  for (const p of assembly?.parts ?? []) {
    if (p.unverified === true) continue;
    if (p.type === 'extrude_profile') flat.push({ id: p.id, params: p.params ?? {} });
    else if (p.type === 'composite') {
      for (const [n, sb] of (p.params?.subs ?? []).entries()) {
        if (sb?.type === 'extrude_profile') flat.push({ id: `${p.id}.subs[${n}]`, params: sb.params ?? {} });
      }
    }
  }
  const plates = flat.filter((x) => Array.isArray(x.params.holes) && x.params.holes.length);
  if (!plates.length) return null;

  const checks = {};
  let worstEdge = Infinity, worstEdgeD = 0, worstEdgeId = null;
  let worstPitch = Infinity, worstPitchD = 0, worstPitchId = null;
  let holeTotal = 0;
  const oversize = [];

  for (const pl of plates) {
    const poly = (pl.params.profile ?? []).map((q) => [Number(q[0]), Number(q[1])]);
    if (poly.length < 3) continue;
    const holes = expandHoles(pl.params.holes);
    holeTotal += holes.length;
    for (const h of holes) {
      const d = Number(h.d);
      // 카운터보어가 있으면 **외경이 지배**한다 — 머리 자리가 판 밖으로 나가면 안 된다.
      const outer = h.kind === 'cbore' && Number(h.cbDia) > d ? Number(h.cbDia)
        : h.kind === 'csink' && Number(h.csDia) > d ? Number(h.csDia) : d;
      const e = distToPolygon(Number(h.x), Number(h.y), poly) - outer / 2;
      // **비(e/d)가 최소**인 홀이 지배한다 — 절대거리로 고르면 큰 볼트가 가려진다.
      if (!worstEdgeD || e / d < worstEdge / worstEdgeD) { worstEdge = e; worstEdgeD = d; worstEdgeId = pl.id; }
      if (h.thread == null && h.kind !== 'tap') {
        // 관통·카운터보어는 볼트가 들어가므로 여유가 표준 범위인지 본다(탭은 나사라 해당 없음).
        const nominal = Math.round(d) - 1;   // 관례: 볼트경 + 1mm
        if (d - nominal > 3) oversize.push(`${pl.id} d${d}`);
      }
    }
    for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        const a = holes[i], b = holes[j];
        const dist = Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
        const dd = Math.max(Number(a.d), Number(b.d));
        if (!worstPitchD || dist / dd < worstPitch / worstPitchD) { worstPitch = dist; worstPitchD = dd; worstPitchId = pl.id; }
      }
    }
  }

  // ── ① 연단거리 ────────────────────────────────────────────────────────────
  if (worstEdgeId) {
    const ratio = worstEdge / worstEdgeD;
    const NEED_CUT = 1.5, NEED_ROLLED = 1.25;
    checks.edgeDistance = {
      labelKo: `볼트 연단거리 최소 ${r1(worstEdge)}mm (볼트경 ${worstEdgeD}mm 의 ${r1(ratio)}배) — ${worstEdgeId}`,
      verdict: ratio >= NEED_CUT ? 'PASS' : ratio >= NEED_ROLLED ? 'CHECK' : 'FAIL',
      pass: ratio >= NEED_CUT ? true : ratio >= NEED_ROLLED ? null : false,
      detail: [
        `가공연 기준 ${NEED_CUT}d = ${r1(NEED_CUT * worstEdgeD)}mm · 압연·절단연 기준 ${NEED_ROLLED}d = ${r1(NEED_ROLLED * worstEdgeD)}mm`,
        ratio >= NEED_CUT
          ? '**두 기준 모두 만족한다** — 판 가공법을 몰라도 결론이 갈리지 않는다.'
          : ratio >= NEED_ROLLED
            ? '**결론이 판 가공법에 달렸다** — 압연·절단연이면 적합, 가공연(전단·화염)이면 미달이다. '
              + '가공법이 선언되지 않아 확정하지 않는다.'
            : '**어느 기준으로도 미달이다.**',
        '카운터보어·싱크가 있으면 **머리 외경**을 기준으로 쟀다(머리 자리가 판 밖으로 나가면 안 된다).',
      ],
      note: 'KDS 14 31 25 §4.4 계열 — 하한은 볼트경·가공법이 정한다. 응력 방향별 강화(하중 방향 연단)는 미반영.',
    };
  }

  // ── ② 볼트 간격 ───────────────────────────────────────────────────────────
  if (worstPitchId && Number.isFinite(worstPitch)) {
    const ratio = worstPitch / worstPitchD;
    checks.boltPitch = {
      labelKo: `볼트 간격 최소 ${r1(worstPitch)}mm (볼트경의 ${r1(ratio)}배) — ${worstPitchId}`,
      pass: ratio >= 3,
      detail: [
        `표준 하한 3d = ${r1(3 * worstPitchD)}mm · 실제 ${r1(worstPitch)}mm`,
        ratio >= 3 ? '체결 공구 접근·판 파열 여유가 확보된다.' : '**간격이 3d 미만이다** — 체결 공구가 들어가지 않거나 판이 찢어질 수 있다.',
      ],
      note: '3d 는 널리 쓰이는 관례 하한이며 **원문 표 절점이 아니다**(프로젝트 기준 확인 필요).',
    };
  }

  if (oversize.length) {
    checks.holeClearance = {
      labelKo: `볼트 여유 과대 ${oversize.length}건`, pass: false,
      detail: [`홀 지름이 표준 여유(볼트경 +1~2mm)를 크게 넘는다: ${oversize.slice(0, 4).join(' · ')}`,
        '여유가 크면 볼트가 미끄러져 접합부가 밀린다(마찰접합이면 특히).'],
    };
  }

  return {
    ok: true,
    label: '볼트 접합 판재 검토 (연단거리·간격)',
    checks,
    basis: { plates: plates.length, holes: holeTotal },
    notChecked: [
      {
        labelKo: '볼트 강도·접합부 내력 (KDS 14 31 25 §4.4)',
        messageKo: '**하중이 선언되지 않아** 볼트 전단·지압·순단면 인장·블록전단을 판정할 수 없다. '
          + '연단거리·간격이 적합해도 **하중을 못 버티면 무의미하다.**',
      },
      {
        labelKo: '판 가공법 (연단거리 하한을 정한다)',
        messageKo: '압연·절단연 1.25d 와 가공연 1.5d 가 다르다. 선언되면 위 판정이 확정된다.',
      },
    ],
    refs: ['KDS 14 31 25 §4.4 (볼트 접합 — 연단거리)', '볼트 간격 3d(관례 하한 — 표 절점 아님)'],
    disclaimer: '개념 검토(비법정) — 형상 파생 치수 기준. 하중·접합부 내력은 미검토. 실시설계는 구조기술사 검토 필요.',
  };
}
