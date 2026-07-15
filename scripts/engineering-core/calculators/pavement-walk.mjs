/**
 * P18 조경 — 보도포장 (KDS 34 60 10 원문 판독).
 * 콘크리트 포장 줄눈(§1.6.5 원문): 팽창줄눈 — 선형 9m 이내·광장 36m² 이내 /
 *   수축줄눈 — 선형 3m 이내·광장 9m² 이내 → 계획 간격 게이트 + 줄눈 수량 산출.
 * 층 구성(§1.6.3 원문): 일반(표층·중간층·기층·보조기층·차단층·동상방지층·노상) /
 *   강성(슬래브·보조기층·동상방지층·노상) / 간이(표층+기층) — 구성 검증.
 * 두께 수치는 KDS 미규정(설계원칙만 §1.6.4) — 재료·교통조건별 두께는 발주/KS 입력
 *   원칙(지어내지 않음). 수량(면적·줄눈 연장)은 결정론 산출.
 */
const LAYER_SETS = {
  flexible: ['표층', '기층', '보조기층'],          // 최소 구성(중간층·차단층·동상방지층=조건부)
  rigid: ['슬래브', '보조기층'],
  simple: ['표층', '기층'],
};
export default {
  id: 'pavement_walk',
  domain: 'landscape/pavement',
  title: '보도포장 (줄눈·층구성·수량)',
  description: '콘크리트 줄눈 간격 게이트(원문 수치)+층 구성 검증+포장·줄눈 수량.',
  refs: ['KDS 34 60 10:2024 §1.6.5(팽창 9m/36m²·수축 3m/9m²)·§1.6.3(층 구성) — 원문 판독', '층 두께=발주/KS 입력 원칙(KDS 미규정 — §1.6.4 설계원칙만)'],
  status: 'verified — 원문 수치 게이트 + 수량 폐형. 블록포장 두께·동상방지층 판정(동결심도)은 입력/후속',
  inputSchema: {
    type: 'object',
    required: ['type', 'length_m', 'width_m'],
    properties: {
      type: { enum: ['concrete_linear', 'concrete_plaza', 'block', 'flexible'], description: '포장 유형 (줄눈 게이트는 콘크리트만)' },
      length_m: { type: 'number', exclusiveMinimum: 0, maximum: 5000, description: '연장 (광장이면 대표 변)' },
      width_m: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: '폭' },
      expJoint_m: { type: 'number', exclusiveMinimum: 0, description: '계획 팽창줄눈 간격 (선형 — 게이트 9m)' },
      conJoint_m: { type: 'number', exclusiveMinimum: 0, description: '계획 수축줄눈 간격 (선형 — 게이트 3m)' },
      panelArea_m2: { type: 'number', exclusiveMinimum: 0, description: '광장 분할 패널 면적 (팽창 36m²·수축 9m² 게이트)' },
      layers: { description: '층 구성 배열 [{name, thk_mm}] — 두께=발주/KS 입력(검증은 구성만·두께 합산 수량)' },
      structureType: { enum: ['flexible', 'rigid', 'simple'], description: '구조 형식 (§1.6.3 구성 검증 — 기본 simple)' },
    },
  },
  run(input) {
    const A = input.length_m * input.width_m;
    const gates = [];
    if (input.type === 'concrete_linear') {
      if (Number(input.expJoint_m) > 0) gates.push({ gate: '팽창줄눈 ≤9m(§1.6.5(1))', value: input.expJoint_m, limit: 9, pass: input.expJoint_m <= 9 });
      if (Number(input.conJoint_m) > 0) gates.push({ gate: '수축줄눈 ≤3m(§1.6.5(2))', value: input.conJoint_m, limit: 3, pass: input.conJoint_m <= 3 });
    } else if (input.type === 'concrete_plaza' && Number(input.panelArea_m2) > 0) {
      gates.push({ gate: '팽창줄눈 패널 ≤36m²(§1.6.5(1))', value: input.panelArea_m2, limit: 36, pass: input.panelArea_m2 <= 36 });
      gates.push({ gate: '수축줄눈 패널 ≤9m²(§1.6.5(2))', value: input.panelArea_m2, limit: 9, pass: input.panelArea_m2 <= 9, note: '수축줄눈 세분 기준 — 팽창 패널 내 추가 분할' });
    }
    // 줄눈 수량 (선형)
    let joints = null;
    if (input.type === 'concrete_linear') {
      const eSp = Number(input.expJoint_m) > 0 ? input.expJoint_m : 9;
      const cSp = Number(input.conJoint_m) > 0 ? input.conJoint_m : 3;
      const nExp = Math.floor(input.length_m / eSp);
      const nCon = Math.max(0, Math.floor(input.length_m / cSp) - nExp); // 팽창 위치와 중복 공제(관례)
      joints = { expansion: { n: nExp, len_m: +(nExp * input.width_m).toFixed(1) }, contraction: { n: nCon, len_m: +(nCon * input.width_m).toFixed(1) } };
    }
    // 층 구성 검증 + 수량
    let layersOut = null;
    if (Array.isArray(input.layers) && input.layers.length) {
      const stype = input.structureType ?? 'simple';
      const needs = LAYER_SETS[stype];
      const names = input.layers.map((l) => String(l.name ?? ''));
      const missing = needs.filter((n) => !names.some((x) => x.includes(n)));
      const vols = input.layers.map((l) => ({ name: l.name, thk_mm: l.thk_mm ?? null, vol_m3: Number(l.thk_mm) > 0 ? +((A * l.thk_mm) / 1000).toFixed(1) : null }));
      layersOut = { structure: stype, required: needs, missing, pass: missing.length === 0, quantities: vols, note: '두께=발주/KS 입력(KDS 미규정 — §1.6.4). 차단층·동상방지층은 지반/동결 조건부(§1.6.3 원문 구성).' };
    }
    const pass = gates.every((g) => g.pass) && (layersOut ? layersOut.pass : true);
    return {
      verdict: gates.length || layersOut ? (pass ? 'PASS' : 'FAIL') : 'INFO',
      checks: { area_m2: +A.toFixed(1), ...(gates.length ? { jointGates: gates } : {}), ...(joints ? { jointQty: joints } : {}), ...(layersOut ? { layers: layersOut } : {}) },
      notes: [
        '줄눈 기준=§1.6.5 원문 수치(팽창 9m/36m²·수축 3m/9m²). 블록·연성포장은 줄눈 게이트 비적용.',
        '장애인 편의 기준(§1.6.11)=법규 별도 확인 명시. 경계처리·배수(§1.6.6~7)는 체크리스트 항목.',
      ],
    };
  },
};
