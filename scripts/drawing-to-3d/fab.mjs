/**
 * fab.mjs — 제조 산출물: 판재 레이저 명세(결정론) + 예상비용(추정) + 절단 DXF (완벽화 Pillar ⑤).
 *
 * 정직 분리:
 *  - **명세(결정론)**: 절단길이·피어싱·면적·중량·절곡수를 형상에서 정확히 산출(추정 아님).
 *  - **비용(예상)**: 위 수치 × 편집 가능한 단가표 + 셋업 + 마진. "예상·참고"로 라벨.
 *  - **DXF**: 평판 외곽 + 홀 → 실제 레이저 절단용 2D 도면(진짜 사용 가능).
 * 판재 레이저 대상은 **평판(얇은 box)** 뿐 — 각관·용기(용접·압출)는 applicable:false로 정직 표기.
 * 실제 확정 견적은 RFQ·공장매칭(실 업체)로 — 여기 total은 예상.
 */

const STEEL_DENSITY = 7.85e-6; // kg/mm³ (연강 7850 kg/m³)
const CONCRETE_DENSITY = 2.4e-6; // kg/mm³ (2400 kg/m³)
const TIMBER_DENSITY = 5.0e-7;  // kg/mm³ (~500 kg/m³)
const PI = Math.PI;

/** 폴리곤 면적(shoelace, 절대값). */
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
/** 폴리곤 둘레. */
function polyPerim(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}
/** 피처 부피(mm³). revolve/sphere 등 미지원=0. */
function featVol(f) {
  if (f.kind === 'box' && Array.isArray(f.size)) return f.size[0] * f.size[1] * f.size[2];
  if (f.kind === 'extrude' && Array.isArray(f.profile) && f.height > 0) return polyArea(f.profile) * f.height;
  if (f.kind === 'cylinder' && f.diameter > 0 && f.height > 0) return PI * (f.diameter / 2) ** 2 * f.height;
  return 0;
}
/** intent 순부피(mm³) = 솔리드 − subtract. */
function volumeOf(intent) {
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  let v = 0;
  for (const f of feats) v += (f.op === 'subtract' ? -1 : 1) * featVol(f);
  return Math.max(0, v);
}
/** 프리즘 부재의 거푸집(측면) 면적 mm² ≈ 단면 둘레 × 길이. */
function formworkArea(intent) {
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  const outer = feats.find((f) => f.op !== 'subtract');
  if (!outer) return 0;
  if (outer.kind === 'box') {
    const s = outer.size, li = s.indexOf(Math.max(...s));
    const face = s.filter((_, i) => i !== li);
    return 2 * (face[0] + face[1]) * s[li];
  }
  if (outer.kind === 'extrude') return polyPerim(outer.profile) * outer.height;
  return 0;
}

/** 기본 단가표(대략치 · 반드시 편집·업체 확정 전제). KRW. */
export const DEFAULT_RATES = {
  materialPerKg: 2500,   // 소재 ₩/kg (강재, 시세 변동)
  cutPerM: 2000,         // 레이저 절단 ₩/m
  piercePerHole: 100,    // 피어싱 ₩/개
  bendPerOp: 500,        // 절곡 ₩/회
  cutPerCut: 1500,       // 강재 부재 절단 ₩/회(양단)
  setup: 20000,          // 셋업 ₩(고정)
  marginPct: 20,         // 마진 %
  densityKgMm3: STEEL_DENSITY,
  // 콘크리트 BOQ
  concretePerM3: 120000, // 콘크리트 ₩/m³(자재+타설)
  rebarPerKg: 1500,      // 철근 ₩/kg
  formworkPerM2: 30000,  // 거푸집 ₩/m²
  rebarKgPerM3: 100,     // 철근량 추정 kg/m³(부재별 변동 — 편집)
  // 목재
  timberPerM3: 600000,   // 목재 ₩/m³
};

