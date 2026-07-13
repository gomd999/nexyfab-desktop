/**
 * 인테리어 — 수용인원·피난 검토 (재실자 밀도 + 피난 유효폭 + 출구 수).
 *
 * 재실자수 = 바닥면적 / 인당 점유면적(용도별). 피난 유효폭 = 재실자 × 폭계수.
 * 계수(m²/인, mm/인, 2방향 피난 임계 재실자)는 **건축법 피난·방화 규칙 / IBC**의 값 —
 * 숫자(사실)는 구현하되 원문은 비-PD(저작권)라 조항 참조만. 공식(면적÷밀도, 재실자×폭)은
 * 보편(저작권 무관). 참고 파일 Atelier의 "1인/0.5m²·문 1.2m" 개념을 표준값으로 일반화.
 */
export default {
  id: 'occupancy_egress',
  domain: 'interior',
  title: '수용인원·피난 검토 (재실자·유효폭·출구)',
  description: '용도별 재실자 밀도로 수용인원 산정, 피난 유효폭·출구 수·문 유효폭을 대조. 밀도·폭계수는 용도/기준에서 입력.',
  refs: [
    '건축법 시행령 §34·§35, 「건축물의 피난·방화구조 등의 기준에 관한 규칙」 (원문 비-PD — 조항 참조)',
    'IBC §1004 재실자 산정 · §1005 피난 폭 (ICC, 비-PD — 조항 참조)',
    '면적÷밀도, 재실자×폭계수 — 보편 산정식',
  ],
  status: 'draft — 산정식 결정론 구현. 밀도·폭계수는 용도/관할 기준에서 확인 입력. 비법정 참고(피난은 건축사·소방 검토 영역)',
  inputSchema: {
    type: 'object',
    required: ['floorAreaM2', 'occupantDensityM2'],
    properties: {
      floorAreaM2: { type: 'number', exclusiveMinimum: 0, maximum: 100000, description: '바닥(재실)면적 m²' },
      occupantDensityM2: { type: 'number', exclusiveMinimum: 0, maximum: 20, description: '인당 점유면적 m²/인 (집회밀집 0.5, 집회좌석 1.4, 판매 3.0, 업무 10 …)' },
      seatCount: { type: 'number', minimum: 0, description: '실제 좌석 수 (있으면 재실자=max(밀도산정, 좌석))' },
      egressWidthProvidedMm: { type: 'number', minimum: 0, description: '확보 피난 유효폭 합 mm (모든 출구)' },
      egressFactorMmPerOcc: { type: 'number', minimum: 1, maximum: 20, description: '재실자당 피난폭 mm/인 (기본 5.0 · 계단 7.6)' },
      exitCount: { type: 'number', minimum: 1, description: '출구 수' },
      doorClearWidthMm: { type: 'number', minimum: 0, description: '주 출입문 유효폭 mm (기본 최소 900)' },
    },
  },
  run(input) {
    const {
      floorAreaM2, occupantDensityM2, seatCount = 0,
      egressWidthProvidedMm = 0, egressFactorMmPerOcc = 5.0, exitCount = 1, doorClearWidthMm = 0,
    } = input;

    const byDensity = Math.ceil(floorAreaM2 / occupantDensityM2);
    const occupants = Math.max(byDensity, Math.ceil(seatCount));

    // 피난 유효폭
    const requiredEgressMm = occupants * egressFactorMmPerOcc;
    // 2방향 피난: 재실자 > 50이면 출구 2개 이상 권장(집회·판매 통상).
    const minExits = occupants > 50 ? 2 : 1;
    const minDoorMm = 900; // 주 출입문 최소 유효폭(통상)

    const checks = {
      egress_width: {
        required_mm: Math.round(requiredEgressMm), provided_mm: Math.round(egressWidthProvidedMm),
        ratio: egressWidthProvidedMm > 0 ? requiredEgressMm / egressWidthProvidedMm : Infinity,
        pass: egressWidthProvidedMm >= requiredEgressMm,
      },
      exit_count: { required: minExits, provided: exitCount, pass: exitCount >= minExits },
    };
    if (doorClearWidthMm > 0) {
      checks.door_width = { required_mm: minDoorMm, provided_mm: Math.round(doorClearWidthMm), pass: doorClearWidthMm >= minDoorMm };
    }

    return {
      inputsEcho: { ...input, egressFactorMmPerOcc, exitCount },
      intermediate: {
        occupants_by_density: byDensity,
        occupants_design: occupants,
        occupant_load_factor_m2: occupantDensityM2,
      },
      checks,
      verdict: Object.values(checks).every((c) => c.pass) ? 'PASS' : 'FAIL',
      notes: [
        '재실자 밀도·피난폭 계수는 건축물 용도·관할(건축법/IBC)에서 확인해 입력 — 본 계산기는 값을 규정하지 않음',
        '피난 최종 판정은 건축사·소방 검토 영역(방화구획·보행거리·직통계단 별도)',
      ],
    };
  },
};
