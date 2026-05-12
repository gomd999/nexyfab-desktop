/**
 * B7 — Curated RFQ system templates.
 *
 * Pre-filled RFQ fields for common manufacturing scenarios. Users see
 * these alongside their own past RFQs in the "use template" picker;
 * picking one fills out shape/material/quantity defaults so creating
 * a new RFQ takes seconds instead of minutes.
 *
 * Source: NexyFab observed common RFQ patterns (CNC bracket, sheet
 * metal panel, 3D-printed prototype, injection-molded enclosure, etc.).
 * Update by editing this list — no DB needed.
 */

export interface RfqSystemTemplate {
  id: string;
  category: 'cnc' | 'sheet_metal' | 'mold' | '3d_print' | 'forging' | 'other';
  title_ko: string;
  title_en: string;
  description_ko: string;
  description_en: string;
  /** Pre-filled fields the form should populate. */
  defaults: {
    materialId: string;
    quantity: number;
    deadline?: string;       // ISO date — null/omitted = user picks
    note_ko?: string;
    note_en?: string;
    /** Suggested geometry hints. Optional — user uploads actual file. */
    typicalBboxMm?: { w: number; h: number; d: number };
  };
  /** Tag list for the picker UI. */
  tags: string[];
}

export const RFQ_SYSTEM_TEMPLATES: RfqSystemTemplate[] = [
  {
    id: 'cnc_bracket_aluminum',
    category: 'cnc',
    title_ko: 'CNC 알루미늄 브래킷 (소량)',
    title_en: 'CNC aluminum bracket (low volume)',
    description_ko: '6061 알루미늄, 소량 1-50개, 정밀 가공 필요',
    description_en: 'Al 6061, 1-50 pcs, precision required',
    defaults: {
      materialId: 'aluminum_6061',
      quantity: 10,
      note_ko: '정밀도 IT8 이상, 표면 anodize Type II 희망. 도면 주석 우선.',
      note_en: 'IT8 tolerance min, Type II anodize preferred. Drawing notes take priority.',
      typicalBboxMm: { w: 80, h: 60, d: 15 },
    },
    tags: ['CNC', 'aluminum', '소량'],
  },
  {
    id: 'sheet_metal_panel_steel',
    category: 'sheet_metal',
    title_ko: '판금 강판 패널 (1.5mm)',
    title_en: 'Sheet metal steel panel (1.5mm)',
    description_ko: '1.5mm 강판, 굽힘 + 펀칭, 도장 옵션',
    description_en: '1.5mm steel, bend + punch, optional powder coat',
    defaults: {
      materialId: 'steel_s45c',
      quantity: 50,
      note_ko: '굽힘 R 최소 2t. 도장 RAL 9005 무광. 50개 단가 + 1000개 단가 함께 견적.',
      note_en: 'Bend radius min 2t. Powder coat RAL 9005 matte. Quote 50pcs and 1000pcs.',
      typicalBboxMm: { w: 200, h: 150, d: 50 },
    },
    tags: ['판금', 'steel', '굽힘'],
  },
  {
    id: 'injection_mold_pa66',
    category: 'mold',
    title_ko: '사출 성형 PA66 (양산)',
    title_en: 'Injection mold PA66 (production)',
    description_ko: 'PA66, 1000+ 양산, 금형 포함 견적',
    description_en: 'PA66, 1000+ pcs, tooling included',
    defaults: {
      materialId: 'pa66',
      quantity: 5000,
      note_ko: '금형 비용 + 단가 분리 견적. 게이트 위치 추천 부탁드립니다. 색상: 자연색.',
      note_en: 'Tooling cost + per-piece quote separate. Suggest gate location. Color: natural.',
      typicalBboxMm: { w: 100, h: 80, d: 30 },
    },
    tags: ['사출', 'PA66', '양산'],
  },
  {
    id: 'fdm_prototype_pla',
    category: '3d_print',
    title_ko: 'FDM 프로토타입 (PLA, 1-5개)',
    title_en: 'FDM prototype (PLA, 1-5 pcs)',
    description_ko: '시제품 검증용. 빠른 납기 우선',
    description_en: 'Prototype for verification. Fast lead time priority',
    defaults: {
      materialId: 'pla',
      quantity: 3,
      note_ko: 'Layer 0.2mm, 인필 20%, 서포트 자동. 색상 무관. 영업일 3일 이내 납품 필수.',
      note_en: 'Layer 0.2mm, infill 20%, auto support. Any color. 3 biz days max lead time.',
      typicalBboxMm: { w: 60, h: 60, d: 30 },
    },
    tags: ['FDM', 'PLA', 'prototype'],
  },
  {
    id: 'sla_resin_detail',
    category: '3d_print',
    title_ko: 'SLA 정밀 출력 (5-20개)',
    title_en: 'SLA detail print (5-20 pcs)',
    description_ko: '복잡 형상, 표면 매끄러움 필수, 투명/불투명',
    description_en: 'Complex geometry, smooth surface required, clear/opaque',
    defaults: {
      materialId: 'pla',  // SLA-specific resin handled in process selection
      quantity: 10,
      note_ko: 'Layer 0.05mm, 표면 매끄러움 우선. 후처리(샌딩+도장) 옵션 견적도 함께.',
      note_en: 'Layer 0.05mm, surface smoothness priority. Include optional post-processing (sand+paint) quote.',
      typicalBboxMm: { w: 50, h: 50, d: 30 },
    },
    tags: ['SLA', 'detail', 'prototype'],
  },
  {
    id: 'cnc_steel_shaft',
    category: 'cnc',
    title_ko: 'CNC 강철 샤프트 (키홈 포함)',
    title_en: 'CNC steel shaft (with keyway)',
    description_ko: '4140 강철, 키홈 + 리테이닝링 그루브',
    description_en: '4140 steel, keyway + retainer groove',
    defaults: {
      materialId: 'steel_s45c',
      quantity: 5,
      note_ko: 'DIN 6885 키홈, DIN 471 외부 리테이닝링 홈. 표면 0.8μm Ra. 열처리 옵션 견적.',
      note_en: 'DIN 6885 keyway, DIN 471 external retainer groove. Surface 0.8μm Ra. Quote with optional heat treatment.',
      typicalBboxMm: { w: 100, h: 20, d: 20 },
    },
    tags: ['CNC', 'shaft', 'keyway'],
  },
  {
    id: 'die_cast_enclosure',
    category: 'mold',
    title_ko: '다이캐스팅 알루미늄 인클로저',
    title_en: 'Die-cast aluminum enclosure',
    description_ko: 'IP65 등급, 게스킷 그루브, 코너 보스',
    description_en: 'IP65 rating, gasket groove, corner bosses',
    defaults: {
      materialId: 'aluminum_6061',
      quantity: 1000,
      note_ko: 'IP65 등급. O-ring 게스킷 그루브 (AS568-251). 4 코너 M5 보스. 분리식 금형.',
      note_en: 'IP65 rating. O-ring gasket groove (AS568-251). 4 corner M5 bosses. Split-die mold.',
      typicalBboxMm: { w: 150, h: 100, d: 50 },
    },
    tags: ['die-cast', 'IP65', '인클로저'],
  },
  // ─── A1 — Round 2 templates (13 more) ────────────────────────────────
  {
    id: 'cnc_brass_connector',
    category: 'cnc',
    title_ko: 'CNC 황동 커넥터 (전기)',
    title_en: 'CNC brass connector (electrical)',
    description_ko: '황동(C3604), 도금 옵션, 가공성 우수',
    description_en: 'Brass C3604, plating optional, easy to machine',
    defaults: {
      materialId: 'brass',
      quantity: 100,
      note_ko: '도전성 부품. 니켈 도금 5μm 옵션 견적도 포함. 나사 가공 정밀도 5H.',
      note_en: 'Conductive part. Include nickel plate 5μm quote. Thread tolerance 5H.',
      typicalBboxMm: { w: 30, h: 30, d: 20 },
    },
    tags: ['CNC', 'brass', '전기'],
  },
  {
    id: 'cnc_stainless_food',
    category: 'cnc',
    title_ko: 'CNC 스테인리스 식품/의료 부품',
    title_en: 'CNC stainless food/medical part',
    description_ko: 'SUS304, 표면 #4 (Ra 0.4μm), 식품 등급',
    description_en: 'SS304, #4 finish (Ra 0.4μm), food-grade',
    defaults: {
      materialId: 'stainless_304',
      quantity: 50,
      note_ko: '식품 직접 접촉 가능. 모서리 R0.5 이상 (틈 방지). 전해 연마 견적 포함.',
      note_en: 'Direct food contact. Edge R≥0.5mm (no crevice). Include electropolish quote.',
      typicalBboxMm: { w: 60, h: 60, d: 20 },
    },
    tags: ['CNC', 'SUS304', '식품/의료'],
  },
  {
    id: 'sheet_metal_aluminum_chassis',
    category: 'sheet_metal',
    title_ko: '판금 알루미늄 전자 인클로저 (1.0mm)',
    title_en: 'Sheet aluminum electronics enclosure (1.0mm)',
    description_ko: '1.0mm 알루미늄, 굽힘+펀칭, 파우더 코팅',
    description_en: '1.0mm aluminum, bend+punch, powder coat',
    defaults: {
      materialId: 'aluminum_6061',
      quantity: 100,
      note_ko: '1.0t Al, U-channel + 4 마운팅 탭. 파우더 코팅 RAL 7035 (저녁 회색). EMI 가스킷 그루브.',
      note_en: '1.0mm Al, U-channel + 4 mounting tabs. Powder coat RAL 7035 (light grey). EMI gasket groove.',
      typicalBboxMm: { w: 200, h: 150, d: 60 },
    },
    tags: ['판금', 'aluminum', '인클로저'],
  },
  {
    id: 'sheet_metal_thin_panel',
    category: 'sheet_metal',
    title_ko: '판금 얇은 패널 (0.5mm)',
    title_en: 'Thin sheet panel (0.5mm)',
    description_ko: '0.5mm 강판, 레이저 절단 + 단순 굽힘',
    description_en: '0.5mm steel, laser cut + simple bend',
    defaults: {
      materialId: 'steel_s45c',
      quantity: 200,
      note_ko: '0.5t SPCC, 레이저 절단 후 90° 1회 굽힘. 도장 없음 (그대로 출하). 배달 일정 우선.',
      note_en: '0.5mm SPCC, laser cut + single 90° bend. No coating (raw). Delivery date priority.',
      typicalBboxMm: { w: 100, h: 100, d: 30 },
    },
    tags: ['판금', 'thin', '레이저'],
  },
  {
    id: 'sls_nylon_functional',
    category: '3d_print',
    title_ko: 'SLS 나일론 기능 부품',
    title_en: 'SLS nylon functional part',
    description_ko: 'PA12 SLS, 강도 + 정밀 동시 (스냅핏 가능)',
    description_en: 'PA12 SLS, strength + precision (snap-fit OK)',
    defaults: {
      materialId: 'pla',  // catalog limitation; PA12 spec'd in note
      quantity: 20,
      note_ko: 'SLS PA12, 미사용 분말 회수율 정보 부탁. 스냅핏 후크 작동 확인 필요. 색상: 자연색 (white-gray).',
      note_en: 'SLS PA12. Share fresh powder ratio. Verify snap-fit hook function. Color: natural (white-gray).',
      typicalBboxMm: { w: 80, h: 60, d: 30 },
    },
    tags: ['SLS', 'PA12', 'functional'],
  },
  {
    id: 'dmls_metal_print',
    category: '3d_print',
    title_ko: 'DMLS 메탈 3D 프린팅',
    title_en: 'DMLS metal 3D print',
    description_ko: '스테인리스/티타늄 SLS, 후처리 포함',
    description_en: 'SS/Ti DMLS, post-processing included',
    defaults: {
      materialId: 'stainless_304',
      quantity: 5,
      note_ko: 'DMLS SS316L. 서포트 제거 + 비드 블라스트 후 출하. 열처리 (응력 제거) 필수.',
      note_en: 'DMLS SS316L. Support removal + bead blast before ship. Stress-relief heat treat required.',
      typicalBboxMm: { w: 60, h: 60, d: 60 },
    },
    tags: ['DMLS', 'metal', '소량'],
  },
  {
    id: 'die_cast_zinc_small',
    category: 'mold',
    title_ko: '아연 다이캐스팅 소형 부품',
    title_en: 'Zinc die-cast small part',
    description_ko: 'Zamak 5, 소형 + 정밀 + 도장',
    description_en: 'Zamak 5, small + precise + plating',
    defaults: {
      materialId: 'aluminum_6061',  // catalog limitation; Zamak 5 spec'd in note
      quantity: 5000,
      note_ko: 'Zamak 5 (Zn-Al4-Cu1). 정밀도 우수. 크롬 도금 옵션 견적 포함. 게이트 위치 추천.',
      note_en: 'Zamak 5. Precise. Include chrome plate quote. Suggest gate location.',
      typicalBboxMm: { w: 50, h: 30, d: 15 },
    },
    tags: ['die-cast', 'zinc', '양산'],
  },
  {
    id: 'forging_steel_hook',
    category: 'forging',
    title_ko: '단조 강철 후크/링크',
    title_en: 'Forged steel hook/link',
    description_ko: '4140 또는 8620, 인장 강도 우선',
    description_en: '4140 or 8620, tensile strength priority',
    defaults: {
      materialId: 'steel_s45c',
      quantity: 500,
      note_ko: '단조 후 가공 + 열처리 (조질, 28-32 HRC). 비파괴 검사 (자분 또는 침투) 옵션.',
      note_en: 'Forge + machine + heat-treat (Q&T, 28-32 HRC). Optional NDT (MT or PT).',
      typicalBboxMm: { w: 100, h: 50, d: 30 },
    },
    tags: ['forging', '인장강도', '하중'],
  },
  {
    id: 'extrusion_aluminum_profile',
    category: 'other',
    title_ko: '알루미늄 압출 프로파일 절단',
    title_en: 'Aluminum extrusion profile cut',
    description_ko: '6063-T5 표준 프로파일 + 절단/탭',
    description_en: '6063-T5 standard profile + cut/tap',
    defaults: {
      materialId: 'aluminum_6061',
      quantity: 100,
      note_ko: '6063-T5, 표준 2020/3030/4040 프로파일. 절단 후 양 끝 탭 (M5 또는 M6). 길이 정밀도 ±0.5mm.',
      note_en: '6063-T5, standard 2020/3030/4040 profile. Cut + both-end tap (M5 or M6). Length tol ±0.5mm.',
      typicalBboxMm: { w: 500, h: 30, d: 30 },
    },
    tags: ['extrusion', 'aluminum', '프로파일'],
  },
  {
    id: 'laser_cut_acrylic',
    category: 'other',
    title_ko: '아크릴 레이저 절단',
    title_en: 'Acrylic laser cut',
    description_ko: '투명 또는 색상 PMMA, 정밀 절단',
    description_en: 'Clear or colored PMMA, precision cut',
    defaults: {
      materialId: 'pc',  // catalog limitation; PMMA spec'd in note
      quantity: 50,
      note_ko: 'PMMA 5mm 투명. CO2 레이저 절단. 절단면 화염 연마 (광택). 색상 RGB 별도 견적.',
      note_en: 'PMMA 5mm clear. CO2 laser cut. Flame-polished edges. Colored variants quoted separately.',
      typicalBboxMm: { w: 200, h: 150, d: 5 },
    },
    tags: ['laser', '아크릴', 'PMMA'],
  },
  {
    id: 'plating_only_chrome',
    category: 'other',
    title_ko: '표면처리만: 크롬 도금',
    title_en: 'Plating only: chrome',
    description_ko: '기존 부품의 크롬 도금 위탁',
    description_en: 'Chrome plating service for existing parts',
    defaults: {
      materialId: 'steel_s45c',
      quantity: 100,
      note_ko: '제공 부품에 장식용 크롬 도금. 코팅 두께 0.5μm 이상. 사전 폴리싱 옵션 견적.',
      note_en: 'Decorative chrome plating on supplied parts. Coating ≥0.5μm. Quote with optional pre-polish.',
      typicalBboxMm: { w: 50, h: 50, d: 50 },
    },
    tags: ['도금', 'chrome', '표면처리'],
  },
  {
    id: 'silicone_gasket_custom',
    category: 'mold',
    title_ko: '실리콘 가스킷 (맞춤)',
    title_en: 'Custom silicone gasket',
    description_ko: '식품/의료 등급 실리콘, 압축 영구변형 낮음',
    description_en: 'Food/medical grade silicone, low compression set',
    defaults: {
      materialId: 'pa66',  // catalog limitation; silicone spec'd in note
      quantity: 1000,
      note_ko: 'FDA 등급 실리콘 (50A 또는 70A 경도). 압축 변형 ≤25% (170°C×22h). 색상 옵션.',
      note_en: 'FDA-grade silicone (50A or 70A durometer). Compression set ≤25% (170°C×22h). Color options.',
      typicalBboxMm: { w: 80, h: 80, d: 3 },
    },
    tags: ['silicone', 'FDA', 'gasket'],
  },
  {
    id: 'wire_edm_complex',
    category: 'cnc',
    title_ko: 'Wire EDM 복잡 형상',
    title_en: 'Wire EDM complex shape',
    description_ko: '경화강 슬롯/내부 코너 (CNC로 가공 불가)',
    description_en: 'Hardened steel slot/inner corners (uncuttable by CNC)',
    defaults: {
      materialId: 'steel_s45c',
      quantity: 10,
      note_ko: '경화 후 EDM (경도 60+ HRC OK). 내부 코너 R0.15. 표면 Ra 0.8μm. 0.25mm 와이어.',
      note_en: 'Post-hardening EDM (60+ HRC OK). Inner corner R0.15. Surface Ra 0.8μm. 0.25mm wire.',
      typicalBboxMm: { w: 60, h: 60, d: 15 },
    },
    tags: ['EDM', '경화강', '복잡'],
  },
];

/** Look up by id; null when unknown. */
export function getSystemTemplate(id: string): RfqSystemTemplate | null {
  return RFQ_SYSTEM_TEMPLATES.find(t => t.id === id) ?? null;
}

/** Filter by category. */
export function listByCategory(category: RfqSystemTemplate['category']): RfqSystemTemplate[] {
  return RFQ_SYSTEM_TEMPLATES.filter(t => t.category === category);
}