/** 평판(얇은 box) + 홀 추출. dfm.mjs와 동일 판별(한 축 < 0.4×중간축). */
function extractSheet(intent) {
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  const boxes = feats.filter((f) => f.op !== 'subtract' && f.kind === 'box' && Array.isArray(f.size) && f.size.length === 3);
  const cutBoxes = feats.filter((f) => f.op === 'subtract' && f.kind === 'box');
  let plate = null;
  if (!cutBoxes.length) {
    for (const f of boxes) {
      const s = f.size.slice().sort((a, b) => a - b);
      if (s[0] < 0.4 * s[1]) {
        const tIdx = f.size.indexOf(s[0]);
        const face = f.size.filter((_, i) => i !== tIdx);
        if (!plate || s[0] < plate.t) plate = { t: s[0], w: face[0], d: face[1] };
      }
    }
  }
  const holes = [];
  for (const c of feats) {
    if (c.op === 'subtract' && c.kind === 'cylinder' && c.diameter > 0) holes.push({ dia: c.diameter });
  }
  return { plate, holes };
}

/**
 * 제조 명세(결정론). @returns {applicable, note, thicknessMm, cutLengthMm, cutLengthM,
 *   pierces, footprintMm2, netAreaMm2, weightKg, bends, bbox}
 */
/** 절곡 전개(K-factor). 각 절곡의 BA/BD로 평판 블랭크 길이를 구한다. */
function flatPattern(sheet, bends, density) {
  const t = sheet.thickness;
  const flanges = sheet.flanges ?? [];
  let totalBD = 0;
  const bendLines = [];
  for (const b of bends) {
    const ang = (b.angle * PI) / 180;
    const R = b.radiusMm ?? t;
    const k = b.k ?? 0.38;
    const BA = ang * (R + k * t);              // bend allowance
    const BD = 2 * (R + t) * Math.tan(ang / 2) - BA; // bend deduction
    totalBD += BD;
    bendLines.push({ angle: b.angle, radiusMm: R, k, BA: +BA.toFixed(2), BD: +BD.toFixed(2) });
  }
  const flatLength = flanges.reduce((s, f) => s + f, 0) - totalBD;
  const flatWidth = sheet.width;
  const perimeter = 2 * (flatLength + flatWidth);
  const area = flatLength * flatWidth;
  return {
    applicable: true,
    kind: 'bent',
    note: `절곡 ${bends.length}회, 전개 ${flatLength.toFixed(1)}×${flatWidth}×${t}mm (플랜지 ${flanges.join('+')} − BD ${totalBD.toFixed(1)})`,
    thicknessMm: +t.toFixed(2),
    cutLengthMm: +perimeter.toFixed(1),
    cutLengthM: +(perimeter / 1000).toFixed(3),
    pierces: 1,
    footprintMm2: +area.toFixed(0),
    netAreaMm2: +area.toFixed(0),
    weightKg: +(area * t * density).toFixed(3),
    bends: bends.length,
    flat: { lengthMm: +flatLength.toFixed(1), widthMm: flatWidth, bendLines },
    bbox: { w: flatLength, d: flatWidth, t },
  };
}

/** 강재 프리즘 부재(포스트·빔): 길이·단면적·중량·절단. box(중공 포함)·extrude 대상. */
function steelMember(intent, density) {
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  const boxes = feats.filter((f) => f.op !== 'subtract' && f.kind === 'box' && Array.isArray(f.size) && f.size.length === 3);
  const cutBoxes = feats.filter((f) => f.op === 'subtract' && f.kind === 'box' && Array.isArray(f.size));
  if (!boxes.length) return null;
  const o = boxes[0].size;
  const li = o.indexOf(Math.max(...o)); // 길이축 = 최장
  const L = o[li];
  const outerFace = o.filter((_, i) => i !== li);
  let area = outerFace[0] * outerFace[1];
  if (cutBoxes.length) {
    const innerFace = cutBoxes[0].size.filter((_, i) => i !== li);
    area -= innerFace[0] * innerFace[1]; // 중공
  }
  if (area <= 0) return null;
  const weightKg = area * L * density;
  return {
    applicable: true, kind: 'steel_member',
    note: `강재 부재 · 길이 ${L}mm · 단면적 ${Math.round(area)}mm²`,
    lengthMm: L,
    sectionAreaMm2: Math.round(area),
    unitWeightKgM: +(area * density * 1000).toFixed(2), // kg/m
    weightKg: +weightKg.toFixed(3),
    cuts: 2, // 양단 절단
    bends: 0,
    bbox: { w: outerFace[0], d: outerFace[1], t: L },
  };
}

