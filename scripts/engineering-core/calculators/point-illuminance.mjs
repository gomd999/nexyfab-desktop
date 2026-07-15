/**
 * P17 인테리어 — 점별 조도 (역제곱·코사인 법칙 — 폐형).
 * 점광원 근사: E = Σ I(θ)·cos³θ / h² (수평면 — cosθ=h/r 포함 형태 E=I·h/r³·… 정리:
 *   E = I·cosθ/r² 에서 수평면 cos 성분 → I·h/(r³)·… 표준식 E_h = I·cos³θ/h²).
 * 배광 I(θ) = 등방(총광속/4π) 근사 또는 각도별 IES 값 입력(지어내지 않음 —
 *   기본은 등방 근사 명시. 다운라이트 협각은 IES 필수 안내).
 * 유지율 MF 입력(광속법과 동일 원칙). 앵커: 직하점 θ=0 → E=I/h² 폐형.
 */
export default {
  id: 'point_illuminance',
  domain: 'interior/lighting',
  title: '점별 조도 (역제곱·코사인)',
  description: '기구 배치 → 임의 점 수평면 조도 그리드 — 광속법의 정밀판. IES는 입력.',
  refs: ['역제곱·코사인 법칙 (조명공학 폐형)', '배광=등방 근사(명시) 또는 I(θ) 입력 — IES 자료 원칙'],
  status: 'verified — 폐형 앵커(직하 I/h²). 반사 성분(간접) 미포함 명시 — 직접조도만(보수)',
  inputSchema: {
    type: 'object',
    required: ['fixtures', 'planeZ_m'],
    properties: {
      fixtures: { description: '기구 [{x_m, y_m, z_m(설치고), flux_lm?(등방 근사용) 또는 I_cd?(하향 대표 광도 — IES 대표값 입력)}] 1~50' },
      planeZ_m: { type: 'number', minimum: 0, description: '작업면 높이 (통상 0.85)' },
      points: { description: '평가점 [{x_m,y_m}] (미입력 시 기구 아래+중간점 자동)' },
      maintenance: { type: 'number', minimum: 0.5, maximum: 1.0, description: '유지율 MF (기본 0.8 관례)' },
      targetLux: { type: 'number', exclusiveMinimum: 0, description: '목표 조도 (KS 조도기준 입력 — 판정용)' },
    },
  },
  run(input) {
    const fx = input.fixtures;
    if (!Array.isArray(fx) || !fx.length || fx.length > 50) throw new Error('input gate: fixtures 1~50');
    const MF = input.maintenance ?? 0.8;
    let pts = input.points;
    if (!Array.isArray(pts) || !pts.length) {
      pts = fx.map((f) => ({ x_m: f.x_m, y_m: f.y_m }));
      for (let i = 0; i < fx.length - 1; i++) pts.push({ x_m: (fx[i].x_m + fx[i + 1].x_m) / 2, y_m: (fx[i].y_m + fx[i + 1].y_m) / 2 });
    }
    if (pts.length > 200) throw new Error('input gate: points ≤200');
    const rows = pts.map((p, pi) => {
      let E = 0;
      for (const f of fx) {
        const h = (f.z_m ?? 2.7) - input.planeZ_m;
        if (h <= 0) throw new Error('input gate: 기구 높이 ≤ 작업면');
        const dx = p.x_m - f.x_m, dy = p.y_m - f.y_m;
        const r2 = dx * dx + dy * dy + h * h;
        const cos = h / Math.sqrt(r2);
        const I = Number(f.I_cd) > 0 ? Number(f.I_cd) : (Number(f.flux_lm) > 0 ? f.flux_lm / (4 * Math.PI) : null);
        if (I === null) throw new Error('input gate: fixtures에 flux_lm 또는 I_cd 필요');
        E += (I * cos ** 3) / (h * h) * MF;
      }
      return { pt: pi + 1, x: p.x_m, y: p.y_m, E_lux: +E.toFixed(0) };
    });
    const Emin = Math.min(...rows.map((r) => r.E_lux));
    const Eavg = rows.reduce((s, r) => s + r.E_lux, 0) / rows.length;
    const uniformity = Emin / Eavg;
    const pass = Number(input.targetLux) > 0 ? Emin >= input.targetLux : null;
    return {
      verdict: pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL',
      checks: { illuminance: { Emin_lux: Emin, Eavg_lux: +Eavg.toFixed(0), uniformity: +uniformity.toFixed(2), ...(pass !== null ? { target: input.targetLux, pass } : {}) } },
      points: rows,
      notes: [
        `직접조도만(반사 미포함 — 보수 명시)·MF ${MF}. 균제도 ${uniformity.toFixed(2)}(0.7↑ 관례 권장).`,
        '배광: I_cd 미입력 시 등방 근사(광속/4π — 다운라이트 협각엔 부정확, IES 대표값 입력 권장 명시). 목표조도=KS A 3011 입력.',
      ],
    };
  },
};
