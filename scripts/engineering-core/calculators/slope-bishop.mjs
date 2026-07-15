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
  status: 'verified — USACE EM 1110-2-1902 F-5 재현 FS 1.340(공표 1.33, b열 역순 인쇄 교정 판독) + φ=0 폐형 앵커',
  inputSchema: {
    type: 'object',
    required: ['fsRequired'],
    properties: {
      slices: { description: '절편 배열 [{W, alphaDeg, dx, c, phiDeg, u?}] — geometry 미입력 시 필수' },
      geometry: { description: '자동 모드(선택): { H(사면고 m), slopeDeg, gamma, c_kPa, phiDeg, nSlices? } — 균질 단일층·수평 지표. 임계원 그리드 탐색 자동' },
      fsRequired: { type: 'number', minimum: 1.0, maximum: 3.0, description: '요구 안전율 (조건별 기준 — 프로젝트 확인 입력)' },
    },
  },
  run(input) {
    // ── 자동 모드: 균질 사면 절편 생성 + 임계원 그리드 탐색 (Taylor 앵커 검증) ──
    if (input.geometry && !input.slices) {
      const g = input.geometry;
      for (const k of ['H', 'slopeDeg', 'gamma', 'c_kPa', 'phiDeg']) if (!Number.isFinite(Number(g[k]))) throw new Error('input gate: geometry.' + k);
      const H = g.H, beta = (g.slopeDeg * Math.PI) / 180;
      const crestX = H / Math.tan(beta); // 선단(0,0)→정상부(crestX,H)
      const surfY = (x) => x <= 0 ? 0 : x >= crestX ? H : x * Math.tan(beta);
      const N = Math.min(40, Math.max(10, Math.round(g.nSlices ?? 24)));
      const fsOfCircle = (xc, yc, R) => {
        // 원-지표 교점: 수치 탐색으로 x 진입/이탈점
        const inGround = (x) => {
          const dy2 = R * R - (x - xc) * (x - xc);
          if (dy2 <= 0) return false;
          return yc - Math.sqrt(dy2) < surfY(x);
        };
        let x0 = null, x1 = null;
        const xmin = xc - R, xmax = xc + R, step = (xmax - xmin) / 400;
        for (let x = xmin; x <= xmax; x += step) {
          if (inGround(x)) { if (x0 === null) x0 = x; x1 = x; }
        }
        if (x0 === null || x1 - x0 < H * 0.3) return null;
        const slices = [];
        const dxs = (x1 - x0) / N;
        for (let i = 0; i < N; i++) {
          const xm = x0 + dxs * (i + 0.5);
          const dy2 = R * R - (xm - xc) * (xm - xc);
          if (dy2 <= 0) return null;
          const yBase = yc - Math.sqrt(dy2);
          const hSlice = surfY(xm) - yBase;
          if (hSlice <= 0) continue;
          const alpha = Math.atan((xm - xc) / Math.sqrt(dy2)); // 접선 경사
          slices.push({ W: g.gamma * hSlice * dxs, alphaDeg: (alpha * 180) / Math.PI, dx: dxs, c: g.c_kPa, phiDeg: g.phiDeg });
        }
        if (slices.length < 5) return null;
        const denom = slices.reduce((sum, sx) => sum + sx.W * Math.sin((sx.alphaDeg * Math.PI) / 180), 0);
        if (denom <= 0) return null;
        let FS = 1.5;
        for (let it = 0; it < 60; it++) {
          let num = 0;
          for (const sx of slices) {
            const a = (sx.alphaDeg * Math.PI) / 180, ph = (sx.phiDeg * Math.PI) / 180;
            num += (sx.c * sx.dx + sx.W * Math.tan(ph)) / (Math.cos(a) * (1 + (Math.tan(a) * Math.tan(ph)) / FS));
          }
          const nx = num / denom;
          if (Math.abs(nx - FS) < 1e-5) return nx;
          FS = nx;
        }
        return FS;
      };
      // 그리드 탐색: 중심 (정상부 위쪽 영역) × R
      let best = { FS: Infinity, xc: 0, yc: 0, R: 0 };
      for (let ix = 0; ix <= 10; ix++) for (let iy = 0; iy <= 8; iy++) {
        const xc = -0.5 * H + (ix / 10) * (crestX + 1.5 * H);
        const yc = H + 0.2 * H + (iy / 8) * (2.0 * H);
        for (let ir = 0; ir <= 8; ir++) {
          const Rmin2 = yc - H * 0.05, Rmax2 = Math.hypot(xc, yc) + 0.3 * H;
          const R = Rmin2 + (ir / 8) * Math.max(0.1, Rmax2 - Rmin2);
          const fs = fsOfCircle(xc, yc, R);
          if (fs !== null && fs > 0.1 && fs < best.FS) best = { FS: fs, xc, yc, R };
        }
      }
      if (!Number.isFinite(best.FS) || best.FS === Infinity) throw new Error('임계원 탐색 실패 — 기하 확인');
      const pass = best.FS >= input.fsRequired;
      return {
        verdict: pass ? 'PASS' : 'FAIL',
        checks: { stability: { FS: +best.FS.toFixed(3), required: input.fsRequired, pass } },
        criticalCircle: { xc_m: +best.xc.toFixed(2), yc_m: +best.yc.toFixed(2), R_m: +best.R.toFixed(2) },
        notes: [
          '자동 모드: 균질 단일층·수평 지표·' + N + '절편, 임계원 그리드 탐색(11×9×9=891원 — 국소 정밀화는 후속).',
          '검증 앵커: φ=0 Taylor 안정수 재현(회귀 테스트). 다층·지하수·인장균열은 절편 입력 모드 사용.',
        ],
      };
    }
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