/** 부재 길이(최장 bbox 축) mm. */
function memberLength(intent) {
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  const outer = feats.find((f) => f.op !== 'subtract');
  if (!outer) return 0;
  if (outer.kind === 'box') return Math.max(...outer.size);
  if (outer.kind === 'extrude') return outer.height;
  if (outer.kind === 'cylinder') return outer.height;
  return 0;
}

/**
 * 콘크리트 BOQ(물량 결정론 + 철근). 철근은:
 *  - opts.rebarAreaMm2(설계 As) 주어지면 As×부재길이×강재밀도로 **정확** 산정(배근 기반).
 *  - 없으면 부피×rebarKgPerM3 **추정**(편집 단가).
 */
function concreteBOQ(intent, opts) {
  const vol = volumeOf(intent); // mm³
  const m3 = vol / 1e9;
  const form = formworkArea(intent) / 1e6; // m²
  const rebarRate = opts.rebarKgPerM3 ?? DEFAULT_RATES.rebarKgPerM3;
  const As = opts.rebarAreaMm2;
  let rebarKg, rebarBasis, note;
  if (As > 0) {
    const L = memberLength(intent);
    rebarKg = As * L * STEEL_DENSITY; // mm²·mm·kg/mm³
    rebarBasis = 'design'; // 배근(As) 기반
    note = `콘크리트 부재 · ${m3.toFixed(3)} m³ · 철근 As=${As}mm²×L 기반`;
  } else {
    rebarKg = m3 * rebarRate;
    rebarBasis = 'estimate'; // 부피율 추정
    note = `콘크리트 부재 · ${m3.toFixed(3)} m³ (철근 ${rebarRate}kg/m³ 추정)`;
  }
  return {
    applicable: true, kind: 'concrete', note,
    volumeM3: +m3.toFixed(3),
    formworkM2: +form.toFixed(2),
    concreteWeightKg: +(vol * CONCRETE_DENSITY).toFixed(0),
    rebarKg: +rebarKg.toFixed(1),
    rebarBasis,
    bends: 0,
  };
}
/** 목재 부재(부피·중량). */
function timberSpec(intent) {
  const vol = volumeOf(intent);
  const m3 = vol / 1e9;
  return {
    applicable: true, kind: 'timber',
    note: `목재 부재 · ${m3.toFixed(4)} m³`,
    volumeM3: +m3.toFixed(4),
    weightKg: +(vol * TIMBER_DENSITY).toFixed(2),
    bends: 0,
  };
}

/** 다부재 강재 어셈블리 → 부재 스케줄(BOM). intent.assembly[{id,kind,section:[w,h],wall,length}]. */
function steelAssembly(intent, density) {
  const asm = Array.isArray(intent?.assembly) ? intent.assembly : null;
  if (!asm || asm.length < 2) return null;
  const members = asm.map((m) => {
    const [w, h] = m.section;
    const area = m.wall > 0 ? w * h - (w - 2 * m.wall) * (h - 2 * m.wall) : w * h;
    const weightKg = area * m.length * density;
    return { id: m.id, kind: m.kind, lengthMm: m.length, sectionAreaMm2: Math.round(area), weightKg: +weightKg.toFixed(2) };
  });
  const totalWeightKg = +members.reduce((s, m) => s + m.weightKg, 0).toFixed(2);
  const totalLengthMm = members.reduce((s, m) => s + m.lengthMm, 0);
  return {
    applicable: true, kind: 'steel_assembly',
    note: `강재 어셈블리 · 부재 ${members.length} · 총중량 ${totalWeightKg}kg`,
    members, memberCount: members.length,
    totalLengthMm, weightKg: totalWeightKg,
    cuts: members.length * 2,
    bends: 0,
  };
}

