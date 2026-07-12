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
const PI = Math.PI;

/** 기본 단가표(대략치 · 반드시 편집·업체 확정 전제). KRW. */
export const DEFAULT_RATES = {
  materialPerKg: 2500,   // 소재 ₩/kg (강판, 시세 변동)
  cutPerM: 2000,         // 절단 ₩/m
  piercePerHole: 100,    // 피어싱 ₩/개
  bendPerOp: 500,        // 절곡 ₩/회
  setup: 20000,          // 셋업 ₩(고정)
  marginPct: 20,         // 마진 %
  densityKgMm3: STEEL_DENSITY,
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
export function fabSpec(intent, opts = {}) {
  const { plate, holes } = extractSheet(intent);
  const density = opts.densityKgMm3 ?? STEEL_DENSITY;
  if (!plate) {
    return { applicable: false, note: '판재 레이저 대상이 아닙니다(평판 아님 — 각관·용기 등은 용접·압출·성형). 실제 견적은 RFQ로.' };
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
  const material = spec.weightKg * r.materialPerKg;
  const cut = spec.cutLengthM * r.cutPerM;
  const pierce = spec.pierces * r.piercePerHole;
  const bend = (spec.bends ?? 0) * r.bendPerOp;
  const subtotal = material + cut + pierce + bend + r.setup;
  const margin = subtotal * (r.marginPct / 100);
  const total = subtotal + margin;
  const round = (v) => Math.round(v);
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

/** 평판 절단용 DXF(R12 ASCII): 외곽 사각형 + 홀 원. 실제 레이저 사용 가능. */
export function toDxf(intent) {
  const { plate, holes } = extractSheet(intent);
  if (!plate) return null;
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  const holePos = feats
    .filter((c) => c.op === 'subtract' && c.kind === 'cylinder' && c.diameter > 0)
    .map((c) => ({ dia: c.diameter, x: c.at?.translate?.[0] ?? plate.w / 2, y: c.at?.translate?.[1] ?? plate.d / 2 }));
  const L = [];
  const p = (code, val) => { L.push(String(code)); L.push(String(val)); };
  p(0, 'SECTION'); p(2, 'ENTITIES');
  const line = (x1, y1, x2, y2) => { p(0, 'LINE'); p(8, 'CUT'); p(10, x1); p(20, y1); p(11, x2); p(21, y2); };
  line(0, 0, plate.w, 0);
  line(plate.w, 0, plate.w, plate.d);
  line(plate.w, plate.d, 0, plate.d);
  line(0, plate.d, 0, 0);
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
