/**
 * P18 토목 — 가설흙막이 (KDS 21 30 00 원문 판독).
 * ①경험토압(그림 1.3-1 Peck 수정 — 원문 전사): 모래 0.65γHKa 균등(Ka=tan²(45−φ/2)) ·
 *   연약~중간 점성토 γHKa 사다리꼴(0.25H 램프+0.75H, Ka=1−4su/γH) ·
 *   단단한 점성토 0.2~0.4γH(0.25/0.5/0.25H — 계수 입력, 기본 0.3 중앙 명시)
 * ②버팀대 반력: 지지점 반분담(단순보 분담 관례 — 명시) × 띠장 간격 → 버팀보 축력
 *   (steel_column 연계 안내) · 띠장 휨 M=R·s²/8 관례 → steel_beam 연계
 * ③근입깊이: Rankine 주동/수동 모멘트 평형(최하단 지지점 기준) FS≥1.2(§3.2.1(4) 원문)
 * ④보일링(사질): Terzaghi 간편식 FS=2γ'D/(γw·hw) (고전 공표 — 원문은 '간편식' 지정) ·
 *   히빙(점토): Terzaghi 지지력식 FS=5.7su/(γH+q−su·H/(0.7B)) (고전 공표)
 * 안전율 표 3.2-1(지지력2.0·활동1.5·전도2.0·사면1.1·근입1.2 — 원문). 히빙·보일링
 * 요구 안전율=발주 기준 입력(기본 1.5 관례 명시 — 원문 §3.2.1(6) 발주처 우선).
 */
