/**
 * 구조/응력 자동 검증 — nexyfab drawing-to-3d 설계 파이프라인 내장 역량.
 *
 * 어셈블리(부품 type·params·at)에서 **형상으로부터 질량·무게중심을 자동 산출**하고,
 * 지지점(캐스터/다리) 반력·프레임 부재 응력/처짐·전도(tip-over)·지진 전도 FS 를
 * 결정론적으로 검토한다. AI 없이 순수 계산 — "설계하면 구조가 자동 고려된다".
 *
 * 원칙: 근사(단순보·강체전도·AABB 체적)임을 명시. 상세 FEA·좌굴·용접피로는 후속.
 *
 * usage: structuralCheck(assembly, { material, fluidParts, supports, member, seismicG })
 */
import { partAabb, gearPoly, sheetPoly, polyArea, boltDims, holeFeature, extrudePoly, expandHoles, holeVolume, compositeSubs, subAabb } from './reconstruct.mjs';
import { snapSquareTube } from './std-snap.mjs';

const g = 9.81;

// 재료 밀도 kg/m³ (timber=침엽수 구조재 대표값 · interior=가구 혼합 개산)
export const DENSITY = {
  STS316: 7980, STS304: 7930, steel: 7850, aluminum: 2700, FRP: 1800, water: 1000, concrete: 2400, PVC: 1400, castiron: 7200,
  timber: 500, glass: 2500,
};
// 각관/형강 단면성능 (mm) — I, Z, A
export const SECTIONS = {
  'SHS50x50x3': sqTube(50, 3), 'SHS40x40x3': sqTube(40, 3), 'SHS60x60x3.2': sqTube(60, 3.2), 'SHS75x75x4': sqTube(75, 4),
};
function sqTube(b, t) {
  const bi = b - 2 * t;
  const I = (Math.pow(b, 4) - Math.pow(bi, 4)) / 12;
  return { I, Z: I / (b / 2), A: b * b - bi * bi, b, t };
}

// ── 부품 체적(mm³): 고체 / 중공 ──────────────────────────────────────────
/**
 * 빼기 하위가 **실제로 재료를 만나는 비율** (0~1). AABB 교집합 / 커터 AABB.
 *
 * · 어느 add 와도 안 만나면 **0** — 뺄 것이 없다(게이트도 따로 잡지만 부피에서도 안 빠져야 한다).
 * · 여러 add 에 걸치면 **각 add 와의 교집합을 더한다.** 게이트가 add 끼리의 관통을 이미
 *   막으므로(접촉 여유 초과 = 오류) add 들은 서로 겹치지 않고, 따라서 합이 이중계수가 아니다.
 *   ⚠ 처음 **최댓값**을 썼다가 실측에서 정정했다: 리브를 지나는 커터가 리브 쪽 절삭을 통째로
 *   놓쳐 부피가 0.15% 과대였다(합으로 바꾼 뒤 0.03%).
 */
function subtractClipFactor(sb, adds) {
  let box;
  try { box = subAabb(sb); } catch { return 1; }
  const vol = (b) => Math.max(0, b.max[0] - b.min[0]) * Math.max(0, b.max[1] - b.min[1]) * Math.max(0, b.max[2] - b.min[2]);
  const own = vol(box);
  if (!(own > 0)) return 1;
  let hit = 0;
  for (const ad of adds) {
    let ab;
    try { ab = subAabb(ad); } catch { continue; }
    hit += vol({
      min: [0, 1, 2].map((k) => Math.max(box.min[k], ab.min[k])),
      max: [0, 1, 2].map((k) => Math.min(box.max[k], ab.max[k])),
    }) / own;
  }
  // 1 을 넘을 수 없다 — 넘으면 게이트를 지나지 않은(add 가 겹친) 형상이다.
  return Math.min(1, hit);
}

