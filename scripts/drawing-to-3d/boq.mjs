/**
 * 물량·작업량 산출서 (BOQ, Bill of Quantities) — 형상에서 결정론적으로 물량을 산출.
 * ⚠️ 금액(₩) 미산출 = 실단가·노임·지역·시점 데이터 없이는 날조이므로 뺀다(정직).
 *    물량(질량·면적·길이·수량·용접·구멍·절곡) = 형상에서 확정. 공수(hr) = 표준 원단위 × 물량(개산).
 *    금액은 사용자가 단가를 입력할 때만("입력단가 기준" 명시).
 * 재사용: partVolumeEffective/DENSITY(structural), welds(buildAssembly). eng-knowledge BOQ 룰엔진 사상.
 */
import { partVolumeEffective, DENSITY } from './structural.mjs';
import { buildAssembly } from './assembly.mjs';
import { gearPoly, sheetPoly, hexPts, polyArea, polyPerimeter, boltDims, extrudePoly, expandHoles, holeWallArea } from './reconstruct.mjs';
import { takeoff } from '../engineering-core/quantity/takeoff.mjs';

const A = Math.PI / 4;
/**
 * 부품 표면적 mm² (도장·산세·도금 물량). **미등록 어휘는 `null`** — 0 이 아니다.
 *
 * ⚠️ 260729 실측: 32개 어휘 중 11개가 미등록이었고 `default: return 0` 이라 도장 물량이
 * **조용히 0** 으로 나갔다. 하필 강구조 단면(h_section·c_channel·i_girder)이 전부 거기
 * 있었다 — 강교 도장은 물량의 핵심인데 산출서에는 "0 ㎡"가 찍혔다.
 * 「없음」이 「필요 없음」으로 읽히는 형태(§6-G ④: 부재가 정상으로 읽힘)다.
 *
 * 이번에 폐형이 서는 것은 전부 채웠고(형강·거더·철근·스프링·엘보), 서지 않는 것은
 * `null` 로 되돌려 computeBOQ 가 **미산출 어휘를 이름으로 고지**한다.
 */
