/**
 * P15 조경 — 식재기반·수목 검토 (KDS 34 30 10·34 40 10 원문 표 전사).
 * ①생육토심 게이트: 표 1.6-1 (식물종류 5 × 인공토/자연토/혼합토 생존최소 +
 *   토양 중급/상급 생육최소 + 배수층) ②객토량 깊이: 표 3.1-1 ③식재밀도:
 *   표 4.2-1 (도시공원 종류별 교목/관목/생울타리 주/㎡) ④수목 중량(이식):
 *   식 4.4-1 W=k·3.14·(B/2)²·h·w₁·(1+p), k=0.5·B=흉고(m)(근원×0.8)·p 0.2~0.3
 *   + 지하부(뿌리분 체적 입력 × 1,300kg/m³ — §4.4.4(3) 원문 기본값)
 *   ⑤규격환산: 표 4.4-3 (근원↔흉고·수고 — 구간 선형보간, 원문 이산표 명시).
 * 전 수치 = KDS 원문 전사(날조 없음). 수종별 상세 생육 DB(내음성·근계 등)는
 *   공인 단일 출처 부재로 보류 명시 — 수간 단위중량은 표 4.4-1 그룹 선택 입력.
 */
const SOIL_DEPTH = { // 표 1.6-1 [생존: 인공토/자연토/혼합토, 생육: 중급/상급, 배수층] cm
  '잔디초화류': { artificial: 10, natural: 15, mixed: 13, growMid: 30, growHigh: 25, drain: 10 },
  '소관목': { artificial: 20, natural: 30, mixed: 25, growMid: 45, growHigh: 40, drain: 15 },
  '대관목': { artificial: 30, natural: 45, mixed: 38, growMid: 60, growHigh: 50, drain: 20 },
  '천근성교목': { artificial: 40, natural: 60, mixed: 50, growMid: 90, growHigh: 70, drain: 30 },
  '심근성교목': { artificial: 60, natural: 90, mixed: 75, growMid: 150, growHigh: 100, drain: 30 },
};
const SOIL_REPLACE = { '교목': 1.0, '아교목': 0.7, '관목': 0.5, '지피초화류': 0.25 }; // 표 3.1-1 (지피 0.2~0.3 중앙 0.25 명시)
const DENSITY = { // 표 4.2-1 주/㎡
  '어린이공원': { tree: 0.068, shrub: 0.133, hedge: 0.025 }, '근린생활권근린공원': { tree: 0.015, shrub: 0.224, hedge: 0.012 },
  '근린도보권공원': { tree: 0.053, shrub: 0.203, hedge: 0.011 }, '도시계획근린공원': { tree: 0.089, shrub: 0.198, hedge: 0.006 },
  '광역권근린공원': { tree: 0.046, shrub: 0.049, hedge: 0.004 }, '체육공원': { tree: 0.035, shrub: 0.163, hedge: 0.043 },
  '역사공원': { tree: 0.055, shrub: 0.043, hedge: 0.013 }, '동물원': { tree: 0.051, shrub: 0.091, hedge: 0.010 },
  '식물원': { tree: 0.264, shrub: 0.486, hedge: 0.010 }, '정원': { tree: 0.097, shrub: 0.099, hedge: 0.020 },
  '기타': { tree: 0.036, shrub: 0.230, hedge: 0.006 }, '평균': { tree: 0.082, shrub: 0.170, hedge: 0.014 },
};
const TRUNK_W = { A: 1340, B: 1320, C: 1275, D: 1230 }; // 표 4.4-1 그룹 대표값(구간 중앙 — 명시): A≥1340, B 1300~1340, C 1250~1300, D 1210~1250
const SIZE_TABLE = [ // 표 4.4-3 [근원cm, 흉고cm, 수고m] — 원문 전사. 100 행은 흉고 50으로 비단조(원문 그대로·플래그)
  [6, 5, 2.0], [8, 7, 2.5], [10, 9, 3.0], [12, 10, 3.5], [15, 13, 4.0], [18, 15, 4.5], [20, 17, 5.0],
  [22, 19, 5.5], [25, 21, 6.0], [28, 23, 7.0], [30, 25, 8.0], [35, 29, 9.0], [40, 33, 10.0],
  [45, 38, 12.0], [50, 42, 14.0], [60, 50, 16.0], [70, 56, 18.0], [80, 65, 21.0],
];
export default {
  id: 'planting_base',
  domain: 'landscape/planting',
  title: '식재기반·수목 검토 (KDS 34 30 10/34 40 10)',
  description: '생육토심 게이트·객토깊이·공원 식재밀도·이식 수목중량·규격환산 — 원문 표 전사.',
  refs: ['KDS 34 30 10:2024 표 1.6-1(생육토심)·표 3.1-1(객토)', 'KDS 34 40 10:2024 표 4.2-1(식재밀도)·식 4.4-1+표 4.4-1/2(수목중량)·표 4.4-3(규격환산) — 전부 원문 전사'],
  status: 'verified — 원문 표 전사 + 식 4.4-1 폐형 손검증. 수종별 생육 상세 DB(내음성·이식적기 등)는 공인 단일출처 부재로 보류 명시',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      soilCheck: { description: '생육토심 검토: { plantType: 잔디초화류|소관목|대관목|천근성교목|심근성교목, soilKind: artificial|natural|mixed, soilGrade?: mid|high(생육 판정용), providedDepth_cm, hasDrainLayer?: boolean }' },
      densityCheck: { description: '식재밀도 검토: { parkType(표 4.2-1 키), area_m2, trees?, shrubs?, hedges? (계획 수량) }' },
      treeWeight: { description: '이식 수목중량: { rootDia_cm?(근원 — 흉고 미지 시 표 4.4-3 환산·범위 밖은 ×0.8), dbh_cm?(흉고 직접), height_m?, trunkGroup: A|B|C|D(표 4.4-1 — A≥1340·B 1300~1340·C 1250~1300·D 1210~1250, 그룹 대표값 명시), leafFactor?(p 0.2~0.3 — 기본 0.25), rootBallVol_m3?(뿌리분 체적 — 별도 산정 입력 시 지하부 1,300kg/m³ 적용 §4.4.4(3)) }' },
      soilReplace: { description: '객토 검토: { category: 교목|아교목|관목|지피초화류 } → 표 3.1-1 깊이' },
    },
  },
  run(input) {
    const out = {};
    // ① 생육토심
    if (input.soilCheck) {
      const sc = input.soilCheck;
      const row = SOIL_DEPTH[sc.plantType];
      if (!row) throw new Error('input gate: plantType은 표 1.6-1의 5종 중 하나');
      const survive = row[sc.soilKind === 'artificial' ? 'artificial' : sc.soilKind === 'mixed' ? 'mixed' : 'natural'];
      const grow = sc.soilGrade === 'high' ? row.growHigh : row.growMid;
      const d = Number(sc.providedDepth_cm) || 0;
      out.soilDepth = {
        surviveMin_cm: survive, growMin_cm: grow, drainLayer_cm: row.drain,
        provided_cm: d, survivePass: d >= survive, growPass: d >= grow,
        drainNote: sc.hasDrainLayer === false ? `⚠ 배수층 ${row.drain}cm 별도 필요(표 1.6-1)` : `배수층 ${row.drain}cm 기준`,
        note: `표 1.6-1: 생존최소(${sc.soilKind}) ${survive}cm·생육최소(토양 ${sc.soilGrade === 'high' ? '상급' : '중급'}) ${grow}cm — 생육 기준 충족 권장.`,
      };
    }
    // ② 식재밀도
    if (input.densityCheck) {
      const dc = input.densityCheck;
      const std = DENSITY[dc.parkType];
      if (!std) throw new Error('input gate: parkType은 표 4.2-1 키(어린이공원 등 12종)');
      const A = Number(dc.area_m2);
      if (!(A > 0)) throw new Error('input gate: area_m2');
      const mk = (plan, per, label) => plan === undefined ? null : { plan, standard: +(per * A).toFixed(1), per_m2: per, ratio: +(plan / (per * A)).toFixed(2), label };
      out.density = {
        tree: mk(dc.trees, std.tree, '교목'), shrub: mk(dc.shrubs, std.shrub, '관목'), hedge: mk(dc.hedges, std.hedge, '생울타리'),
        note: `표 4.2-1 ${dc.parkType} 기준(주/㎡) — 기준은 실태조사 기반 참고치(원문 성격 명시), 설계 목표는 발주 지침 우선.`,
      };
    }
    // ③ 수목중량 (식 4.4-1)
    if (input.treeWeight) {
      const tw = input.treeWeight;
      let B_cm = Number(tw.dbh_cm) || 0, H = Number(tw.height_m) || 0, conv = null;
      if (!B_cm && Number(tw.rootDia_cm) > 0) {
        const rd = tw.rootDia_cm;
        const t = SIZE_TABLE;
        if (rd >= t[0][0] && rd <= t[t.length - 1][0]) {
          let k = 0; while (k < t.length - 2 && t[k + 1][0] < rd) k++;
          const [r1, b1, h1] = t[k], [r2, b2, h2] = t[k + 1];
          const f = (rd - r1) / (r2 - r1);
          B_cm = b1 + f * (b2 - b1);
          if (!H) H = h1 + f * (h2 - h1);
          conv = `표 4.4-3 보간(근원 ${rd}→흉고 ${B_cm.toFixed(1)}cm${!Number(tw.height_m) ? `·수고 ${H.toFixed(1)}m` : ''}) — 이산표 선형보간 명시. 100cm 행은 원문 비단조(흉고 50)로 80cm 초과 미지원`;
        } else {
          B_cm = rd * 0.8;
          conv = '표 범위 밖 — 원문 관계(흉고=근원×0.8, 식 4.4-1 정의) 적용';
        }
      }
      if (!(B_cm > 0) || !(H > 0)) throw new Error('input gate: treeWeight는 (dbh_cm+height_m) 또는 rootDia_cm 필요');
      const grp = TRUNK_W[tw.trunkGroup];
      if (!grp) throw new Error('input gate: trunkGroup A|B|C|D (표 4.4-1)');
      const p = Number(tw.leafFactor) > 0 ? Math.min(0.3, Math.max(0.2, tw.leafFactor)) : 0.25;
      const Wtop = 0.5 * 3.14 * Math.pow(B_cm / 100 / 2, 2) * H * grp * (1 + p); // 식 4.4-1 (원문 3.14)
      const Wroot = Number(tw.rootBallVol_m3) > 0 ? tw.rootBallVol_m3 * 1300 : null; // §4.4.4(3) 분 단위중량 1,300
      out.treeWeight = {
        dbh_cm: +B_cm.toFixed(1), height_m: +H.toFixed(1), ...(conv ? { conversion: conv } : {}),
        Wtop_kg: +Wtop.toFixed(0), ...(Wroot !== null ? { Wroot_kg: +Wroot.toFixed(0), Wtotal_kg: +(Wtop + Wroot).toFixed(0) } : {}),
        note: `식 4.4-1: k0.5·3.14·(B/2)²·h·w₁(${grp} — 그룹 대표값 명시)·(1+p ${p}). 지하부=${Wroot !== null ? '뿌리분 체적×1,300kg/m³(§4.4.4(3))' : '뿌리분 체적 입력 시 산정(§4.4.4(3) 1,300kg/m³)'}. 크레인 선정 등은 여유율 별도.`,
      };
    }
    // ④ 객토
    if (input.soilReplace) {
      const depth = SOIL_REPLACE[input.soilReplace.category];
      if (!depth) throw new Error('input gate: category 교목|아교목|관목|지피초화류');
      out.soilReplace = { depth_m: depth, note: `표 3.1-1 객토량 산정 깊이(지피초화류는 0.2~0.3m 중앙 0.25 적용 명시).` };
    }
    if (!Object.keys(out).length) throw new Error('input gate: soilCheck·densityCheck·treeWeight·soilReplace 중 1개 이상');
    const passes = [out.soilDepth?.growPass, out.soilDepth?.survivePass].filter((v) => v !== undefined);
    return {
      verdict: passes.length ? (out.soilDepth.survivePass ? (out.soilDepth.growPass ? 'PASS' : 'WARN') : 'FAIL') : 'INFO',
      checks: out,
      notes: [
        '전 수치 = KDS 34 30 10 표 1.6-1/3.1-1·34 40 10 표 4.2-1/4.4-1/4.4-3·식 4.4-1 원문 전사.',
        '수종별 상세 생육특성 DB(내음성·근계·이식적기)는 공인 단일 출처 부재로 보류 — 수간 중량 그룹은 표 4.4-1 예시 수종 참고해 선택 입력.',
        'WARN=생존은 충족·생육 미달(표 1.6-1 생육 기준 충족 권장).',
      ],
    };
  },
};