export function partVolume(type, p) {
  const A = Math.PI / 4;
  switch (type) {
    case 'box': return p.width * p.depth * p.height;
    // C1 인벤토리(260719) 폐형 정정 4건: 구멍·겹침 공제 — SCAD/STEP 실측과 일치
    case 'plate_with_holes': // T1(260719): through/blind·cbore·csink·tap
      // 260801: 식을 `holeVolume` 로 뽑아 다른 어휘와 공유한다(두 벌이면 언젠가 갈린다).
      //   패턴도 펼쳐 센다 — 선언 1건이 실제 홀 6개일 수 있다.
      return p.width * p.depth * p.thickness
        - expandHoles(p.holes).reduce((sum, h) => sum + holeVolume(h, p.thickness), 0);
    case 'stepped_plate': return p.stepWidth * p.depth * p.stepThickness + (p.width - p.stepWidth) * p.depth * p.thickness;
    case 'base_plate': return p.width * p.depth * p.thickness - 4 * A * p.boltDia ** 2 * p.thickness; // 코너 볼트홀 4(scadBody 동일)
    case 'l_bracket': return (p.legA * p.width * p.thickness) + (p.thickness * p.width * (p.legB - p.thickness)); // 코너 겹침 1회만
    case 'bent_sheet': return p.length * p.webWidth * p.thickness + 2 * (p.length * p.thickness * (p.flangeHeight - p.thickness)); // 절곡 겹침 공제
    case 'flange': // 볼트홀 공제(260719 라운드트립 실측 — STEP 은 공제된 실형상, 미공제 시 ~5% 과대)
      return A * (p.outerDia ** 2 - p.boreDia ** 2) * p.thickness - (p.boltCount ?? 0) * A * (p.boltHoleD ?? 0) ** 2 * p.thickness;
    case 'tube': return A * (p.outerDia ** 2 - p.innerDia ** 2) * p.length;   // 중공
    case 'rect_tube': return (p.width * p.height - (p.width - 2 * p.wallThk) * (p.height - 2 * p.wallThk)) * p.length;
    // §8-② 형강 실단면(2026-07-16): 플랜지2 + 웨브 — AABB가 아닌 실단면적으로 질량·BOQ 정확
    case 'h_section': return (2 * p.B * p.tf + p.tw * (p.H - 2 * p.tf)) * p.length;
    case 'c_channel': return (2 * p.B * p.tf + p.tw * (p.H - 2 * p.tf)) * p.length;
    // 260801h — 원뿔대 V = πh/12·(d1² + d1·d2 + d2²) · 원환 V = 2π²Rr² (둘 다 **정확식**)
    case 'cone': return (Math.PI * p.height / 12) * (p.dia1 ** 2 + p.dia1 * p.dia2 + p.dia2 ** 2);
    case 'torus': return 2 * Math.PI ** 2 * (p.majorDia / 2) * (p.minorDia / 2) ** 2;
    // 260803 — 구 V = (π/6)d³ · 타원체 V = (π/6)·dx·dy·dz (둘 다 **정확식**)
    case 'sphere': return (Math.PI / 6) * p.diameter ** 3;
    case 'ellipsoid': return (Math.PI / 6) * p.dx * p.dy * p.dz;
    case 'cylinder': { // T1(260719): 키홈=원호 절단 정확식, 오링 홈=원환 폐형
      let v = A * p.diameter ** 2 * p.length;
      const r = p.diameter / 2;
      if (p.keyway) { // 절단 영역 = {x≥r−t, |y|≤w/2} ∩ 원판 — 폐형 적분
        const k = p.keyway, hw = Math.min(k.w / 2, r);
        const segA = 2 * ((hw / 2) * Math.sqrt(Math.max(0, r * r - hw * hw)) + (r * r / 2) * Math.asin(hw / r)) - (r - k.depth) * k.w;
        v -= Math.max(0, segA) * (k.length ?? p.length);
      }
      for (const g of p.oringGrooves ?? []) v -= Math.PI * (r * r - (r - g.depth) ** 2) * g.w;
      return v;
    }
    case 'gusset': return 0.5 * p.legA * p.legB * p.thickness;
    case 'spur_gear': return (polyArea(gearPoly(p)) - A * (p.boreDia ?? 0) ** 2) * p.thickness;
    case 'hex_bolt': {
      const { af, hh } = boltDims(p);
      return (Math.sqrt(3) / 2) * af ** 2 * hh + A * p.threadDia ** 2 * p.length; // 육각머리 + 자루
    }
    case 'sheet_profile': return polyArea(sheetPoly(p)) * p.width;
    /**
     * 임의 폐곡선 압출 — 부피는 **폐형**이다(shoelace 면적 × 깊이 − 원형홀).
     * 근사가 아니므로 AABB 과대 문제(코퍼스 primitive_fit 잔차 99%대)를 겪지 않는다.
     */
    /**
     * 복합 부품 — add 합 − subtract 합.
     * ⚠ **겹침은 공제하지 않는다.** add 끼리 겹치면 부피가 과대해진다 — 어휘 힌트와
     *   BOQ 고지에 적었다. 조용히 근사하면 물량이 틀린 채로 나간다.
     */
    /**
     * 복합 부품 — `Σ add − Σ subtract`. 단, **빼기는 add 영역으로 잘라서** 뺀다 (260801k).
     *
     * ⚠ 종전에는 커터 부피를 통째로 뺐다. 관통홀 커터를 판보다 길게 잡는 것은 **통상 관례**
     *   (동일 평면 회피)인데, 그 튀어나온 부분이 **없는 자리에서 빠졌다.**
     *   실측: 100×100×20 판 + ⌀20×40 관통 커터 → 부피 **−3.24%**(질량이 그만큼 작게 나갔다).
     *   게이트는 통과였다 — 「고아 빼기」는 잡아도 「일부만 걸친 빼기」는 못 잡는다.
     *
     * ⚠ 자르는 비율은 **AABB 교집합 비**다. 커터 단면이 자르는 축을 따라 일정하면
     *   (원통·각기둥 = 실무의 대부분) **정확하다.** 두 축 이상에서 잘리거나 단면이 변하는
     *   커터(구·원뿔)는 **근사**다.
     */
    case 'composite': {
      const subs = compositeSubs(p);
      const adds = subs.filter((sb) => sb.op !== 'subtract');
      let v = 0;
      for (const sb of adds) v += partVolume(sb.type, sb.params);
      for (const sb of subs.filter((q) => q.op === 'subtract')) {
        v -= partVolume(sb.type, sb.params) * subtractClipFactor(sb, adds);
      }
      return Math.max(0, v);
    }
    /** 조적 블록 — 공동을 뺀 폐형(중실로 두면 질량이 실물의 1.5~2배가 된다). */
    case 'masonry_block': {
      const n = Number(p.coreCount ?? 0);
      const cores = n > 0 ? n * Number(p.coreW) * Number(p.coreD) * Number(p.height) : 0;
      return Math.max(0, p.length * p.thickness * p.height - cores);
    }
    case 'extrude_profile': {
      /**
       * ⚠ 260801: 홀을 **단순 원통 관통**으로만 셌다. 그래서 같은 카운터보어를 줘도
       * `plate_with_holes` 는 475,024mm³, 여기는 477,738mm³(=관통과 동일)로 갈렸다.
       * 이제 `holeVolume` 단일 소스를 쓰고 패턴도 펼친다. 필렛은 프로파일에 반영된다.
       */
      const A2 = Math.abs(polyArea(extrudePoly(p)));
      const holes = expandHoles(p.holes).reduce((sum, h) => sum + holeVolume(h, Number(p.depth)), 0);
      return Math.max(0, A2 * Number(p.depth) - holes);
    }
    case 'wall_with_openings': {
      const solid = p.length * p.thickness * p.height;
      const cut = (p.openings ?? []).reduce((s, o) => s + o.w * o.h * p.thickness, 0);
      return solid - cut;
    }
    // 슬래브 관통 개구부(260729) — 계단·승강로·덕트 관통. 벽체와 달리 **수평면**이고
    // 개구가 평면(x,y)에 나므로 별도 어휘가 필요하다. 관통이라 두께 전체가 빠진다(폐형).
    case 'slab_with_openings': {
      const solid = p.length * p.depth * p.thickness;
      const cut = (p.openings ?? []).reduce((s, o) => s + o.w * o.d * p.thickness, 0);
      return solid - cut;
    }
    case 'i_girder': return p.length * (p.botW * p.botT + p.webT * p.webH + p.topW * p.topT);
    /**
     * 변단면 거더(헌치보) — 웨브 춤이 webH1→webH2 로 **선형** 변한다.
     *
     * 근거: buildingSMART IFC 4.3 공식 커버리지 샘플 `beam-varying-profiles`.
     * IFC 의 `IfcExtrudedAreaSolidTapered` 의미(양 끝 단면의 선형 모프)를 그대로 따른다.
     *
     * 폐형인 이유: 단면적 A(t)=2·(플랜지)+webT·webH(t) 가 t 의 **1차식**이므로 평균단면
     * ×길이가 정확하다(심프슨도 같은 값). 웨브=사다리꼴, 상부 플랜지=평행사변형.
     *
     * ⚠ 상부 플랜지 두께 topT 는 **연직 측정**이다(선형 모프의 필연). 경사 θ 에서 실제
     *   직교 두께는 topT·cosθ — 그래서 게이트가 물매를 1/3 로 제한한다(≤0.5% 차이).
     * ⚠ 국소축이 i_girder 와 **다르다**: x=스팬 · y=춤 · z=폭(sheet_profile 관례).
     *   경사면 프리즘은 축이 폭 방향이라 XY 프로파일→Z 압출로만 SCAD·STEP 이 일치한다.
     */
    case 'tapered_girder':
      return p.length * (p.botW * p.botT + p.topW * p.topT + p.webT * (p.webH1 + p.webH2) / 2);
    // 표준 부품 확장(260718b — 자주 쓰는 부품)
    case 'hex_nut': return (Math.sqrt(3) / 2) * p.af ** 2 * p.thickness - A * (p.boreDia ?? 0) ** 2 * p.thickness;
    case 'washer': return A * (p.outerDia ** 2 - p.boreDia ** 2) * p.thickness;
    case 'angle': return (p.legA + p.legB - p.thickness) * p.thickness * p.length; // L형강(장척)
    case 'tee_section': return (p.B * p.tf + p.tw * (p.H - p.tf)) * p.length;       // T형강
    case 'pipe_reducer': {
      const t = p.wallThk ?? Math.max(2, p.dia1 * 0.03);
      const frus = (D1, D2) => (Math.PI * p.length / 12) * (D1 * D1 + D1 * D2 + D2 * D2);
      return frus(p.dia1, p.dia2) - frus(Math.max(0, p.dia1 - 2 * t), Math.max(0, p.dia2 - 2 * t)); // 원뿔대 셸
    }
    // 자유곡면 어휘(260718d): mesh=발산정리 정밀값(빌드 시 산출 — 날조 아님·파일/수식 파생),
    // revolve=파푸스 정리(폐형: V=2π·r̄·A — 프로파일 도심 반경×면적)
    case 'mesh': return Number(p.volumeMm3) > 0 ? Number(p.volumeMm3) : 0;
    case 'pipe_elbow': { // 엘보(R2-⑧) = 파푸스: 2π·bendR·링단면적·(angle/360) 폐형
      const t = p.wallThk ?? Math.max(2, p.od * 0.05);
      const ringA = (Math.PI / 4) * (p.od ** 2 - (p.od - 2 * t) ** 2);
      return 2 * Math.PI * p.bendR * ringA * ((p.angleDeg ?? 90) / 360);
    }
    case 'pipe_tee': { // 티(R2-⑧) = 본관 셸 + 지관 셸(본관 반경 구간 제외) — 접합부 ±수% 근사(명시)
      const t = p.wallThk ?? Math.max(2, p.runOD * 0.05);
      const shell = (od, L) => (Math.PI / 4) * (od ** 2 - (od - 2 * t) ** 2) * L;
      return shell(p.runOD, p.runLen) + shell(p.branchOD, Math.max(0, p.branchLen - p.runOD / 2));
    }
    case 'rebar': { // 철근(R2-④) = π/4·d²·경로장(폐형 — 절점 스피어 중복은 미미·보수)
      let L = 0;
      const pts = p.points ?? [];
      for (let k = 0; k < pts.length - 1; k++) L += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1], pts[k + 1][2] - pts[k][2]);
      return (Math.PI / 4) * p.dia ** 2 * L;
    }
    case 'coil_spring': { // 헬리컬 스프링 = π/4·d²·L_wire (L_wire=n·√((πDm)²+p²)) 폐형
      const Dm = p.coilDia - p.wireDia; // 평균 코일경
      const Lw = p.turns * Math.hypot(Math.PI * Dm, p.pitch);
      return (Math.PI / 4) * p.wireDia ** 2 * Lw;
    }
    case 'pillow_block': { // C2(260719b): 실형상 폐형 — 베이스+상부 반원통 − 보어(렌즈) − 볼트홀 2
      const w = p.width, h = p.height, d2 = p.depth ?? Math.round(p.boreDia * 1.4);
      const bp = p.boltPitch ?? Math.round(w * 0.8);
      const R = Math.min(w * 0.9, h * 1.1) / 2;      // 상부 원통 반경(중심 z=0.55h — R ≤ 0.55h 보장)
      const rb = p.boreDia / 2, db = Math.max(8, p.boreDia * 0.25);
      // 보어 공제 = 원-원 렌즈(보어 중심 z=h ↔ 원통 중심 z=0.55h, 축간 0.45h) — 하부 침범분은
      // 베이스 스트립이 전폭이라 렌즈로 수렴(유도 명시). 완전 내포/분리 경계 클램프.
      const dd = 0.45 * h;
      let lens;
      if (dd >= R + rb) lens = 0;
      else if (dd <= Math.abs(R - rb)) lens = Math.PI * Math.min(R, rb) ** 2;
      else {
        lens = R * R * Math.acos((dd * dd + R * R - rb * rb) / (2 * dd * R))
          + rb * rb * Math.acos((dd * dd + rb * rb - R * R) / (2 * dd * rb))
          - 0.5 * Math.sqrt((-dd + R + rb) * (dd + R - rb) * (dd - R + rb) * (dd + R + rb));
      }
      // 볼트홀: 관통 높이 = 베이스 0.55h + 홀 위치의 원통 여분(중심 x 기준 근사 — 소경 명시)
      const off = bp / 2;
      const domeExtra = off < R ? Math.sqrt(R * R - off * off) : 0;
      const boltV = A * db * db * Math.min(h, 0.55 * h + domeExtra);
      return w * d2 * 0.55 * h + (Math.PI / 2) * R * R * d2 - lens * d2 - 2 * boltV;
    }
    case 'cavity_block': { // 금형 블록 − 음형 = 폐형 차 체적(캐비티 체적은 재귀)
      const cav = p.cavity ? partVolume(p.cavity.type, p.cavity.params) : 0;
      return Math.max(0, p.blockW * p.blockD * p.blockH - cav);
    }
    case 'revolve': {
      const prof = p.profile ?? [];
      let area2 = 0, momR = 0; // shoelace(×2) · 도심 r×면적(×6)
      for (let i = 0; i < prof.length; i++) {
        const [r1, z1] = prof[i], [r2, z2] = prof[(i + 1) % prof.length];
        const cr = r1 * z2 - r2 * z1;
        area2 += cr; momR += (r1 + r2) * cr;
      }
      const areaAbs = Math.abs(area2) / 2;
      const rBar = Math.abs(momR / 6) / Math.max(1e-9, areaAbs);
      const frac = Math.min(360, Math.max(1, Number(p.angleDeg) || 360)) / 360;
      return 2 * Math.PI * rBar * areaAbs * frac;
    }
    default: return 0;
  }
}
// ══ 실단면 보정 (F1·F12, 도그푸딩 260719b) ═══════════════════════════════════
// partVolume() 은 "선언된 형상 그대로"의 체적이다. 그런데 어떤 부재는 선언 형상(box)과
// 발주·제작 실물이 다르다 — 규격 스냅이 각형강관으로 라벨을 붙인 기둥, 판재로 짜는 함체.
// 여기서 그 둘을 **같은 소스**로 묶는다(모듈 경계 교차검증). 판별 불가 시 중실 유지 =
// 날조 금지 원칙. 어느 경로를 탔는지는 basis 로 산출물에 항상 드러난다.