function surfaceMm2(type, p) {
  switch (type) {
    case 'box': return 2 * (p.width * p.depth + p.depth * p.height + p.width * p.height);
    case 'plate_with_holes': case 'stepped_plate': return 2 * (p.width * p.depth) + 2 * (p.width + p.depth) * (p.thickness ?? 3);
    case 'base_plate': return 2 * (p.width * p.depth) + 2 * (p.width + p.depth) * p.thickness;
    case 'l_bracket': return 2 * (p.legA * p.width + p.legB * p.width) + p.thickness * 2 * (p.legA + p.legB + p.width);
    case 'bent_sheet': return 2 * (p.length * (p.webWidth + 2 * p.flangeHeight));
    case 'flange': return 2 * A * (p.outerDia ** 2) + Math.PI * p.outerDia * p.thickness;
    case 'tube': return Math.PI * p.outerDia * p.length + Math.PI * p.innerDia * p.length + 2 * A * (p.outerDia ** 2 - p.innerDia ** 2);
    case 'rect_tube': return 2 * (p.width + p.height) * p.length + 2 * ((p.width - 2 * p.wallThk) + (p.height - 2 * p.wallThk)) * p.length;
    case 'cylinder': return Math.PI * p.diameter * p.length + 2 * A * p.diameter ** 2;
    /**
     * 원뿔대 겉넓이 = 측면 π(r1+r2)·s + 두 밑면. s = √(h² + (r1−r2)²) — **모선 길이**다.
     * ⚠ 높이를 모선으로 쓰면 도장·도금 물량이 과소가 된다(경사가 클수록 크게 벌어진다).
     */
    case 'cone': {
      const r1 = p.dia1 / 2, r2 = p.dia2 / 2;
      const slant = Math.hypot(p.height, r1 - r2);
      return Math.PI * (r1 + r2) * slant + Math.PI * (r1 ** 2 + r2 ** 2);
    }
    // 원환 겉넓이 = 4π²Rr (정확식). 안쪽 구멍 면도 도장 대상이라 전면적이 맞다.
    case 'torus': return 4 * Math.PI ** 2 * (p.majorDia / 2) * (p.minorDia / 2);
    case 'sphere': return Math.PI * p.diameter ** 2; // 정확식 4πr²
    /**
     * 타원체 겉넓이는 **닫힌 초등식이 없다**(타원적분). Knud Thomsen 근사식을 쓴다 —
     * 상대오차 ≤1.061%. 부피는 정확식인데 면적만 근사이므로 여기 명시해 둔다.
     * S ≈ 4π·((aᵖbᵖ + aᵖcᵖ + bᵖcᵖ)/3)^(1/p),  p = 1.6075
     */
    case 'ellipsoid': {
      const a = p.dx / 2, b = p.dy / 2, c = p.dz / 2, q = 1.6075;
      return 4 * Math.PI * (((a ** q) * (b ** q) + (a ** q) * (c ** q) + (b ** q) * (c ** q)) / 3) ** (1 / q);
    }
    case 'gusset': return p.legA * p.legB + p.thickness * (p.legA + p.legB + Math.hypot(p.legA, p.legB));
    case 'spur_gear': {
      const poly = gearPoly(p);
      return 2 * (polyArea(poly) - A * (p.boreDia ?? 0) ** 2) + polyPerimeter(poly) * p.thickness + Math.PI * (p.boreDia ?? 0) * p.thickness;
    }
    case 'hex_bolt': {
      const { af, hh } = boltDims(p);
      return 2 * (Math.sqrt(3) / 2) * af ** 2 + polyPerimeter(hexPts(af)) * hh + Math.PI * p.threadDia * p.length;
    }
    case 'sheet_profile': {
      const poly = sheetPoly(p);
      return 2 * polyArea(poly) + polyPerimeter(poly) * p.width;
    }
    /**
     * 임의 폐곡선 압출 — 표면적도 **폐형**이다.
     *   양단면(면적 − 홀단면 ×2) + 외곽 측면(둘레 × 깊이) + **홀 내벽**(π·d·깊이)
     * 홀 내벽을 빼먹으면 도장·가공 면적이 과소 산출된다 — 260729 에 BOQ 표면적 11종이
     * 조용히 0 이던 것을 고칠 때 세운 규약과 같다(내주 엣지는 실제로 마감이 붙는 면).
     */
    /**
     * 조적 블록 — 겉면 6면 + **공동 내벽**(모르타르·미장이 붙지 않는 면이지만 가공/도장
     * 대상 면적 산출의 일관성을 위해 포함하고, 상·하 개구분은 겉면에서 공제한다).
     */
    case 'masonry_block': {
      const n = Number(p.coreCount ?? 0);
      const L = Number(p.length), T = Number(p.thickness), H = Number(p.height);
      const coreTop = n > 0 ? n * Number(p.coreW) * Number(p.coreD) : 0;
      const coreWall = n > 0 ? n * 2 * (Number(p.coreW) + Number(p.coreD)) * H : 0;
      return 2 * (L * T - coreTop) + 2 * (L * H) + 2 * (T * H) + coreWall;
    }
    /**
     * 복합 부품 표면적 — **산출하지 않는다(null)**.
     * add 하위가 서로 맞닿으면 접촉면이 겉면에서 빠져야 하는데 그걸 알 수 없다.
     * 합만 하면 실제보다 크고, 임의로 깎으면 근거가 없다 — `computeBOQ` 가 **미산출**로
     * 이름과 함께 고지한다(0 으로 두면 「필요 없음」으로 읽힌다 — §6-G ④).
     */
    case 'composite': return null;
    /**
     * ★260802 — 아래 셋은 **형상이 답을 갖고 있는데** 미산출로 남아 있었다.
     *   BOQ 가 「미산출」로 고지는 했지만, 고지가 필요 없는 것까지 고지하면
     *   **정말 못 내는 것**(`composite`·`mesh`)이 묻힌다.
     */
    case 'pipe_tee': {
      /**
       * T 분기 — 런 원통 겉면 + 분기 원통 겉면 + 런 양단 링 2 + 분기 끝 링 1.
       * ⚠ 분기가 런에 뚫고 들어간 **교차부**는 서로 상쇄되지 않는다(안쪽 구멍 둘레가 생기고
       *   바깥에서는 그만큼 사라진다). 1차 근사로 **상쇄된다고 본다** — 그 사실을 적는다.
       */
      const t = p.wallThk ?? Math.max(2, p.runOD * 0.05);
      const runId = p.runOD - 2 * t, brId = p.branchOD - 2 * t;
      return Math.PI * (p.runOD + runId) * p.runLen
        + Math.PI * (p.branchOD + brId) * p.branchLen
        + 2 * A * (p.runOD ** 2 - runId ** 2)      // 런 양단 링
        + A * (p.branchOD ** 2 - brId ** 2);        // 분기 끝 링
    }
    case 'cavity_block': {
      // 겉면 6 + 공동 내벽. 공동은 어휘 하나를 품으므로 **그 어휘의 겉넓이 규칙**을 재사용한다.
      const outer = 2 * (p.blockW * p.blockD + p.blockD * p.blockH + p.blockW * p.blockH);
      const c = p.cavity;
      if (!c?.type) return outer;
      const inner = surfaceMm2(c.type, c.params ?? {});
      // 공동 입구 면적은 겉면에서 빠지고 내벽이 더해진다 — 원통 공동이면 양 끝면은 제외.
      return inner == null ? outer : outer + inner;
    }
    case 'pillow_block': {
      /**
       * 필로우 블록 — 외형 상자 겉면 + 보어 내벽. 실형상(라운드·앵커홀)은 미반영이며
       * 그만큼 **과대**다(도장 물량은 안전측). 그 사실을 적는다.
       */
      const outer = 2 * (p.width * p.depth + p.depth * p.height + p.width * p.height);
      return outer + Math.PI * p.boreDia * p.depth;
    }
    case 'extrude_profile': {
      const poly = extrudePoly(p);
      const holes = expandHoles(p.holes);
      const holeArea = holes.reduce((sum, h) => sum + (Math.PI / 4) * Number(h.d) ** 2, 0);
      // 260801: 홀 내벽도 **단일 소스**(`holeWallArea`) — 카운터보어 벽·바닥링·싱크 원뿔면 포함.
      const holeWall = holes.reduce((sum, h) => sum + holeWallArea(h, Number(p.depth)), 0);
      return 2 * Math.max(0, Math.abs(polyArea(poly)) - holeArea) + polyPerimeter(poly) * Number(p.depth) + holeWall;
    }
    case 'wall_with_openings': {
      const face = p.length * p.height - (p.openings ?? []).reduce((s, o) => s + o.w * o.h, 0);
      return 2 * face + 2 * (p.length + p.height) * p.thickness; // 양면(개구 공제) + 둘레 엣지
    }
    case 'slab_with_openings': {
      const face = p.length * p.depth - (p.openings ?? []).reduce((s, o) => s + o.w * o.d, 0);
      // 상·하면(개구 공제) + 외주 엣지 + **개구 내주 엣지**(거푸집·마감이 실제로 붙는 면)
      const innerEdge = (p.openings ?? []).reduce((s, o) => s + 2 * (o.w + o.d) * p.thickness, 0);
      return 2 * face + 2 * (p.length + p.depth) * p.thickness + innerEdge;
    }
    // 표준 부품 확장(260718b)
    case 'hex_nut': {
      const hexA = (Math.sqrt(3) / 2) * p.af ** 2;
      return 2 * (hexA - A * (p.boreDia ?? 0) ** 2) + polyPerimeter(hexPts(p.af)) * p.thickness + Math.PI * (p.boreDia ?? 0) * p.thickness;
    }
    case 'washer': return 2 * A * (p.outerDia ** 2 - p.boreDia ** 2) + Math.PI * (p.outerDia + p.boreDia) * p.thickness;
    case 'angle': return (2 * p.legA + 2 * p.legB - p.thickness) * p.length + 2 * (p.legA + p.legB - p.thickness) * p.thickness; // L 둘레×길이 + 단부 2
    case 'tee_section': return (2 * p.B + 2 * p.H) * p.length + 2 * (p.B * p.tf + p.tw * (p.H - p.tf)); // T 둘레(2B+2H)×길이 + 단부 2
    case 'pipe_reducer': {
      const t = p.wallThk ?? Math.max(2, p.dia1 * 0.03), sl = Math.hypot(p.length, (p.dia1 - p.dia2) / 2);
      return Math.PI * ((p.dia1 + p.dia2) / 2) * sl + Math.PI * ((p.dia1 - 2 * t + p.dia2 - 2 * t) / 2) * sl + A * (p.dia1 ** 2 - (p.dia1 - 2 * t) ** 2 + p.dia2 ** 2 - (p.dia2 - 2 * t) ** 2);
    }
    // ── 260729 보충: 폐형이 서는 어휘 전부 ────────────────────────────────────
    // 형강(I·C) 전개둘레 = 4B + 2H − 2tw (윤곽 추적 결과 I·C 동일 — 펼친 길이가 같다).
    case 'h_section': case 'c_channel':
      return (4 * p.B + 2 * p.H - 2 * p.tw) * p.length + 2 * (2 * p.B * p.tf + p.tw * (p.H - 2 * p.tf));
    case 'i_girder': { // 조립 거더(상·하 플랜지 폭 상이) — 같은 윤곽 추적
      // ─ 웹 공제는 **1회**이다 — 플랜지 노출 가단이 양쪽 합해서 (W−webT) 이므로.
      //   처음 −2·webT 로 썼다가 tapered_girder(등단면) 대조에서 걸렸다.
      //   검증: 평열 플랜지면 4B+2H−2tw 로 환원 → h_section 식·KS 형강표와 일치.
      const perim = 2 * (p.botW + p.topW - p.webT + p.botT + p.topT + p.webH);
      const sec = p.botW * p.botT + p.webT * p.webH + p.topW * p.topT;
      return perim * p.length + 2 * sec;
    }
    case 'tapered_girder': {
      // 변단면은 둘레가 스팬을 따라 변한다 → 성분별 실면적(접촉면 공제).
      const h1 = p.webH1, h2 = p.webH2, L = p.length;
      const s = Math.hypot(L, h2 - h1); // 상부 플랜지 경사면의 실장
      const web2 = 2 * (L * (h1 + h2) / 2);                       // 웨브 양면(사다리꼴)
      const botBox = L * p.botW + L * (p.botW - p.webT)           // 하면 + 상면(웨브 접촉 공제)
        + 2 * L * p.botT + 2 * p.botW * p.botT;                   // 측면 2 + 단부 2
      const webEnds = (h1 + h2) * p.webT;                          // 웨브 단부 2
      const top = 2 * (L * p.topT) + s * p.topW                    // 측면 2 + 상면(경사)
        + s * (p.topW - p.webT) + 2 * p.topT * p.topW;             // 하면(웨브 접촉 공제) + 단부 2
      return botBox + web2 + webEnds + top;
    }
    case 'rebar': { // 원형 봉 — 경로장 × 원주 + 단부 2
      let L = 0;
      const pts = p.points ?? [];
      for (let k = 0; k < pts.length - 1; k++) L += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1], pts[k + 1][2] - pts[k][2]);
      return Math.PI * p.dia * L + 2 * A * p.dia ** 2;
    }
    case 'coil_spring': { // 소선 전개장 × 원주 + 단부 2
      const Dm = p.coilDia - p.wireDia;
      const Lw = p.turns * Math.hypot(Math.PI * Dm, p.pitch);
      return Math.PI * p.wireDia * Lw + 2 * A * p.wireDia ** 2;
    }
    case 'pipe_elbow': { // 파푸스 — 곡률중심 이동거리 × 내·외 원주 + 절단 단면 2
      const t = p.wallThk ?? Math.max(2, p.od * 0.05);
      const id = p.od - 2 * t;
      const arc = 2 * Math.PI * p.bendR * ((p.angleDeg ?? 90) / 360);
      return arc * Math.PI * (p.od + id) + 2 * A * (p.od ** 2 - id ** 2);
    }
    /**
     * 회전체 표면적 — **파푸스 제1정리**(폐형). 260729b.
     *
     * 부피는 파푸스 제2정리(2π·r̄·A)로 이미 폐형이 서 있었는데 표면적만 미산출로 남아
     * 있었다. 같은 정리의 짝이라 함께 설 수 있다:
     *   측면적 = 2π · r̄_line · L_line  (프로파일 **윤곽선**의 도심·길이 — 면이 아니다)
     * 회전축(r=0)에 붙은 세그먼트는 회전해도 면적이 0 이므로 자연히 빠진다.
     * 부분 회전(angleDeg<360)이면 **절단 단면 2장**을 더한다.
     */
    case 'revolve': {
      const prof = p.profile ?? [];
      if (prof.length < 3) return null;
      let lineMoment = 0, lineLen = 0, area2 = 0;
      for (let i = 0; i < prof.length; i++) {
        const [r1, z1] = prof[i], [r2, z2] = prof[(i + 1) % prof.length];
        const seg = Math.hypot(r2 - r1, z2 - z1);
        lineLen += seg;
        lineMoment += ((r1 + r2) / 2) * seg;   // 세그먼트 도심 r × 길이
        area2 += r1 * z2 - r2 * z1;
      }
      if (!(lineLen > 0)) return null;
      const frac = Math.min(360, Math.max(1, Number(p.angleDeg) || 360)) / 360;
      const lateral = 2 * Math.PI * lineMoment * frac;   // = 2π·r̄·L (r̄=lineMoment/lineLen)
      const capArea = Math.abs(area2) / 2;
      return lateral + (frac < 1 ? 2 * capArea : 0);
    }
    /**
     * ★260802 — **메시에 선언 채널이 생겼다.** 종전 주석은 「메시 실면적은 삼각형 합으로
     *   낼 수 있으나 `volumeMm3` 같은 선언 채널이 없어 지어내지 않는다」였다.
     *   그런데 커널 임포트(`stepKernelImport`)가 이제 **`areaMm2` 를 정확값으로 싣는다**
     *   (기준 형상 실측 오차 0.000000%). **있는 것을 안 쓰고 「미산출」이라 적는 것**은
     *   이 세션 내내 잡아 온 형태 ①(있는 것이 안 닿음)이다.
     * ⚠ **선언돼 있을 때만** 쓴다. 없으면 종전대로 미산출이다 — 삼각형 합을 여기서
     *   다시 계산하지 않는다(정점이 없는 메시 부품도 있고, 커널 값이 더 정확하다).
     */
    case 'mesh':
      return Number(p?.areaMm2) > 0 ? Number(p.areaMm2) : null;
    // ⚠ 아래는 폐형이 서지 않는다 — **0 이 아니라 미산출**(computeBOQ 가 이름으로 고지).
    //   composite(접촉면 미상) · revolve 일부(임의 형상).
    default: return null;
  }
}
// 260801: 패턴을 펼친 **실제 가공 회차**를 센다 — 선언 1건이 홀 6개일 수 있다.
// 260801b: 복합 부품은 **하위의 홀을 합산**한다 — 안 세면 드릴 공수가 0 으로 나간다.
const holeCount = (type, p) => type === 'composite'
  ? (p.subs ?? []).reduce((n, sb) => n + holeCount(sb.type, sb.params ?? {}), 0)
  : type === 'plate_with_holes' || type === 'extrude_profile' ? expandHoles(p.holes).length : type === 'flange' ? (p.boltCount ?? 0) : type === 'base_plate' ? 4 : type === 'spur_gear' && p.boreDia > 0 ? 1 : type === 'hex_nut' || type === 'washer' ? 1 : 0;
