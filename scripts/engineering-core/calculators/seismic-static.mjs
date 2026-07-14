/**
 * P3 건축 — 등가정적 지진하중 (밑면전단·층별 분포) — KDS 41 17 00 §7.2.
 *
 * V = Cs·W (식 7.2-1) · Cs = SDS/(R/IE) (7.2-2), 상한 SD1/((R/IE)·T) (7.2-3),
 * 하한 0.044·SDS·IE ≥ 0.01 (7.2-5) · SDS=S·2.5·Fa·⅔ (4.2-4) · SD1=S·Fv·⅔ (4.2-5)
 * · Fx = Cvx·V, Cvx = wx·hx^k/Σwi·hi^k (7.2-8/9, k: T≤0.5→1·≥2.5→2·보간)
 * · Ta = Ct·hn^x (7.2-6) · S = Z×위험도계수(기본 2400년 2.0 — §3.2).
 *
 * 정직 원칙: R(반응수정계수)은 표 6.2-1 시스템 결정 사항 — 반드시 입력(기본값 없음).
 * 적용성(높이·비정형) 검토는 별도 — 등가정적 허용 조건(§7.1)은 사용자 확인 명시.
 */
export default {
  id: 'seismic_static',
  domain: 'building/seismic',
  title: '등가정적 지진하중 (밑면전단·층별 분포)',
  description: 'KDS 41 17 00 등가정적해석법 — 유효지반가속도→설계스펙트럼→Cs→V→층별 Fx.',
  refs: [
    'KDS 41 17 00:2022 §7.2 (식 7.2-1~9)·§4.2 (식 4.2-4/5, 표 4.2-1/2)·표 2.2-1(IE)·표 7.2-1(Cu)',
    'KDS 17 10 00:2024 표 4.2-2(지진구역계수)·표 4.2-3(위험도계수)',
  ],
  status: 'draft — 원문 수식·표 전체 대조(GIF 판독). 등가정적 적용조건(§7.1)·우발편심·비틀림 미포함(명시). 공표예제 재현 대기',
  inputSchema: {
    type: 'object',
    required: ['R', 'weightsKN', 'heightsM'],
    properties: {
      zone: { type: 'string', enum: ['I', 'II'], description: '지진구역 (I=0.11·II=0.07, KDS 17 10 00 표 4.2-2). S 직접 입력 시 생략 가능' },
      S: { type: 'number', minimum: 0.05, maximum: 0.5, description: '유효지반가속도 직접 입력 (기본: Z×2.0(2400년))' },
      siteClass: { type: 'string', enum: ['S1', 'S2', 'S3', 'S4', 'S5'], description: '지반종류 (기본 S4)' },
      importance: { type: 'string', enum: ['special', 'grade1', 'grade2'], description: '내진등급 (특 1.5·I 1.2·II 1.0, 기본 grade2)' },
      R: { type: 'number', minimum: 1, maximum: 8, description: '반응수정계수 (표 6.2-1 — 시스템 결정, 필수 입력)' },
      structType: { type: 'string', enum: ['rc_moment', 'steel_moment', 'steel_ebf_brb'], description: '약산주기 계수용 구조형식 (기본 rc_moment)' },
      T: { type: 'number', exclusiveMinimum: 0, maximum: 10, description: '고유주기 직접 입력 s (생략 시 Ta=Ct·hn^x)' },
      heightsM: { type: 'array', items: { type: 'number' }, description: '층별 바닥 높이 hx (m, 밑면 기준, 하층→상층)' },
      weightsKN: { type: 'array', items: { type: 'number' }, description: '층별 유효중량 wx (kN, 고정하중 기준)' },
    },
  },
  run(input, std) {
    const sb = std.seismicBuilding;
    if (!sb) throw new Error(`standard gate: '${std.id}'에 seismicBuilding 미탑재 — KDS만 지원`);
    const { R } = input;
    const hs = input.heightsM, ws = input.weightsKN;
    if (!Array.isArray(hs) || !Array.isArray(ws) || hs.length !== ws.length || !hs.length) {
      const e = new Error('heightsM·weightsKN 길이 일치 필요'); e.code = 'INPUT_GATE'; throw e;
    }
    const S = input.S ?? (sb.zoneZ[input.zone ?? 'I'] * sb.riskFactor.y2400);
    const site = input.siteClass ?? 'S4';
    const IE = sb.importanceIE[input.importance ?? 'grade2'];
    // Fa/Fv 직선보간 (절점 S=0.1/0.2/0.3 — 원문 주석)
    const interp = (arr) => {
      const xs = [0.1, 0.2, 0.3];
      if (S <= 0.1) return arr[0];
      if (S >= 0.3) return arr[2];
      const i = S <= 0.2 ? 0 : 1;
      return arr[i] + ((S - xs[i]) / 0.1) * (arr[i + 1] - arr[i]);
    };
    const Fa = interp(sb.Fa[site]);
    const Fv = interp(sb.Fv[site]);
    const SDS = S * 2.5 * Fa * (2 / 3);
    const SD1 = S * Fv * (2 / 3);
    const hn = Math.max(...hs);
    const ap = sb.approxPeriod[input.structType ?? 'rc_moment'];
    const Ta = input.T ?? ap.Ct * Math.pow(hn, ap.x);
    // Cs (식 7.2-2 ~ 7.2-5)
    const base = SDS / (R / IE);
    const cap = Ta <= sb.TL_sec ? SD1 / ((R / IE) * Ta) : (SD1 * sb.TL_sec) / ((R / IE) * Ta * Ta);
    const floor_ = Math.max(sb.csFloorCoef * SDS * IE, sb.csFloorMin);
    const Cs = Math.max(Math.min(base, cap), floor_);
    const governing = Cs === floor_ ? '하한 0.044·SDS·IE (7.2-5)' : Cs === base ? 'SDS/(R/IE) (7.2-2)' : 'SD1/((R/IE)T) (7.2-3)';
    const W = ws.reduce((s, w) => s + w, 0);
    const V = Cs * W;
    // 연직분포 (7.2-8/9)
    const k = Ta <= 0.5 ? 1 : Ta >= 2.5 ? 2 : 1 + (Ta - 0.5) / 2;
    const denom = ws.reduce((s, w, i) => s + w * Math.pow(hs[i], k), 0);
    const Fx = ws.map((w, i) => +(V * (w * Math.pow(hs[i], k)) / denom).toFixed(2));
    // 층전단 (상층부터 누적)
    const storyShear = Fx.map((_, i) => +Fx.slice(i).reduce((s, f) => s + f, 0).toFixed(2));
    const r3 = (v) => +v.toFixed(4);
    return {
      verdict: 'INFO', // 하중 산출 — 부재 판정은 후속 체인(기둥 P-M 등)
      intermediate: { S: r3(S), Fa: r3(Fa), Fv: r3(Fv), SDS: r3(SDS), SD1: r3(SD1), Ta_s: r3(Ta), IE, R, k: r3(k), Cs: r3(Cs), governing, W_kN: +W.toFixed(1) },
      V_kN: +V.toFixed(2),
      Fx_kN: Fx,
      storyShear_kN: storyShear,
      notes: [
        `S=${r3(S)} (${input.S ? '직접 입력' : `구역 ${input.zone ?? 'I'}: Z=${sb.zoneZ[input.zone ?? 'I']}×2.0(2400년)`}) · 지반 ${site} · IE ${IE} · R ${R}(표 6.2-1, 입력)`,
        '등가정적 적용조건(§7.1: 높이·정형성)·우발편심·비틀림증폭 미포함 — 해당 시 동적해석 필요(명시).',
        'W=입력 층중량 합(고정하중 기준 — 창고 등 활하중 포함 조건은 §7.2.1 확인).',
      ],
    };
  },
};
