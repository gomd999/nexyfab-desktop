/**
 * P1/P3 공용 — 지압형 볼트접합 검토 (전단 + 지압), AISC 360 §J3 / KDS 14 31 25 동형식.
 * Rn(전단)=Fnv·Ab·평면수, Rn(지압)=2.4·d·t·Fu (변형 고려), φ=0.75.
 * 근거 코퍼스(수집완료): FHWA SBDH Vol.14 (볼트 이음 설계).
 */
export default {
  id: 'bolt_connection',
  domain: 'steel/building',
  title: '볼트접합 검토 (지압형: 전단·지압)',
  description: '지압형(bearing-type) 볼트군의 설계강도. 마찰형(slip-critical)·인장·블록전단은 미포함(게이트 명시).',
  refs: [
    'AISC 360-16 §J3.6/J3.10, Table J3.2 (Fnv 파라미터: standards/*.json)',
    'KDS 14 31 25 (원문 확보 대기)',
    'FHWA SBDH Vol.14 (RAG 코퍼스 수록: fhwa-sbdh-vol14-splice-design)',
  ],
  status: 'draft — 골든벤치 1케이스, 공개 게이트 미충족',
  inputSchema: {
    type: 'object',
    required: ['boltGrade', 'd', 'nBolts', 'tPlate', 'Fu', 'Vu'],
    properties: {
      boltGrade: { type: 'string', enum: ['A325-N', 'A325-X', 'A490-N', 'F10T-N', 'F8T-N'], description: '볼트 등급-나사부 조건' },
      d: { type: 'number', minimum: 12, maximum: 36, description: '볼트 공칭지름 mm' },
      nBolts: { type: 'integer', minimum: 1, maximum: 100, description: '볼트 개수' },
      shearPlanes: { type: 'integer', minimum: 1, maximum: 2, description: '전단면 수 (기본 1)' },
      tPlate: { type: 'number', exclusiveMinimum: 0, description: '지압 지배 판두께 mm (얇은 쪽)' },
      Fu: { type: 'number', minimum: 300, maximum: 700, description: '판재 인장강도 MPa' },
      Vu: { type: 'number', minimum: 0, description: '소요전단력 kN (LRFD 계수하중, 볼트군 전체)' },
    },
  },
  run(input, std) {
    const s = std.steel;
    const planes = input.shearPlanes ?? 1;
    const { boltGrade, d, nBolts, tPlate, Fu, Vu } = input;
    const Fnv = s.bolt_Fnv_MPa[boltGrade];
    if (Fnv === undefined) throw new Error(`standard gate: ${std.id}에 ${boltGrade}의 Fnv 미정의 (standards/${std.id.toLowerCase()}.json 튜닝 필요)`);

    const Ab = (Math.PI / 4) * d * d; // mm²
    const rnShear = (Fnv * Ab * planes) / 1000; // kN/bolt
    const rnBearing = (s.bolt_bearing_coef * d * tPlate * Fu) / 1000; // kN/bolt
    const rnGov = Math.min(rnShear, rnBearing);
    const governing = rnShear <= rnBearing ? 'shear' : 'bearing';
    const phiRn = s.phi_bolt * rnGov * nBolts;
    const ratio = Vu > 0 ? Vu / phiRn : 0;

    return {
      inputsEcho: { ...input, shearPlanes: planes },
      intermediate: { Ab_mm2: Ab, rnShear_kN_perBolt: rnShear, rnBearing_kN_perBolt: rnBearing, governing },
      checks: { capacity_LRFD: { phiRn_kN: phiRn, Vu_kN: Vu, ratio, pass: Vu <= phiRn } },
      verdict: Vu <= phiRn ? 'PASS' : 'FAIL',
      notes: [
        '지압강도는 연단거리·피치 충분(변형 고려식 2.4dtFu) 가정 — 연단 부족 시 별도 확인',
        '마찰형(slip-critical)·볼트 인장·블록전단·판재 순단면 파단 미포함',
      ],
    };
  },
};
