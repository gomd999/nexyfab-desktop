/**
 * P12 건축 — 전단벽 횡강성·분담 + 개략 검토 (폐형).
 * 캔틸레버 벽 강성 k = 1/(h³/(3EcI) + 1.2h/(Gc·A)) — 휨+전단변형(교과서 폐형).
 * 여러 요소(벽·골조) 병렬 강성 분담: Vi = V·ki/Σk (강막 가정 명시).
 * 벽체 검토(개략): 휨 = 수직 캔틸레버 보(rc_beam 연계 안내) · 전단 개략
 * φVc=0.75·(1/6)√fck·(0.8lw)·t (KDS 전단 기본식 계열 — 벽 상세식은 후속 명시).
 * 앵커: 전단변형 무시 시 k→3EI/h³ 폐형 · 분담률 합=1.
 */
export default {
  id: 'shear_wall',
  domain: 'architecture/lateral',
  title: '전단벽 횡강성·분담 (개략)',
  description: '벽 요소 강성(휨+전단변형)·병렬 분담률·벽체 개략 전단 검토.',
  refs: ['캔틸레버 벽 강성 폐형(휨+전단변형 — 구조역학 표준)', 'KDS 14 20 22 계열 Vc=√fck/6 기본식(벽 전용 상세식은 후속 명시)'],
  status: 'verified — 폐형 앵커 + §4.9.2 상세식 + §4.9.3 최소철근 + §4.7.6 특수경계요소(KDS 14 20 80 — 변위법·응력법·범위·(5) 검토, 원문 판독). 연결보는 후속',
  inputSchema: {
    type: 'object',
    required: ['walls', 'storyShear_kN'],
    properties: {
      walls: { description: '벽 목록 [{lw_mm(벽 길이), t_mm(두께), h_mm(높이), fck?}] — 최대 20' },
      frameStiffness_kNmm: { type: 'number', minimum: 0, description: '병렬 골조 강성 kN/mm (frame2d 산정값 입력 — 선택, 벽·골조 분담)' },
      storyShear_kN: { type: 'number', exclusiveMinimum: 0, description: '층전단력 V (지진·풍 산정값)' },
      fck: { type: 'number', minimum: 18, maximum: 60, description: '콘크리트 강도 (기본 24)' },
      detail: { description: '벽 상세 전단검토(§4.9 원문식 — 선택): { wallIndex(1~), Nu_kN(압축+), Mu_kNm, Vu_kN, Avh_mm2?, sh_mm?, fy?, Avv_mm2?, sv_mm? } — Avv/sv 입력 시 §4.9.3 최소철근·간격 검토 포함' },
      boundary: { description: '특수경계요소 검토(선택 — KDS 14 20 80 §4.7.6 원문): { wallIndex(1~), c_mm(압축연단 중립축 — P-M 해석 산정 입력), deltaU_mm(설계변위), hw_mm(벽 전체높이 — 기본 벽 h), Mu_kNm?, Vu_kN?(연장범위 Mu/4Vu용), sigmaMax_MPa?(응력법 (3) — 비균열 선형탄성 산정 입력), rhoBoundary?(경계부 종방향 철근비 — (5)① 2.8/fy 검토) } — 변위법 (2)①: c≥lw/(600(δu/hw)), δu/hw≥0.007' },
    },
  },
  run(input) {
    const walls = input.walls;
    if (!Array.isArray(walls) || !walls.length || walls.length > 20) throw new Error('input gate: walls 1~20개');
    const fck = input.fck ?? 24;
    const Ec = 8500 * Math.cbrt(fck + 4); // MPa
    const Gc = Ec / (2 * (1 + 0.17)); // ν=0.17 관례(명시)
    const items = walls.map((w, i) => {
      for (const k of ['lw_mm', 't_mm', 'h_mm']) if (!(Number(w[k]) > 0)) throw new Error(`input gate: 벽 ${i + 1} ${k}`);
      const I = (w.t_mm * Math.pow(w.lw_mm, 3)) / 12; // mm⁴
      const A = w.t_mm * w.lw_mm;
      const kFlex = Math.pow(w.h_mm, 3) / (3 * Ec * I);
      const kShear = (1.2 * w.h_mm) / (Gc * A);
      const k = 1 / (kFlex + kShear); // N/mm
      return { i: i + 1, lw: w.lw_mm, t: w.t_mm, h: w.h_mm, k_kNmm: k / 1000, I, A };
    });
    const kFrame = (input.frameStiffness_kNmm ?? 0);
    const sumK = items.reduce((s, x) => s + x.k_kNmm, 0) + kFrame;
    const V = input.storyShear_kN;
    const rows = items.map((x) => {
      const share = x.k_kNmm / sumK;
      const Vi = V * share;
      // 개략 전단강도: φVc = 0.75·(√fck/6)·0.8lw·t (기본식 — 벽 상세식·수평철근 기여 후속)
      const phiVc = (0.75 * (Math.sqrt(fck) / 6) * 0.8 * x.lw * x.t) / 1000; // kN
      return {
        wall: x.i, k_kNmm: +x.k_kNmm.toFixed(2), share: +share.toFixed(3), Vi_kN: +Vi.toFixed(1),
        phiVc_kN: +phiVc.toFixed(1), ratio: +(Vi / phiVc).toFixed(3), pass: Vi <= phiVc,
        flexNote: `휨: 수직 캔틸레버 M=${(Vi * x.h / 1000).toFixed(0)}kN·m — rc_beam(b=${x.t}, d≈0.8lw)로 수직철근 검토`,
      };
    });
    // 상세 전단검토 (KDS 14 20 22 §4.9.2 원문 판독: 식 4.9-1·4.9-2 중 작은 값 + 식 4.9-3)
    let detail = null;
    const dt = input.detail;
    if (dt && Number(dt.wallIndex) >= 1 && items[dt.wallIndex - 1]) {
      const w = items[dt.wallIndex - 1];
      const d = 0.8 * w.lw; // §4.9.1(3): d=0.8lw 허용
      const lam = 1.0, h = w.t;
      const Nu = (Number(dt.Nu_kN) || 0) * 1000, Mu = (Number(dt.Mu_kNm) || 0) * 1e6, Vu = (Number(dt.Vu_kN) || 0) * 1000;
      const vc1 = 0.28 * lam * Math.sqrt(fck) * h * d + (Nu * d) / (4 * w.lw); // 식 4.9-1 (N)
      let vc2 = null;
      if (Vu > 0) {
        const den = Mu / Vu - w.lw / 2;
        if (den > 0) vc2 = (0.05 * lam * Math.sqrt(fck) + (w.lw * (0.10 * lam * Math.sqrt(fck) + (0.2 * Nu) / (w.lw * h))) / den) * h * d; // 식 4.9-2
      }
      const Vc = vc2 !== null ? Math.min(vc1, vc2) : vc1;
      let Vs = 0;
      if (Number(dt.Avh_mm2) > 0 && Number(dt.sh_mm) > 0) Vs = (dt.Avh_mm2 * (dt.fy ?? 400) * d) / dt.sh_mm; // 식 4.9-3
      const VnCap = ((5 * lam * Math.sqrt(fck)) / 6) * h * d; // Vn 상한 (§4.9.2(3) 원문: (5λ√fck/6)hd)
      const Vn = Math.min(Vc + Vs, VnCap);
      const capped = Vc + Vs > VnCap;
      const phiVn = 0.75 * Vn;
      // §4.9.3 최소철근·간격 (원문 GIF 판독 확정): 문턱 φVc/2 · ρh,min=0.0025(fy≤400,
      // 초과 시 0.0025·400/fy, fy≤500 캡) · 식4.9-4 ρl=ρh,min+0.5(2.5−hw/lw)(ρh−ρh,min)≤ρh
      // 간격: 수평 sh≤min(lw/5, 3h, 450) · 수직 sv≤min(lw/3, 3h, 450)
      let minReinf = null;
      if (Number(dt.Avh_mm2) > 0 && Number(dt.sh_mm) > 0) {
        const fy = Math.min(dt.fy ?? 400, 500);
        const rhoMin = fy <= 400 ? 0.0025 : (0.0025 * 400) / fy;
        const rhoH = dt.Avh_mm2 / (dt.sh_mm * h);
        const halfPhiVc = (0.75 * Vc) / 2;
        const hwlw = w.h / w.lw;
        let rhoLreq = rhoMin + 0.5 * (2.5 - hwlw) * (rhoH - rhoMin);
        rhoLreq = Math.max(rhoMin, Math.min(rhoLreq, rhoH)); // §4.9.3(4): ≥ρl,min·≤소요수평비
        const shLim = Math.min(w.lw / 5, 3 * h, 450);
        const shOk = dt.sh_mm <= shLim;
        let vert = null;
        if (Number(dt.Avv_mm2) > 0 && Number(dt.sv_mm) > 0) {
          const rhoV = dt.Avv_mm2 / (dt.sv_mm * h);
          const svLim = Math.min(w.lw / 3, 3 * h, 450);
          vert = { rhoV: +rhoV.toFixed(5), rhoLreq: +rhoLreq.toFixed(5), pass: rhoV >= rhoLreq, sv_mm: dt.sv_mm, svLimit_mm: +svLim.toFixed(0), svOk: dt.sv_mm <= svLim };
        }
        minReinf = {
          threshold: { Vu_kN: Vu / 1000, halfPhiVc_kN: +(halfPhiVc / 1000).toFixed(1), regime: Vu <= halfPhiVc ? 'Vu≤φVc/2 — §4.9.3(2)~(5) 또는 KDS 14 20 72 배치' : 'Vu>φVc/2 — §4.9.3(2)~(5) 필수' },
          horizontal: { rhoH: +rhoH.toFixed(5), rhoMin: +rhoMin.toFixed(5), pass: rhoH >= rhoMin, sh_mm: dt.sh_mm, shLimit_mm: +shLim.toFixed(0), shOk },
          ...(vert ? { vertical: vert } : {}),
          note: '§4.9.3 원문: ρh,min 0.0025(fy≤400)·식4.9-4 ρl=ρh,min+0.5(2.5−hw/lw)(ρh−ρh,min)(≥ρl,min·≤ρh)·간격 수평 min(lw/5,3h,450)·수직 min(lw/3,3h,450). 단부 후크정착 시 완화 별도(§4.9.3(3) 단서).',
        };
      }
      detail = {
        wall: dt.wallIndex, d_mm: d, Vc1_kN: +(vc1 / 1000).toFixed(1), Vc2_kN: vc2 !== null ? +(vc2 / 1000).toFixed(1) : null,
        Vc_kN: +(Vc / 1000).toFixed(1), Vs_kN: +(Vs / 1000).toFixed(1), phiVn_kN: +(phiVn / 1000).toFixed(1),
        Vu_kN: Vu / 1000, ratio: Vu > 0 ? +((Vu) / phiVn).toFixed(3) : null, pass: Vu > 0 ? Vu <= phiVn : null,
        ...(minReinf ? { minReinf } : {}),
        note: '식 4.9-1/2 중 작은 값 + 식 4.9-3 + Vn≤(5λ√fck/6)hd 상한(§4.9.2(3) 원문)' + (capped ? ' — ⚠ 상한 지배(철근 증가 무효, 단면 증대 필요)' : '') + (minReinf ? '' : '. 최소 수평·수직철근(§4.9.3)은 Avh·sh 입력 시 검토.'),
      };
    }
    // ── 특수경계요소 (KDS 14 20 80 §4.7.6 — 원문 GIF 판독 확정) ─────────────
    // (2)① 변위법: c ≥ lw/(600(δu/hw)) → 필요, δu/hw는 0.007 이상 적용
    // (2)② 연장(수직): ≥ max(lw, Mu/4Vu) · (3) 응력법: σ>0.2fck 발생·<0.15fck 종료
    // (4)① 범위(수평): ≥ max(c−0.1lw, c/2) · (5)① ρ>2.8/fy → 횡철근 요건(간격≤200)
    // (5)② 연단 감싸기: Vu < (√fck/12)Acv 미만이면 제외
    let boundary = null;
    const be = input.boundary;
    if (be && Number(be.wallIndex) >= 1 && items[be.wallIndex - 1]) {
      const w = items[be.wallIndex - 1];
      const hw = Number(be.hw_mm) > 0 ? Number(be.hw_mm) : w.h;
      let need = null, method = null, cLimit = null;
      if (Number(be.c_mm) > 0 && Number(be.deltaU_mm) > 0) {
        const drift = Math.max(be.deltaU_mm / hw, 0.007); // §4.7.6(2)① 원문: δu/hw ≥ 0.007
        cLimit = w.lw / (600 * drift);
        need = be.c_mm >= cLimit;
        method = `변위법 식4.7-2: c ${be.c_mm} vs 한계 ${cLimit.toFixed(0)}mm (δu/hw=${drift.toFixed(4)}${be.deltaU_mm / hw < 0.007 ? '←0.007 하한 적용' : ''})`;
      } else if (Number(be.sigmaMax_MPa) > 0) {
        need = be.sigmaMax_MPa > 0.2 * fck;
        method = `응력법 (3): σ ${be.sigmaMax_MPa} vs 0.2fck=${(0.2 * fck).toFixed(1)}MPa (종료점 0.15fck=${(0.15 * fck).toFixed(1)} — 비균열 선형탄성 산정 입력 전제)`;
      } else {
        throw new Error('input gate: boundary는 (c_mm+deltaU_mm) 또는 sigmaMax_MPa 필요');
      }
      let extent = null;
      if (need && Number(be.c_mm) > 0) {
        const horiz = Math.max(be.c_mm - 0.1 * w.lw, be.c_mm / 2);
        const vert = Number(be.Mu_kNm) > 0 && Number(be.Vu_kN) > 0 ? Math.max(w.lw, (be.Mu_kNm * 1e6) / (4 * be.Vu_kN * 1000)) : w.lw;
        extent = { horizontal_mm: +horiz.toFixed(0), vertical_mm: +vert.toFixed(0), note: '수평 max(c−0.1lw, c/2)·수직 max(lw, Mu/4Vu) — §4.7.6(4)①·(2)②. 횡철근 상세는 §4.5.4(1)~(3) 준용(식4.5-3 제외·간격 최소단면 1/3).' };
      }
      let noBE = null;
      if (need === false) {
        const fy = (input.detail?.fy ?? 400);
        const rhoLim = 2.8 / fy;
        const rhoChk = Number(be.rhoBoundary) > 0 ? { rho: be.rhoBoundary, limit: +rhoLim.toFixed(5), hoopRequired: be.rhoBoundary > rhoLim } : null;
        const VuEdge = Number(be.Vu_kN) > 0 ? be.Vu_kN * 1000 : null;
        const Acv = w.lw * w.t;
        const edgeWrap = VuEdge !== null ? VuEdge >= (Math.sqrt(fck) / 12) * Acv : null;
        noBE = { rhoCheck: rhoChk, edgeWrapRequired: edgeWrap, note: '(5)①: ρ>2.8/fy면 경계부 횡철근(§4.5.4(1)③·(3)·간격≤200)·(5)②: Vu≥(√fck/12)Acv면 연단 감싸기(갈고리/U스터럽) 필요.' };
      }
      boundary = {
        wall: be.wallIndex, required: need, method, ...(cLimit !== null ? { cLimit_mm: +cLimit.toFixed(0) } : {}),
        ...(extent ? { extent } : {}), ...(noBE ? { noBoundaryChecks: noBE } : {}),
        note: 'KDS 14 20 80 §4.7.6 원문. 변위법은 연속벽체·단일 위험단면 전제((2) — 아니면 응력법). c·δu·σ는 해석 산정 입력(지어내지 않음).',
      };
    }
    const frameShare = kFrame > 0 ? +(kFrame / sumK).toFixed(3) : 0;
    const allPass = rows.every((r) => r.pass);
    return {
      verdict: allPass ? 'PASS' : 'FAIL',
      walls: rows,
      distribution: { sumK_kNmm: +sumK.toFixed(2), frameShare, wallShare: +(1 - frameShare).toFixed(3) },
      ...(detail ? { detail } : {}),
      ...(boundary ? { boundaryElement: boundary } : {}),
      notes: [
        `강성 분담(강막 가정 명시): 벽 ${rows.length}장${kFrame > 0 ? `+골조(${(frameShare * 100).toFixed(0)}%)` : ''} — 분담 합 1.0.`,
        '벽 강성=휨+전단변형 폐형(ν=0.17 관례). 비틀림(강성중심 편심)·연결보·개구부는 후속 명시.',
        'φVc는 기본식 개략 — 벽 전용 상세식(수평철근 기여)·경계요소는 KDS 14 20 22 원문 판독 후 승격.',
      ],
    };
  },
};
