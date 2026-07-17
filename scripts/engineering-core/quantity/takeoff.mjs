/**
 * 수량산출 룰엔진 v1 — 결정론 설계수량 산출 (plan §7.7).
 *
 * 방법론 참조: LH 「BIM 적용지침(단지분야)」 부속서-07 수량산출 기준의 구조
 * (시설군→공종 위계, 체적/산식 구분, 산출근거 명시)를 차용 — 규칙 산식 자체는
 * 본 파일에서 기하학으로 독립 작성 (아이디어-표현 이분법, 원문 재배포 아님).
 *
 * 정직성 원칙:
 *  - 산출 수량 = 설계수량(기하 기반). 표준품셈 할증·품(노무) 적용 아님 — 견적 참고자료.
 *  - 모든 항목에 basis(산출근거 산식) 문자열 공개 — 옵티마이저와 동일한 투명 감사.
 *  - 끝단(마구리)·모따기 등 미소량은 단순화 가정을 assumptions에 명시.
 *
 * 요소 타입 v1 (시설군 대응):
 *  - retaining_wall  (옹벽시설)  : 터파기·버림·구체 콘크리트·거푸집·되메우기·잔토
 *  - trench          (관로 토공) : 사다리꼴 터파기·모래기초·되메우기
 *  - pavement        (포장공)    : 층별 체적·경계블록 연장
 */

const round = (v, d) => {
  const p = 10 ** d;
  return Math.round((v + Number.EPSILON) * p) / p;
};
const req = (el, keys) => {
  for (const k of keys) {
    if (typeof el[k] !== 'number' || !Number.isFinite(el[k]) || el[k] <= 0) {
      const err = new Error(`${el.type}: '${k}' must be a positive number`);
      err.code = 'INPUT_INVALID';
      throw err;
    }
  }
};
const item = (name, spec, unit, qty, basis, method) => ({
  item: name, spec, unit,
  qty: round(qty, unit === 'm' ? 1 : unit === '㎡' ? 2 : 3),
  basis, method,
});

/** 옹벽시설 — 역T형 캔틸레버 (retaining-wall-stability 계산기와 동일 기하 파라미터) */
function retainingWall(el) {
  req(el, ['H', 'stemThickness', 'baseWidth', 'baseThickness', 'length']);
  const {
    H, stemThickness: t, baseWidth: B, baseThickness: tb, length: L,
    workingSpace: ws = 0.6,      // 터파기 작업여유 (편측, m)
    excavSlope: s = 0.3,          // 터파기 경사 (수평/수직)
    leanThickness: tl = 0.1,      // 버림콘크리트 두께 (m)
    leanMargin: lm = 0.1,         // 버림 여유폭 (편측, m)
    excavDepth,                   // 기초저면 굴착깊이 (기본: 기초두께+버림)
  } = el;
  const D = excavDepth ?? tb + tl;
  const stemH = H - tb;
  const items = [];

  // 터파기 (사다리꼴 단면: 바닥폭 b, 경사 s)
  const b = B + 2 * ws;
  const Vexc = (b + s * D) * D * L;
  items.push(item('터파기', `깊이 ${D}m, 경사 1:${s}`, '㎥', Vexc,
    `(b+s·D)·D·L = (${b.toFixed(2)}+${s}×${D.toFixed(2)})×${D.toFixed(2)}×${L}`, 'formula'));

  // 버림콘크리트
  const bl = B + 2 * lm;
  const Vlean = bl * tl * L;
  items.push(item('버림콘크리트', `t=${tl}m`, '㎥', Vlean,
    `(B+2×${lm})×t×L = ${bl.toFixed(2)}×${tl}×${L}`, 'formula'));

  // 구체 콘크리트 (벽체+기초)
  const Vstem = t * stemH * L;
  const Vbase = B * tb * L;
  items.push(item('구체 콘크리트', '벽체+기초', '㎥', Vstem + Vbase,
    `벽체 t×(H−tb)×L = ${t}×${stemH.toFixed(2)}×${L} = ${Vstem.toFixed(3)} + 기초 B×tb×L = ${B}×${tb}×${L} = ${Vbase.toFixed(3)}`, 'formula'));

  // 거푸집 (벽체 양면 + 기초 측면 2면; 마구리 제외 — 연속체 가정)
  const Aform = 2 * stemH * L + 2 * tb * L;
  items.push(item('거푸집', '벽체 양면+기초 측면', '㎡', Aform,
    `2×(H−tb)×L + 2×tb×L = 2×${stemH.toFixed(2)}×${L} + 2×${tb}×${L}`, 'formula'));

  // 되메우기 = 터파기 − 매입 구조물(버림+기초+벽체 매입부)
  const stemBuried = Math.max(0, D - tb - tl);
  const Vburied = Vlean + Vbase + t * stemBuried * L;
  const Vbackfill = Math.max(0, Vexc - Vburied);
  items.push(item('되메우기', '', '㎥', Vbackfill,
    `터파기 ${Vexc.toFixed(3)} − 매입(버림 ${Vlean.toFixed(3)} + 기초 ${Vbase.toFixed(3)} + 벽체매입 ${(t * stemBuried * L).toFixed(3)})`, 'formula'));

  // 잔토처리 = 매입 체적만큼 반출
  items.push(item('잔토처리', '', '㎥', Math.min(Vexc, Vburied),
    `터파기 − 되메우기 = ${Vexc.toFixed(3)} − ${Vbackfill.toFixed(3)}`, 'formula'));

  return {
    items,
    assumptions: [
      '연속체 가정 — 마구리(끝단) 거푸집·모따기 미소량 제외',
      `굴착깊이 D=${D.toFixed(2)}m ${excavDepth ? '(입력값)' : '(기본: 기초두께+버림 — 근입깊이가 더 깊으면 excavDepth 입력)'}`,
      '앞굽/뒷굽 상부 되메우기 동일 토사 가정',
    ],
  };
}