export default {
  id: 'earth_retention',
  domain: 'civil/excavation',
  title: '가설흙막이 (경험토압·버팀대·근입·히빙/보일링)',
  description: 'Peck 토압→버팀 반력→근입 FS 1.2→굴착저면 안정 — KDS 21 30 00 원문.',
  refs: ['KDS 21 30 00:2025 그림 1.3-1(Peck 수정토압)·§3.2.1(4) 근입 FS 1.2·표 3.2-1 안전율·§1.7.2(5) Rankine — 원문 판독', '보일링 Terzaghi 간편식·히빙 지지력식 = 고전 공표(원문 지정 방법)'],
  status: 'verified — 원문 토압 전사 + 폐형 앵커. 단계별 굴착 해석(탄소성 스프링)·수압 상세·앵커 지지는 후속',
  inputSchema: {
    type: 'object',
    required: ['H_m', 'soil', 'gamma'],
    properties: {
      H_m: { type: 'number', exclusiveMinimum: 0, maximum: 30, description: '굴착깊이' },
      soil: { enum: ['sand', 'softClay', 'stiffClay'], description: '지반 (Peck 3분류 — 경험토압은 H≥6m 좁은 굴착 버팀 지지 전제 원문 명시)' },
      gamma: { type: 'number', minimum: 14, maximum: 22, description: '단위중량 kN/m³' },
      phi: { type: 'number', minimum: 20, maximum: 45, description: '내부마찰각 (sand 필수)' },
      su_kPa: { type: 'number', exclusiveMinimum: 0, description: '비배수전단강도 (clay 필수)' },
      mCoef: { type: 'number', minimum: 0.2, maximum: 0.4, description: 'stiffClay 계수 (0.2~0.4γH — 기본 0.3 중앙 명시)' },
      struts: { description: '버팀 단수 배열 [z_m(지표부터 깊이)] — 1~8단' },
      spacing_m: { type: 'number', exclusiveMinimum: 0, maximum: 10, description: '띠장(수평) 방향 버팀보 간격 (기본 2.5 관례)' },
      D_m: { type: 'number', exclusiveMinimum: 0, description: '근입깊이 (근입 FS 검토 시)' },
      hw_m: { type: 'number', minimum: 0, description: '내외 수위차 (보일링 검토 — 사질)' },
      gammaSub: { type: 'number', minimum: 7, maximum: 13, description: '수중단위중량 γ′ (보일링 — 기본 γ−9.81)' },
      B_m: { type: 'number', exclusiveMinimum: 0, description: '굴착폭 (히빙 검토 — 점토)' },
      surcharge_kPa: { type: 'number', minimum: 0, description: '상재하중' },
      fsBoilHeave: { type: 'number', minimum: 1.2, maximum: 3.0, description: '히빙/보일링 요구 안전율 (기본 1.5 관례 — 발주 기준 우선 §3.2.1(6))' },
    },
  },
  run(input) {
    const { H_m: H, gamma: g } = input;
    const q = Number(input.surcharge_kPa) || 0;
    // ── ① 경험토압 (그림 1.3-1 원문 전사) ─────────────────────────────────────
    let pMax, profile, KaNote;
    if (input.soil === 'sand') {
      if (!(Number(input.phi) > 0)) throw new Error('input gate: sand는 phi 필수');
      const Ka = Math.pow(Math.tan(Math.PI / 4 - (input.phi * Math.PI) / 360), 2);
      pMax = 0.65 * g * H * Ka + q * Ka;
      profile = 'uniform';
      KaNote = `0.65γHKa 균등 (Ka=${Ka.toFixed(3)}) + 상재 qKa`;
    } else if (input.soil === 'softClay') {
      if (!(Number(input.su_kPa) > 0)) throw new Error('input gate: clay는 su_kPa 필수');
      const Ka = Math.max(0.2, 1 - (4 * input.su_kPa) / (g * H)); // 음수 방지 하한 관례(명시)
      pMax = g * H * Ka + q;
      profile = 'trapezoid_0.25ramp';
      KaNote = `γHKa 사다리꼴(0.25H 램프) — Ka=1−4su/γH=${Ka.toFixed(3)}${Ka === 0.2 ? '(하한 0.2 관례 적용 명시)' : ''}`;
    } else {
      const m = Number(input.mCoef) > 0 ? input.mCoef : 0.3;
      pMax = m * g * H + q;
      profile = 'trapezoid_0.25_0.5_0.25';
      KaNote = `${m}γH 사다리꼴(0.25/0.5/0.25H — 0.2~0.4 범위, ${input.mCoef ? '입력값' : '기본 0.3 중앙 명시'})`;
    }
    // ── ② 버팀 반력 (지지점 반분담 — 단순보 분담 관례 명시) ────────────────────
    let strutRes = null;
    const st = input.struts;
    if (Array.isArray(st) && st.length >= 1 && st.length <= 8) {
      const zs = st.map(Number).sort((a, b) => a - b);
      if (zs.some((z) => !(z > 0) || z >= H)) throw new Error('input gate: struts z는 0<z<H');
      const s = Number(input.spacing_m) > 0 ? input.spacing_m : 2.5;
      // 분담 경계: 인접 지지점 중간 + 최상단은 지표까지 + 최하단은 굴착저면까지(관례 명시)
      const bounds = [0, ...zs.slice(0, -1).map((z, i) => (z + zs[i + 1]) / 2), H];
      const pressAt = (z) => {
        if (profile === 'uniform') return pMax;
        if (profile === 'trapezoid_0.25ramp') return z < 0.25 * H ? (pMax * z) / (0.25 * H) : pMax;
        return z < 0.25 * H ? (pMax * z) / (0.25 * H) : z > 0.75 * H ? (pMax * (H - z)) / (0.25 * H) : pMax;
      };
      const rows = zs.map((z, i) => {
        // 구간 적분(사다리꼴 근사 20분할 — 프로파일 폐형이라 정확)
        let R = 0;
        const a = bounds[i], b = bounds[i + 1], nDiv = 20;
        for (let k2 = 0; k2 < nDiv; k2++) {
          const z1 = a + ((b - a) * k2) / nDiv, z2 = a + ((b - a) * (k2 + 1)) / nDiv;
          R += ((pressAt(z1) + pressAt(z2)) / 2) * (z2 - z1);
        }
        const N = R * s; // 버팀보 축력 kN
        const M = (R * s * s) / 8; // 띠장 휨 관례 (연속보 ws²/8~/10 — 보수 /8 명시)
        return { level: i + 1, z_m: z, R_kNm: +R.toFixed(1), strutN_kN: +N.toFixed(1), walerM_kNm: +M.toFixed(1) };
      });
      strutRes = { spacing_m: s, levels: rows, note: '반력=지지점 반분담(단순 분담 관례 — 연속성 해석은 탄소성 후속). 버팀보 축력→steel_column·띠장 휨(ws²/8 보수)→steel_beam으로 부재 검토 연계.' };
    }
    // ── ③ 근입깊이 FS (Rankine 모멘트 평형 — 최하단 지지점 기준, §3.2.1(4) FS≥1.2) ──
    let embed = null;
    if (Number(input.D_m) > 0) {
      if (!(Number(input.phi) > 0)) throw new Error('input gate: 근입 검토는 phi 필요(Rankine — §1.7.2(5) 원문)');
      const Ka = Math.pow(Math.tan(Math.PI / 4 - (input.phi * Math.PI) / 360), 2);
      const Kp = 1 / Ka;
      const D = input.D_m;
      const zPivot = Array.isArray(st) && st.length ? Math.max(...st.map(Number)) : 0; // 최하단 지지점
      // 주동(배면): 지표~H+D 삼각 — 지지점 기준 모멘트
      const Pa = 0.5 * Ka * g * (H + D) ** 2 + q * Ka * (H + D);
      const aArm = (2 / 3) * (H + D) - zPivot; // 합력 팔길이 근사(삼각 도심 — 상재는 보수 동일팔 명시)
      const Pp = 0.5 * Kp * g * D * D;
      const pArm = H + (2 / 3) * D - zPivot;
      const FS = (Pp * pArm) / (Pa * aArm);
      embed = { D_m: D, FS: +FS.toFixed(2), required: 1.2, pass: FS >= 1.2, note: 'Rankine 주동/수동 모멘트 평형(최하단 지지점 기준·상재 팔길이 보수 근사 명시) — FS≥1.2 §3.2.1(4) 원문. 수압 별도(§1.7.2(4)).' };
    }
    // ── ④ 굴착저면 안정 ────────────────────────────────────────────────────────
    const fsReq = input.fsBoilHeave ?? 1.5;
    let boiling = null, heaving = null;
    if (input.soil === 'sand' && Number(input.hw_m) > 0 && Number(input.D_m) > 0) {
      const gSub = Number(input.gammaSub) > 0 ? input.gammaSub : g - 9.81;
      const FS = (2 * gSub * input.D_m) / (9.81 * input.hw_m);
      boiling = { FS: +FS.toFixed(2), required: fsReq, pass: FS >= fsReq, note: 'Terzaghi 간편식 2γ′D/(γw·hw) — 원문 §3.2.1(3)③ 지정 방법(수위차 3m 미만 병행 검토 조건 명시). 깊은 굴착은 침투해석 필요(§(3)④).' };
    }
    if (input.soil !== 'sand' && Number(input.su_kPa) > 0 && Number(input.B_m) > 0) {
      const denom = g * H + q - (input.su_kPa * H) / (0.7 * input.B_m);
      const FS = denom > 0 ? (5.7 * input.su_kPa) / denom : 99;
      heaving = { FS: +Math.min(FS, 99).toFixed(2), required: fsReq, pass: FS >= fsReq, note: 'Terzaghi 지지력식 5.7su/(γH+q−suH/0.7B) — 고전 공표. 모멘트 평형법 병행 후 작은 값 채택(§3.2.1(3)② 원문) — 병행법은 후속.' };
    }
    const passList = [embed?.pass, boiling?.pass, heaving?.pass].filter((v) => v !== undefined);
    return {
      verdict: passList.length ? (passList.every(Boolean) ? 'PASS' : 'FAIL') : 'INFO',
      checks: {
        pressure: { pMax_kPa: +pMax.toFixed(1), profile, note: KaNote },
        ...(strutRes ? { struts: strutRes } : {}),
        ...(embed ? { embedment: embed } : {}),
        ...(boiling ? { boiling } : {}),
        ...(heaving ? { heaving } : {}),
      },
      notes: [
        `경험토압(그림 1.3-1 원문): ${KaNote} — H≥6m 좁은 굴착·버팀 지지 전제(원문 §1.7.2(3)②). 수압 별도 가산 필요(차수벽 — §(3)②).`,
        '안전율: 근입 1.2(원문)·히빙/보일링 요구치=' + fsReq + '(발주 기준 우선 §3.2.1(6) — 기본 1.5 관례 명시). 표 3.2-1: 지지력2.0·활동1.5·전도2.0·사면1.1.',
        '단계별 굴착(삼각 토압)·탄소성 지반스프링 해석·어스앵커·계측 연동은 후속 명시.',
      ],
    };
  },
};
