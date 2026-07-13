/**
 * interior-presets.mjs — 인테리어(상업공간) 결정론 파라메트릭 프리셋(Pillar ① · 6번째 분야).
 * 참고: nexygames Atelier(Commercial Space Planner). 실 바닥 + 가구 배치(박스) + FF&E 서술자.
 * 검증=domain-verify interior(수용인원·피난, 바닥면적·좌석 형상 파생). 제조=FF&E BOM(가구·단가).
 *
 * intent.furniture[{id,name,count,seats,priceEach}] → fab가 가구 스케줄·비용을 산출한다.
 * intent.floorAreaM2 → verify가 재실자 산정에 쓴다(형상 footprint에서도 파생 가능).
 */
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** 카페/레스토랑 레이아웃: 바닥 + 카운터 + 테이블 그리드(+의자). 치수 mm. */
function cafeLayoutIntent(p) {
  const W = num(p.width, 8000), D = num(p.depth, 6000);
  const rows = Math.max(1, Math.round(num(p.tableRows, 2)));
  const cols = Math.max(1, Math.round(num(p.tableCols, 3)));
  const seatsPerTable = Math.max(1, Math.round(num(p.seatsPerTable, 4)));
  const nTables = rows * cols;
  const seats = nTables * seatsPerTable;

  const features = [{ id: 'floor', kind: 'box', size: [W, D, 100], at: { translate: [0, 0, -100] } }];
  // 카운터(뒤벽)
  features.push({ id: 'counter', kind: 'box', size: [Math.min(3100, W * 0.4), 800, 1050], at: { translate: [W - Math.min(3100, W * 0.4) - 400, D - 800 - 300, 0] } });
  // 테이블 그리드(고객 영역)
  const zoneW = W - 1600, zoneD = D - 2400;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 800 + (zoneW / cols) * (c + 0.5) - 600;
      const y = 800 + (zoneD / rows) * (r + 0.5) - 600;
      features.push({ id: `table_${r}_${c}`, kind: 'box', size: [1200, 1200, 750], at: { translate: [x, y, 0] } });
    }
  }

  return {
    name: 'CafeLayout',
    features,
    floorAreaM2: +((W * D) / 1e6).toFixed(2),
    furniture: [
      { id: 'table', name: '테이블', count: nTables, seats: 0, priceEach: 620 },
      { id: 'chair', name: '의자', count: seats, seats: 1, priceEach: 95 },
      { id: 'counter', name: '서비스 카운터', count: 1, seats: 0, priceEach: 3800 },
    ],
    material: 'interior',
  };
}

/** 리테일 매장: 바닥 + 진열대(그리드) + 카운터. */
function retailLayoutIntent(p) {
  const W = num(p.width, 10000), D = num(p.depth, 8000);
  const rows = Math.max(1, Math.round(num(p.shelfRows, 3)));
  const nShelves = rows * 2;
  const features = [{ id: 'floor', kind: 'box', size: [W, D, 100], at: { translate: [0, 0, -100] } }];
  features.push({ id: 'counter', kind: 'box', size: [3100, 800, 1050], at: { translate: [400, D - 1100, 0] } });
  for (let r = 0; r < rows; r++) {
    const y = 1200 + (r * (D - 2400)) / rows;
    features.push({ id: `shelfL_${r}`, kind: 'box', size: [(W - 2400) / 2, 400, 1800], at: { translate: [400, y, 0] } });
    features.push({ id: `shelfR_${r}`, kind: 'box', size: [(W - 2400) / 2, 400, 1800], at: { translate: [W / 2 + 800, y, 0] } });
  }
  return {
    name: 'RetailLayout', features,
    floorAreaM2: +((W * D) / 1e6).toFixed(2),
    furniture: [
      { id: 'shelf', name: '진열대', count: nShelves, seats: 0, priceEach: 680 },
      { id: 'counter', name: '계산 카운터', count: 1, seats: 0, priceEach: 3800 },
      { id: 'rack', name: '행거', count: rows, seats: 0, priceEach: 420 },
    ],
    material: 'interior',
  };
}

export const INTERIOR_TEMPLATES = [
  {
    id: 'cafe_layout', labelKo: '카페/레스토랑 레이아웃', labelEn: 'Café / restaurant layout', build: cafeLayoutIntent,
    params: [
      { name: 'width', labelKo: '실 폭', unit: 'mm', default: 8000, min: 3000, max: 30000 },
      { name: 'depth', labelKo: '실 깊이', unit: 'mm', default: 6000, min: 3000, max: 30000 },
      { name: 'tableRows', labelKo: '테이블 행', unit: '', default: 2, min: 1, max: 8 },
      { name: 'tableCols', labelKo: '테이블 열', unit: '', default: 3, min: 1, max: 10 },
      { name: 'seatsPerTable', labelKo: '테이블당 좌석', unit: '', default: 4, min: 1, max: 8 },
    ],
  },
  {
    id: 'retail_layout', labelKo: '리테일 매장 레이아웃', labelEn: 'Retail store layout', build: retailLayoutIntent,
    params: [
      { name: 'width', labelKo: '실 폭', unit: 'mm', default: 10000, min: 3000, max: 40000 },
      { name: 'depth', labelKo: '실 깊이', unit: 'mm', default: 8000, min: 3000, max: 40000 },
      { name: 'shelfRows', labelKo: '진열대 행', unit: '', default: 3, min: 1, max: 10 },
    ],
  },
];