const bendCount = (type, p) => type === 'bent_sheet' ? 2 : type === 'l_bracket' ? 1 : type === 'angle' ? 1 : type === 'sheet_profile' ? (p?.angles ?? []).filter((a) => a !== 0).length : 0;
const isLinear = (type) => type === 'rect_tube' || type === 'tube' || type === 'cylinder' || type === 'angle' || type === 'tee_section';
const linearLenMm = (type, p) => type === 'rect_tube' || type === 'tube' ? p.length : type === 'cylinder' ? p.length : type === 'angle' || type === 'tee_section' ? p.length : 0;

// 표준 원단위 (hr/단위) — 개산 가정. 사용자/현장 조정 대상.
export const STD_RATES = { weldPerM: 0.15, drillPerHole: 0.03, bendPerBend: 0.10, assyPerPart: 0.20, surfacePerM2: 0.12, cutPerCut: 0.05 };

/** 어셈블리 → 물량·작업량 (금액 제외). 비기계 도메인은 부피(재적 m³) 중심 물량. */
export function computeBOQ(assembly, { material = 'STS316', rates = STD_RATES } = {}) {
  const built = buildAssembly(assembly);
  const parts = assembly.parts ?? [];
  const items = parts.map((p) => {
    const rho = (DENSITY[p.material ?? material] ?? DENSITY.STS316) / 1e9;
    // F1·F12(260719b): 질량·재적은 structural 과 **같은 소스**(실단면 보정)를 본다 —
    // 발주 규격 라벨(각관)과 질량(통짜)이 한 페이지에서 어긋나던 자기모순을 구조적으로 차단.
    const eff = partVolumeEffective(p);
    const volMm3 = eff.volumeMm3;
    // qty(260718): 동일 부품 반복 수(대표 1개 배치 — STEP 대표화 임포트). 물량=1개분×qty.
    const qty = Math.max(1, Math.round(Number(p.qty) || 1));
    const massKg = volMm3 * rho * qty;
    const sMm2 = surfaceMm2(p.type, p.params);
    return { id: p.id ?? p.type, type: p.type, material: p.material ?? material, qty, massKg: +massKg.toFixed(2), basis: eff.basis, basisNote: eff.note, volM3: +(volMm3 * qty / 1e9).toFixed(4), surfaceM2: sMm2 == null ? null : +(sMm2 * qty / 1e6).toFixed(3), holes: holeCount(p.type, p.params) * qty, bends: bendCount(p.type, p.params) * qty, linearLenM: +(linearLenMm(p.type, p.params) * qty / 1000).toFixed(2) };
  });
  // 재질별 집계 (콘크리트 m³·목재 재적 m³ 등 비기계 물량 단위)
  const byMaterial = {};
  for (const it of items) {
    const k = it.material;
    byMaterial[k] = byMaterial[k] ?? { massKg: 0, volM3: 0, surfaceM2: 0, count: 0 };
    byMaterial[k].massKg = +(byMaterial[k].massKg + it.massKg).toFixed(1);
    byMaterial[k].volM3 = +(byMaterial[k].volM3 + it.volM3).toFixed(4);
    byMaterial[k].surfaceM2 = +(byMaterial[k].surfaceM2 + (it.surfaceM2 ?? 0)).toFixed(2);
    byMaterial[k].count++;
  }
  const sum = (k) => items.reduce((s, x) => s + (x[k] || 0), 0);
  const totalMassKg = +sum('massKg').toFixed(1);
  const surfaceM2 = +sum('surfaceM2').toFixed(2);
  // 표면적 미산출 어휘는 합계에서 **빠져 있다** — 합계만 보면 전부 산출된 것으로 읽힌다.
  const surfaceMissing = [...new Set(items.filter((x) => x.surfaceM2 == null).map((x) => x.type))];
  const tubeLenM = +items.filter(x => x.linearLenM).reduce((s, x) => s + x.linearLenM, 0).toFixed(2);
  const holes = sum('holes'), bends = sum('bends');
  const cutCount = parts.filter(p => isLinear(p.type)).length * 2 + parts.filter(p => ['plate_with_holes', 'stepped_plate', 'base_plate', 'l_bracket', 'gusset', 'bent_sheet', 'sheet_profile', 'spur_gear', 'extrude_profile'].includes(p.type)).length;
  const weldTotalMm = built.ok ? (built.weldTotalMm ?? 0) : 0;
  const weldJoints = built.ok ? (built.welds?.length ?? 0) : 0;
  const weldAreaMm2 = built.ok ? (built.welds ?? []).reduce((s, w) => s + (Number(w.throatAreaMm2) || 0), 0) : 0;

  // 배관 물량(#6 확산) — 라우트 길이는 형상(라우터) 결정론이라 물량 산출 가능(날조 아님).
  // 부속류(엘보 개소만 계상)·행거·보온은 미포함 명시.
  let piping = null;
  if (built.ok && built.pipes && built.pipes.routes.length) {
    const segLen = (pts) => { let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]); return L; };
    // 티 계상(잔여후보 ④): 한 라인 끝점이 다른 라인 세그먼트 위(끝점 아님)에 접속 = 티.
    // 이경 접속(관경 상이)=이경 티로 함께 계상(리듀서 상세 후속 명시).
    const p2s = (P, A, B) => { // 점-세그먼트 거리
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * ab[0] + (P[1] - A[1]) * ab[1] + (P[2] - A[2]) * ab[2]) / Math.max(1e-9, ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
      const q = [A[0] + ab[0] * t, A[1] + ab[1] * t, A[2] + ab[2] * t];
      return { d: Math.hypot(P[0] - q[0], P[1] - q[1], P[2] - q[2]), t };
    };
    let tees = 0, reducingTees = 0;
    const rts = built.pipes.routes;
    for (const a of rts) {
      for (const P of [a.pts[0], a.pts[a.pts.length - 1]]) {
        for (const b of rts) {
          if (b === a) continue;
          const endNear = [b.pts[0], b.pts[b.pts.length - 1]].some((E) => Math.hypot(P[0] - E[0], P[1] - E[1], P[2] - E[2]) <= (a.d + b.d));
          if (endNear) continue; // 끝점-끝점 = 티 아님(직결/엘보)
          let hit = false;
          for (let i = 0; i < b.pts.length - 1 && !hit; i++) hit = p2s(P, b.pts[i], b.pts[i + 1]).d <= (a.d + b.d) / 2 + 2;
          if (hit) { tees++; if (a.d !== b.d) reducingTees++; break; }
        }
      }
    }
    const lines = built.pipes.routes.map((r) => ({ label: r.label, service: r.service ?? '-', dn: r.d, lengthM: +(segLen(r.pts) / 1000).toFixed(2), elbows: Math.max(0, r.pts.length - 2) }));
    const byService = {};
    for (const l of lines) {
      byService[l.service] = byService[l.service] ?? { lengthM: 0, lines: 0 };
      byService[l.service].lengthM = +(byService[l.service].lengthM + l.lengthM).toFixed(2);
      byService[l.service].lines++;
    }
    piping = {
      lines, byService,
      totalM: +lines.reduce((s, l) => s + l.lengthM, 0).toFixed(2),
      elbows: lines.reduce((s, l) => s + l.elbows, 0),
      tees, reducingTees,
      sleeves: built.pipes.sleeves?.length ?? 0,
      unrouted: built.pipes.errors.length,
    };
  }

  const labor = {
    용접: +((weldTotalMm / 1000) * rates.weldPerM).toFixed(1),
    절단: +(cutCount * rates.cutPerCut).toFixed(1),
    드릴: +(holes * rates.drillPerHole).toFixed(1),
    절곡: +(bends * rates.bendPerBend).toFixed(1),
    조립: +(parts.length * rates.assyPerPart).toFixed(1),
    표면처리: +(surfaceM2 * rates.surfacePerM2).toFixed(1),
  };
  labor.합계 = +Object.values(labor).reduce((s, v) => s + v, 0).toFixed(1);

  return {
    parts: parts.length, items, byMaterial, totalMassKg, totalVolM3: +sum('volM3').toFixed(3), surfaceM2, tubeLenM, holes, bends, cutCount,
    ...(surfaceMissing.length ? { surfaceMissing } : {}),
    weld: { totalMm: weldTotalMm, totalM: +(weldTotalMm / 1000).toFixed(2), joints: weldJoints, throatAreaMm2: Math.round(weldAreaMm2) },
    piping,
    laborHr: labor,
    note: '물량=형상 결정론 · 공수=표준 원단위×물량(개산) · 금액 미산출(실단가 없으면 날조).',
  };
}

