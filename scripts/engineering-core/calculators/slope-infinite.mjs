/**
 * P8 토목 — 무한사면 안정 (침투 유무) — 한계평형 폐형해(교과서 표준).
 * FS = [c′ + (γz − γw·zw)·cos²β·tanφ′] / (γz·sinβ·cosβ)  (zw=침윤 수두, 0=건조)
 * 검증 앵커: c′=0·건조 → FS = tanφ/tanβ (폐형) · 완전포화(zw=z) 감소 확인.
 * 한계(명시): 무한사면 가정(얕은 평면 파괴·사면 평행 침투) — 원호 파괴(Bishop)는 후속.
 */
export default {
  id: 'slope_infinite',
  domain: 'civil/slope',
  title: '무한사면 안정 (평면 파괴)',
  description: '한계평형 폐형해 — 얕은 표층 파괴 FS. 절토·성토 사면 개념 검토.',
  refs: ['한계평형 무한사면 고전 정해 (검증 앵커: c′=0 건조 시 FS=tanφ/tanβ)', 'KDS 11 70 05(비탈면) — 기준 FS는 프로젝트 조건 입력'],
  status: 'verified — 폐형 앵커 상시. Bishop 원호·지진 관성은 후속',
  inputSchema: {
    type: 'object',
    required: ['slopeDeg', 'phiDeg', 'depthM', 'gamma', 'fsRequired'],
    properties: {
      slopeDeg: { type: 'number', minimum: 5, maximum: 60, description: '사면 경사 β °' },
      phiDeg: { type: 'number', minimum: 5, maximum: 45, description: '내부마찰각 φ′ ° (지반조사값)' },
      cohesion: { type: 'number', minimum: 0, maximum: 100, description: '점착력 c′ kPa (기본 0 — 보수측)' },
      depthM: { type: 'number', exclusiveMinimum: 0, maximum: 10, description: '파괴면 깊이 z m (표층)' },
      gamma: { type: 'number', minimum: 14, maximum: 24, description: '단위중량 kN/m³' },
      waterDepthM: { type: 'number', minimum: 0, maximum: 10, description: '침윤 수두 zw m (0=건조, z=완전포화 — 사면 평행 침투 가정)' },
      fsRequired: { type: 'number', minimum: 1.0, maximum: 3.0, description: '요구 안전율 (KDS 11 70 05 — 건기/우기·비탈면 등급별 상이, 프로젝트 값 입력)' },
    },
  },
  run(input) {
    const b = (input.slopeDeg * Math.PI) / 180, phi = (input.phiDeg * Math.PI) / 180;
    const c = input.cohesion ?? 0, z = input.depthM, g = input.gamma;
    const zw = Math.min(input.waterDepthM ?? 0, z);
    const gw = 9.81;
    const num = c + (g * z - gw * zw) * Math.cos(b) ** 2 * Math.tan(phi);
    const den = g * z * Math.sin(b) * Math.cos(b);
    const FS = num / den;
    const pass = FS >= input.fsRequired;
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks: { stability: { FS: +FS.toFixed(3), required: input.fsRequired, pass } },
      intermediate: { ru_like: +(gw * zw / (g * z)).toFixed(3), dryFS_c0: +(Math.tan(phi) / Math.tan(b)).toFixed(3) },
      notes: [
        `FS = [c′+(γz−γw·zw)cos²β·tanφ]/(γz·sinβ·cosβ) = ${FS.toFixed(3)} (요구 ${input.fsRequired})`,
        '무한사면 가정(표층 평면 파괴·사면 평행 침투) — 깊은 원호 파괴는 Bishop 해석 필요(후속 명시).',
        '요구 FS는 KDS 11 70 05 조건별 값 — 사용자가 확인 입력.',
      ],
    };
  },
};