/** 관로 토공 — 사다리꼴 터파기 + 모래기초 + 되메우기 */
function trench(el) {
  req(el, ['depth', 'bottomWidth', 'length']);
  const {
    depth: D, bottomWidth: w, length: L,
    excavSlope: s = 0.3,
    beddingThickness: tbed = 0.1,  // 모래기초 두께
    pipeOutsideDia: dp = 0,        // 관 외경 (되메우기 공제용, 0=공제 없음)
  } = el;
  const items = [];
  const Vexc = (w + s * D) * D * L;
  items.push(item('터파기', `깊이 ${D}m, 경사 1:${s}`, '㎥', Vexc,
    `(w+s·D)·D·L = (${w}+${s}×${D})×${D}×${L}`, 'formula'));
  const Vbed = w * tbed * L;
  items.push(item('모래기초', `t=${tbed}m`, '㎥', Vbed, `w×t×L = ${w}×${tbed}×${L}`, 'formula'));
  const Vpipe = Math.PI * (dp / 2) ** 2 * L;
  const Vbackfill = Math.max(0, Vexc - Vbed - Vpipe);
  items.push(item('되메우기', dp ? `관 외경 ${dp}m 공제` : '공제 없음', '㎥', Vbackfill,
    `터파기 ${Vexc.toFixed(3)} − 모래기초 ${Vbed.toFixed(3)} − 관 π(d/2)²L ${Vpipe.toFixed(3)}`, 'formula'));
  return { items, assumptions: ['직선 구간 가정 — 맨홀·이형관 부위 별도', '토사 단일층 가정'] };
}

/** 포장공 — 층별 체적 + 경계블록 연장 */
function pavement(el) {
  req(el, ['area']);
  const { area: A, layers = [], curbLength = 0 } = el;
  if (!Array.isArray(layers) || layers.length === 0) {
    const err = new Error('pavement: layers[{name,thickness}] required (≥1)');
    err.code = 'INPUT_INVALID';
    throw err;
  }
  const items = [];
  for (const ly of layers) {
    if (typeof ly.thickness !== 'number' || ly.thickness <= 0) {
      const err = new Error(`pavement layer '${ly.name}': thickness must be positive`);
      err.code = 'INPUT_INVALID';
      throw err;
    }
    items.push(item(`포장 — ${ly.name}`, `t=${ly.thickness}m`, '㎥', A * ly.thickness,
      `A×t = ${A}×${ly.thickness}`, 'formula'));
  }
  if (curbLength > 0) {
    items.push(item('경계블록 설치', '', 'm', curbLength, `연장 입력값 ${curbLength}m`, 'input'));
  }
  return { items, assumptions: ['평면적 기준 — 경사 보정 미적용', '절취·단차 부위 미반영'] };
}

/** 암거(box culvert) — 등두께 박스 연장 기준 (box_culvert_frame 계산기와 동일 기하 파라미터).
 *  마구리·날개벽·차수공 미포함(assumptions 명시) — 산식 전부 공개(설계수량, 표준품셈 미적용). */
