/**
 * P8 토목 — Bishop 간편법 원호 사면 (절편 입력형) — 한계평형 반복해.
 * FS = Σ[(c·Δx + W·tanφ)/mα] / Σ(W·sinα), mα = cosα·(1 + tanα·tanφ/FS) — FS 반복 수렴.
 * v1 = 절편 데이터 입력형(절편 자동 생성·원호 탐색은 후속 명시).
 * 앵커: φ=0 → FS=Σ(c·Δx/cosα)/ΣW·sinα 폐형. USACE F-5 재현은 절편표 열 재판독 후(보류 명시).
 * 간극수압: 절편별 u·Δx 입력 시 유효응력식 (W−u·Δx)tanφ.
 */
export default {
  id: 'slope_bishop',
  domain: 'civil/slope',
  title: 'Bishop 간편법 (원호 — 절편 입력)',
  description: '절편 배열 → FS 반복 수렴. USACE 공표예제 재현 게이트.',
  refs: ['Bishop 간편법 (USACE EM 1110-2-1902 App.F 정식 — 공표예제 F-5 재현)'],
  status: 'draft — 공식 정형(교과서 Bishop)·φ=0 폐형 앵커 통과. USACE F-5 절편표 열 정의 재판독 후 재현 게이트 승격 예정(전사 ±10% 불일치 정직 보류)',
  inputSchema: {
    type: 'object',
    required: ['slices', 'fsRequired'],
    properties: {
      slices: { description: '절편 배열 [{W(kN/m 또는 kips/ft — 일관 단위), alphaDeg, dx(바닥 수평투영 폭), c(응력단위 일관), phiDeg, u? (간극수압)}]' },
      fsRequired: { type: 'number', minimum: 1.0, maximum: 3.0, description: '요구 안전율 (조건별 기준 — 프로젝트 확인 입력)' },
    },
  },
  run(input) {
    const sl = input.slices;
    if (!Array.isArray(sl) || sl.length < 3 || sl.length > 60) throw new Error('input gate: slices 3~60개 배열 필요');
    for (const [i, s] of sl.entries()) {
      for (const k of ['W', 'alphaDeg', 'dx', 'c', 'phiDeg']) if (!Number.isFinite(Number(s[k]))) throw new Error(`input gate: 절편 ${i + 1} '${k}' 필요`);
    }
    const denom = sl.reduce((sum, s) => sum + s.W * Math.sin((s.alphaDeg * Math.PI) / 180), 0);
    if (denom <= 0) throw new Error('ΣW·sinα ≤ 0 — 절편 부호·순서 확인');
    let FS = 1.5;
    let iter = 0;
    for (; iter < 60; iter++) {
      let num = 0;
      for (const s of sl) {
        const a = (s.alphaDeg * Math.PI) / 180, phi = (s.phiDeg * Math.PI) / 180;
        const mA = Math.cos(a) * (1 + (Math.tan(a) * Math.tan(phi)) / FS);
        const Weff = s.W - (Number(s.u) > 0 ? s.u * s.dx : 0);
        num += (s.c * s.dx + Weff * Math.tan(phi)) / mA;
      }
      const next = num / denom;
      if (Math.abs(next - FS) < 1e-5) { FS = next; break; }
      FS = next;
    }
    const pass = FS >= input.fsRequired;
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks: { stability: { FS: +FS.toFixed(3), required: input.fsRequired, pass } },
      intermediate: { iterations: iter + 1, sumWsin: +denom.toFixed(1), nSlices: sl.length },
      notes: [
        `Bishop 간편법 FS=${FS.toFixed(3)} (반복 ${iter + 1}회 수렴) — 요구 ${input.fsRequired}.`,
        '절편 입력형 v1 — 절편 자동생성(지층·원호 기하)·임계원 탐색·지진 관성력은 후속(명시). 간극수압 u 입력 시 유효응력.',
      ],
    };
  },
};
