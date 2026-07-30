/**
 * P19 인테리어/설비 — 배수·통기 관지름 (KDS 31 30 25 원문 표 전사 — DFU법 정식).
 * 표 4.1-2: 기구배수부하단위(일반 건물·공동주택 열 전사 — 대표 15종).
 * 표 4.1-5: 수평지관·수직관 최대 DFU / 표 4.1-4: 수평주관(기울기별) / 표 4.1-1: 최소 기울기.
 * 주기: 대변기 연결 수평주관 최소 DN80(표 4.1-4 주1)·수직관 축소 1/2 제한(표 4.1-5 주2).
 * 급수(fixture_supply)와 짝 — 배수는 KDS가 DFU법을 정식 채택(급수와 대조 명시).
 */
const DFU = { // 표 4.1-2 [일반건물, 공동주택] (—=미규정 null)
  '욕조': [null, 2.0], '세탁기': [3.0, 3.0], '식기세척기': [2.0, 2.0], '음수기': [0.5, null],
  '주방싱크': [2.0, 2.0], '주방싱크_식세기포함': [3.0, 3.0], '세면기': [1.0, 1.0], '청소싱크': [3.0, null],
  '샤워부스': [2.0, 2.0], '소변기_4L': [4.0, null], '소변기_4L초과': [5.0, null],
  '대변기_6L': [4.0, 3.0], '대변기_13L': [6.0, 4.0], '싱크_DN40': [2.0, 2.0], '싱크_DN50': [3.0, 3.0],
};
const BRANCH = [[40, 3], [50, 6], [65, 12], [80, 20], [100, 160], [125, 360], [150, 620], [200, 1400], [250, 2500], [300, 3900], [380, 7000]]; // 표 4.1-5 수평지관
const STACK3 = [[40, 4], [50, 10], [65, 20], [80, 48], [100, 240], [125, 540], [150, 960], [200, 2200], [250, 3800], [300, 6000]]; // 3층 이하 수직관 합계
const STACK4 = [[40, 8], [50, 24], [65, 42], [80, 72], [100, 500], [125, 1100], [150, 1900], [200, 3600], [250, 5600], [300, 8400]]; // 4층+ 수직관 합계
const MAIN = { '1/200': [[200, 1400], [250, 2500], [300, 3900], [380, 7000]], '1/100': [[80, 36], [100, 180], [125, 390], [150, 700], [200, 1600], [250, 2900], [300, 4600], [380, 8300]], '1/50': [[32, 1], [40, 3], [50, 21], [65, 24], [80, 42], [100, 216], [125, 480], [150, 840], [200, 1920], [250, 3500], [300, 5600], [380, 10000]] }; // 표 4.1-4
const SLOPE_MIN = (dn) => (dn <= 65 ? '1/50' : dn <= 150 ? '1/100' : '1/200'); // 표 4.1-1
export default {
  id: 'drainage_vent',
  domain: 'interior/plumbing',
  title: '배수관 관지름 (DFU법 — KDS 31 30 25)',
  description: '기구 DFU 합산 → 수평지관·수직관·수평주관 관지름 선정 + 기울기·대변기 게이트.',
  refs: ['KDS 31 30 25:2021 표 4.1-2(DFU)·표 4.1-5(지관·수직관)·표 4.1-4(수평주관)·표 4.1-1(기울기) — 원문 전사', 'KDS 31 30 25 §4.3(1)·(2) 통기관 하한 규칙 — 원문 조항'],
  status: 'verified — 원문 표 전사(결정론 선정). 통기 표 4.3-1 매트릭스(신정통기 길이 선정)는 원문 병합셀 구조로 신뢰 전사 불가 — 명문 하한만 구현(정직 보류)·습통기·브랜치간격 상세는 후속',
  inputSchema: {
    type: 'object',
    required: ['segment'],
    properties: {
      fixtures: { description: '기구 [{type(표 4.1-2 키), count}] — 키: ' + Object.keys(DFU).join('·') + ' (segment branch/stack/main 필수)' },
      building: { enum: ['general', 'apartment'], description: '건물 구분 (표 4.1-2 열 — 기본 general. 공동주택 미규정 기구는 일반값 폴백 명시)' },
      segment: { enum: ['branch', 'stack', 'main', 'vent'], description: '구간 (수평지관/수직관/수평주관/통기관)' },
      floors: { type: 'integer', minimum: 1, maximum: 100, description: '층수 (수직관 — 3층 이하/4층+ 표 구분)' },
      slope: { enum: ['1/200', '1/100', '1/50'], description: '수평주관 기울기 (표 4.1-4 열)' },
      hasWC: { type: 'boolean', description: '대변기 포함 여부 (수평주관 최소 DN80 — 표 4.1-4 주1)' },
      plannedDN: { type: 'number', description: '계획 관지름 (판정용)' },
      drainDN: { type: 'number', description: '통기(vent): 담당 배수관 지름 DN' },
      ventLen_m: { type: 'number', minimum: 0, description: '통기(vent): 배관길이 m (각개·지관·루프·도피 — ≥12 m 시 한 단계 업, §4.3(2))' },
      ventKind: { enum: ['stack_vent', 'individual'], description: '통기 종류: stack_vent=신정통기·통기수직관(1/2 초과) / individual=각개·지관·루프·도피(1/2 이상)' },
    },
  },
  run(input) {
    // 통기관(§4.3) — 명문 하한 규칙만. 표 4.3-1(신정통기 길이·DFU 매트릭스)은 원문이 병합 셀
    // 구조라 신뢰 전사 불가 → 날조 대신 정직 보류(비전 판독 후속). PASS=하한 충족이며,
    // 신정통기·통기수직관은 표 4.3-1 정밀 선정에서 더 커질 수 있음을 notes 로 명시.
    if (input.segment === 'vent') {
      const DN_SERIES = [32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 380];
      const drainDN = Number(input.drainDN);
      if (!(drainDN > 0)) throw new Error('input gate: drainDN(담당 배수관 지름) 필요');
      const kind = input.ventKind === 'individual' ? 'individual' : 'stack_vent';
      const half = drainDN / 2;
      let dn = DN_SERIES.find((d) => (kind === 'stack_vent' ? d > half : d >= half)) ?? DN_SERIES[DN_SERIES.length - 1];
      if (dn < 32) dn = 32;
      const notes = [`§4.3(${kind === 'stack_vent' ? '1' : '2'}) 하한: 담당 배수관 DN${drainDN}의 1/2${kind === 'stack_vent' ? ' 초과' : ' 이상'} · 최소 DN32 → DN${dn}.`];
      if (kind === 'individual' && Number(input.ventLen_m) >= 12) {
        dn = DN_SERIES[Math.min(DN_SERIES.indexOf(dn) + 1, DN_SERIES.length - 1)];
        notes.push(`배관길이 ${input.ventLen_m} m ≥ 12 m → 한 단계 큰 지름 DN${dn} (§4.3(2)).`);
      }
      if (kind === 'stack_vent') notes.push('⚠ 신정통기·통기수직관의 표 4.3-1(길이·DFU 매트릭스) 정밀 선정은 보류 — 여기 판정은 명문 하한 충족 여부만(실소요는 더 커질 수 있음).');
      const dnPass = Number(input.plannedDN) > 0 ? input.plannedDN >= dn : null;
      return {
        verdict: dnPass === null ? 'INFO' : dnPass ? 'PASS' : 'FAIL',
        checks: { sizing: { labelKo: '관경 산정 (소요 DN)', requiredDN: dn, basis: `KDS 31 30 25 §4.3 하한(${kind})`, ...(dnPass !== null ? { plannedDN: input.plannedDN, pass: dnPass } : {}) } },
        notes,
      };
    }
    if (!Array.isArray(input.fixtures)) throw new Error('input gate: fixtures 필요 (segment branch/stack/main)');
    const bIdx = (input.building ?? 'general') === 'apartment' ? 1 : 0;
    let sum = 0;
    const rows = input.fixtures.map((fx, i) => {
      const d = DFU[fx.type];
      if (!d) throw new Error(`input gate: fixtures[${i}].type — 표 4.1-2 키 필요`);
      let v = d[bIdx];
      let note;
      if (v === null) { v = d[0] ?? d[1]; note = '해당 열 미규정 — 대체 열 값 적용(명시)'; }
      const cnt = Number(fx.count) || 1;
      sum += v * cnt;
      return { type: fx.type, count: cnt, dfu: v, ...(note ? { note } : {}) };
    });
    const hasWC = input.hasWC ?? input.fixtures.some((f) => String(f.type).startsWith('대변기'));
    let table, tableName;
    if (input.segment === 'branch') { table = BRANCH; tableName = '표 4.1-5 수평지관'; }
    else if (input.segment === 'stack') { table = (input.floors ?? 1) <= 3 ? STACK3 : STACK4; tableName = `표 4.1-5 수직관(${(input.floors ?? 1) <= 3 ? '3층 이하' : '4층 이상'} 합계)`; }
    else {
      const sl = input.slope ?? '1/100';
      table = MAIN[sl]; tableName = `표 4.1-4 수평주관(기울기 ${sl})`;
    }
    const row = table.find(([, max]) => sum <= max);
    if (!row) throw new Error(`input gate: ΣDFU ${sum} — 표 범위 초과(설계 기준에 의한 선정 필요, 표 주기3)`);
    let dn = row[0];
    if (input.segment === 'main' && hasWC && dn < 80) dn = 80; // 표 4.1-4 주1
    const dnPass = Number(input.plannedDN) > 0 ? input.plannedDN >= dn : null;
    return {
      verdict: dnPass === null ? 'INFO' : dnPass ? 'PASS' : 'FAIL',
      checks: {
        sizing: { labelKo: '관경 산정 (DFU 합 → 소요 DN)', sumDFU: +sum.toFixed(1), requiredDN: dn, table: tableName, ...(dnPass !== null ? { plannedDN: input.plannedDN, pass: dnPass } : {}),
          ...(input.segment === 'main' ? { minSlope: SLOPE_MIN(dn) + ' (표 4.1-1)' } : {}),
          ...(hasWC && input.segment === 'main' ? { wcNote: '대변기 연결 수평주관 최소 DN80 (표 4.1-4 주1)' } : {}) },
      },
      fixtures: rows,
      notes: [
        `ΣDFU ${sum.toFixed(1)} → 소요 DN${dn} (${tableName} 원문).`,
        '수직관 축소는 최대 수직관 지름의 1/2 미만 불가(표 4.1-5 주2). 통기관(표 4.3-1)·브랜치 간격·오프셋은 후속.',
        '급수(fixture_supply — 동시사용률 입력)와 달리 배수는 KDS가 DFU법 정식 채택 — 대조 명시.',
      ],
    };
  },
};
