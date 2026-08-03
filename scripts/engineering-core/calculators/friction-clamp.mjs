/**
 * 마찰 고정 검토 (힌지 마찰 토크 · 클램프 유지력) — 260803.
 *
 * ## 왜 이 계산기가 있는가
 * `desk_stand`(데스크 거치대)를 만들고 §10.4 수용 시험을 재 보니 **이 제품의 유일한
 * 공학 문제가 판정되지 않았다**: 「각도 0~45° 가 실제로 유지되는가」와
 * 「높이 140~320mm 가 흘러내리지 않는가」. 계산기 61종 중 이걸 하는 것이 없었다.
 * GPT 가 만든 같은 제품 모델도 당연히 안 봤다(계획서 §10.3).
 *
 * ## 무엇을 계산하나 — 둘 다 폐형이다
 * ```
 *   ① 마찰 토크   T  = n · μ · F · r_eff            (마찰면 n 개, 유효반경 r_eff)
 *      환형 면의 유효반경(균일압 가정) r_eff = (2/3)·(Ro³−Ri³)/(Ro²−Ri²)
 *   ② 볼트 축력   F  = T_tighten / (K · d)          (토크계수 K — 나사 마찰 포함 경험식)
 *   ③ 클램프 유지 V  = n · μ · F                    (미끄럼 저항, 축직각 하중)
 * ```
 *
 * ## ⚠ 이 계산기가 **하지 않는** 것 — 결과에 그대로 싣는다
 * - **μ 와 K 는 시험값이다.** 재질·표면조도·윤활·체결 이력에 따라 배로 흔들린다.
 *   기본값을 넣지 않고 **입력을 요구**한다(미입력이면 판정하지 않는다).
 *   → 이 리포의 원칙: 「물성=시험 입력」(`consolidation`·`pile_capacity` 선례와 같다).
 * - **크리프·풀림(loosening)·반복 조작에 의한 마모**를 보지 않는다. 실제 거치대가
 *   몇 달 뒤 흘러내리는 주된 원인이 이것인데, 정적 마찰식으로는 못 잡는다.
 * - **면압 분포**를 균일로 가정한다(환형 r_eff 폐형의 전제). 편심 하중·와셔 변형은 미반영.
 *
 * ## 근거
 * 환형 마찰면 유효반경·토크계수 관계는 기계설계 표준 교재의 보편식이다(특정 규격 고유값이
 * 아니다) — 이 리포의 이원화 규율상 **보편수식**이므로 해석해·손검증으로 앵커한다.
 * ⚠ KDS·AISC 등 법정 기준의 고유 계수를 쓰지 않는다. 쓸 일이 생기면 원문 대조가 먼저다.
 */
