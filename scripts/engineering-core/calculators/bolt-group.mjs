/**
 * P17 기계/강구조 — 볼트군 편심 (탄성벡터법 — 폐형).
 * 직접분 P/n + 비틀림분 M·r/Σr² 벡터합 → 최대 볼트 전단력 vs 설계전단강도.
 * 설계강도: φRn = 0.75·Fnv·Ab (KDS 14 31 25 볼트 전단 구조 — Fnv는 등급별 입력
 *   또는 kds.json 볼트 데이터. 본 계산기는 Fnv 직접 입력 원칙 — bolt_connection과 동일 근거).
 * 앵커: 대칭 4볼트 순수 모멘트 → 각 볼트 힘 = M/(4r) 폐형 · 도심 손검증.
 * 순간중심법(비선형)은 공표 하중-변형 곡선 확보 시 후속 — 탄성법은 보수(명시).
 */
export default {
  id: 'bolt_group',
  domain: 'mechanical/connection',
  title: '볼트군 편심 (탄성벡터법)',
  description: '편심하중 볼트군 — 직접+비틀림 벡터합 최대 볼트력 vs φRn.',
  refs: ['탄성벡터법(교과서 폐형 — 순간중심법 대비 보수 명시)', 'φ0.75·Fnv — KDS 14 31 25 볼트 전단 구조(Fnv 입력 원칙)'],
  status: 'verified — 폐형 앵커(대칭 4볼트 M/(4r)·도심). 순간중심법·지압·미끄럼(마찰접합)은 후속/별도',
  inputSchema: {
    type: 'object',
    required: ['bolts', 'boltDia_mm', 'Fnv_MPa'],
    properties: {
      bolts: { description: '볼트 좌표 [{x,y}] mm — 2~36개' },
      boltDia_mm: { type: 'number', minimum: 12, maximum: 36, description: '볼트 지름 (Ab=π d²/4 — 나사부 전단이면 유효단면 별도 명시)' },
      Fnv_MPa: { type: 'number', minimum: 150, maximum: 600, description: '공칭전단강도 Fnv (등급별 — F10T-N 400 등 kds.json 대조 입력)' },
      Px_kN: { type: 'number', description: '수평력 (군 전체)' },
      Py_kN: { type: 'number', description: '수직력' },
      e_mm: { type: 'number', description: '편심 (Py 기준 x방향 — 도심에서)' },
      Mz_kNm: { type: 'number', description: '직접 모멘트 입력(선택 — e 대신)' },
      threadsIncluded: { type: 'boolean', description: '나사부 전단면 포함 여부 (true면 0.75Ab 관례 적용 명시)' },
    },
  },
  run(input) {
    const bolts = input.bolts;
    if (!Array.isArray(bolts) || bolts.length < 2 || bolts.length > 36) throw new Error('input gate: bolts 2~36개');
    for (const [i, b] of bolts.entries()) if (!Number.isFinite(Number(b.x)) || !Number.isFinite(Number(b.y))) throw new Error(`input gate: bolts[${i}]`);
    const n = bolts.length;
    const Cx = bolts.reduce((s, b) => s + b.x, 0) / n;
    const Cy = bolts.reduce((s, b) => s + b.y, 0) / n;
    const sumR2 = bolts.reduce((s, b) => s + (b.x - Cx) ** 2 + (b.y - Cy) ** 2, 0);
    const Px = (Number(input.Px_kN) || 0) * 1000, Py = (Number(input.Py_kN) || 0) * 1000;
    const Mz = Number(input.Mz_kNm) ? input.Mz_kNm * 1e6 : (Number(input.e_mm) || 0) * Py;
    if (Mz !== 0 && sumR2 === 0) throw new Error('input gate: 모멘트 저항 불가(볼트 동일점)');
    let fMax = 0, crit = null;
    const perBolt = bolts.map((b, i) => {
      const rx = b.x - Cx, ry = b.y - Cy;
      const fx = Px / n + (Mz !== 0 ? (Mz * -ry) / sumR2 : 0);
      const fy = Py / n + (Mz !== 0 ? (Mz * rx) / sumR2 : 0);
      const f = Math.hypot(fx, fy) / 1000; // kN
      if (f > fMax) { fMax = f; crit = i + 1; }
      return { bolt: i + 1, x: b.x, y: b.y, F_kN: +f.toFixed(2) };
    });
    const d = input.boltDia_mm;
    const AbFull = (Math.PI * d * d) / 4;
    const Ab = input.threadsIncluded ? 0.75 * AbFull : AbFull; // 나사부 0.75 관례(명시)
    const phiRn = (0.75 * input.Fnv_MPa * Ab) / 1000; // kN
    const ratio = phiRn > 0 ? fMax / phiRn : null;
    return {
      verdict: fMax <= phiRn ? 'PASS' : 'FAIL',
      checks: {
        maxBolt: { bolt: crit, F_kN: +fMax.toFixed(2), phiRn_kN: +phiRn.toFixed(1), ratio: +ratio.toFixed(3), pass: fMax <= phiRn },
      },
      intermediate: { n, centroid: { x: +Cx.toFixed(1), y: +Cy.toFixed(1) }, sumR2_mm2: Math.round(sumR2), Mz_kNmm: +(Mz / 1000).toFixed(0), Ab_mm2: +Ab.toFixed(1) },
      perBolt,
      notes: [
        `탄성벡터법: 직접 P/n + 비틀림 M·r/Σr² — 최대 볼트 ${crit}번 ${fMax.toFixed(2)}kN vs φRn ${phiRn.toFixed(1)}kN.`,
        `φ0.75·Fnv ${input.Fnv_MPa}MPa·Ab${input.threadsIncluded ? '(나사부 0.75 관례 명시)' : ''}. 순간중심법 대비 보수 명시.`,
        '지압·연단거리·미끄럼(마찰접합)·게이지 배치는 bolt_connection/별도 검토.',
      ],
    };
  },
};