/** 인테리어 FF&E: 가구 스케줄(가구·수량·좌석·단가) + 바닥면적. intent.furniture[]. */
function ffeSchedule(intent) {
  const list = Array.isArray(intent?.furniture) ? intent.furniture : [];
  if (!list.length) return null;
  const items = list.map((f) => ({ id: f.id, name: f.name ?? f.id, count: f.count, seats: (f.seats || 0) * f.count, priceEach: f.priceEach ?? 0, subtotal: (f.priceEach ?? 0) * f.count }));
  const itemCount = items.reduce((s, i) => s + i.count, 0);
  const seatTotal = items.reduce((s, i) => s + i.seats, 0);
  return {
    applicable: true, kind: 'ffe',
    note: `FF&E · 품목 ${items.length}종/${itemCount}점 · 좌석 ${seatTotal}`,
    floorAreaM2: intent.floorAreaM2 ?? null,
    itemTypes: items.length, itemCount, seatTotal,
    items, bends: 0,
  };
}

export function fabSpec(intent, opts = {}) {
  const density = opts.densityKgMm3 ?? STEEL_DENSITY;
  // 인테리어 → FF&E 스케줄.
  if (intent?.material === 'interior') { const ffe = ffeSchedule(intent); if (ffe) return ffe; }
  // 다부재 어셈블리(프레임 등) → 부재 스케줄.
  const asm = steelAssembly(intent, density);
  if (asm) return asm;
  // 재료 힌트(프리셋이 intent.material로 표기): 콘크리트·목재는 강판/강재 로직 대신 BOQ.
  if (intent?.material === 'concrete') return concreteBOQ(intent, opts);
  if (intent?.material === 'timber') return timberSpec(intent);
  // 절곡물: intent.bends + sheet 메타가 있으면 전개 계산.
  if (Array.isArray(intent?.bends) && intent.bends.length && intent?.sheet?.thickness) {
    return flatPattern(intent.sheet, intent.bends, density);
  }
  const { plate, holes } = extractSheet(intent);
  if (!plate) {
    // 평판이 아니면 강재 프리즘 부재(포스트·빔)로 시도 → 중량·절단.
    const steel = steelMember(intent, density);
    if (steel) return steel;
    return { applicable: false, note: '판재·강재 부재로 인식 못함(용기 등). 실제 견적은 RFQ로.' };
  }
  const t = opts.thicknessMm ?? plate.t;
  const perimeter = 2 * (plate.w + plate.d);
  const holeCut = holes.reduce((s, h) => s + PI * h.dia, 0);
  const cutLengthMm = perimeter + holeCut;
  const pierces = 1 + holes.length; // 외곽 1 + 홀
  const footprint = plate.w * plate.d;
  const holeArea = holes.reduce((s, h) => s + (PI / 4) * h.dia * h.dia, 0);
  const netArea = Math.max(0, footprint - holeArea);
  const weightKg = netArea * t * density;
  return {
    applicable: true,
    note: `평판 ${plate.w}×${plate.d}×${t}mm, 홀 ${holes.length}개`,
    thicknessMm: +t.toFixed(2),
    cutLengthMm: +cutLengthMm.toFixed(1),
    cutLengthM: +(cutLengthMm / 1000).toFixed(3),
    pierces,
    footprintMm2: +footprint.toFixed(0),
    netAreaMm2: +netArea.toFixed(0),
    weightKg: +weightKg.toFixed(3),
    bends: 0, // 현재 프리셋은 절곡 없음(평판). 절곡물 템플릿 추가 시 반영.
    bbox: { w: plate.w, d: plate.d, t },
  };
}