export default {
  id: 'friction_clamp',
  domain: 'mech/fastening',
  title: '마찰 고정 검토 (힌지 토크·클램프 유지력)',
  titleEn: 'Friction clamp check (hinge torque / slip resistance)',
  description: '체결 축력에서 마찰 토크와 미끄럼 저항을 산정해 조절 기구가 자세를 유지하는지 판정한다. '
    + 'μ·K 는 시험 입력(기본값 없음) — 미입력이면 판정하지 않고 정직하게 반려한다.',
  refs: [
    '환형 마찰면 유효반경 r_eff=(2/3)(Ro³−Ri³)/(Ro²−Ri²) — 균일 면압 가정 보편식',
    '체결 토크-축력 T=K·F·d — 토크계수 K 는 시험값(윤활·표면 상태 의존)',
    '⚠ 법정 기준 고유계수 미사용 — 보편수식만',
  ],
  status: '검증 — 해석해 앵커(균일압 환형 r_eff · 토크-축력 선형). '
    + '⚠ μ·K 는 시험 입력 · 크리프/풀림/마모 미반영 · 균일 면압 가정. 비법정 참고',
  inputSchema: {
    type: 'object',
    required: ['mode', 'mu', 'nSurfaces'],
    properties: {
      mode: { type: 'string', enum: ['hinge', 'clamp'], description: '검토 대상: hinge=회전 유지 토크 · clamp=축직각 미끄럼 저항' },
      mu: { type: 'number', exclusiveMinimum: 0, maximum: 1.2, description: '마찰계수 (시험값 — 기본값 없음)' },
      nSurfaces: { type: 'integer', minimum: 1, maximum: 12, description: '마찰면 수 (와셔 양면이면 2)' },
      // 축력 — 직접 주거나 조임토크에서 환산
      axialForceN: { type: 'number', exclusiveMinimum: 0, description: '체결 축력 N (직접 입력)' },
      tightenTorqueNm: { type: 'number', exclusiveMinimum: 0, description: '조임 토크 N·m (K·boltDia 와 함께 주면 축력 환산)' },
      torqueCoefK: { type: 'number', exclusiveMinimum: 0, maximum: 0.6, description: '토크계수 K (시험값 — 기본값 없음)' },
      boltDia: { type: 'number', exclusiveMinimum: 0, description: '볼트 공칭지름 mm' },
      // 마찰면 기하
      outerDia: { type: 'number', exclusiveMinimum: 0, description: '마찰면 외경 mm (와셔 외경)' },
      innerDia: { type: 'number', minimum: 0, description: '마찰면 내경 mm (보어)' },
      // 소요
      demandTorqueNm: { type: 'number', minimum: 0, description: '소요 유지 토크 N·m (hinge)' },
      demandForceN: { type: 'number', minimum: 0, description: '소요 미끄럼 저항 N (clamp)' },
    },
  },
  run(input) {
    const { mode, mu, nSurfaces, outerDia, innerDia = 0 } = input;

    /**
     * ⚠ **축력을 지어내지 않는다.** 직접 주거나, 조임토크+K+지름 셋이 다 있어야 환산한다.
     *   셋 중 하나라도 없으면 판정하지 않고 `needInputs` 로 무엇이 없는지 말한다 —
     *   기본 K 를 끼워 넣으면 그 순간 결과가 「시험값 기반」이 아니게 된다.
     */
    let axialN = input.axialForceN;
    let axialBasis = '직접 입력';
    const needInputs = [];
    if (!(axialN > 0)) {
      const { tightenTorqueNm, torqueCoefK, boltDia } = input;
      if (tightenTorqueNm > 0 && torqueCoefK > 0 && boltDia > 0) {
        axialN = (tightenTorqueNm * 1000) / (torqueCoefK * boltDia); // N·m→N·mm
        axialBasis = `조임토크 환산 F=T/(K·d) — K=${torqueCoefK}(시험값)`;
      } else {
        for (const [f, ko] of [['axialForceN', '체결 축력'], ['tightenTorqueNm', '조임 토크'], ['torqueCoefK', '토크계수 K'], ['boltDia', '볼트 지름']]) {
          if (!(input[f] > 0)) needInputs.push({ field: f, labelKo: ko });
        }
        return {
          inputsEcho: { ...input },
          verdict: null,
          needInputs,
          notes: ['축력을 정하지 못했다 — 축력을 직접 주거나 (조임토크 · 토크계수 K · 볼트지름)을 모두 주어라.',
            '⚠ 토크계수 K 는 시험값이라 기본값을 쓰지 않는다. 추정하면 결과가 시험 근거를 잃는다.'],
        };
      }
    }

    const slipN = nSurfaces * mu * axialN;   // 미끄럼 저항 N

    if (mode === 'clamp') {
      const demand = input.demandForceN ?? 0;
      const ratio = demand > 0 ? demand / slipN : 0;
      return {
        inputsEcho: { ...input },
        intermediate: { 축력_N: axialN, 축력근거: axialBasis, 마찰면수: nSurfaces },
        checks: {
          미끄럼저항: {
            labelKo: '클램프 미끄럼 저항 (V = n·μ·F)',
            저항_N: slipN, 소요_N: demand, 비율: ratio,
            pass: demand > 0 ? demand <= slipN : null,
          },
        },
        verdict: demand > 0 ? (demand <= slipN ? 'PASS' : 'FAIL') : null,
        ...(demand > 0 ? {} : { needInputs: [{ field: 'demandForceN', labelKo: '소요 미끄럼 저항' }] }),
        notes: ['⚠ 정적 마찰만 — 크리프·풀림·반복 조작 마모 미반영(실제 흘러내림의 주원인).',
          '⚠ μ 는 시험값이다. 표면 상태가 바뀌면 결과가 바뀐다.'],
      };
    }

    // hinge — 환형 마찰면 유효반경(균일 면압 가정)
    const Ro = outerDia / 2, Ri = innerDia / 2;
    if (!(Ro > Ri)) throw new Error(`geometry gate: 마찰면 외경(${outerDia})이 내경(${innerDia})보다 커야 한다`);
    const rEff = Ri > 0
      ? (2 / 3) * ((Ro ** 3 - Ri ** 3) / (Ro ** 2 - Ri ** 2))
      : (2 / 3) * Ro;                                   // 내경 0 = 원판
    const torqueNm = (nSurfaces * mu * axialN * rEff) / 1000; // N·mm → N·m
    const demand = input.demandTorqueNm ?? 0;
    const ratio = demand > 0 ? demand / torqueNm : 0;

    return {
      inputsEcho: { ...input },
      intermediate: {
        축력_N: axialN, 축력근거: axialBasis, 마찰면수: nSurfaces,
        유효반경_mm: rEff, 유효반경근거: '환형 균일 면압 (2/3)(Ro³−Ri³)/(Ro²−Ri²)',
      },
      checks: {
        유지토크: {
          labelKo: '힌지 마찰 유지 토크 (T = n·μ·F·r_eff)',
          유지_Nm: torqueNm, 소요_Nm: demand, 비율: ratio,
          pass: demand > 0 ? demand <= torqueNm : null,
        },
      },
      verdict: demand > 0 ? (demand <= torqueNm ? 'PASS' : 'FAIL') : null,
      ...(demand > 0 ? {} : { needInputs: [{ field: 'demandTorqueNm', labelKo: '소요 유지 토크' }] }),
      notes: ['⚠ 균일 면압 가정 — 편심 하중·와셔 변형 미반영.',
        '⚠ 크리프·풀림·마모 미반영. 반복 조작 후 유지력 저하는 이 식으로 못 잡는다.',
        '⚠ μ 는 시험값이다 — 기본값을 쓰지 않았다.'],
    };
  },
};