/**
 * F1 — std-snap 이 각형강관으로 스냅한 부재의 실단면(중공).
 * `auditAssemblyStd`(std-snap.mjs) 의 각관 분기와 **동일 조건**을 쓴다: 라벨을 만든 판정과
 * 질량을 만드는 판정이 갈라지면 다시 F1 이 재발한다.
 *   ① type='box' & role ∈ {column, beam}   ② 강재(알루미늄=T슬롯 표 — 카탈로그에 단면적이
 *   없으므로 중실 유지)   ③ width===depth (정사각)   ④ 스냅 편차 devPct===0
 * ④가 핵심: 근사 스냅(예 □145→□150, 편차 3.4%)은 **모델 형상이 규격과 다른 것**이므로
 * 질량을 규격으로 바꾸면 형상과 어긋난다. 정확 일치일 때만 중공으로 본다.
 * 두께: params.wallThk(사용자 선언) > 카탈로그 두께 후보 중 최대(보수 = 질량 과소평가 방지).
 * 근사 명시: 코너 R 이 카탈로그에 없어 직각 모서리로 계산 → KS D 3568 공표치 대비 +2~3%
 *   (SQ150×150×6t: 본 식 27.1 kg/m vs 공표 26.4 kg/m). 중실 대비 −85%.
 * @returns {{ areaMm2:number, thkMm:number, label:string, spec:string }|null}
 */
export function stdHollowSection(part) {
  if (!part || part.type !== 'box') return null;
  const role = String(part.role ?? '');
  if (role !== 'column' && role !== 'beam') return null;
  if (/alu/i.test(String(part.material ?? ''))) return null; // T슬롯: 단면적 미수록 → 중실
  const p = part.params ?? {};
  if (!(p.width > 0) || p.width !== p.depth) return null;
  const snap = snapSquareTube(p.width);
  if (!snap.ok || snap.devPct !== 0) return null;
  const opts = snap.thkOptions ?? [];
  const declared = Number(p.wallThk);
  const t = Number.isFinite(declared) && declared > 0 && declared < snap.side / 2
    ? declared
    : Math.max(...opts);
  if (!(t > 0)) return null;
  const bi = snap.side - 2 * t;
  return {
    areaMm2: snap.side * snap.side - bi * bi,
    thkMm: t,
    label: `${snap.label}×${t}t`,
    spec: snap.spec,
  };
}

/**
 * F12 — 판재로 짜는 함체(캐비닛·붙박이장 하부장·걸레받이)를 통짜 목재로 계산하면
 * 7~10배 과대가 되고, 그 값이 바닥 활하중(kg/m²)으로 환산돼 "개산"으로 제시된다.
 * 셸로 볼 부재의 기준 = **role 선언**(형상·치수 추정 금지 — 오판단하느니 중실이 낫다):
 *   cabinet/carcass/casework → 5면 셸(좌·우 측판 + 상·하판 + 뒷판. 전면은 문짝이
 *     별도 부품으로 이미 계상되므로 개방). 내부 칸막이·서랍은 선언 부품이 아니면 미계상
 *     (없는 부재를 만들지 않는다) → 실물 대비 보수적 하한.
 *   plinth → 둘레 프레임(받침대는 상·하가 뚫린 사다리 프레임: 둘레 레일만).
 * 판 두께 t = params.panelThk > params.thickness > 18mm(가구 판재 상용 기본).
 * 밀도는 부재 선언 재질을 그대로 쓴다(timber=500). 실제 MDF/PB(650~750 kg/m³)면
 * 약 1.3~1.5배 — 재질을 임의로 바꾸지 않고 note 로만 밝힌다.
 * @returns {{ volumeMm3:number, basis:string, note:string }|null}
 */