/** 예상비용(추정). spec × 단가표. @returns 항목별 + total(예상). */
export function estimateCost(spec, ratesIn = {}) {
  const r = { ...DEFAULT_RATES, ...ratesIn };
  if (!spec.applicable) return { applicable: false, note: spec.note };
  const round = (v) => Math.round(v);

  // 콘크리트 BOQ 견적: 콘크리트 + 철근 + 거푸집.
  if (spec.kind === 'concrete') {
    const concrete = spec.volumeM3 * r.concretePerM3;
    const rebar = spec.rebarKg * r.rebarPerKg;
    const formwork = spec.formworkM2 * r.formworkPerM2;
    const subtotal = concrete + rebar + formwork + r.setup;
    const margin = subtotal * (r.marginPct / 100);
    return {
      applicable: true, currency: 'KRW', estimate: true,
      breakdown: { concrete: round(concrete), rebar: round(rebar), formwork: round(formwork), setup: round(r.setup) },
      subtotal: round(subtotal), margin: round(margin), total: round(subtotal + margin), rates: r,
      disclaimer: '예상 물량·비용(참고) — 철근량·단가는 배근·시세에 따라 변동. 확정은 상세 산출/견적에서.',
    };
  }
  // 인테리어 FF&E 견적: 가구 소계 합 + 설치/셋업 + 마진.
  if (spec.kind === 'ffe') {
    const furniture = (spec.items ?? []).reduce((s, i) => s + i.subtotal, 0);
    const install = r.setup;
    const subtotal = furniture + install;
    const margin = subtotal * (r.marginPct / 100);
    return {
      applicable: true, currency: 'KRW', estimate: true,
      breakdown: { furniture: round(furniture), install: round(install) },
      subtotal: round(subtotal), margin: round(margin), total: round(subtotal + margin), rates: r,
      disclaimer: '예상 FF&E 비용(참고) — 가구 단가·사양·시공범위에 따라 변동. 마감·설비·인건비 별도.',
    };
  }
  // 목재 견적: 부피 기준.
  if (spec.kind === 'timber') {
    const material = spec.volumeM3 * r.timberPerM3;
    const subtotal = material + r.setup;
    const margin = subtotal * (r.marginPct / 100);
    return {
      applicable: true, currency: 'KRW', estimate: true,
      breakdown: { material: round(material), setup: round(r.setup) },
      subtotal: round(subtotal), margin: round(margin), total: round(subtotal + margin), rates: r,
      disclaimer: '예상 비용(참고) — 수종·등급·시세에 따라 변동.',
    };
  }

  const material = spec.weightKg * r.materialPerKg;
  let cut, pierce, bend;
  if (spec.kind === 'steel_member' || spec.kind === 'steel_assembly') {
    // 강재: 절단은 절단횟수 기준(레이저 절단길이·피어싱 아님).
    cut = (spec.cuts ?? 2) * (r.cutPerCut ?? DEFAULT_RATES.cutPerCut);
    pierce = 0;
    bend = 0;
  } else {
    cut = (spec.cutLengthM ?? 0) * r.cutPerM;
    pierce = (spec.pierces ?? 0) * r.piercePerHole;
    bend = (spec.bends ?? 0) * r.bendPerOp;
  }
  const subtotal = material + cut + pierce + bend + r.setup;
  const margin = subtotal * (r.marginPct / 100);
  const total = subtotal + margin;
  return {
    applicable: true,
    currency: 'KRW',
    estimate: true,
    breakdown: {
      material: round(material), cut: round(cut), pierce: round(pierce), bend: round(bend), setup: round(r.setup),
    },
    subtotal: round(subtotal),
    margin: round(margin),
    total: round(total),
    rates: r,
    disclaimer: '예상 견적(참고) — 단가는 업체·시세·수량에 따라 변동. 확정 견적은 RFQ/공장매칭에서.',
  };
}

