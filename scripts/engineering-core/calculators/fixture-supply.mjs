/**
 * P15 인테리어/설비 — 위생기구 급수 검토 (KDS 31 30 15 원문 표 전사).
 * 표 4.3-1: 기구별 필요 유량(L/s)·최저 유동압력(kPa) — 15종 전사.
 * 표 4.5-1: 기구급수관 최소 관지름(DN) — 16종 전사.
 * §4.7(1): 최대 급수압력 550kPa 미만(초과 시 감압/조닝).
 * 설계유량 = Σ(기구 유량) × 동시사용률(**입력 원칙** — KDS 31 30 15에 동시사용률
 *   표 없음(기구단위/Hunter 방식 미채택 확인). 국내 관례·기구단위법은 발주 기준
 *   확인 입력, 지어내지 않음).
 * 앵커: 표 전사 + 합산 폐형(자체검증).
 */
const FIXTURES = { // 표 4.3-1: [유량 L/s, 유동압력 kPa] · 표 4.5-1: 최소 DN
  '욕조': { q: 0.25, p: 55, dn: 15 },
  '연합기구': { q: 0.25, p: 55, dn: null },
  '식기세척기': { q: 0.17, p: 55, dn: 15 },
  '음수기': { q: 0.05, p: 55, dn: 10 },
  '세탁기': { q: 0.25, p: 55, dn: 15 },
  '세면기': { q: 0.1, p: 55, dn: 10 },
  '샤워기': { q: 0.18, p: 70, dn: 15 },
  '샤워기_압력온도감지': { q: 0.18, p: 130, dn: 15 },
  '호스수도꼭지': { q: 0.3, p: 55, dn: 15 },
  '싱크_가정용': { q: 0.15, p: 55, dn: 15 },
  '싱크_청소용': { q: 0.18, p: 55, dn: 15 },
  '소변기_밸브': { q: 0.75, p: 100, dn: 20 },
  '소변기_세정탱크': { q: null, p: null, dn: 15 },
  '대변기_세정밸브': { q: 1.6, p: 100, dn: 25 },
  '대변기_세정탱크': { q: 0.18, p: 55, dn: 10 },
  '비데': { q: null, p: null, dn: 10 },
  '주방싱크': { q: 0.15, p: 55, dn: 15 },
};
export default {
  id: 'fixture_supply',
  domain: 'interior/plumbing',
  title: '위생기구 급수 검토 (KDS 31 30 15)',
  description: '기구별 유량·유동압력·최소관지름 게이트 + 설계유량 합산(동시사용률 입력 원칙).',
  refs: ['KDS 31 30 15:2021(급수설비) 표 4.3-1(유량·유동압력)·표 4.5-1(최소 관지름)·§4.7(550kPa 상한) — 원문 전사'],
  status: 'verified — 원문 표 전사 + 합산 폐형. 동시사용률·기구단위법은 발주기준 확인 입력(KDS 미규정 확인). 마찰손실 관망계산은 pipe_sizing 연계',
  inputSchema: {
    type: 'object',
    required: ['fixtures'],
    properties: {
      fixtures: { description: '기구 목록 [{type(표 키: 세면기·대변기_세정밸브 등), count, plannedDN?(계획 관지름 — 최소치 게이트)}]' },
      simultaneity: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '동시사용률 (기본 1.0=전기구 동시 — 보수. KDS 미규정, 발주기준·기구단위법 산정 입력 원칙)' },
      supplyPressure_kPa: { type: 'number', minimum: 0, description: '공급 압력 (기구 최저 유동압력·550kPa 상한 게이트)' },
    },
  },
  run(input) {
    const list = input.fixtures;
    if (!Array.isArray(list) || !list.length || list.length > 50) throw new Error('input gate: fixtures 1~50종');
    let Q = 0, maxP = 0;
    const rows = [];
    for (const [i, fx] of list.entries()) {
      const spec = FIXTURES[fx.type];
      if (!spec) throw new Error(`input gate: 기구 ${i + 1} type — 표 4.3-1/4.5-1 키 중 하나 (${Object.keys(FIXTURES).join('·')})`);
      const cnt = Number(fx.count) || 1;
      const qi = spec.q !== null ? spec.q * cnt : 0;
      Q += qi;
      if (spec.p !== null) maxP = Math.max(maxP, spec.p);
      const dnOk = spec.dn !== null && Number(fx.plannedDN) > 0 ? fx.plannedDN >= spec.dn : null;
      rows.push({
        type: fx.type, count: cnt, q_Ls: spec.q, flowP_kPa: spec.p, minDN: spec.dn,
        ...(dnOk !== null ? { plannedDN: fx.plannedDN, dnPass: dnOk } : {}),
        ...(spec.q === null ? { note: '표 4.3-1에 유량 미수록(관지름만 표 4.5-1) — 유량은 제조사 사양 입력' } : {}),
      });
    }
    const sim = input.simultaneity ?? 1.0;
    const Qd = Q * sim;
    const checks = { flow: { sumQ_Ls: +Q.toFixed(2), simultaneity: sim, designQ_Ls: +Qd.toFixed(2), designQ_m3h: +(Qd * 3.6).toFixed(2) } };
    let pPass = null;
    if (Number(input.supplyPressure_kPa) > 0) {
      const sp = input.supplyPressure_kPa;
      const lowOk = sp >= maxP, highOk = sp < 550;
      pPass = lowOk && highOk;
      checks.pressure = {
        supply_kPa: sp, requiredMin_kPa: maxP, max_kPa: 550, lowOk, highOk,
        note: !lowOk ? '⚠ 최저 유동압력 미달 — 가압장치 검토(§4.6)' : !highOk ? '⚠ 550kPa 이상 — 감압밸브/조닝(§4.7(1))' : '압력 범위 적정(말단 기준 — 관 마찰·높이 손실 별도 반영)',
      };
    }
    const dnAll = rows.filter((r) => r.dnPass !== undefined);
    const dnPass = dnAll.every((r) => r.dnPass);
    const pass = (pPass === null || pPass) && dnPass;
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks, fixtures: rows,
      notes: [
        `설계유량 ${Qd.toFixed(2)}L/s = Σ기구유량 ${Q.toFixed(2)} × 동시사용률 ${sim}${sim === 1 ? '(전기구 동시 — 보수 기본. 실설계는 발주기준/기구단위법 산정 입력)' : '(입력값)'}.`,
        '표 4.3-1 유량·유동압력, 표 4.5-1 최소 관지름 — 원문 전사. 공급압력은 기구 위치 기준(마찰·정수두 손실은 pipe_sizing/관망 별도).',
        'KDS 31 30 15는 기구단위(Hunter)법 미채택 — 동시사용률 근거는 프로젝트 기준 명시 필요.',
      ],
    };
  },
};