const CABINET_ROLES = new Set(['cabinet', 'carcass', 'casework']);
export function panelShellVolume(part) {
  if (!part || part.type !== 'box') return null;
  const role = String(part.role ?? '');
  const p = part.params ?? {};
  const W = p.width, D = p.depth, H = p.height;
  if (!(W > 0 && D > 0 && H > 0)) return null;
  const t = Number(p.panelThk) > 0 ? Number(p.panelThk) : Number(p.thickness) > 0 ? Number(p.thickness) : 18;
  if (CABINET_ROLES.has(role)) {
    if (!(W > 2 * t && H > 2 * t && D > t)) return null; // 판 두께보다 작은 함체 = 셸 불성립
    const sides = 2 * t * D * H;                 // 좌·우 측판(전깊이·전높이)
    const topBot = 2 * (W - 2 * t) * D * t;      // 상·하판(측판 사이)
    const back = (W - 2 * t) * t * (H - 2 * t);  // 뒷판(상·하판 사이)
    return {
      volumeMm3: sides + topBot + back,
      basis: 'panel-shell',
      note: `판재 함체 5면 셸(t${t} · 전면 개방=문짝 별도) — 내부 칸막이·서랍 미계상(하한). 재질 밀도 그대로 적용`,
    };
  }
  if (role === 'plinth') {
    if (!(W > 2 * t && D > 2 * t)) return null;
    // 둘레 레일 프레임: 전·후 레일(전폭) + 좌·우 레일(사이 채움)
    const vol = 2 * W * t * H + 2 * (D - 2 * t) * t * H;
    return {
      volumeMm3: vol,
      basis: 'panel-frame',
      note: `걸레받이 둘레 레일 프레임(t${t} · 상·하 개방) — 중간 보강 레일 미계상(하한)`,
    };
  }
  return null;
}

/**
 * 부품 1개분 **실단면 보정 체적**(mm³) + 산출 근거. 질량을 쓰는 모든 경로
 * (structuralCheck · computeBOQ)는 partVolume 이 아니라 이 함수를 통과해야 한다 —
 * 그래야 "라벨은 각관인데 질량은 통짜" 같은 한 페이지 자기모순이 구조적으로 불가능해진다.
 * @returns {{ volumeMm3:number, basis:'solid'|'hollow-std'|'panel-shell'|'panel-frame', note:string, section?:object }}
 */
export function partVolumeEffective(part) {
  const solid = partVolume(part.type, part.params);
  const hollow = stdHollowSection(part);
  if (hollow) {
    const len = part.params.height; // 정사각 단면(width=depth)의 부재 축 = height
    if (len > 0) {
      return {
        volumeMm3: hollow.areaMm2 * len,
        basis: 'hollow-std',
        note: `규격 중공 단면 ${hollow.label} (${hollow.spec}) — 단면적 ${Math.round(hollow.areaMm2)}mm². 코너R 미반영으로 공표치 대비 +2~3% 근사`,
        section: hollow,
      };
    }
  }
  const shell = panelShellVolume(part);
  if (shell) return withEdgeBreak(part, { volumeMm3: shell.volumeMm3, basis: shell.basis, note: shell.note });
  return withEdgeBreak(part, { volumeMm3: solid, basis: 'solid', note: '중실(선언 형상 그대로) — 규격 중공/판재 셸 판별 대상 아님' });
}

/**
 * 모서리 가공(필렛·모따기)을 **질량에 반영** (260801l).
 *
 * ## 무엇이 갈려 있었나
 * `part.filletMm` 은 **STEP B-rep 에만** 반영되고 부피·질량은 무필렛 그대로였다.
 * 같은 부품이 도면에서는 둥글고 물량서에서는 각진 것이다 — 「선언과 산출이 갈린다」로
 * 이 세션 내내 잡아 온 형태이며, 질량이 **깎인 만큼 과대**로 나간다.
 *
 * ## 얼마나 깎이나 — 볼록 모서리 길이로 낸다(폐형)
 * 길이 L 인 **볼록 직각 모서리**에서
 *   · 필렛 반경 r → 제거 `(1 − π/4)·r²·L`
 *   · 모따기 c    → 제거 `(c²/2)·L`
 * 모서리가 만나는 꼭짓점은 2차 항이라 이 식에 없다 — **근사이며 그 사실을 적는다.**
 *
 * ## ⚠ 모서리 길이를 아는 어휘만 계산한다
 * `box`·`cylinder` 는 모서리가 명확하다. 그 밖은 **계산하지 않고 「미반영」이라고 적는다** —
 * 모서리 길이를 추정해서 곱하면 그럴듯한 거짓 수치가 된다.
 */
function convexEdgeLengthMm(type, p) {
  if (type === 'box') return 4 * (Number(p.width) + Number(p.depth) + Number(p.height));
  // 원기둥은 위·아래 원둘레 2개가 볼록 모서리다.
  if (type === 'cylinder') return 2 * Math.PI * Number(p.diameter);
  return null;
}

function withEdgeBreak(part, base) {
  /**
   * ★260802 — **면·선 기준 연산(`edgeOps`)을 먼저 반영**한다.
   *   부품 전체 필렛과 **같은 폐형**을 엣지 길이에 적용한다(중복 구현 금지):
   *     필렛 `(1−π/4)r²L` · 모따기 `(c²/2)L`
   * ⚠ `len`(엣지 길이)이 선언된 것만 반영한다. 없으면 **부피를 건드리지 않고**
   *   「질량이 그만큼 과대」라고 적는다 — 길이를 추정해 곱하면 출처를 아무도 모른다.
   */
  const ops = Array.isArray(part?.edgeOps) ? part.edgeOps : [];
  if (ops.length) {
    let cut = 0, unquant = 0;
    for (const o of ops) {
      const L = Number(o?.len);
      const sz = Number(o?.size);
      if (!(L > 0) || !(sz > 0)) { unquant += 1; continue; }
      cut += o.kind === 'chamfer' ? (sz * sz / 2) * L : (1 - Math.PI / 4) * sz * sz * L;
    }
    const v = Math.max(0, base.volumeMm3 - cut);
    const pct = base.volumeMm3 > 0 ? (cut / base.volumeMm3) * 100 : 0;
    base = {
      volumeMm3: v,
      basis: `${base.basis}+edge-ops`,
      note: `${base.note} · 면·선 연산 ${ops.length}건 중 ${ops.length - unquant}건 반영`
        + (cut > 0 ? ` (${Math.round(cut)}mm³ · ${pct.toFixed(2)}%)` : '')
        + (unquant ? ` · ⚠ ${unquant}건은 **엣지 길이 미선언**으로 질량에 반영하지 않았다(그만큼 과대)` : ''),
    };
  }
  const r = Number(part?.filletMm) || 0;
  const c = Number(part?.chamferMm) || 0;
  if (!(r > 0) && !(c > 0)) return base;
  const L = convexEdgeLengthMm(part.type, part.params ?? {});
  const kind = r > 0 && c > 0 ? `필렛 R${r} + 모따기 C${c}` : r > 0 ? `필렛 R${r}` : `모따기 C${c}`;
  if (!(L > 0)) {
    /**
     * ⚠ 모르면 **모른다고 적고 부피는 건드리지 않는다.** 여기서 임의 계수를 곱하면
     *   질량이 조용히 틀어지고, 그게 어디서 왔는지 아무도 모른다.
     */
    return {
      ...base,
      basis: `${base.basis}+edge-break-unquantified`,
      note: `${base.note} · ⚠ ${kind} 이 선언됐으나 이 어휘는 **모서리 길이를 알 수 없어 질량에 반영하지 않았다** — `
        + 'STEP 형상은 가공돼 있고 질량은 무가공 기준이라 **질량이 그만큼 과대**다.',
    };
  }
  const cut = (r > 0 ? (1 - Math.PI / 4) * r * r * L : 0) + (c > 0 ? (c * c / 2) * L : 0);
  const v = Math.max(0, base.volumeMm3 - cut);
  const pct = base.volumeMm3 > 0 ? (cut / base.volumeMm3) * 100 : 0;
  return {
    volumeMm3: v,
    basis: `${base.basis}+edge-break`,
    note: `${base.note} · ${kind} 반영 — 볼록 모서리 ${Math.round(L)}mm 에서 ${Math.round(cut)}mm³(${pct.toFixed(2)}%) 제거. `
      + '**꼭짓점 교차분은 2차 항이라 미반영**(그만큼 아주 조금 과대).',
  };
}

