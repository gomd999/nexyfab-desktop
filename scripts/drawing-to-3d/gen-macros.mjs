/**
 * gen-macros.mjs — 자유곡면 생성기 레지스트리(260719).
 *
 * 자유곡면(mesh) 부품을 "정점 덩어리"가 아니라 **생성기 스펙(gen:{kind,params})**으로
 * 보유 → 대화 수정은 gen.params 패치 → 결정론 재생성(verts 직접 수정 금지 — 제작
 * 추적성 유지, 실제 터보기계 CAD 의 파라메트릭 블레이드 설계와 동일 사상).
 */

/** NACA 4-digit 블레이드 링(축=x) — domain-assemblies 프로펠러 수학의 엔진 승격판. */
export function bladeRingMesh({ nB = 12, rRoot = 100, rTip = 240, chord = 60, cx = 0, cy = 0, cz = 0, pitch = 600, naca = '4412', secs = 8, mpts = 16 } = {}) {
  const nBlades = Math.max(2, Math.min(60, Math.round(nB)));
  const s = String(naca).padStart(4, '0');
  const mC = (parseInt(s[0], 10) || 0) / 100, pC = (parseInt(s[1], 10) || 4) / 10, tC = (parseInt(s.slice(2), 10) || 12) / 100;
  const yt = (x) => 5 * tC * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const camber = (x) => (x < pC ? (mC / (pC * pC)) * (2 * pC * x - x * x) : (mC / ((1 - pC) ** 2)) * (1 - 2 * pC + 2 * pC * x - x * x));
  const half = mpts / 2;
  const baseLoop = [];
  for (let i = 0; i <= half; i++) { const x = i / half; baseLoop.push([x, camber(x) + yt(x)]); }
  for (let i = half - 1; i > 0; i--) { const x = i / half; baseLoop.push([x, camber(x) - yt(x)]); }
  const M = mpts;
  const verts = [], faces = [];
  for (let bi = 0; bi < nBlades; bi++) {
    const phase = (2 * Math.PI * bi) / nBlades;
    const off = verts.length;
    for (let k = 0; k <= secs; k++) {
      const r = rRoot + ((rTip - rRoot) * k) / secs;
      const taper = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.15 + (0.85 * k) / secs));
      const cCh = chord * taper;
      const beta = Math.atan(pitch / (2 * Math.PI * r));
      for (const [xu, yu] of baseLoop) {
        const sx = (xu - 0.35) * cCh, sy = yu * cCh;
        const tang = sx * Math.cos(beta) - sy * Math.sin(beta);
        const axial = sx * Math.sin(beta) + sy * Math.cos(beta);
        verts.push([
          cx + axial,
          cy + r * Math.cos(phase) - tang * Math.sin(phase),
          cz + r * Math.sin(phase) + tang * Math.cos(phase),
        ]);
      }
    }
    for (let k = 0; k < secs; k++) for (let i = 0; i < M; i++) {
      const a = off + k * M + i, b2 = off + k * M + ((i + 1) % M), c2 = off + (k + 1) * M + ((i + 1) % M), d2 = off + (k + 1) * M + i;
      faces.push([a, b2, c2], [a, c2, d2]);
    }
    const rootC = verts.length; verts.push([0, 1, 2].map((j) => baseLoop.reduce((sum, _q, i) => sum + verts[off + i][j], 0) / M));
    for (let i = 0; i < M; i++) faces.push([rootC, off + ((i + 1) % M), off + i]);
    const tipC = verts.length; verts.push([0, 1, 2].map((j) => baseLoop.reduce((sum, _q, i) => sum + verts[off + secs * M + i][j], 0) / M));
    for (let i = 0; i < M; i++) faces.push([tipC, off + secs * M + i, off + secs * M + ((i + 1) % M)]);
  }
  let vol6 = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let j = 0; j < 3; j++) { if (v[j] < mn[j]) mn[j] = v[j]; if (v[j] > mx[j]) mx[j] = v[j]; }
  for (const [a, b2, c2] of faces) {
    const A2 = verts[a], B2 = verts[b2], C2 = verts[c2];
    vol6 += A2[0] * (B2[1] * C2[2] - B2[2] * C2[1]) + A2[1] * (B2[2] * C2[0] - B2[0] * C2[2]) + A2[2] * (B2[0] * C2[1] - B2[1] * C2[0]);
  }
  return {
    volumeMm3: +Math.abs(vol6 / 6).toFixed(1), triCount: faces.length,
    aabb: { min: mn.map((v) => +v.toFixed(2)), max: mx.map((v) => +v.toFixed(2)) },
    verts: verts.map((v) => v.map((x) => +x.toFixed(3))), faces,
  };
}

/** kind → mesh params 생성기. 미등록 kind = 정직 거부(호출측). */
export const GEN_REGISTRY = {
  blade_ring: bladeRingMesh,
};