// 배관 물량 섹션 HTML (mech·비기계 공용) — piping 없으면 빈 문자열.
function pipingSection(b, headNo) {
  if (!b.piping) return '';
  const rows = b.piping.lines.map((l) => `<tr><td style="text-align:left">${esc(l.label)}</td><td>${esc(l.service)}</td><td>DN${l.dn}</td><td>${l.lengthM}</td><td>${l.elbows}</td></tr>`).join('');
  return `<h2>${headNo} 배관 물량 (자동 라우팅 실측)</h2>
<table><tr><th>라인</th><th>계통</th><th>관경</th><th>길이(m)</th><th>엘보</th></tr>${rows}
<tr style="font-weight:700;background:#f8fafc"><td colspan="3">합계</td><td>${b.piping.totalM}</td><td>${b.piping.elbows}</td></tr></table>
<div class="note">라우트 길이=결정론 실측 · 티 ${b.piping.tees}개소(이경 티 ${b.piping.reducingTees} 포함 — 리듀서 상세 후속) · 관통 슬리브 ${b.piping.sleeves}개소 · 행거·보온·구배 여유 미포함${b.piping.unrouted ? ` · ⚠미라우팅 ${b.piping.unrouted}라인(물량 제외)` : ''}.</div>`;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
/**
 * BOQ HTML 리포트 (인쇄양식). 금액 없음 — 물량·용접·가공·공수만.
 * 비기계 도메인(building/landscape/interior/civil)은 재적(m³) 중심 물량표 —
 * 용접·드릴·공수(금속가공 원단위)는 표시하지 않는다(분야 원단위 없이 공수 산출=날조).
 */
export function boqReport(assembly, { title = '물량·작업량 산출서', rates, domain } = {}) {
  const b = computeBOQ(assembly, rates ? { rates } : {});
  const dom = domain ?? assembly.domain ?? 'mech';
  const nonMech = ['building', 'landscape', 'interior', 'civil', 'bridge'].includes(dom);
  const f = (n, d = 2) => (n == null ? '—' : Number(n).toFixed(d)); // null=미산출 — NaN도 0도 아니다
  // 표면적 미산출 고지 — 합계에서 빠졌다는 사실을 숫자 옆에 붙인다(·0 으로 읽힐 여지 제거).
  const missNote = b.surfaceMissing?.length
    ? ` · <b>⚠ 표면적 미산출</b>: ${b.surfaceMissing.map(esc).join('·')} — 폐형이 서지 않는 어휘라 해당 부품은 도장 물량 합계에 **빠져 있다**(0이 아니라 모름).`
    : '';
  const rows = b.items.map((x) => `<tr><td style="text-align:left">${esc(x.id)}</td><td>${esc(x.type)}</td><td>${esc(x.material)}</td><td>${f(x.massKg)}</td><td>${f(x.surfaceM2, 3)}</td><td>${x.linearLenM || '-'}</td><td>${x.holes || '-'}</td><td>${x.bends || '-'}</td></tr>`).join('');
  const laborRows = Object.entries(b.laborHr).filter(([k]) => k !== '합계').map(([k, v]) => `<tr><td style="text-align:left">${k}</td><td>${v} hr</td></tr>`).join('');
  if (nonMech) {
    const matRows = Object.entries(b.byMaterial).map(([m, v]) => `<tr><td style="text-align:left">${esc(m)}</td><td>${v.count}</td><td>${f(v.volM3, 3)}</td><td>${f(v.massKg, 1)}</td><td>${f(v.surfaceM2)}</td></tr>`).join('');
    const nmRows = b.items.map((x) => `<tr><td style="text-align:left">${esc(x.id)}</td><td>${esc(x.type)}</td><td>${esc(x.material)}</td><td>${f(x.volM3, 4)}</td><td>${f(x.massKg)}</td><td>${f(x.surfaceM2, 3)}</td></tr>`).join('');
    // C2: 규칙 기반 형상-밖 물량(터파기·거푸집·되메우기…) — 수량 룰엔진(civilTakeoff 메타) 합본, 산출근거 전항목 공개
    let ruleSection = '';
    if (Array.isArray(assembly.civilTakeoff) && assembly.civilTakeoff.length) {
      try {
        const to = takeoff(assembly.civilTakeoff);
        const ruleRows = to.elements.flatMap((el) => el.items.map((it) =>
          `<tr><td style="text-align:left">${esc(el.elementId)}</td><td style="text-align:left">${esc(it.item)}</td><td>${esc(it.spec)}</td><td>${it.qty}</td><td>${esc(it.unit)}</td><td style="text-align:left;font-size:10px;color:#64748b">${esc(it.basis)}</td></tr>`)).join('');
        const assum = to.elements.flatMap((el) => el.assumptions ?? []);
        ruleSection = `<h2>③ 규칙 물량 (토공·거푸집 — 수량 룰엔진)</h2>
<table><tr><th>요소</th><th>항목</th><th>규격</th><th>수량</th><th>단위</th><th>산출근거</th></tr>${ruleRows}</table>
${assum.length ? `<div class="note">가정: ${assum.map(esc).join(' · ')}</div>` : ''}`;
      } catch { ruleSection = ''; }
    }
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.nf-print-bar{position:sticky;top:0;z-index:9;background:#1f2937;color:#fff;padding:7px 16px;font-size:12.5px;display:flex;gap:12px;align-items:center}.nf-print-bar button{background:#2563eb;color:#fff;border:0;padding:5px 13px;border-radius:6px;cursor:pointer}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
h2{font-size:14px;margin:18px 24px 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}table{border-collapse:collapse;margin:6px 24px;font-size:11.5px;width:calc(100% - 48px)}td,th{border:1px solid #cbd5e1;padding:4px 8px;text-align:center}th{background:#f1f5f9}
.kpi{display:flex;gap:8px;flex-wrap:wrap;margin:10px 24px}.kpi div{flex:1;min-width:100px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px}.kpi b{display:block;font-size:17px;color:#2563eb}.kpi span{font-size:10.5px;color:#64748b}
.honest{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;margin:8px 24px;padding:8px 14px;font-size:11.5px;color:#92400e}.note{font-size:11px;color:#94a3b8;padding:6px 24px}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body><div class="nf-print-bar"><b>물량 산출서 (BOQ) — ${esc(dom)}</b><button onclick="print()">🖨 인쇄 / PDF</button></div>
<div class="sheet"><div class="hd"><h1>${esc(title)} — 물량 산출서 (BOQ)</h1><div class="s">nexyfab · 형상기반 물량 결정론 산출 · 분야 ${esc(dom)} · 금액 미산출(비법정)</div></div>
<div class="honest">⚠ <b>금액(₩)·공수는 산출하지 않습니다</b> — 이 분야의 실단가·표준품셈 데이터 없이는 날조이기 때문. <b>물량(부피·질량·표면적)은 형상에서 확정</b>. 철근·마감·기초 등 형상 밖 물량은 미포함(별도 산정 대상).</div>
<div class="kpi"><div><b>${f(b.totalVolM3, 2)} m³</b><span>총 부피(재적)</span></div><div><b>${(b.totalMassKg / 1000).toFixed(1)} t</b><span>총 질량</span></div><div><b>${b.surfaceM2} ㎡</b><span>표면적(거푸집·마감 개산)</span></div><div><b>${b.parts}</b><span>부재 수</span></div></div>
<h2>① 재질별 집계</h2><table><tr><th>재질</th><th>부재</th><th>부피(m³)</th><th>질량(kg)</th><th>표면적(㎡)</th></tr>${matRows}</table>
<h2>② 부재별 물량</h2><table><tr><th>부재</th><th>Type</th><th>재질</th><th>부피(m³)</th><th>질량(kg)</th><th>표면적(㎡)</th></tr>${nmRows}</table>
${pipingSection(b, '②b')}
${ruleSection}
<div class="note">⚠ 물량=형상 결정론(신뢰) · 규칙 물량=설계수량(표준품셈 할증·품 미적용) · 표면적=거푸집/도장/마감 개산(공제 미반영) · 철근·배근·마감재는 형상 외 — 미산출 · 비법정 참고자료.${assembly.alignment ? ' · <b>선형 주의</b>: 부재별 물량=현(chord) 분할 부품 기준(접합 트림 포함), 규칙 물량=중심선 호장 기준 — 두 기준 차이(트림·현 근사)는 정상이며 정밀 콘크리트량은 규칙 물량이 기준.' : ''}${missNote}</div>
<div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div><script>
// H5 현장 인터랙션(260718): th 클릭 정렬 · 행 체크오프(localStorage) · CSV 내보내기
document.querySelectorAll('table').forEach(function(tb,ti){
  var head=tb.tHead; if(!head||!tb.tBodies[0])return;
  Array.prototype.forEach.call(head.rows[0].cells,function(th,ci){
    th.style.cursor='pointer'; th.title='클릭=정렬';
    th.onclick=function(){
      var rows=Array.prototype.slice.call(tb.tBodies[0].rows);
      var asc=th.dataset.asc!=='1'; th.dataset.asc=asc?'1':'0';
      rows.sort(function(a,b2){var x=a.cells[ci]?a.cells[ci].textContent:'',y=b2.cells[ci]?b2.cells[ci].textContent:'';var nx=parseFloat(x.replace(/[^\d.-]/g,'')),ny=parseFloat(y.replace(/[^\d.-]/g,''));return (isFinite(nx)&&isFinite(ny)?nx-ny:x.localeCompare(y))*(asc?1:-1)});
      rows.forEach(function(r){tb.tBodies[0].appendChild(r)});
    };
  });
  var key='nf-boq-'+location.pathname+'-'+ti;
  var saved={}; try{saved=JSON.parse(localStorage.getItem(key)||'{}')}catch(e){}
  Array.prototype.forEach.call(tb.tBodies[0].rows,function(r,ri){
    var td=r.insertCell(0); var cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!!saved[ri];
    cb.onchange=function(){saved[ri]=cb.checked;localStorage.setItem(key,JSON.stringify(saved));r.style.opacity=cb.checked?0.45:1};
    if(cb.checked)r.style.opacity=0.45; td.appendChild(cb);
  });
  if(head.rows[0]){var th0=head.rows[0].insertCell?null:null; var thEl=document.createElement('th'); thEl.textContent='✓'; head.rows[0].insertBefore(thEl, head.rows[0].cells[0]);}
});
var btn=document.createElement('button'); btn.textContent='⬇ CSV 내보내기'; btn.style.cssText='position:fixed;right:16px;bottom:16px;background:#2563eb;color:#fff;border:0;padding:8px 14px;border-radius:8px;cursor:pointer;z-index:99';
btn.onclick=function(){var t=document.querySelector('table');if(!t)return;var csv=Array.prototype.map.call(t.rows,function(r){return Array.prototype.map.call(r.cells,function(c){return '"'+c.textContent.replace(/"/g,'""')+'"'}).join(',')}).join('
');var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));a.download='BOQ.csv';a.click()};
document.body.appendChild(btn);
</script></body></html>`;
  }
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.nf-print-bar{position:sticky;top:0;z-index:9;background:#1f2937;color:#fff;padding:7px 16px;font-size:12.5px;display:flex;gap:12px;align-items:center}.nf-print-bar button{background:#2563eb;color:#fff;border:0;padding:5px 13px;border-radius:6px;cursor:pointer}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
h2{font-size:14px;margin:18px 24px 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}table{border-collapse:collapse;margin:6px 24px;font-size:11.5px;width:calc(100% - 48px)}td,th{border:1px solid #cbd5e1;padding:4px 8px;text-align:center}th{background:#f1f5f9}
.kpi{display:flex;gap:8px;flex-wrap:wrap;margin:10px 24px}.kpi div{flex:1;min-width:100px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px}.kpi b{display:block;font-size:17px;color:#2563eb}.kpi span{font-size:10.5px;color:#64748b}
.honest{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;margin:8px 24px;padding:8px 14px;font-size:11.5px;color:#92400e}.note{font-size:11px;color:#94a3b8;padding:6px 24px}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body><div class="nf-print-bar"><b>물량·작업량 산출서 (BOQ)</b><button onclick="print()">🖨 인쇄 / PDF</button></div>
<div class="sheet"><div class="hd"><h1>${esc(title)} — 물량·작업량 산출서 (BOQ)</h1><div class="s">nexyfab · 형상기반 물량 결정론 산출 · 금액 미산출(비법정)</div></div>
<div class="honest">⚠ <b>금액(₩)은 산출하지 않습니다</b> — 실 자재단가·노임·지역·시점 데이터 없이는 날조이기 때문. <b>물량은 형상에서 확정</b>, <b>공수(hr)는 표준 원단위×물량 개산</b>(현장 조정 대상). 자재단가를 입력하면 그때만 금액 계산(입력단가 기준).</div>
<div class="kpi"><div><b>${b.totalMassKg} kg</b><span>총 자재 질량</span></div><div><b>${b.surfaceM2} ㎡</b><span>표면적(도장·산세)</span></div><div><b>${b.weld.totalM} m</b><span>총 용접선(${b.weld.joints}조인트)</span></div><div><b>${b.laborHr.합계} hr</b><span>공수 합계(개산)</span></div></div>
<h2>① 부품별 물량</h2><table><tr><th>부품</th><th>Type</th><th>재질</th><th>질량(kg)</th><th>표면적(㎡)</th><th>길이(m)</th><th>홀</th><th>절곡</th></tr>${rows}
<tr style="font-weight:700;background:#f8fafc"><td colspan="3">합계 (${b.parts}부품)</td><td>${b.totalMassKg}</td><td>${b.surfaceM2}</td><td>${b.tubeLenM || '-'}</td><td>${b.holes || '-'}</td><td>${b.bends || '-'}</td></tr></table>
<h2>② 용접·가공 물량</h2><table><tr><th>항목</th><th>물량</th></tr>
<tr><td>용접선 길이</td><td>${b.weld.totalM} m (${b.weld.totalMm} mm)</td></tr><tr><td>용접 조인트</td><td>${b.weld.joints} 개</td></tr><tr><td>용접 목두께 면적</td><td>${b.weld.throatAreaMm2.toLocaleString()} mm²</td></tr>
<tr><td>절단</td><td>${b.cutCount} 회</td></tr><tr><td>드릴 홀</td><td>${b.holes} 개</td></tr><tr><td>절곡</td><td>${b.bends} 회</td></tr></table>
${pipingSection(b, '②b')}
<h2>③ 공수 (표준 원단위 개산, hr)</h2><table><tr><th>작업</th><th>공수</th></tr>${laborRows}<tr style="font-weight:700;background:#f8fafc"><td>합계</td><td>${b.laborHr.합계} hr</td></tr></table>
<div class="note">⚠ 물량=형상 결정론(신뢰) · 공수=표준 원단위(용접 ${STD_RATES.weldPerM}h/m·드릴 ${STD_RATES.drillPerHole}h/홀 등) 개산 → 현장/작업방식 따라 조정 · 금액 미산출 · 용접량은 AABB 접촉 개산(정밀은 조인트 선언 후속).${missNote}</div>
<div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div><script>
// H5 현장 인터랙션(260718): th 클릭 정렬 · 행 체크오프(localStorage) · CSV 내보내기
document.querySelectorAll('table').forEach(function(tb,ti){
  var head=tb.tHead; if(!head||!tb.tBodies[0])return;
  Array.prototype.forEach.call(head.rows[0].cells,function(th,ci){
    th.style.cursor='pointer'; th.title='클릭=정렬';
    th.onclick=function(){
      var rows=Array.prototype.slice.call(tb.tBodies[0].rows);
      var asc=th.dataset.asc!=='1'; th.dataset.asc=asc?'1':'0';
      rows.sort(function(a,b2){var x=a.cells[ci]?a.cells[ci].textContent:'',y=b2.cells[ci]?b2.cells[ci].textContent:'';var nx=parseFloat(x.replace(/[^\d.-]/g,'')),ny=parseFloat(y.replace(/[^\d.-]/g,''));return (isFinite(nx)&&isFinite(ny)?nx-ny:x.localeCompare(y))*(asc?1:-1)});
      rows.forEach(function(r){tb.tBodies[0].appendChild(r)});
    };
  });
  var key='nf-boq-'+location.pathname+'-'+ti;
  var saved={}; try{saved=JSON.parse(localStorage.getItem(key)||'{}')}catch(e){}
  Array.prototype.forEach.call(tb.tBodies[0].rows,function(r,ri){
    var td=r.insertCell(0); var cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!!saved[ri];
    cb.onchange=function(){saved[ri]=cb.checked;localStorage.setItem(key,JSON.stringify(saved));r.style.opacity=cb.checked?0.45:1};
    if(cb.checked)r.style.opacity=0.45; td.appendChild(cb);
  });
  if(head.rows[0]){var th0=head.rows[0].insertCell?null:null; var thEl=document.createElement('th'); thEl.textContent='✓'; head.rows[0].insertBefore(thEl, head.rows[0].cells[0]);}
});
var btn=document.createElement('button'); btn.textContent='⬇ CSV 내보내기'; btn.style.cssText='position:fixed;right:16px;bottom:16px;background:#2563eb;color:#fff;border:0;padding:8px 14px;border-radius:8px;cursor:pointer;z-index:99';
btn.onclick=function(){var t=document.querySelector('table');if(!t)return;var csv=Array.prototype.map.call(t.rows,function(r){return Array.prototype.map.call(r.cells,function(c){return '"'+c.textContent.replace(/"/g,'""')+'"'}).join(',')}).join('
');var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));a.download='BOQ.csv';a.click()};
document.body.appendChild(btn);
</script></body></html>`;
}