// 부품 내부 유체 체적(mm³) — 중공/용기 만수
export function fluidVolume(type, p) {
  const A = Math.PI / 4;
  if (type === 'tube') return A * p.innerDia ** 2 * p.length;
  if (type === 'rect_tube') return (p.width - 2 * p.wallThk) * (p.height - 2 * p.wallThk) * p.length;
  if (type === 'cylinder') return A * p.diameter ** 2 * p.length; // 속찬 원기둥을 용기로 쓰면 근사
  return 0;
}
/**
 * 부품 로컬 무게중심 — 타입별 해석식 (AABB 중심 근사 제거, 외부감사 반영).
 * 대칭 타입은 AABB 중심과 동일하므로 비대칭 타입만 정밀식: gusset(삼각형 도심),
 * l_bracket·stepped_plate·bent_sheet(합성 도형 1차모멘트), sheet_profile(폴리곤 도심),
 * hex_bolt(자루+머리 합성), spur_gear·flange·tube(대칭 — 중심).
 */
function localCG(type, p) {
  const A = Math.PI / 4;
  /**
   * ★260802 — **선언된 무게중심이 있으면 그것을 쓴다.**
   *
   * 커널 임포트(`stepKernelImport`)가 솔리드마다 `cg` 를 **정확값**으로 싣는데
   * (기준 형상 실측 일치), 여기서 무시하고 **AABB 중심**을 썼다.
   * 실측: 커널이 `cg:[500,20,30]` 을 준 부품인데 구조 검토는 `[500,50,50]` 을 썼다.
   *
   * ⚠ 이건 표면적보다 무겁다 — **무게중심은 전도 판정을 직접 지배**한다.
   *   실물 형상은 비대칭이 흔하고(용접 구조물·기계 가공품), AABB 중심은 그걸 못 담는다.
   * ⚠ **선언된 것만** 쓴다. 없으면 종전 해석식·AABB 중심 그대로다 — 지어내지 않는다.
   */
  const declared = p?.cg;
  if (Array.isArray(declared) && declared.length === 3 && declared.every((v) => Number.isFinite(Number(v)))) {
    return declared.map(Number);
  }
  switch (type) {
    case 'gusset': // 직각삼각 도심 = 직각꼭짓점에서 각 변의 1/3
      return [p.legA / 3, p.legB / 3, p.thickness / 2];
    case 'l_bracket': {
      const A1 = p.legA * p.thickness, A2 = p.thickness * Math.max(0, p.legB - p.thickness); // 수평판 + 수직판(겹침 제외)
      const y = p.width / 2;
      const x = (A1 * (p.legA / 2) + A2 * (p.thickness / 2)) / (A1 + A2);
      const z = (A1 * (p.thickness / 2) + A2 * (p.thickness + (p.legB - p.thickness) / 2)) / (A1 + A2);
      return [x, y, z];
    }
    case 'stepped_plate': {
      const V1 = p.stepWidth * p.depth * p.stepThickness, V2 = (p.width - p.stepWidth) * p.depth * p.thickness;
      const x = (V1 * (p.stepWidth / 2) + V2 * (p.stepWidth + (p.width - p.stepWidth) / 2)) / (V1 + V2);
      const z = (V1 * (p.stepThickness / 2) + V2 * (p.thickness / 2)) / (V1 + V2);
      return [x, p.depth / 2, z];
    }
    case 'bent_sheet': {
      const Vw = p.length * p.webWidth * p.thickness;               // 웨브(바닥)
      const Vf = p.length * p.thickness * p.flangeHeight;           // 플랜지 ×2 (양측 대칭 → y는 중심)
      const z = (Vw * (p.thickness / 2) + 2 * Vf * (p.flangeHeight / 2)) / (Vw + 2 * Vf);
      return [p.length / 2, p.webWidth / 2, z];
    }
    case 'sheet_profile': {
      const poly = sheetPoly(p);
      let ax = 0, ay = 0, ar = 0;
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
        const c = x1 * y2 - x2 * y1;
        ar += c; ax += (x1 + x2) * c; ay += (y1 + y2) * c;
      }
      ar /= 2;
      return [ax / (6 * ar), ay / (6 * ar), p.width / 2];
    }
    case 'i_girder': {
      const Ab = p.botW * p.botT, Aw = p.webT * p.webH, At = p.topW * p.topT;
      const z = (Ab * p.botT / 2 + Aw * (p.botT + p.webH / 2) + At * (p.botT + p.webH + p.topT / 2)) / (Ab + Aw + At);
      return [p.length / 2, Math.max(p.topW, p.botW) / 2, z];
    }
    case 'tapered_girder': { // 변단면 — 스팬(x)·춤(y) 둘 다 비대칭이라 성분별 1차모멘트
      const L = p.length, h1 = p.webH1, h2 = p.webH2;
      const Vb = L * p.botT * p.botW;                 // 하부 플랜지(직육면체)
      const Vw = (L * (h1 + h2) / 2) * p.webT;        // 웨브(사다리꼴 프리즘)
      const Vt = L * p.topT * p.topW;                 // 상부 플랜지(평행사변형 프리즘)
      const V = Vb + Vw + Vt;
      // 사다리꼴 도심(x̄=L(h1+2h2)/3(h1+h2) · ȳ=(h1²+h1h2+h2²)/3(h1+h2)) — 적분 결과.
      const wx = L * (h1 + 2 * h2) / (3 * (h1 + h2));
      const wy = p.botT + (h1 * h1 + h1 * h2 + h2 * h2) / (3 * (h1 + h2));
      // 평행사변형 도심 = 네 꼭짓점 평균 → x=L/2 · y=botT+(h1+h2)/2+topT/2
      const ty = p.botT + (h1 + h2) / 2 + p.topT / 2;
      const cx = (Vb * (L / 2) + Vw * wx + Vt * (L / 2)) / V;
      const cy = (Vb * (p.botT / 2) + Vw * wy + Vt * ty) / V;
      return [cx, cy, Math.max(p.topW, p.botW) / 2]; // z(폭)는 전 성분 중심정렬 — 대칭
    }
    case 'hex_bolt': {
      const { af, hh } = boltDims(p);
      const Vs = A * p.threadDia ** 2 * p.length, Vh = (Math.sqrt(3) / 2) * af ** 2 * hh;
      const z = (Vs * (p.length / 2) + Vh * (p.length + hh / 2)) / (Vs + Vh);
      return [0, 0, z];
    }
    case 'angle': { // L형강 도심(단면 1차모멘트 — 길이=x 대칭)
      const A1 = p.legA * p.thickness, A2 = p.thickness * Math.max(0, p.legB - p.thickness);
      const y = (A1 * (p.legA / 2) + A2 * (p.thickness / 2)) / (A1 + A2);
      const z = (A1 * (p.thickness / 2) + A2 * (p.thickness + (p.legB - p.thickness) / 2)) / (A1 + A2);
      return [p.length / 2, y, z];
    }
    case 'tee_section': { // T형강 도심(z 비대칭·y 대칭)
      const Aw = p.tw * (p.H - p.tf), Af = p.B * p.tf;
      const z = (Aw * ((p.H - p.tf) / 2) + Af * (p.H - p.tf / 2)) / (Aw + Af);
      return [p.length / 2, p.B / 2, z];
    }
    default: {
      // 대칭 타입(box·plate·flange·tube·cylinder·gear·wall(개구 무시 근사)·base_plate 등) = AABB 중심
      const a = partAabb({ type, ...p });
      return [(a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2, (a.min[2] + a.max[2]) / 2];
    }
  }
}

