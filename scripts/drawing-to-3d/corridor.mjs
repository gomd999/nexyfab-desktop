/**
 * 코리더 모델링 — 갭 매트릭스 빈칸 ③ (Civil 3D 코리더 상당).
 *
 * ## 무엇인가
 * **횡단면(subassembly)을 선형(alignment)을 따라 스윕**해 3D 본체와 물량을 낸다.
 * 도로·수로·제방·옹벽 연장이 전부 이 형태다. 종전에 우리에게 있던 `corridorMm` 은
 * 선형 주변 **측방 필터 폭**이었지 코리더 모델링이 아니었다(갭 매트릭스 정정 대장 참조).
 *
 * ## 방법과 그 한계 — **정직하게 적는다**
 * 스테이션마다 횡단면을 놓고 **구간마다 각기둥(prism)** 으로 채운다. 곡선 구간에서는
 * 현(chord) 근사이고, 그 오차는 `sagMm`(현–호 최대 이격)으로 **계산해 함께 낸다**.
 * ```
 *   직선 구간   오차 0
 *   곡선 구간   sag = R(1 − cos(Δ/2)),  Δ = step/R
 *   → step 을 줄이면 줄어든다. 얼마나 줄었는지 사용자가 알 수 있게 값으로 낸다.
 * ```
 * ⚠ 편경사(superelevation)·확폭은 **선언한 만큼만** 반영한다. 안 준 것을 표준값으로
 *   채우지 않는다 — 도로 설계기준은 발주처·등급마다 다르고, 지어내면 그게 틀린 답이 된다.
 * ⚠ 여기서 내는 것은 **형상과 물량**이다. 종단곡선·편경사 설계 자체는 도메인 계산 영역이다.
 */
import { buildElements, chainAt } from './alignment-geom.mjs';

/**
 * 횡단면 = 선형 중심선 기준 (offset, height) 점열. offset 은 좌(−)/우(+), height 는 상(+).
 * 닫힌 폴리곤이어야 한다(첫점=끝점 자동 폐합).
 * @typedef {{ id?:string, points:Array<[number,number]>, material?:string, role?:string }} CorridorSection
 */

/**
 * 선형을 따라 횡단면을 스윕해 **부품 배열**로 낸다(우리 어휘 `extrude_profile` 각기둥).
 *
 * @param {{ips?:Array, elements?:Array, sections:CorridorSection[], stepMm?:number,
 *          startMm?:number, endMm?:number, superelevation?:Array<{sta:number, pct:number}>}} spec
 * @returns {{name:string, domain:'civil', parts:Array, corridorMeta:object, alignmentErrors?:string[]}}
 */