function culvert(el) {
  req(el, ['innerWidth', 'innerHeight', 'wallThk', 'length']);
  const {
    innerWidth: Bi, innerHeight: Hi, wallThk: t, length: L,
    workingSpace: ws = 0.6, excavSlope: s = 0.3, leanThickness: tl = 0.1, leanMargin: lm = 0.1,
    cover = 0, // 토피(m) — 미입력 0(개거 가정 명시)
  } = el;
  const Bo = Bi + 2 * t, Ho = Hi + 2 * t;
  const D = cover + Ho + tl; // 굴착깊이 = 토피 + 외고 + 버림
  const items = [];
  const b = Bo + 2 * ws;
  const Vexc = (b + s * D) * D * L;
  items.push(item('터파기', `깊이 ${D.toFixed(2)}m, 경사 1:${s}`, '㎥', Vexc,
    `(b+s·D)·D·L = (${b.toFixed(2)}+${s}×${D.toFixed(2)})×${D.toFixed(2)}×${L}`, 'formula'));
  const bl = Bo + 2 * lm;
  const Vlean = bl * tl * L;
  items.push(item('버림콘크리트', `t=${tl}m`, '㎥', Vlean, `(Bo+2×${lm})×t×L = ${bl.toFixed(2)}×${tl}×${L}`, 'formula'));
  const Vconc = (Bo * Ho - Bi * Hi) * L;
  items.push(item('구체 콘크리트', `외곽 ${Bo.toFixed(2)}×${Ho.toFixed(2)} − 내공 ${Bi}×${Hi}`, '㎥', Vconc,
    `(Bo·Ho−Bi·Hi)·L = (${(Bo * Ho).toFixed(3)}−${(Bi * Hi).toFixed(3)})×${L}`, 'formula'));
  const Aform = (2 * (Bi + Hi) + 2 * (Bo + Ho)) * L;
  items.push(item('거푸집', '내부+외부 둘레(마구리 제외)', '㎡', Aform,
    `[2(Bi+Hi)+2(Bo+Ho)]·L = [${(2 * (Bi + Hi)).toFixed(2)}+${(2 * (Bo + Ho)).toFixed(2)}]×${L}`, 'formula'));
  const Vbackfill = Math.max(0, Vexc - Vlean - Bo * Ho * L);
  items.push(item('되메우기', '내공은 유수단면 — 미충전', '㎥', Vbackfill,
    `터파기 − 버림 − 외곽체적 = ${Vexc.toFixed(3)}−${Vlean.toFixed(3)}−${(Bo * Ho * L).toFixed(3)}`, 'formula'));
  items.push(item('잔토처리', '', '㎥', Vexc - Vbackfill, `터파기 − 되메우기`, 'formula'));
  return {
    items,
    assumptions: [
      `토피 ${cover}m(미입력=0 개거 가정) · 마구리·날개벽·차수공·기초처리 미포함`,
      '등두께 박스 가정(상·하판=벽두께) · 설계수량(표준품셈 할증·품 미적용)',
    ],
  };
}

const HANDLERS = { retaining_wall: retainingWall, trench, pavement, culvert };
export const elementTypes = Object.keys(HANDLERS);

/**
 * @param {Array<object>} elements — [{id?, type:'retaining_wall'|'trench'|'pavement', …}]
 * @returns {{ elements:Array, boq:Array, disclaimer:string, methodology:string }}
 */
export function takeoff(elements) {
  if (!Array.isArray(elements) || elements.length === 0) {
    const err = new Error('elements[] required');
    err.code = 'INPUT_INVALID';
    throw err;
  }
  if (elements.length > 200) {
    const err = new Error('too many elements (max 200)');
    err.code = 'INPUT_INVALID';
    throw err;
  }
  const perElement = elements.map((el, i) => {
    const h = HANDLERS[el.type];
    if (!h) {
      const err = new Error(`unknown element type '${el.type}' (supported: ${elementTypes.join(', ')})`);
      err.code = 'INPUT_INVALID';
      throw err;
    }
    const { items, assumptions } = h(el);
    return { elementId: el.id ?? `el-${i + 1}`, type: el.type, items, assumptions };
  });
  // 공종별 합계 (item+unit 기준)
  const agg = new Map();
  for (const e of perElement) {
    for (const it of e.items) {
      const key = `${it.item}|${it.unit}`;
      agg.set(key, (agg.get(key) ?? 0) + it.qty);
    }
  }
  const boq = [...agg.entries()].map(([key, qty]) => {
    const [name, unit] = key.split('|');
    return { item: name, unit, qty: round(qty, unit === 'm' ? 1 : unit === '㎡' ? 2 : 3) };
  });
  return {
    elements: perElement,
    boq,
    disclaimer: '설계수량(기하 기반) 참고자료 — 표준품셈 할증·품 미적용. 계약·정산용 수량산출서는 발주처 기준 확인 필요.',
    methodology: '산출 구조는 LH BIM 적용지침(단지분야) 부속서-07의 위계를 참조하되, 산식은 독립 작성 (전 항목 basis에 공개)',
  };
}
