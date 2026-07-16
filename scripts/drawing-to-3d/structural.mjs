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
import { partAabb, gearPoly, sheetPoly, polyArea, boltDims } from './reconstruct.mjs';

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
export function partVolume(type, p) {
  const A = Math.PI / 4;
  switch (type) {
    case 'box': return p.width * p.depth * p.height;
    case 'plate_with_holes': return p.width * p.depth * p.thickness;
    case 'stepped_plate': return p.stepWidth * p.depth * p.stepThickness + (p.width - p.stepWidth) * p.depth * p.thickness;
    case 'base_plate': return p.width * p.depth * p.thickness;
    case 'l_bracket': return (p.legA * p.width * p.thickness) + (p.thickness * p.width * p.legB);
    case 'bent_sheet': return p.length * p.webWidth * p.thickness + 2 * (p.length * p.thickness * p.flangeHeight);
    case 'flange': return A * (p.outerDia ** 2 - p.boreDia ** 2) * p.thickness;
    case 'tube': return A * (p.outerDia ** 2 - p.innerDia ** 2) * p.length;   // 중공
    case 'rect_tube': return (p.width * p.height - (p.width - 2 * p.wallThk) * (p.height - 2 * p.wallThk)) * p.length;
    // §8-② 형강 실단면(2026-07-16): 플랜지2 + 웨브 — AABB가 아닌 실단면적으로 질량·BOQ 정확
    case 'h_section': return (2 * p.B * p.tf + p.tw * (p.H - 2 * p.tf)) * p.length;
    case 'c_channel': return (2 * p.B * p.tf + p.tw * (p.H - 2 * p.tf)) * p.length;
    case 'cylinder': return A * p.diameter ** 2 * p.length;
    case 'gusset': return 0.5 * p.legA * p.legB * p.thickness;
    case 'spur_gear': return (polyArea(gearPoly(p)) - A * (p.boreDia ?? 0) ** 2) * p.thickness;
    case 'hex_bolt': {
      const { af, hh } = boltDims(p);
      return (Math.sqrt(3) / 2) * af ** 2 * hh + A * p.threadDia ** 2 * p.length; // 육각머리 + 자루
    }
    case 'sheet_profile': return polyArea(sheetPoly(p)) * p.width;
    case 'wall_with_openings': {
      const solid = p.length * p.thickness * p.height;
      const cut = (p.openings ?? []).reduce((s, o) => s + o.w * o.h * p.thickness, 0);
      return solid - cut;
    }
    case 'i_girder': return p.length * (p.botW * p.botT + p.webT * p.webH + p.topW * p.topT);
    default: return 0;
  }
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
    case 'hex_bolt': {
      const { af, hh } = boltDims(p);
      const Vs = A * p.threadDia ** 2 * p.length, Vh = (Math.sqrt(3) / 2) * af ** 2 * hh;
      const z = (Vs * (p.length / 2) + Vh * (p.length + hh / 2)) / (Vs + Vh);
      return [0, 0, z];
    }
    default: {
      // 대칭 타입(box·plate·flange·tube·cylinder·gear·wall(개구 무시 근사)·base_plate 등) = AABB 중심
      const a = partAabb({ type, ...p });
      return [(a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2, (a.min[2] + a.max[2]) / 2];
    }
  }
}

// 부품 월드 무게중심 (타입별 해석식 + 배치 이동. 회전 배치는 코너회전과 동일 규칙 미적용 — 축정렬 전제, 비대칭+회전 조합은 근사 명시)
export function partCG(part) {
  const { tx = 0, ty = 0, tz = 0 } = part.at ?? {};
  const c = localCG(part.type, part.params);
  return [c[0] + tx, c[1] + ty, c[2] + tz];
}

/**
 * @param assembly { parts:[{ id, type, params, at, material?, fluid? }] }
 * @param opts {
 *   defaultMaterial='STS316', fluidDensity='water',
 *   supports:[[x,y]...] (캐스터/다리 XY, mm) — 없으면 최하단 4모서리 추정,
 *   member:{ section:'SHS50x50x3', spanMm, loadKg } (최악 부재 검토; loadKg 없으면 상부질량/2),
 *   seismicG=0.5, materialFy=205, E=193000
 * }
 */
export function structuralCheck(assembly, opts = {}) {
  const dMat = opts.defaultMaterial ?? 'STS316';
  const fluidRho = DENSITY[opts.fluidDensity ?? 'water'] / 1e9; // kg/mm³
  const Fy = opts.materialFy ?? 205, E = opts.E ?? 193000, seismic = opts.seismicG ?? 0.5;

  const bodies = [];
  for (const part of assembly.parts ?? []) {
    const rho = (DENSITY[part.material ?? dMat] ?? DENSITY.STS316) / 1e9; // kg/mm³
    const vol = partVolume(part.type, part.params);
    let mass = vol * rho;
    if (part.fluid) mass += fluidVolume(part.type, part.params) * fluidRho;
    const cg = partCG(part);
    bodies.push({ id: part.id ?? part.type, mass, cg, role: part.role });
  }
  const totalMass = bodies.reduce((s, b) => s + b.mass, 0);
  const cg = [0, 1, 2].map(k => bodies.reduce((s, b) => s + b.mass * b.cg[k], 0) / (totalMass || 1));

  // 지지점 반력 (강체, 대칭 근사: CG 편심에 따른 분배)
  let supports = opts.supports;
  if (!supports || !supports.length) {
    // AABB 하단 4모서리 추정
    const xs = bodies.flatMap(b => [b.cg[0]]), ys = bodies.flatMap(b => [b.cg[1]]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    supports = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
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

  // 전도(tip-over)
  const baseShort = Math.min(sx1 - sx0, sy1 - sy0);
  const cgZ = cg[2];
  const tipAngleDeg = +(Math.atan((baseShort / 2) / cgZ) * 180 / Math.PI).toFixed(1);
  const seismicFS = +((baseShort / 2) / (seismic * cgZ)).toFixed(2);

  const warnings = [];
  if (tipAngleDeg < 15) warnings.push(`정적 전도각 ${tipAngleDeg}° < 15° — 전도 위험(CG 저감·폭 확대 필요)`);
  if (seismicFS < 1.5) warnings.push(`${seismic}g 측방 전도 FS ${seismicFS} < 1.5 — 아웃리거/앵커·CG 저감 필요`);
  if (member && !member.pass) warnings.push(`부재 ${member.section} 초과 — 단면 상향 필요`);

  return {
    totalMassKg: +totalMass.toFixed(1),
    cgWorldMm: cg.map(v => +v.toFixed(1)),
    cgHeightM: +(cgZ / 1000).toFixed(2),
    supports: supportLoads.map(l => ({ pos: l.pos, loadKg: +l.loadKg.toFixed(1) })),
    maxSupportKg: +maxSupport.toFixed(1),
    member,
    tipover: { staticAngleDeg: tipAngleDeg, seismicG: seismic, seismicFS },
    warnings,
    ok: warnings.length === 0,
    method: 'AABB 체적×밀도 질량 · 강체 반력 · 단순보 부재 · 강체 전도(근사, 비법정)',
  };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('structural.mjs');
if (isMain && process.argv[2]) {
  const { readFileSync } = await import('node:fs');
  const asm = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(structuralCheck(asm, { member: { section: 'SHS50x50x3', spanMm: 1300 } }), null, 2));
}