export function buildCorridor(spec = {}) {
  const errors = [];
  const sections = Array.isArray(spec.sections) ? spec.sections.filter((s) => Array.isArray(s?.points) && s.points.length >= 3) : [];
  if (!sections.length) errors.push('sections[]: 점 3개 이상의 횡단면이 최소 하나 필요하다');

  let elements = spec.elements;
  if (!elements) {
    if (!Array.isArray(spec.ips) || spec.ips.length < 2) errors.push('ips[] 또는 elements[] 가 필요하다(IP 2점 이상)');
    else ({ elements } = buildElements(spec.ips, spec.curves ?? []));
  }
  if (errors.length) return { name: '코리더', domain: 'civil', parts: [], alignmentErrors: errors };

  const total = elements[elements.length - 1].ch0 + elements[elements.length - 1].len;
  const s0 = Math.max(0, Number(spec.startMm ?? 0));
  const s1 = Math.min(total, Number(spec.endMm ?? total));
  const step = Math.max(100, Number(spec.stepMm ?? 5000));
  if (!(s1 > s0)) return { name: '코리더', domain: 'civil', parts: [], alignmentErrors: [`구간이 비었다(${s0}~${s1})`] };

  /** 스테이션에서의 편경사(%) — **선언된 구간만**. 없으면 0(지어내지 않는다). */
  const superAt = (s) => {
    const list = spec.superelevation ?? [];
    if (!list.length) return 0;
    const sorted = [...list].sort((a, b) => a.sta - b.sta);
    if (s <= sorted[0].sta) return sorted[0].pct;
    if (s >= sorted[sorted.length - 1].sta) return sorted[sorted.length - 1].pct;
    for (let i = 1; i < sorted.length; i++) {
      if (s <= sorted[i].sta) {
        const t = (s - sorted[i - 1].sta) / (sorted[i].sta - sorted[i - 1].sta);
        return sorted[i - 1].pct + t * (sorted[i].pct - sorted[i - 1].pct); // 선형 천이
      }
    }
    return 0;
  };

  const parts = [];
  let volumeMm3 = 0;
  let maxSagMm = 0;
  const stations = [];
  for (let s = s0; s < s1 - 1e-6; s += step) {
    const segLen = Math.min(step, s1 - s);
    const mid = s + segLen / 2;
    const at = chainAt(elements, mid);
    const headingDeg = (Math.atan2(at.dir[1], at.dir[0]) * 180) / Math.PI;
    // 곡선 구간 현 근사 오차: 요소 반경을 알면 폐형으로 낸다(직선이면 0)
    const el = elements.find((e) => mid <= e.ch0 + e.len + 1e-6) ?? elements[elements.length - 1];
    const sag = el.type === 'line' ? 0 : el.R * (1 - Math.cos(segLen / (2 * el.R)));
    if (sag > maxSagMm) maxSagMm = sag;
    const supPct = superAt(mid);

    for (const [si, sec] of sections.entries()) {
      /**
       * 로컬 프로파일: x = 진행방향 길이(0..segLen), y = 횡방향 offset, z = 높이.
       * `extrude_profile` 은 xy 폴리곤을 z 로 뽑으므로 **(offset, height) 를 xy 로 두고
       * 진행방향으로 뽑은 뒤** 세워서 배치한다 — 프로파일 그대로가 단면이 되게 한다.
       * 편경사는 offset 에 비례한 높이 증분으로 반영한다(선언된 %만).
       */
      const profile = sec.points.map(([off, h]) => [off, h + (supPct / 100) * off]);
      parts.push({
        id: `${sec.id ?? 'sec'}_${Math.round(s)}`,
        type: 'extrude_profile',
        params: { profile, depth: segLen, filletR: 0 },
        // ry:-90 → 뽑기축(z)이 x 로 눕는다. rz=heading → 선형 방향으로 돌린다.
        at: { tx: at.p[0], ty: at.p[1], tz: 0, ry: -90, rz: headingDeg },
        material: sec.material ?? 'concrete',
        role: sec.role ?? 'pavement',
        /**
         * ⚠ **실물은 한 몸이다.** 스테이션마다 각기둥으로 나눈 것은 모델링 편의이고,
         * 곡선에서 인접 구간이 안쪽으로 조금 겹치는 것은 현 근사의 필연이지 설계 오류가 아니다.
         * 이 선언이 없으면 간섭 판정이 구간 수만큼 오탐한다(실측: 48부품에서 34건).
         */
        continuousWith: `corridor:${sec.id ?? 'sec'}`,
      });
      volumeMm3 += polygonArea(profile) * segLen;
      if (si === 0) stations.push({ staMm: Math.round(mid), x: +at.p[0].toFixed(1), y: +at.p[1].toFixed(1), headingDeg: +headingDeg.toFixed(3), superPct: +supPct.toFixed(2) });
    }
  }

  return {
    name: `코리더 ${Math.round((s1 - s0) / 1000)}m (단면 ${sections.length}종 · 스텝 ${step}mm)`,
    domain: 'civil', kind: 'assembly', parts,
    corridorMeta: {
      lengthMm: +(s1 - s0).toFixed(1), stepMm: step, stations: stations.length,
      sectionCount: sections.length,
      volumeM3: +(volumeMm3 / 1e9).toFixed(3),
      /**
       * ⚠ **현 근사 오차를 값으로 낸다.** 「곡선은 근사입니다」라고만 쓰면 얼마나 틀렸는지
       *   모른다. step 을 줄이면 이 값이 줄어든다는 것도 사용자가 확인할 수 있어야 한다.
       */
      maxChordSagMm: +maxSagMm.toFixed(2),
      superelevationDeclared: (spec.superelevation ?? []).length,
      stationTable: stations.slice(0, 200),
    },
    note: '횡단면 스윕(구간별 각기둥). 곡선은 현 근사이고 최대 이격은 maxChordSagMm 로 낸다. '
      + '편경사는 선언된 구간만 선형 천이로 반영 — 미선언 구간은 0(표준값으로 채우지 않는다). '
      + '종단곡선·편경사 설계 자체는 도메인 계산 영역이다.',
  };
}

/** 폴리곤 면적(신발끈) — 부호 무시. */
function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
