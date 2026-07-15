/**
 * P17 인테리어 — 잔향시간 (Sabine·Eyring — 폐형).
 * Sabine: RT60 = 0.161·V/A, A = Σ(Si·αi) [+ 공기흡음 4mV 옵션].
 * Eyring: RT60 = 0.161·V/(−S·ln(1−ᾱ)) — 흡음 큰 실(ᾱ>0.2 관례)에서 정확.
 * 흡음률 αi = 자료 입력 원칙(마감재·주파수 의존 — 제조사/문헌값. 지어내지 않음).
 * 권장 잔향시간 = 용도·실용적 기준 입력(비교용 — KS/문헌 확인 명시).
 * 앵커: ᾱ→0 극한에서 Eyring→Sabine 수렴(폐형 자체검증).
 */
export default {
  id: 'reverb_time',
  domain: 'interior/acoustics',
  title: '잔향시간 (Sabine·Eyring)',
  description: '실체적·표면 흡음 → RT60 2법 병기 — 흡음률·목표값 입력 원칙.',
  refs: ['Sabine·Eyring 잔향식 (건축음향 표준 폐형)', '흡음률=재료 자료 입력 원칙 · 권장 RT=용도 기준 입력(비교)'],
  status: 'verified — 폐형 앵커(저흡음 극한 수렴). 주파수 대역별 해석·확산도 가정은 명시',
  inputSchema: {
    type: 'object',
    required: ['volume_m3', 'surfaces'],
    properties: {
      volume_m3: { type: 'number', exclusiveMinimum: 0, maximum: 100000, description: '실 체적' },
      surfaces: { description: '표면 배열 [{name?, area_m2, alpha(0~1 — 재료 자료 입력, 주파수 명시 권장)}] 1~30' },
      airAbsorb: { type: 'boolean', description: '공기흡음 4mV 반영 (2kHz+ 대역·대공간 — m=0.009/m 관례 명시)' },
      targetRT_s: { type: 'number', exclusiveMinimum: 0, description: '권장 잔향시간 (용도 기준 입력 — 판정용)' },
      tolerance_pct: { type: 'number', minimum: 5, maximum: 50, description: '허용 편차 % (기본 20 관례)' },
    },
  },
  run(input) {
    const V = input.volume_m3;
    const sf = input.surfaces;
    if (!Array.isArray(sf) || !sf.length || sf.length > 30) throw new Error('input gate: surfaces 1~30');
    let S = 0, A = 0;
    const rows = sf.map((s, i) => {
      const a = Number(s.area_m2), al = Number(s.alpha);
      if (!(a > 0) || !(al >= 0 && al <= 1)) throw new Error(`input gate: surfaces[${i}] area/alpha`);
      S += a; A += a * al;
      return { name: s.name ?? `면${i + 1}`, area_m2: a, alpha: al, Sa: +(a * al).toFixed(2) };
    });
    const alphaBar = A / S;
    const air = input.airAbsorb ? 4 * 0.009 * V : 0; // m=0.009/m 관례(명시)
    const rtSabine = (0.161 * V) / (A + air);
    const rtEyring = (0.161 * V) / (-S * Math.log(1 - Math.min(alphaBar, 0.99)) + air);
    const use = alphaBar > 0.2 ? rtEyring : rtSabine;
    const method = alphaBar > 0.2 ? 'Eyring(ᾱ>0.2 관례)' : 'Sabine';
    let judge = null;
    if (Number(input.targetRT_s) > 0) {
      const tol = (input.tolerance_pct ?? 20) / 100;
      const ok = Math.abs(use - input.targetRT_s) <= input.targetRT_s * tol;
      judge = { RT_s: +use.toFixed(2), target_s: input.targetRT_s, tolerance_pct: (input.tolerance_pct ?? 20), pass: ok };
    }
    return {
      verdict: judge ? (judge.pass ? 'PASS' : 'FAIL') : 'INFO',
      checks: { reverb: { sabine_s: +rtSabine.toFixed(2), eyring_s: +rtEyring.toFixed(2), governing: method, alphaBar: +alphaBar.toFixed(3), ...(judge ? { judge } : {}) } },
      surfaces: rows,
      notes: [
        `RT60: Sabine ${rtSabine.toFixed(2)}s · Eyring ${rtEyring.toFixed(2)}s — ${method} 적용(ᾱ=${alphaBar.toFixed(2)}).`,
        '흡음률=재료 자료 입력 원칙(주파수 의존 — 500Hz/1kHz 대표 관례). 확산음장 가정·집중흡음 배치는 한계 명시.',
        '권장 RT=용도 기준 입력(비교) — 강당·회의실 등 문헌값 확인 필요.',
      ],
    };
  },
};