/**
 * 절단용 DXF(R12 ASCII). 평판=외곽+홀(CUT). 절곡물=전개 블랭크 외곽(CUT)+절곡선(BEND 레이어).
 * 실제 레이저·절곡기에 사용 가능.
 */
export function toDxf(intent) {
  const L = [];
  const p = (code, val) => { L.push(String(code)); L.push(String(val)); };
  const line = (x1, y1, x2, y2, layer) => { p(0, 'LINE'); p(8, layer); p(10, x1); p(20, y1); p(11, x2); p(21, y2); };
  p(0, 'SECTION'); p(2, 'ENTITIES');

  // 절곡물: 전개 블랭크 + 절곡선
  if (Array.isArray(intent?.bends) && intent.bends.length && intent?.sheet?.thickness) {
    const spec = flatPattern(intent.sheet, intent.bends, STEEL_DENSITY);
    const W = spec.flat.lengthMm, H = spec.flat.widthMm;
    line(0, 0, W, 0, 'CUT'); line(W, 0, W, H, 'CUT'); line(W, H, 0, H, 'CUT'); line(0, H, 0, 0, 'CUT');
    // 절곡선: 첫 플랜지 길이 위치(누적, 근사)에 세로선.
    const flanges = intent.sheet.flanges ?? [];
    let x = flanges[0] ?? W / 2;
    for (let i = 0; i < intent.bends.length; i++) { line(x, 0, x, H, 'BEND'); }
    p(0, 'ENDSEC'); p(0, 'EOF');
    return L.join('\n') + '\n';
  }

  const { plate } = extractSheet(intent);
  if (!plate) { return null; }
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  const holePos = feats
    .filter((c) => c.op === 'subtract' && c.kind === 'cylinder' && c.diameter > 0)
    .map((c) => ({ dia: c.diameter, x: c.at?.translate?.[0] ?? plate.w / 2, y: c.at?.translate?.[1] ?? plate.d / 2 }));
  line(0, 0, plate.w, 0, 'CUT'); line(plate.w, 0, plate.w, plate.d, 'CUT');
  line(plate.w, plate.d, 0, plate.d, 'CUT'); line(0, plate.d, 0, 0, 'CUT');
  for (const h of holePos) { p(0, 'CIRCLE'); p(8, 'CUT'); p(10, h.x); p(20, h.y); p(40, h.dia / 2); }
  p(0, 'ENDSEC'); p(0, 'EOF');
  return L.join('\n') + '\n';
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('fab.mjs');
if (isMain) {
  const plate = { name: 'p', features: [
    { id: 'plate', kind: 'box', size: [300, 200, 6] },
    { id: 'h1', kind: 'cylinder', diameter: 8, op: 'subtract', at: { translate: [20, 20, -1] }, height: 8 },
    { id: 'h2', kind: 'cylinder', diameter: 8, op: 'subtract', at: { translate: [280, 20, -1] }, height: 8 },
    { id: 'c', kind: 'cylinder', diameter: 40, op: 'subtract', at: { translate: [150, 100, -1] }, height: 8 },
  ] };
  const spec = fabSpec(plate);
  const est = estimateCost(spec);
  console.log('spec:', JSON.stringify(spec));
  console.log('est :', JSON.stringify({ total: est.total, breakdown: est.breakdown }));
  console.log('dxf lines:', toDxf(plate).split('\n').length, '| head:', toDxf(plate).slice(0, 30).replace(/\n/g, '\\n'));
  const tube = { features: [{ id: 'o', kind: 'box', size: [50, 50, 1000] }, { id: 'b', kind: 'box', op: 'subtract', size: [44, 44, 1002] }] };
  console.log('tube applicable:', fabSpec(tube).applicable, '|', fabSpec(tube).note);
}