// OpenSCAD rotate([rx,ry,rz]) 순서(X→Y→Z) — placedAabb(assembly.mjs)와 동일 규칙.
// (assembly→structural 의존이라 여기 복제 — 역방향 import 는 순환)
const DEGR = Math.PI / 180;
function rotCG([x, y, z], rx, ry, rz) {
  let p = [x, y, z];
  if (rx) { const c = Math.cos(rx * DEGR), s = Math.sin(rx * DEGR); p = [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
  if (ry) { const c = Math.cos(ry * DEGR), s = Math.sin(ry * DEGR); p = [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
  if (rz) { const c = Math.cos(rz * DEGR), s = Math.sin(rz * DEGR); p = [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }
  return p;
}

// 부품 월드 무게중심 — 로컬 CG 를 회전 후 평행이동(⚠버그 이력 260717: 회전 미반영으로
// rz90 벽 CG 가 (3000,75)≠참값(−75,3000) — 회전 부품 어셈블리의 전도·반력을 왜곡했음)
export function partCG(part) {
  const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = part.at ?? {};
  let c = localCG(part.type, part.params);
  if (rx || ry || rz) c = rotCG(c, rx, ry, rz);
  return [c[0] + tx, c[1] + ty, c[2] + tz];
}

/**
 * ★**관성 텐서**(260803) — 갭 매트릭스가 지목한 빈칸 ①.
 *
 * 동역학·모달·기울임 응답의 전제다. 종전 `structural` 은 질량·CG·반력·전도까지만 있었다.
 *
 * ## 방법과 그 한계 — **정직하게 적는다**
 * 어휘마다 폐형 관성식을 쓰는 게 정확하지만 40종 전부에 대해 그것을 쓰는 것은 별개 작업이다.
 * 여기서는 **질량은 정확값**(`partVolumeEffective` × 재질 밀도)을 쓰고, **분포는 AABB 균질
 * 직육면체로 근사**한다. 그래서:
 * ```
 *   질량·CG            정확(기존 경로 그대로)
 *   관성 분포          AABB 균질 근사 — 속찬 블록에 가까울수록 정확
 *   중공·박판·회전체    과대(질량이 실제보다 바깥에 있다고 보므로) — 아래 basis 로 고지
 * ```
 * ⚠ 「근사」를 결과에 **붙여서** 낸다. 관성값만 주고 근거를 안 적으면 폐형인 줄 안다.
 * ⚠ 원통·구는 폐형이 간단하므로 그것만 정확식을 쓴다(자주 쓰이고 오차가 크다).
 *
 * @returns {{ Ixx,Iyy,Izz,Ixy,Ixz,Iyz, aboutCgMm, basis, exactCount, approxCount }} kg·mm²
 */
export function inertiaTensor(assembly, opts = {}) {
  const dMat = opts.defaultMaterial ?? 'STS316';
  const parts = assembly?.parts ?? [];
  // 전체 CG(질량 가중) — 텐서는 이 점 기준으로 낸다(평행축 정리).
  let M = 0; const cg = [0, 0, 0];
  const rows = [];
  for (const part of parts) {
    const rho = (DENSITY[part.material ?? dMat] ?? DENSITY.STS316) / 1e9; // kg/mm³
    const m = partVolumeEffective(part).volumeMm3 * rho * Math.max(1, Math.round(Number(part.qty) || 1));
    if (!(m > 0)) continue;
    const c = partCG(part);
    rows.push({ part, m, c });
    M += m;
    for (const k of [0, 1, 2]) cg[k] += m * c[k];
  }
  if (!(M > 0)) return null;
  for (const k of [0, 1, 2]) cg[k] /= M;

  let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
  let exact = 0, approx = 0;
  for (const { part, m, c } of rows) {
    // ── 자기 CG 기준 주관성(대각) ────────────────────────────────────────────
    let ix, iy, iz;
    const p = part.params ?? {};
    const ax = axisOfRotationalPart(part);
    if (ax && part.type === 'cylinder' && p.diameter > 0 && p.length > 0) {
      // 속찬 원기둥 폐형: 축방향 mr²/2 · 횡방향 m(3r²+h²)/12
      const r = p.diameter / 2, h = p.length;
      const along = m * r * r / 2, across = m * (3 * r * r + h * h) / 12;
      [ix, iy, iz] = ax === 'x' ? [along, across, across] : ax === 'y' ? [across, along, across] : [across, across, along];
      exact++;
    } else if (part.type === 'sphere' && p.diameter > 0) {
      const r = p.diameter / 2;
      ix = iy = iz = 2 * m * r * r / 5; // 속찬 구 폐형
      exact++;
    } else {
      // AABB 균질 직육면체 근사
      const b = placedPartAabb(part);
      const d = [0, 1, 2].map((k) => Math.max(1e-6, b.max[k] - b.min[k]));
      ix = m * (d[1] * d[1] + d[2] * d[2]) / 12;
      iy = m * (d[0] * d[0] + d[2] * d[2]) / 12;
      iz = m * (d[0] * d[0] + d[1] * d[1]) / 12;
      approx++;
    }
    // ── 평행축 정리로 전체 CG 기준으로 옮긴다 ──────────────────────────────
    const dx = c[0] - cg[0], dy = c[1] - cg[1], dz = c[2] - cg[2];
    Ixx += ix + m * (dy * dy + dz * dz);
    Iyy += iy + m * (dx * dx + dz * dz);
    Izz += iz + m * (dx * dx + dy * dy);
    Ixy -= m * dx * dy;
    Ixz -= m * dx * dz;
    Iyz -= m * dy * dz;
  }
  const r3 = (v) => +v.toFixed(3);
  return {
    Ixx: r3(Ixx), Iyy: r3(Iyy), Izz: r3(Izz), Ixy: r3(Ixy), Ixz: r3(Ixz), Iyz: r3(Iyz),
    aboutCgMm: cg.map((v) => +v.toFixed(2)),
    unit: 'kg·mm²',
    exactCount: exact, approxCount: approx,
    basis: approx === 0
      ? '전 부재 폐형(원기둥·구)'
      : `질량은 정확값, 분포는 ${approx}부재를 AABB 균질 직육면체로 근사 — 중공·박판·회전체는 과대`,
  };
}

/** 회전 대칭축(폐형 관성이 성립하는 축). 사축이면 null. */
function axisOfRotationalPart(part) {
  if (!['cylinder', 'tube'].includes(part.type)) return null;
  const { rx = 0, ry = 0, rz = 0 } = part.at ?? {};
  if (!rx && !ry && !rz) return 'z';
  if (Math.abs(Math.abs(ry) - 90) < 1e-6 && !rx) return 'x';
  if (Math.abs(Math.abs(rx) - 90) < 1e-6 && !ry) return 'y';
  return null;
}

// 부품 배치 후 월드 AABB — assembly.mjs placedAabb 와 동일 수학(로컬 AABB 8코너 회전→이동).
// assembly→structural 의존이라 여기 복제(rotCG 와 같은 사유 — 역방향 import 는 순환).
function placedPartAabb(part) {
  const a = partAabb({ type: part.type, ...part.params });
  const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = part.at ?? {};
  if (!(rx || ry || rz)) {
    return { min: [a.min[0] + tx, a.min[1] + ty, a.min[2] + tz], max: [a.max[0] + tx, a.max[1] + ty, a.max[2] + tz] };
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const cx of [a.min[0], a.max[0]]) for (const cy of [a.min[1], a.max[1]]) for (const cz of [a.min[2], a.max[2]]) {
    const w = rotCG([cx, cy, cz], rx, ry, rz);
    w[0] += tx; w[1] += ty; w[2] += tz;
    for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
  }
  return { min, max };
}

/**
 * supports 미지정 시 지지 기반 폴백 — **접지 부품들의 바닥 footprint** (260720 수리).
 * 종전 폴백은 "부품 CG 점들의 XY 스팬"이었고 두 방향으로 틀렸다:
 *   ① 동축 배치(판+기둥 받침대)는 모든 CG 가 한 점 → 지지폭 0 → staticAngleDeg 0° —
 *      명백히 안정한 구조를 전도 위험으로 **과탐**
 *   ② 공중 부품(크레인 지브 등)의 CG 도 지지점으로 계상 → 실제 베이스보다 넓은 스팬 —
 *      **미탐** 방향 왜곡(이번 크레인은 CG 가 워낙 높아 우연히 경고가 살아있었을 뿐)
 * 수리: 전 부품 배치 AABB 의 최저 z(zMin)에 닿는(접촉 공차 1mm — assembly 접촉 판정과
 * 동일 스케일) 부품들의 XY AABB **합집합 사각형** = 접지 footprint. 전도축은 그 경계다.
 * 근사 명시: AABB 합집합 사각(비볼록 실 footprint 아님)·대표 배치(qty 반복 인스턴스 미전개).
 * @returns {{ rect:[[x,y]...4], grounded:string[] }|null} 접지 부품이 없거나 면적 퇴화면 null
 */
function groundFootprint(parts) {
  const boxed = [];
  for (const p of parts) {
    const b = placedPartAabb(p);
    if (b.min.every(Number.isFinite) && b.max.every(Number.isFinite)) boxed.push({ id: p.id ?? p.type, b });
  }
  if (!boxed.length) return null;
  const zMin = Math.min(...boxed.map(({ b }) => b.min[2]));
  const CONTACT = 1; // mm
  const g = boxed.filter(({ b }) => b.min[2] <= zMin + CONTACT);
  const x0 = Math.min(...g.map(({ b }) => b.min[0])), x1 = Math.max(...g.map(({ b }) => b.max[0]));
  const y0 = Math.min(...g.map(({ b }) => b.min[1])), y1 = Math.max(...g.map(({ b }) => b.max[1]));
  if (!(x1 > x0) || !(y1 > y0)) return null; // 면적 퇴화(선·점 접지) — 폴백 상위에서 처리
  return { rect: [[x0, y0], [x1, y0], [x0, y1], [x1, y1]], grounded: g.map(({ id }) => id) };
}

/**
 * @param assembly { parts:[{ id, type, params, at, material?, fluid? }] }
 * @param opts {
 *   defaultMaterial='STS316', fluidDensity='water',
 *   supports:[[x,y]...] (캐스터/다리 XY, mm) — 없으면 접지 부품 footprint 4모서리(groundFootprint),
 *   member:{ section:'SHS50x50x3', spanMm, loadKg } (최악 부재 검토; loadKg 없으면 상부질량/2),
 *   seismicG=0.5, materialFy=205, E=193000
 * }
 */
export function structuralCheck(assembly, opts = {}) {
  const dMat = opts.defaultMaterial ?? 'STS316';
  const fluidRho = DENSITY[opts.fluidDensity ?? 'water'] / 1e9; // kg/mm³
  const Fy = opts.materialFy ?? 205, E = opts.E ?? 193000, seismic = opts.seismicG ?? 0.5;

  const bodies = [];
  /**
   * ★모르는 재질 이름(260803) — **조용히 스테인리스로 떨어지고 있었다.**
   * 실측: `material:'rubber'` · `'wood'` · `'나무'` 가 전부 7980 kg/m³(STS316)로 계산됐다.
   * 사용자가 「고무 패드」라고 적었는데 질량이 스테인리스로 나오면 그건 **틀린 답을
   * 맞는 답처럼** 내는 것이다. 폴백 자체는 유지하되(계산은 나와야 한다) **이름을 모은다** —
   * 호출측이 「이 재질은 표에 없어 강재로 계산했다」를 말할 수 있어야 한다.
   */
  const unknownMaterials = new Set();
  for (const part of assembly.parts ?? []) {
    const mName = part.material ?? dMat;
    if (DENSITY[mName] === undefined) unknownMaterials.add(String(mName));
    const rho = (DENSITY[mName] ?? DENSITY.STS316) / 1e9; // kg/mm³
    // F1·F12(260719b): 선언 형상 체적이 아니라 **실단면 보정 체적**(규격 중공/판재 셸).
    const eff = partVolumeEffective(part);
    const vol = eff.volumeMm3;
    // qty(260718): 반복 부품(STEP 대표화) — 질량은 ×qty(BOQ 단일 소스 폐합).
    // CG 는 대표 배치 위치 기준 근사(반복 인스턴스 개별 위치 미반영 — 스케치 용도 명시).
    const qty = Math.max(1, Math.round(Number(part.qty) || 1));
    let mass = vol * rho * qty;
    if (part.fluid) mass += fluidVolume(part.type, part.params) * fluidRho * qty;
    const cg = partCG(part);
    bodies.push({ id: part.id ?? part.type, mass, cg, role: part.role, basis: eff.basis, basisNote: eff.note });
  }
  const totalMass = bodies.reduce((s, b) => s + b.mass, 0);
  const cg = [0, 1, 2].map(k => bodies.reduce((s, b) => s + b.mass * b.cg[k], 0) / (totalMass || 1));

  // 지지점 반력 (강체, 대칭 근사: CG 편심에 따른 분배)
  let supports = opts.supports;
  let supportBasis = 'declared';
  if (!supports || !supports.length) {
    // 접지 footprint 폴백(260720 수리 — groundFootprint 주석 참조). 종전 "CG 점 XY 스팬"은
    // 동축 배치에서 지지폭이 0 으로 붕괴(과탐)했고 공중 부품을 지지로 계상(미탐)했다.
    const fp = groundFootprint(assembly.parts ?? []);
    if (fp) {
      supports = fp.rect;
      supportBasis = 'ground-footprint';
    } else {
      // 최후 폴백(접지 판별 불능·면적 퇴화): 종전 CG 스팬 — 보수적 정확도임을 basis 로 명시
      const xs = bodies.flatMap(b => [b.cg[0]]), ys = bodies.flatMap(b => [b.cg[1]]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      supports = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
      supportBasis = 'cg-span-degenerate';
    }
  }
  const sx0 = Math.min(...supports.map(s => s[0])), sx1 = Math.max(...supports.map(s => s[0]));
  const sy0 = Math.min(...supports.map(s => s[1])), sy1 = Math.max(...supports.map(s => s[1]));
  // 편심하중 다점 반력(강체·선형압력 근사): R_i = W[1/n + ex·xi/Σxi² + ey·yi/Σyi²]
  // (xi,yi = 지지점 중심 기준 상대좌표, ex,ey = CG 편심). 표준 4점 지지 공식.
  const n = supports.length;
  const scx = supports.reduce((s, p) => s + p[0], 0) / n, scy = supports.reduce((s, p) => s + p[1], 0) / n;
  const rel = supports.map(([x, y]) => [x - scx, y - scy]);
  const Sxx = rel.reduce((s, r) => s + r[0] * r[0], 0) || 1, Syy = rel.reduce((s, r) => s + r[1] * r[1], 0) || 1;
  const ex = cg[0] - scx, ey = cg[1] - scy;
  const raw = supports.map((_, i) => Math.max(0, 1 / n + ex * rel[i][0] / Sxx + ey * rel[i][1] / Syy));
  const rawSum = raw.reduce((s, v) => s + v, 0) || 1; // uplift 클램프 후 수직평형 재정규화
  const supportLoads = supports.map(([x, y], i) => ({ pos: [x, y], loadKg: +(totalMass * raw[i] / rawSum).toFixed(1), uplift: raw[i] === 0 }));
  const maxSupport = Math.max(...supportLoads.map(l => l.loadKg));

  // 프레임 부재 검토 (최악)
  //
  // ⚠ 260728: 이 검토는 **호출자가 지간·단면을 선언했을 때만** 돈다(opts.member). 그런데
  // 주 경로(assembly.mjs)는 `structuralCheck(asm, {})` 로 부르므로 **모든 패키지에서
  // member=null 이었다.** 그러면서 warnings 는 비고, ok=true 가 되고, method 문자열은
  // "단순보 부재"를 수행한 것처럼 나열했다. 실측: 보 8개 가대에서
  // structural.ok=true · warnings=[] · 쉬운요약 "구조 안전(개산) 이상 없음" —
  // **부재 응력·처짐을 하나도 보지 않고서** 그렇게 나갔다.
  //
  // 지간을 형상에서 추측해 계산하지는 않는다(그게 곧 날조다). 대신 **안 했다는 사실을
  // 말한다** — "확인 못 함 ≠ 이상 없음".
  let member = null;
  if (opts.member) {
    const sec = SECTIONS[opts.member.section] ?? SECTIONS['SHS50x50x3'];
    const topMass = bodies.filter(b => b.cg[2] > cg[2]).reduce((s, b) => s + b.mass, 0);
    const loadKg = opts.member.loadKg ?? topMass / 2;
    const P = loadKg * g, L = opts.member.spanMm;
    const M = P * L / 4, sigma = M / sec.Z, defl = P * Math.pow(L, 3) / (48 * E * sec.I);
    const allow = Fy / 1.67;
    member = { section: opts.member.section, spanMm: L, loadKg: +loadKg.toFixed(1), sigmaMPa: +sigma.toFixed(1), allowMPa: +allow.toFixed(1), utilization: +(sigma / allow).toFixed(2), deflMm: +defl.toFixed(2), deflLimitMm: +(L / 250).toFixed(1), pass: sigma < allow && defl < L / 250 };
  }

  // 전도(tip-over) — 강체 전도 개산. 전도축 = 지지 사각형(footprint)의 경계이고, 팔길이는
  // CG 에서 **가장 가까운 경계까지의 수평거리**다(260720: 종전 baseShort/2 는 CG 중앙 가정 —
  // 편심 CG 에서 안정을 과대평가하는 미탐 방향 오차라 교체). CG 가 지지 밖이면 0 = 즉시 전도.
  // 안 보는 것(종전과 동일·명시): 앵커/볼트 인장, 바닥 마찰·미끄럼, 동적 증폭·충격,
  // 지지 형상의 비볼록성(AABB 합집합 사각 근사), 부분 들림 후 거동. 상세 검토는 별도.
  const cgZ = cg[2];
  const edgeDist = Math.max(0, Math.min(cg[0] - sx0, sx1 - cg[0], cg[1] - sy0, sy1 - cg[1]));
  const tipAngleDeg = +(Math.atan(edgeDist / cgZ) * 180 / Math.PI).toFixed(1);
  const seismicFS = +(edgeDist / (seismic * cgZ)).toFixed(2);

  // 부재 검토를 **할 만한 대상이 있는데도** 못 했으면 그 사실을 판정 불가로 남긴다.
  // 보·기둥이 하나도 없으면 애초에 해당 사항이 아니라 침묵이 맞다(과잉 경고 방지).
  const MEMBER_ROLES = new Set(['beam', 'column', 'brace', 'chord', 'diagonal', 'girder', 'rafter', 'joist', 'purlin']);
  const memberCandidates = (assembly?.parts ?? []).filter((p) => MEMBER_ROLES.has(String(p?.role ?? '')));
  const memberUnavailable = (!member && memberCandidates.length)
    ? {
      ran: false,
      candidates: memberCandidates.length,
      needInputs: [
        { name: 'member.section', labelKo: '부재 단면 규격(예: SHS50x50x3)' },
        { name: 'member.spanMm', labelKo: '지간(mm)' },
        { name: 'member.loadKg', labelKo: '재하 하중(kg) — 생략 시 상부질량/2' },
      ],
      messageKo: `부재 강도(휨응력·처짐) 미검토 — 보·기둥류 ${memberCandidates.length}개가 있으나 단면 규격·지간이 선언되지 않았습니다. `
        + '형상에서 지간을 추측해 응력을 계산하면 근거 없는 수치가 되므로 계산하지 않았습니다. '
        + '**"부재가 안전하다"는 뜻이 아닙니다.**',
    }
    : null;

  const warnings = [];
  if (tipAngleDeg < 15) warnings.push(`정적 전도각 ${tipAngleDeg}° < 15° — 전도 위험(CG 저감·폭 확대 필요)`);
  if (seismicFS < 1.5) warnings.push(`${seismic}g 측방 전도 FS ${seismicFS} < 1.5 — 아웃리거/앵커·CG 저감 필요`);
  if (member && !member.pass) warnings.push(`부재 ${member.section} 초과 — 단면 상향 필요`);

  // 질량 내역 자기정합(#8, 위시빌더 3차 "구조표 합계 845 vs 실제합 835" 류 자기모순 방지).
  // F13(260719b) 재설계 — 종전 최대잔여법은 합계는 맞췄지만 **보정 잔차가 부재 행에 보였다**
  // (동일 서까래 7개 중 1개만 +0.1kg → 사용자는 다른 부재로 오해한다). 이제 방향을 뒤집는다:
  //   부재 표시값 = 각자의 반올림(동일 질량 부재는 항상 동일 표시), 표시 총계 = 그 합.
  // 합계 정합은 그대로 유지되고(정의상 일치), 총계는 참값 대비 최대 0.05kg×부재수 만큼
  // 표류할 수 있어 참값을 totalExactKg 로 함께 노출한다(숨기지 않음).
  const disp = bodies.map((b) => Math.round(b.mass * 10) / 10);
  const totalDisp = +disp.reduce((s, v) => s + v, 0).toFixed(1);
  const massBreakdown = bodies.map((b, i) => ({
    id: b.id, massKg: +disp[i].toFixed(1), exactKg: +b.mass.toFixed(3), basis: b.basis, basisNote: b.basisNote,
  }));
  const massSumCheck = +massBreakdown.reduce((s, r) => s + r.massKg, 0).toFixed(1) === totalDisp;

  return {
    // 표시 총계 = 부재 표시값의 합(F13 — 행에 보정 잔차를 심지 않는다). 참값은 totalExactKg.
    totalMassKg: totalDisp,
    totalExactKg: +totalMass.toFixed(3),
    massBreakdown, massSumCheck,
    // 표에 없는 재질 이름 — 있으면 그 부재 질량은 STS316 로 계산된 값이다(위 §모르는 재질).
    ...(unknownMaterials.size ? { unknownMaterials: [...unknownMaterials] } : {}),
    /**
     * 관성 텐서(260803) — 전 CG 기준, kg·mm². `basis` 에 폐형/근사 비율을 적어 낸다.
     * ⚠ 여기에 실어야 웹·MCP·CLI 가 **한 번에** 받는다. 소비자마다 따로 부르면 또 갈린다.
     */
    inertia: inertiaTensor(assembly, opts),
    // 산출 근거 집계(F1·F12) — 어떤 부재가 규격 중공/판재 셸/중실로 잡혔는지 한눈에.
    massBasis: massBreakdown.reduce((m, r) => { m[r.basis] = (m[r.basis] ?? 0) + 1; return m; }, {}),
    cgWorldMm: cg.map(v => +v.toFixed(1)),
    cgHeightM: +(cgZ / 1000).toFixed(2),
    supports: supportLoads.map(l => ({ pos: l.pos, loadKg: +l.loadKg.toFixed(1) })),
    maxSupportKg: +maxSupport.toFixed(1),
    member,
    ...(memberUnavailable ? { memberUnavailable } : {}),
    tipover: { staticAngleDeg: tipAngleDeg, seismicG: seismic, seismicFS, edgeDistMm: +edgeDist.toFixed(1), supportBasis },
    warnings,
    // ok = "찾은 문제가 없다"이지 "전부 검토했다"가 아니다. 미검토는 실패가 아니므로
    // ok 를 false 로 만들지 않는다 — 대신 memberUnavailable 로 따로 전달하고,
    // 패키지가 그것을 "판정 불가" 채널로 소비자까지 올린다.
    ok: warnings.length === 0,
    // 안 돌린 검토를 방법론에 적으면 수행한 것으로 읽힌다 — 부재 항목은 실제로 돌렸을 때만.
    method: '실단면 보정 체적×밀도 질량(규격 중공/판재 셸/중실 — massBasis 참조) · 강체 반력'
      + (member ? ' · 단순보 부재' : '')
      + ' · 강체 전도(접지 footprint 경계축·CG 최근접 팔길이 — 앵커·마찰·동적하중 미고려 근사, 비법정)'
      + (memberUnavailable ? ' · ⚠ 부재 휨/처짐 미검토(지간·단면 미선언)' : ''),
  };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('structural.mjs');
if (isMain && process.argv[2]) {
  const { readFileSync } = await import('node:fs');
  const asm = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(structuralCheck(asm, { member: { section: 'SHS50x50x3', spanMm: 1300 } }), null, 2));
}
