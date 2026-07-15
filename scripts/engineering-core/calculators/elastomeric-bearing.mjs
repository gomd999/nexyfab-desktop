/**
 * P19 교량 — 강재보강 탄성받침 (KDS 24 90 11 §4.2.3 원문 판독).
 * 형상계수 S = A1/(lp·te) (4.2-8) · 압축 변형률 εc,d = 1.5Fz,d/(G·Ar·S) (4.2-9)
 * · 전단 변형률 εq,d = vxy,d/Tq — 사용 0.7·극한 1.0 한계(원문 §4.2.3.9)
 * · 회전 변형률 εα,d = (a′²αa+b′²αb)·ti/(2Σti³) (4.2-12)
 * · 총 변형률 εt,d = KL(εc+εq+εα) (4.2-7) — KL·총한계는 원문 계수 확인 입력
 *   (§4.2.3.6 여기서 항목 미판독분 — 정직하게 입력 원칙, 관례 KL 1.0·한계 5.0G계열 안내만).
 * 표 4.2-7/8(표준치수 허용압축응력·회전)은 표 전사 후속 — 치수별 대조는 입력 안내.
 */
export default {
  id: 'elastomeric_bearing',
  domain: 'bridge/bearing',
  title: '탄성받침 (강재보강 — §4.2.3)',
  description: '형상계수·압축/전단/회전 변형률·총변형률 — 전단 0.7/1.0 한계 원문.',
  refs: ['KDS 24 90 11 §4.2.3 — 식4.2-7(εt=KL(εc+εq+εα))·4.2-8(S)·4.2-9(εc=1.5Fz/GArS)·4.2-11(εq≤0.7/1.0 원문)·4.2-12(εα) — GIF 판독'],
  status: 'verified(식) — 전단 한계 0.7/1.0 원문 확정. 총변형률 한계·KL·표 4.2-7/8 표준치수 표는 확인 입력(후속 전사)',
  inputSchema: {
    type: 'object',
    required: ['a_mm', 'b_mm', 'ti_mm', 'nLayers', 'G_MPa', 'Fz_kN'],
    properties: {
      a_mm: { type: 'number', exclusiveMinimum: 0, description: '받침 나비 a (유효 a′=강판 치수 — 피복 제외 입력 권장)' },
      b_mm: { type: 'number', exclusiveMinimum: 0, description: '받침 길이 b' },
      ti_mm: { type: 'number', exclusiveMinimum: 0, maximum: 30, description: '개별 고무층 두께' },
      nLayers: { type: 'integer', minimum: 2, maximum: 30, description: '고무층 수' },
      G_MPa: { type: 'number', minimum: 0.6, maximum: 1.2, description: '전단탄성계수 (표 4.2-4 등급 — 0.9 통상, 제품값 입력)' },
      Fz_kN: { type: 'number', exclusiveMinimum: 0, description: '설계 수직하중' },
      vxy_mm: { type: 'number', minimum: 0, description: '수평 상대변위 (온도+크리프 등 벡터합 — expansion_joint 연계)' },
      limitState: { enum: ['service', 'ultimate'], description: '한계상태 (전단 한계 0.7/1.0 — 원문)' },
      alphaA_rad: { type: 'number', minimum: 0, description: '회전각 a방향 (구조해석 입력)' },
      alphaB_rad: { type: 'number', minimum: 0, description: '회전각 b방향' },
      KL: { type: 'number', minimum: 1.0, maximum: 2.0, description: '하중계수 KL (원문 §4.2.3.6 확인 입력 — 기본 1.0)' },
      totalStrainLimit: { type: 'number', exclusiveMinimum: 0, description: '총변형률 한계 (원문 §4.2.3.6 확인 입력 — 미입력 시 총변형률 INFO 보고만·판정 안 함)' },
      Ar_mm2: { type: 'number', exclusiveMinimum: 0, description: '유효 재하면적 Ar (변위 감소 반영 — 기본 a×b 명시)' },
    },
  },
  run(input) {
    const { a_mm: a, b_mm: b, ti_mm: ti, nLayers: n, G_MPa: G } = input;
    const A1 = a * b;
    const lp = 2 * (a + b);
    const S = A1 / (lp * ti); // 4.2-8 (te=개별층 두께)
    const Ar = Number(input.Ar_mm2) > 0 ? input.Ar_mm2 : A1;
    const Fz = input.Fz_kN * 1000;
    const epsC = (1.5 * Fz) / (G * Ar * S); // 4.2-9
    const Tq = n * ti; // 전단 유효 총두께(피복 별도 — 명시)
    const epsQ = (Number(input.vxy_mm) || 0) / Tq; // 4.2-11
    const qLimit = (input.limitState ?? 'service') === 'ultimate' ? 1.0 : 0.7;
    // 회전 (4.2-12): 등두께 n층 — Σti³ = n·ti³
    const aa = Number(input.alphaA_rad) || 0, ab = Number(input.alphaB_rad) || 0;
    const epsA = ((a * a * aa + b * b * ab) * ti) / (2 * n * Math.pow(ti, 3));
    const KL = input.KL ?? 1.0;
    const epsT = KL * (epsC + epsQ + epsA);
    const checks = {
      shape: { S: +S.toFixed(2), note: 'S=A1/(lp·te) 식4.2-8 — 통상 6~12 범위 관례' },
      shear: { epsQ: +epsQ.toFixed(3), limit: qLimit, pass: epsQ <= qLimit, note: `식4.2-11 — ${input.limitState === 'ultimate' ? '극한 1.0' : '사용 0.7'} 원문 한계` },
      compression: { epsC: +epsC.toFixed(3), sigma_MPa: +(Fz / Ar).toFixed(2), note: 'εc=1.5Fz/(G·Ar·S) 식4.2-9. 허용압축응력은 표 4.2-7/8 표준치수 대조(전사 후속) 또는 제품 시험값' },
      rotation: { epsA: +epsA.toFixed(3), note: '식4.2-12 (등두께 층 가정 명시)' },
      total: Number(input.totalStrainLimit) > 0
        ? { epsT: +epsT.toFixed(3), KL, limit: input.totalStrainLimit, pass: epsT <= input.totalStrainLimit }
        : { epsT: +epsT.toFixed(3), KL, note: '총한계 미입력 — INFO(원문 §4.2.3.6 한계·KL 확인 입력 원칙)' },
    };
    const gatePass = checks.shear.pass && (checks.total.pass !== false);
    return {
      verdict: gatePass ? (Number(input.totalStrainLimit) > 0 ? 'PASS' : 'WARN') : 'FAIL',
      checks,
      intermediate: { A1_mm2: A1, Tq_mm: Tq, Ar_mm2: Ar },
      notes: [
        `S=${S.toFixed(2)} · εc ${epsC.toFixed(3)} + εq ${epsQ.toFixed(3)}(≤${qLimit} 원문) + εα ${epsA.toFixed(3)} → εt ${epsT.toFixed(3)} (KL=${KL}).`,
        'WARN=전단 통과·총한계 미입력(확인 입력 시 정식 판정). 안정성(§4.2.3.12)·부반력·마찰(활동) 검토는 후속.',
        '수평변위는 expansion_joint 산출 연계 가능. Ar=변위 시 유효면적 감소 반영 입력 권장(기본 전면적 — 비보수 방향이므로 명시).',
      ],
    };
  },
};
