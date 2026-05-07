/**
 * parts.ts — NexyFab 검증 부품 JSCAD 템플릿 카탈로그 (L3)
 *
 * 각 템플릿은:
 *  1. 메타데이터 (AI의 매칭/선택용)
 *  2. 파라미터 정의 (사용자/AI가 조정할 변수)
 *  3. JSCAD 스니펫 ({{paramName}} 치환)
 *
 * LLM(Composition Agent)은 카탈로그를 보고 적절한 템플릿 조합을 고른 뒤
 * 파라미터 값을 스펙에 맞게 채워서 JSCAD 코드를 합성함.
 */

export interface PartParameter {
  name: string;
  unit: 'mm' | 'deg' | 'count' | '';
  default: number;
  min: number;
  max: number;
  description: string;
}

export interface PartTemplate {
  id: string;
  nameKo: string;
  nameEn: string;
  category: string;
  description: string;
  useCases: string[];              // ["고정", "브라켓"] 등 IntakeSpec.function과 매칭
  standards: string[];             // 'ISO 4014' 등
  compatibleMethods: string[];     // L2 method id와 매칭
  parameters: PartParameter[];
  jscadSnippet: string;            // {{param}} 자리표시자 포함 JSCAD 코드
}

export const PARTS_CATALOG: PartTemplate[] = [
  // ─────────── 1. L 브라켓 ───────────
  {
    id: 'bracket-l',
    nameKo: 'L 브라켓',
    nameEn: 'L-Bracket',
    category: 'bracket',
    description: '직각으로 꺾인 L 형태 브라켓. 두 면을 직교로 고정할 때.',
    useCases: ['fix', 'support', 'mount'],
    standards: [],
    compatibleMethods: ['sheet-metal', 'cnc-milling', 'casting-sand', '3dprint-fdm'],
    parameters: [
      { name: 'width', unit: 'mm', default: 50, min: 10, max: 300, description: '가로 폭' },
      { name: 'height', unit: 'mm', default: 50, min: 10, max: 300, description: '세로 높이' },
      { name: 'depth', unit: 'mm', default: 40, min: 10, max: 200, description: '안쪽 깊이' },
      { name: 'thickness', unit: 'mm', default: 4, min: 1.5, max: 20, description: '벽 두께' },
      { name: 'holeRadius', unit: 'mm', default: 2.75, min: 1.5, max: 10, description: '볼트 구멍 반경 (M5=2.75)' },
      { name: 'holeCount', unit: 'count', default: 2, min: 0, max: 6, description: '면당 구멍 개수' },
    ],
    jscadSnippet: `const width = {{width}};
const height = {{height}};
const depth = {{depth}};
const thickness = {{thickness}};
const holeRadius = {{holeRadius}};
const holeCount = {{holeCount}};

function makeLBracket() {
  const horiz = primitives.cuboid({ size: [width, thickness, depth], center: [0, thickness/2, 0] });
  const vert = primitives.cuboid({ size: [width, height, thickness], center: [0, height/2, -depth/2 + thickness/2] });
  let solid = booleans.union(horiz, vert);
  if (holeCount > 0) {
    const tools = [];
    const spacing = width / (holeCount + 1);
    for (let i = 1; i <= holeCount; i++) {
      const x = -width/2 + spacing * i;
      tools.push(transforms.translate([x, 0, depth/4], transforms.rotate([Math.PI/2, 0, 0], primitives.cylinder({ radius: holeRadius, height: thickness * 2, segments: 32 }))));
      tools.push(transforms.translate([x, height/2, -depth/2 + thickness/2], primitives.cylinder({ radius: holeRadius, height: thickness * 2, segments: 32 })));
    }
    solid = booleans.subtract(solid, ...tools);
  }
  return solid;
}

function main() { return makeLBracket(); }`,
  },

  // ─────────── 2. 평 브라켓 (플랫 플레이트) ───────────
  {
    id: 'bracket-flat',
    nameKo: '평 브라켓',
    nameEn: 'Flat Bracket',
    category: 'bracket',
    description: '평판에 볼트 구멍을 낸 간단한 고정 브라켓.',
    useCases: ['fix', 'mount', 'connect'],
    standards: [],
    compatibleMethods: ['sheet-metal', 'laser-cut', 'waterjet', 'cnc-milling'],
    parameters: [
      { name: 'width', unit: 'mm', default: 80, min: 20, max: 500, description: '폭' },
      { name: 'length', unit: 'mm', default: 40, min: 20, max: 500, description: '길이' },
      { name: 'thickness', unit: 'mm', default: 3, min: 1, max: 15, description: '두께' },
      { name: 'holeRadius', unit: 'mm', default: 3.3, min: 1.5, max: 10, description: '구멍 반경 (M6=3.3)' },
      { name: 'holeCount', unit: 'count', default: 4, min: 2, max: 10, description: '구멍 개수' },
    ],
    jscadSnippet: `const width = {{width}};
const length = {{length}};
const thickness = {{thickness}};
const holeRadius = {{holeRadius}};
const holeCount = {{holeCount}};

function makeFlatBracket() {
  let plate = primitives.cuboid({ size: [width, length, thickness] });
  const tools = [];
  const perSide = Math.ceil(holeCount / 2);
  const spacing = width / (perSide + 1);
  for (let i = 1; i <= perSide; i++) {
    const x = -width/2 + spacing * i;
    tools.push(transforms.translate([x, length/2 - 8, 0], primitives.cylinder({ radius: holeRadius, height: thickness * 2, segments: 32 })));
    if (holeCount > perSide) {
      tools.push(transforms.translate([x, -length/2 + 8, 0], primitives.cylinder({ radius: holeRadius, height: thickness * 2, segments: 32 })));
    }
  }
  return booleans.subtract(plate, ...tools);
}

function main() { return makeFlatBracket(); }`,
  },

  // ─────────── 3. 원형 플랜지 ───────────
  {
    id: 'flange-round',
    nameKo: '원형 플랜지',
    nameEn: 'Round Flange',
    category: 'flange',
    description: '원형 플랜지. PCD(볼트 원주) 기준 볼트 배열.',
    useCases: ['connect', 'mount', 'transmit'],
    standards: ['ISO 7005-1'],
    compatibleMethods: ['cnc-milling', 'cnc-turning', 'casting-sand', 'forging'],
    parameters: [
      { name: 'outerDiameter', unit: 'mm', default: 80, min: 30, max: 500, description: '외경' },
      { name: 'boreDiameter', unit: 'mm', default: 20, min: 5, max: 200, description: '중앙 구멍 지름' },
      { name: 'thickness', unit: 'mm', default: 10, min: 3, max: 50, description: '두께' },
      { name: 'boltCount', unit: 'count', default: 4, min: 3, max: 16, description: '볼트 구멍 개수' },
      { name: 'pcd', unit: 'mm', default: 60, min: 20, max: 450, description: 'PCD (볼트 원주 지름)' },
      { name: 'boltRadius', unit: 'mm', default: 3.3, min: 1.5, max: 10, description: '볼트 구멍 반경 (M6=3.3)' },
    ],
    jscadSnippet: `const outerDiameter = {{outerDiameter}};
const boreDiameter = {{boreDiameter}};
const thickness = {{thickness}};
const boltCount = {{boltCount}};
const pcd = {{pcd}};
const boltRadius = {{boltRadius}};

function makeFlange() {
  let base = primitives.cylinder({ radius: outerDiameter/2, height: thickness, segments: 64 });
  const bore = primitives.cylinder({ radius: boreDiameter/2, height: thickness * 2, segments: 48 });
  const tools = [bore];
  for (let i = 0; i < boltCount; i++) {
    const a = (i / boltCount) * Math.PI * 2;
    const x = Math.cos(a) * (pcd/2);
    const y = Math.sin(a) * (pcd/2);
    tools.push(transforms.translate([x, y, 0], primitives.cylinder({ radius: boltRadius, height: thickness * 2, segments: 32 })));
  }
  return booleans.subtract(base, ...tools);
}

function main() { return makeFlange(); }`,
  },

  // ─────────── 4. 샤프트 ───────────
  {
    id: 'shaft-cylindrical',
    nameKo: '원통 샤프트',
    nameEn: 'Cylindrical Shaft',
    category: 'shaft',
    description: '원통형 축. 양단에 베어링 장착용 단차 가능.',
    useCases: ['transmit', 'support', 'align'],
    standards: ['ISO 286'],
    compatibleMethods: ['cnc-turning', 'cnc-milling', 'grinding'],
    parameters: [
      { name: 'length', unit: 'mm', default: 100, min: 20, max: 1000, description: '총 길이' },
      { name: 'diameter', unit: 'mm', default: 12, min: 3, max: 100, description: '주 직경' },
      { name: 'endDiameter', unit: 'mm', default: 10, min: 3, max: 100, description: '양단 직경 (베어링 시트)' },
      { name: 'endLength', unit: 'mm', default: 15, min: 0, max: 100, description: '양단 길이 (0=단차 없음)' },
    ],
    jscadSnippet: `const length = {{length}};
const diameter = {{diameter}};
const endDiameter = {{endDiameter}};
const endLength = {{endLength}};

function makeShaft() {
  if (endLength <= 0 || endDiameter >= diameter) {
    return primitives.cylinder({ radius: diameter/2, height: length, segments: 48 });
  }
  const mid = primitives.cylinder({ radius: diameter/2, height: length - 2 * endLength, segments: 48 });
  const endA = transforms.translate([0, 0, (length - endLength)/2], primitives.cylinder({ radius: endDiameter/2, height: endLength, segments: 48 }));
  const endB = transforms.translate([0, 0, -(length - endLength)/2], primitives.cylinder({ radius: endDiameter/2, height: endLength, segments: 48 }));
  return booleans.union(mid, endA, endB);
}

function main() { return makeShaft(); }`,
  },

  // ─────────── 5. 리지드 커플링 ───────────
  {
    id: 'coupling-rigid',
    nameKo: '리지드 커플링',
    nameEn: 'Rigid Coupling',
    category: 'coupling',
    description: '두 축을 강성 연결하는 커플링. 세트 스크류 홀 포함.',
    useCases: ['transmit', 'connect'],
    standards: [],
    compatibleMethods: ['cnc-turning', 'cnc-milling'],
    parameters: [
      { name: 'outerDiameter', unit: 'mm', default: 25, min: 10, max: 100, description: '외경' },
      { name: 'length', unit: 'mm', default: 30, min: 10, max: 150, description: '길이' },
      { name: 'bore', unit: 'mm', default: 8, min: 3, max: 50, description: '축 구멍 지름' },
      { name: 'setScrewRadius', unit: 'mm', default: 1.5, min: 1, max: 4, description: '세트 스크류 반경 (M3=1.5)' },
    ],
    jscadSnippet: `const outerDiameter = {{outerDiameter}};
const length = {{length}};
const bore = {{bore}};
const setScrewRadius = {{setScrewRadius}};

function makeCoupling() {
  let body = primitives.cylinder({ radius: outerDiameter/2, height: length, segments: 48 });
  const throughBore = primitives.cylinder({ radius: bore/2, height: length * 2, segments: 32 });
  const screwA = transforms.translate([0, 0, length/4], transforms.rotate([0, Math.PI/2, 0], primitives.cylinder({ radius: setScrewRadius, height: outerDiameter * 2, segments: 24 })));
  const screwB = transforms.translate([0, 0, -length/4], transforms.rotate([0, Math.PI/2, 0], primitives.cylinder({ radius: setScrewRadius, height: outerDiameter * 2, segments: 24 })));
  return booleans.subtract(body, throughBore, screwA, screwB);
}

function main() { return makeCoupling(); }`,
  },

  // ─────────── 6. 스탠드오프 ───────────
  {
    id: 'standoff',
    nameKo: '스탠드오프 / 스페이서',
    nameEn: 'Standoff / Spacer',
    category: 'spacer',
    description: 'PCB/판재 간격을 띄우는 원통형 스페이서.',
    useCases: ['support', 'align', 'mount'],
    standards: [],
    compatibleMethods: ['cnc-turning', '3dprint-fdm', 'cnc-milling'],
    parameters: [
      { name: 'outerDiameter', unit: 'mm', default: 8, min: 3, max: 30, description: '외경' },
      { name: 'length', unit: 'mm', default: 20, min: 3, max: 100, description: '길이' },
      { name: 'throughHole', unit: 'mm', default: 3.3, min: 0, max: 15, description: '관통 구멍 반경 (0=솔리드)' },
    ],
    jscadSnippet: `const outerDiameter = {{outerDiameter}};
const length = {{length}};
const throughHole = {{throughHole}};

function makeStandoff() {
  let body = primitives.cylinder({ radius: outerDiameter/2, height: length, segments: 32 });
  if (throughHole > 0) {
    const hole = primitives.cylinder({ radius: throughHole, height: length * 2, segments: 24 });
    body = booleans.subtract(body, hole);
  }
  return body;
}

function main() { return makeStandoff(); }`,
  },

  // ─────────── 7. 평 기어 ───────────
  {
    id: 'gear-spur',
    nameKo: '평 기어 (스퍼 기어)',
    nameEn: 'Spur Gear',
    category: 'gear',
    description: '모듈 기반 평 기어. 인볼류트 근사 프로파일.',
    useCases: ['transmit'],
    standards: ['ISO 1328'],
    compatibleMethods: ['cnc-milling', 'wire-edm', 'hobbing'],
    parameters: [
      { name: 'teeth', unit: 'count', default: 20, min: 6, max: 100, description: '이빨 수' },
      { name: 'module', unit: 'mm', default: 2, min: 0.5, max: 10, description: '모듈 (m)' },
      { name: 'thickness', unit: 'mm', default: 8, min: 2, max: 50, description: '기어 두께' },
      { name: 'boreDiameter', unit: 'mm', default: 8, min: 3, max: 50, description: '축 구멍 지름' },
    ],
    jscadSnippet: `const teeth = {{teeth}};
const gearModule = {{module}};
const thickness = {{thickness}};
const boreDiameter = {{boreDiameter}};

function makeGear() {
  const pitchR = teeth * gearModule / 2;
  const addendum = gearModule;
  const dedendum = gearModule * 1.25;
  const outerR = pitchR + addendum;
  const rootR = pitchR - dedendum;
  // 근사: 톱니 윤곽을 cuboid-subtract 방식으로 단순화
  let body = primitives.cylinder({ radius: outerR, height: thickness, segments: teeth * 4 });
  const tools = [];
  // 축 구멍
  tools.push(primitives.cylinder({ radius: boreDiameter/2, height: thickness * 2, segments: 32 }));
  // 톱니 간 slot 제거 (사다리꼴 근사)
  const slotWidth = (Math.PI * 2 * rootR) / teeth * 0.4;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const slot = primitives.cuboid({ size: [slotWidth, (outerR - rootR) * 2 + 2, thickness * 1.5] });
    tools.push(transforms.translate([Math.cos(a) * outerR, Math.sin(a) * outerR, 0], transforms.rotate([0, 0, a], slot)));
  }
  return booleans.subtract(body, ...tools);
}

function main() { return makeGear(); }`,
  },

  // ─────────── 8. 타공 플레이트 ───────────
  {
    id: 'plate-with-holes',
    nameKo: '타공 플레이트',
    nameEn: 'Plate with Holes',
    category: 'plate',
    description: '격자 패턴 타공 플레이트. 공조/방열판/필터용.',
    useCases: ['protect', 'mount'],
    standards: [],
    compatibleMethods: ['laser-cut', 'waterjet', 'sheet-metal', 'cnc-milling'],
    parameters: [
      { name: 'width', unit: 'mm', default: 100, min: 20, max: 500, description: '폭' },
      { name: 'length', unit: 'mm', default: 100, min: 20, max: 500, description: '길이' },
      { name: 'thickness', unit: 'mm', default: 2, min: 0.5, max: 10, description: '두께' },
      { name: 'holeSpacing', unit: 'mm', default: 15, min: 5, max: 50, description: '구멍 간격' },
      { name: 'holeRadius', unit: 'mm', default: 3, min: 1, max: 15, description: '구멍 반경' },
    ],
    jscadSnippet: `const width = {{width}};
const length = {{length}};
const thickness = {{thickness}};
const holeSpacing = {{holeSpacing}};
const holeRadius = {{holeRadius}};

function makePerforatedPlate() {
  let plate = primitives.cuboid({ size: [width, length, thickness] });
  const tools = [];
  const nx = Math.floor(width / holeSpacing) - 1;
  const ny = Math.floor(length / holeSpacing) - 1;
  const startX = -(nx - 1) * holeSpacing / 2;
  const startY = -(ny - 1) * holeSpacing / 2;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      tools.push(transforms.translate([startX + i * holeSpacing, startY + j * holeSpacing, 0],
        primitives.cylinder({ radius: holeRadius, height: thickness * 2, segments: 20 })));
    }
  }
  return booleans.subtract(plate, ...tools);
}

function main() { return makePerforatedPlate(); }`,
  },

  // ─────────── 9. 커버 플레이트 ───────────
  {
    id: 'cover-plate',
    nameKo: '커버 플레이트',
    nameEn: 'Cover Plate',
    category: 'cover',
    description: '하우징 덮개. 모서리 4곳에 고정 스크류 구멍.',
    useCases: ['protect', 'fix'],
    standards: [],
    compatibleMethods: ['sheet-metal', 'laser-cut', 'cnc-milling', 'injection'],
    parameters: [
      { name: 'width', unit: 'mm', default: 100, min: 20, max: 500, description: '폭' },
      { name: 'length', unit: 'mm', default: 80, min: 20, max: 500, description: '길이' },
      { name: 'thickness', unit: 'mm', default: 2.5, min: 1, max: 10, description: '두께' },
      { name: 'margin', unit: 'mm', default: 6, min: 3, max: 30, description: '모서리 여백' },
      { name: 'screwRadius', unit: 'mm', default: 1.7, min: 1, max: 5, description: '스크류 반경 (M3=1.7)' },
    ],
    jscadSnippet: `const width = {{width}};
const length = {{length}};
const thickness = {{thickness}};
const margin = {{margin}};
const screwRadius = {{screwRadius}};

function makeCoverPlate() {
  let plate = primitives.cuboid({ size: [width, length, thickness] });
  const corners = [
    [ width/2 - margin,  length/2 - margin],
    [-width/2 + margin,  length/2 - margin],
    [ width/2 - margin, -length/2 + margin],
    [-width/2 + margin, -length/2 + margin],
  ];
  const tools = corners.map(([x, y]) => transforms.translate([x, y, 0],
    primitives.cylinder({ radius: screwRadius, height: thickness * 2, segments: 24 })));
  return booleans.subtract(plate, ...tools);
}

function main() { return makeCoverPlate(); }`,
  },

  // ─────────── 10. 베어링 시트 ───────────
  {
    id: 'bearing-seat',
    nameKo: '베어링 시트',
    nameEn: 'Bearing Seat',
    category: 'mount',
    description: '베어링 삽입용 시트 하우징. 플랜지형.',
    useCases: ['support', 'mount', 'align'],
    standards: ['ISO 15'],
    compatibleMethods: ['cnc-milling', 'cnc-turning', 'casting-sand'],
    parameters: [
      { name: 'outerDiameter', unit: 'mm', default: 60, min: 20, max: 300, description: '플랜지 외경' },
      { name: 'bearingDiameter', unit: 'mm', default: 22, min: 10, max: 200, description: '베어링 외경 (시트 내경)' },
      { name: 'bearingDepth', unit: 'mm', default: 7, min: 3, max: 50, description: '베어링 깊이' },
      { name: 'flangeThickness', unit: 'mm', default: 8, min: 3, max: 30, description: '플랜지 두께' },
      { name: 'boltCount', unit: 'count', default: 4, min: 3, max: 8, description: '볼트 구멍 수' },
      { name: 'pcd', unit: 'mm', default: 45, min: 20, max: 250, description: 'PCD' },
      { name: 'boltRadius', unit: 'mm', default: 2.75, min: 1.5, max: 8, description: '볼트 구멍 반경 (M5=2.75)' },
    ],
    jscadSnippet: `const outerDiameter = {{outerDiameter}};
const bearingDiameter = {{bearingDiameter}};
const bearingDepth = {{bearingDepth}};
const flangeThickness = {{flangeThickness}};
const boltCount = {{boltCount}};
const pcd = {{pcd}};
const boltRadius = {{boltRadius}};

function makeBearingSeat() {
  let body = primitives.cylinder({ radius: outerDiameter/2, height: flangeThickness, segments: 64 });
  const pocket = transforms.translate([0, 0, flangeThickness/2 - bearingDepth/2],
    primitives.cylinder({ radius: bearingDiameter/2, height: bearingDepth + 0.1, segments: 48 }));
  const tools = [pocket];
  for (let i = 0; i < boltCount; i++) {
    const a = (i / boltCount) * Math.PI * 2;
    tools.push(transforms.translate([Math.cos(a) * pcd/2, Math.sin(a) * pcd/2, 0],
      primitives.cylinder({ radius: boltRadius, height: flangeThickness * 2, segments: 24 })));
  }
  return booleans.subtract(body, ...tools);
}

function main() { return makeBearingSeat(); }`,
  },

  // ─────────── 11. 박스 하우징 ───────────
  {
    id: 'housing-box',
    nameKo: '박스 하우징',
    nameEn: 'Box Housing',
    category: 'housing',
    description: '직육면체 상자형 하우징. 상단 개방.',
    useCases: ['protect', 'mount'],
    standards: [],
    compatibleMethods: ['injection', 'sheet-metal', 'cnc-milling', '3dprint-fdm'],
    parameters: [
      { name: 'width', unit: 'mm', default: 100, min: 30, max: 500, description: '폭' },
      { name: 'length', unit: 'mm', default: 80, min: 30, max: 500, description: '길이' },
      { name: 'height', unit: 'mm', default: 40, min: 10, max: 300, description: '높이' },
      { name: 'wallThickness', unit: 'mm', default: 2.5, min: 1, max: 10, description: '벽 두께' },
    ],
    jscadSnippet: `const width = {{width}};
const length = {{length}};
const height = {{height}};
const wallThickness = {{wallThickness}};

function makeBoxHousing() {
  const outer = primitives.cuboid({ size: [width, length, height] });
  const inner = transforms.translate([0, 0, wallThickness/2],
    primitives.cuboid({ size: [width - 2*wallThickness, length - 2*wallThickness, height] }));
  return booleans.subtract(outer, inner);
}

function main() { return makeBoxHousing(); }`,
  },

  // ─────────── 12. T-슬롯 알루미늄 프로파일 ───────────
  {
    id: 'profile-tslot',
    nameKo: 'T-슬롯 알루미늄 프로파일',
    nameEn: 'T-Slot Aluminum Profile',
    category: 'structural',
    description: '20×20/30×30 T-슬롯 프로파일. 프레임·머신 구조 표준.',
    useCases: ['support', 'mount', 'connect'],
    standards: ['Bosch Rexroth', 'Misumi HFS'],
    compatibleMethods: ['extrusion', 'cnc-milling'],
    parameters: [
      { name: 'side', unit: 'mm', default: 30, min: 15, max: 80, description: '단변 (정사각)' },
      { name: 'length', unit: 'mm', default: 300, min: 50, max: 3000, description: '길이' },
      { name: 'slotWidth', unit: 'mm', default: 8, min: 4, max: 12, description: '슬롯 폭' },
      { name: 'slotDepth', unit: 'mm', default: 6, min: 3, max: 10, description: '슬롯 깊이' },
    ],
    jscadSnippet: `const side = {{side}};
const length = {{length}};
const slotWidth = {{slotWidth}};
const slotDepth = {{slotDepth}};

function makeProfile() {
  const body = primitives.cuboid({ size: [side, side, length] });
  const slot = primitives.cuboid({ size: [slotWidth, slotDepth*2, length+2] });
  const slot1 = transforms.translate([0, side/2, 0], slot);
  const slot2 = transforms.translate([0, -side/2, 0], slot);
  const slot3 = transforms.rotate([0,0,Math.PI/2], transforms.translate([0, side/2, 0], slot));
  const slot4 = transforms.rotate([0,0,Math.PI/2], transforms.translate([0, -side/2, 0], slot));
  return booleans.subtract(body, slot1, slot2, slot3, slot4);
}

function main() { return makeProfile(); }`,
  },

  // ─────────── 13. H-빔 구조재 ───────────
  {
    id: 'beam-h',
    nameKo: 'H 빔',
    nameEn: 'H-Beam',
    category: 'structural',
    description: 'H 형강. 건축·중장비 구조 부재.',
    useCases: ['support'],
    standards: ['KS D 3502', 'JIS G 3101'],
    compatibleMethods: ['cnc-milling', 'laser-cut', 'waterjet', 'tig-welding'],
    parameters: [
      { name: 'height', unit: 'mm', default: 100, min: 30, max: 600, description: '전체 높이' },
      { name: 'flange', unit: 'mm', default: 100, min: 30, max: 400, description: '플랜지 폭' },
      { name: 'webThickness', unit: 'mm', default: 6, min: 3, max: 20, description: '웹 두께' },
      { name: 'flangeThickness', unit: 'mm', default: 8, min: 3, max: 25, description: '플랜지 두께' },
      { name: 'length', unit: 'mm', default: 500, min: 100, max: 3000, description: '길이' },
    ],
    jscadSnippet: `const height = {{height}};
const flange = {{flange}};
const webThickness = {{webThickness}};
const flangeThickness = {{flangeThickness}};
const length = {{length}};

function makeHBeam() {
  const top = transforms.translate([0, (height-flangeThickness)/2, 0],
    primitives.cuboid({ size: [flange, flangeThickness, length] }));
  const bot = transforms.translate([0, -(height-flangeThickness)/2, 0],
    primitives.cuboid({ size: [flange, flangeThickness, length] }));
  const web = primitives.cuboid({ size: [webThickness, height - 2*flangeThickness, length] });
  return booleans.union(top, bot, web);
}

function main() { return makeHBeam(); }`,
  },

  // ─────────── 14. U 채널 ───────────
  {
    id: 'channel-u',
    nameKo: 'U 채널',
    nameEn: 'U-Channel',
    category: 'structural',
    description: 'U 자형 채널. 가이드·프레임·트림.',
    useCases: ['support', 'connect'],
    standards: [],
    compatibleMethods: ['sheet-metal', 'extrusion', 'cnc-milling'],
    parameters: [
      { name: 'width', unit: 'mm', default: 40, min: 10, max: 200, description: '내부 폭' },
      { name: 'height', unit: 'mm', default: 30, min: 10, max: 200, description: '벽 높이' },
      { name: 'thickness', unit: 'mm', default: 3, min: 1, max: 10, description: '두께' },
      { name: 'length', unit: 'mm', default: 200, min: 50, max: 2000, description: '길이' },
    ],
    jscadSnippet: `const width = {{width}};
const height = {{height}};
const thickness = {{thickness}};
const length = {{length}};

function makeUChannel() {
  const outer = primitives.cuboid({ size: [width + 2*thickness, height, length] });
  const inner = transforms.translate([0, thickness, 0],
    primitives.cuboid({ size: [width, height, length+2] }));
  return booleans.subtract(outer, inner);
}

function main() { return makeUChannel(); }`,
  },

  // ─────────── 15. 테이블 다리 ───────────
  {
    id: 'leg-table',
    nameKo: '테이블 다리',
    nameEn: 'Table Leg',
    category: 'structural',
    description: '원통 테이블/가구 다리 + 베이스 플랜지.',
    useCases: ['support', 'mount'],
    standards: [],
    compatibleMethods: ['cnc-turning', 'cnc-milling', 'casting-sand'],
    parameters: [
      { name: 'topRadius', unit: 'mm', default: 25, min: 10, max: 80, description: '상단 반경' },
      { name: 'baseRadius', unit: 'mm', default: 50, min: 20, max: 150, description: '베이스 반경' },
      { name: 'height', unit: 'mm', default: 700, min: 100, max: 1200, description: '다리 높이' },
      { name: 'baseThickness', unit: 'mm', default: 10, min: 3, max: 30, description: '베이스 두께' },
    ],
    jscadSnippet: `const topRadius = {{topRadius}};
const baseRadius = {{baseRadius}};
const height = {{height}};
const baseThickness = {{baseThickness}};

function makeLeg() {
  const stem = primitives.cylinder({ radius: topRadius, height: height - baseThickness, segments: 64 });
  const base = transforms.translate([0, 0, -(height-baseThickness)/2 + baseThickness/2 - (height-baseThickness)/2],
    primitives.cylinder({ radius: baseRadius, height: baseThickness, segments: 64 }));
  return booleans.union(stem, base);
}

function main() { return makeLeg(); }`,
  },

  // ─────────── 16. 삼각 보강판 (Gusset) ───────────
  {
    id: 'gusset-triangular',
    nameKo: '삼각 보강판',
    nameEn: 'Triangular Gusset',
    category: 'plate',
    description: '두 면 사이 직각을 보강하는 삼각 플레이트.',
    useCases: ['support', 'fix'],
    standards: [],
    compatibleMethods: ['laser-cut', 'waterjet', 'sheet-metal', 'cnc-milling'],
    parameters: [
      { name: 'legA', unit: 'mm', default: 60, min: 20, max: 300, description: '한쪽 변 길이' },
      { name: 'legB', unit: 'mm', default: 60, min: 20, max: 300, description: '다른 변 길이' },
      { name: 'thickness', unit: 'mm', default: 5, min: 1.5, max: 25, description: '판 두께' },
    ],
    jscadSnippet: `const legA = {{legA}};
const legB = {{legB}};
const thickness = {{thickness}};

function makeGusset() {
  const tri2d = primitives.polygon({ points: [[0,0],[legA,0],[0,legB]] });
  return extrusions.extrudeLinear({ height: thickness }, tri2d);
}

function main() { return makeGusset(); }`,
  },

  // ─────────── 17. 모서리 둥근 케이스 ───────────
  {
    id: 'housing-rounded',
    nameKo: '둥근 케이스',
    nameEn: 'Rounded Enclosure',
    category: 'housing',
    description: '모서리 라운드 처리된 전자기기 케이스.',
    useCases: ['protect'],
    standards: ['IP54', 'IP65'],
    compatibleMethods: ['injection', '3dprint-sls', 'cnc-milling'],
    parameters: [
      { name: 'width', unit: 'mm', default: 120, min: 30, max: 500, description: '폭' },
      { name: 'length', unit: 'mm', default: 80, min: 30, max: 500, description: '길이' },
      { name: 'height', unit: 'mm', default: 35, min: 10, max: 200, description: '높이' },
      { name: 'cornerRadius', unit: 'mm', default: 8, min: 1, max: 40, description: '모서리 반경' },
      { name: 'wallThickness', unit: 'mm', default: 2.5, min: 1, max: 8, description: '벽 두께' },
    ],
    jscadSnippet: `const width = {{width}};
const length = {{length}};
const height = {{height}};
const cornerRadius = {{cornerRadius}};
const wallThickness = {{wallThickness}};

function makeRounded() {
  const outer = primitives.roundedCuboid({ size: [width, length, height], roundRadius: cornerRadius, segments: 32 });
  const innerSize = [width - 2*wallThickness, length - 2*wallThickness, height];
  const inner = transforms.translate([0, 0, wallThickness/2],
    primitives.roundedCuboid({ size: innerSize, roundRadius: Math.max(0.5, cornerRadius - wallThickness), segments: 32 }));
  return booleans.subtract(outer, inner);
}

function main() { return makeRounded(); }`,
  },

  // ─────────── 18. 원통형 인클로저 ───────────
  {
    id: 'enclosure-cylindrical',
    nameKo: '원통 인클로저',
    nameEn: 'Cylindrical Enclosure',
    category: 'housing',
    description: '원통 형상의 인클로저. 센서/조명/모터.',
    useCases: ['protect', 'mount'],
    standards: [],
    compatibleMethods: ['cnc-turning', 'injection', '3dprint-sls'],
    parameters: [
      { name: 'outerRadius', unit: 'mm', default: 30, min: 10, max: 150, description: '외경 반경' },
      { name: 'height', unit: 'mm', default: 60, min: 15, max: 400, description: '높이' },
      { name: 'wallThickness', unit: 'mm', default: 2.5, min: 1, max: 10, description: '벽 두께' },
      { name: 'capThickness', unit: 'mm', default: 3, min: 1, max: 12, description: '바닥 두께' },
    ],
    jscadSnippet: `const outerRadius = {{outerRadius}};
const height = {{height}};
const wallThickness = {{wallThickness}};
const capThickness = {{capThickness}};

function makeCylEnclosure() {
  const outer = primitives.cylinder({ radius: outerRadius, height, segments: 96 });
  const inner = transforms.translate([0,0, capThickness/2],
    primitives.cylinder({ radius: outerRadius - wallThickness, height: height - capThickness + 1, segments: 96 }));
  return booleans.subtract(outer, inner);
}

function main() { return makeCylEnclosure(); }`,
  },

  // ─────────── 19. 통풍 케이스 ───────────
  {
    id: 'housing-vented',
    nameKo: '통풍 케이스',
    nameEn: 'Vented Enclosure',
    category: 'housing',
    description: '슬롯 통풍구가 있는 발열 부품용 케이스.',
    useCases: ['protect'],
    standards: [],
    compatibleMethods: ['sheet-metal', 'laser-cut', 'cnc-milling'],
    parameters: [
      { name: 'width', unit: 'mm', default: 120, min: 50, max: 400, description: '폭' },
      { name: 'length', unit: 'mm', default: 80, min: 40, max: 400, description: '길이' },
      { name: 'height', unit: 'mm', default: 50, min: 20, max: 200, description: '높이' },
      { name: 'wallThickness', unit: 'mm', default: 2, min: 1, max: 6, description: '벽 두께' },
      { name: 'slotCount', unit: 'count', default: 6, min: 2, max: 20, description: '슬롯 개수' },
    ],
    jscadSnippet: `const width = {{width}};
const length = {{length}};
const height = {{height}};
const wallThickness = {{wallThickness}};
const slotCount = {{slotCount}};

function makeVented() {
  const outer = primitives.cuboid({ size: [width, length, height] });
  const inner = transforms.translate([0,0,wallThickness/2],
    primitives.cuboid({ size: [width-2*wallThickness, length-2*wallThickness, height] }));
  let body = booleans.subtract(outer, inner);
  const slotW = width / (slotCount * 2 + 1);
  const slots = [];
  for (let i = 0; i < slotCount; i++) {
    const x = -width/2 + slotW * (1 + i*2 + 0.5);
    slots.push(transforms.translate([x, 0, height/2 - wallThickness/2],
      primitives.cuboid({ size: [slotW, length*0.7, wallThickness*2] })));
  }
  return booleans.subtract(body, ...slots);
}

function main() { return makeVented(); }`,
  },

  // ─────────── 20. D 핸들 ───────────
  {
    id: 'handle-d',
    nameKo: 'D 핸들',
    nameEn: 'D-Handle',
    category: 'mount',
    description: 'D 형 손잡이. 서랍·문·장비.',
    useCases: ['mount'],
    standards: [],
    compatibleMethods: ['cnc-milling', 'casting-sand', '3dprint-sls'],
    parameters: [
      { name: 'span', unit: 'mm', default: 100, min: 40, max: 300, description: '양단 거리' },
      { name: 'standoff', unit: 'mm', default: 35, min: 15, max: 80, description: '돌출 높이' },
      { name: 'gripRadius', unit: 'mm', default: 6, min: 3, max: 15, description: '그립 굵기' },
      { name: 'baseRadius', unit: 'mm', default: 10, min: 5, max: 25, description: '베이스 반경' },
    ],
    jscadSnippet: `const span = {{span}};
const standoff = {{standoff}};
const gripRadius = {{gripRadius}};
const baseRadius = {{baseRadius}};

function makeDHandle() {
  const baseL = transforms.translate([-span/2, 0, 0], primitives.cylinder({ radius: baseRadius, height: standoff, segments: 32 }));
  const baseR = transforms.translate([ span/2, 0, 0], primitives.cylinder({ radius: baseRadius, height: standoff, segments: 32 }));
  const grip = transforms.translate([0, 0, standoff/2],
    transforms.rotate([0, Math.PI/2, 0], primitives.cylinder({ radius: gripRadius, height: span, segments: 32 })));
  return booleans.union(baseL, baseR, grip);
}

function main() { return makeDHandle(); }`,
  },

  // ─────────── 21. 조작 노브 ───────────
  {
    id: 'knob-control',
    nameKo: '조작 노브',
    nameEn: 'Control Knob',
    category: 'mount',
    description: '회전 다이얼/포텐셔미터 노브. 손가락 그립.',
    useCases: ['mount'],
    standards: [],
    compatibleMethods: ['injection', 'cnc-turning', '3dprint-fdm'],
    parameters: [
      { name: 'outerRadius', unit: 'mm', default: 15, min: 6, max: 50, description: '외경 반경' },
      { name: 'height', unit: 'mm', default: 18, min: 8, max: 60, description: '높이' },
      { name: 'shaftRadius', unit: 'mm', default: 3, min: 1.5, max: 12, description: '축 구멍 반경' },
      { name: 'gripCount', unit: 'count', default: 24, min: 6, max: 60, description: '그립 홈 개수' },
    ],
    jscadSnippet: `const outerRadius = {{outerRadius}};
const height = {{height}};
const shaftRadius = {{shaftRadius}};
const gripCount = {{gripCount}};

function makeKnob() {
  const body = primitives.cylinder({ radius: outerRadius, height, segments: 96 });
  const shaft = primitives.cylinder({ radius: shaftRadius, height: height + 1, segments: 24 });
  let knob = booleans.subtract(body, shaft);
  const gripDepth = outerRadius * 0.08;
  const grips = [];
  for (let i = 0; i < gripCount; i++) {
    const a = (i / gripCount) * Math.PI * 2;
    grips.push(transforms.translate([Math.cos(a)*outerRadius, Math.sin(a)*outerRadius, 0],
      primitives.cylinder({ radius: gripDepth, height: height + 1, segments: 8 })));
  }
  return booleans.subtract(knob, ...grips);
}

function main() { return makeKnob(); }`,
  },

  // ─────────── 22. 벨트 풀리 ───────────
  {
    id: 'pulley-belt',
    nameKo: '벨트 풀리',
    nameEn: 'Belt Pulley',
    category: 'gear',
    description: 'V 벨트/타이밍 벨트 풀리. 동력 전달.',
    useCases: ['transmit'],
    standards: ['HTD', 'GT2'],
    compatibleMethods: ['cnc-turning', 'cnc-milling'],
    parameters: [
      { name: 'outerRadius', unit: 'mm', default: 25, min: 8, max: 150, description: '외경 반경' },
      { name: 'width', unit: 'mm', default: 12, min: 4, max: 50, description: '풀리 폭' },
      { name: 'shaftRadius', unit: 'mm', default: 4, min: 2, max: 30, description: '축 구멍' },
      { name: 'flangeRadius', unit: 'mm', default: 28, min: 9, max: 160, description: '가이드 플랜지' },
      { name: 'flangeThickness', unit: 'mm', default: 2, min: 0.5, max: 8, description: '플랜지 두께' },
    ],
    jscadSnippet: `const outerRadius = {{outerRadius}};
const width = {{width}};
const shaftRadius = {{shaftRadius}};
const flangeRadius = {{flangeRadius}};
const flangeThickness = {{flangeThickness}};

function makePulley() {
  const body = primitives.cylinder({ radius: outerRadius, height: width, segments: 96 });
  const f1 = transforms.translate([0,0, (width+flangeThickness)/2],
    primitives.cylinder({ radius: flangeRadius, height: flangeThickness, segments: 96 }));
  const f2 = transforms.translate([0,0, -(width+flangeThickness)/2],
    primitives.cylinder({ radius: flangeRadius, height: flangeThickness, segments: 96 }));
  const shaft = primitives.cylinder({ radius: shaftRadius, height: width + 2*flangeThickness + 1, segments: 24 });
  return booleans.subtract(booleans.union(body, f1, f2), shaft);
}

function main() { return makePulley(); }`,
  },

  // ─────────── 23. V 블록 (지그) ───────────
  {
    id: 'v-block',
    nameKo: 'V 블록',
    nameEn: 'V-Block',
    category: 'mount',
    description: '원통 부품 정렬·고정용 V 홈 블록. 검사·가공 지그 표준.',
    useCases: ['fix', 'align'],
    standards: ['DIN 875'],
    compatibleMethods: ['cnc-milling', 'grinding'],
    parameters: [
      { name: 'width', unit: 'mm', default: 50, min: 20, max: 200, description: '폭' },
      { name: 'length', unit: 'mm', default: 80, min: 30, max: 300, description: '길이' },
      { name: 'height', unit: 'mm', default: 40, min: 20, max: 150, description: '높이' },
      { name: 'vAngle', unit: 'deg', default: 90, min: 60, max: 120, description: 'V 홈 각도' },
      { name: 'vDepth', unit: 'mm', default: 20, min: 5, max: 60, description: 'V 홈 깊이' },
    ],
    jscadSnippet: `const width = {{width}};
const length = {{length}};
const height = {{height}};
const vAngle = {{vAngle}} * Math.PI / 180;
const vDepth = {{vDepth}};

function makeVBlock() {
  const body = primitives.cuboid({ size: [width, length, height] });
  const halfWidth = vDepth * Math.tan(vAngle / 2);
  const vProfile = primitives.polygon({ points: [[-halfWidth, 0], [halfWidth, 0], [0, -vDepth]] });
  const v3d = transforms.translate([0, length/2 + 0.5, height/2],
    transforms.rotate([Math.PI/2, 0, 0], extrusions.extrudeLinear({ height: length + 1 }, vProfile)));
  return booleans.subtract(body, v3d);
}

function main() { return makeVBlock(); }`,
  },

  // ─────────── 24. 위치결정 핀 ───────────
  {
    id: 'pin-positioning',
    nameKo: '위치결정 핀',
    nameEn: 'Positioning Pin',
    category: 'mount',
    description: 'Dowel pin / locating pin. 정밀 위치 결정.',
    useCases: ['align', 'connect'],
    standards: ['ISO 2338', 'DIN 6325'],
    compatibleMethods: ['cnc-turning', 'grinding'],
    parameters: [
      { name: 'radius', unit: 'mm', default: 4, min: 1, max: 20, description: '직경 반경' },
      { name: 'length', unit: 'mm', default: 25, min: 5, max: 100, description: '길이' },
      { name: 'chamfer', unit: 'mm', default: 0.8, min: 0.2, max: 3, description: '모따기' },
    ],
    jscadSnippet: `const radius = {{radius}};
const length = {{length}};
const chamfer = {{chamfer}};

function makePin() {
  const body = primitives.cylinder({ radius, height: length, segments: 64 });
  // 끝단 모따기 - cone 빼기
  const ch1 = transforms.translate([0,0, length/2],
    primitives.cylinderElliptic({ startRadius: [radius, radius], endRadius: [radius - chamfer, radius - chamfer], height: chamfer, segments: 64 }));
  return body;
}

function main() { return makePin(); }`,
  },

  // ─────────── 25. 소프트 죠 어댑터 ───────────
  {
    id: 'soft-jaw',
    nameKo: '소프트 죠',
    nameEn: 'Soft Jaw',
    category: 'mount',
    description: '바이스/척에 부착하는 알루미늄 소프트 죠. 작업물별 가공.',
    useCases: ['fix'],
    standards: [],
    compatibleMethods: ['cnc-milling'],
    parameters: [
      { name: 'width', unit: 'mm', default: 100, min: 30, max: 250, description: '폭' },
      { name: 'height', unit: 'mm', default: 30, min: 15, max: 80, description: '높이' },
      { name: 'thickness', unit: 'mm', default: 25, min: 10, max: 60, description: '두께' },
      { name: 'boltSpacing', unit: 'mm', default: 60, min: 20, max: 200, description: '볼트 간격' },
      { name: 'boltRadius', unit: 'mm', default: 4, min: 2, max: 10, description: '볼트 구멍 반경' },
    ],
    jscadSnippet: `const width = {{width}};
const height = {{height}};
const thickness = {{thickness}};
const boltSpacing = {{boltSpacing}};
const boltRadius = {{boltRadius}};

function makeSoftJaw() {
  const body = primitives.cuboid({ size: [width, thickness, height] });
  const h1 = transforms.translate([-boltSpacing/2, 0, 0],
    transforms.rotate([Math.PI/2, 0, 0], primitives.cylinder({ radius: boltRadius, height: thickness + 1, segments: 32 })));
  const h2 = transforms.translate([ boltSpacing/2, 0, 0],
    transforms.rotate([Math.PI/2, 0, 0], primitives.cylinder({ radius: boltRadius, height: thickness + 1, segments: 32 })));
  return booleans.subtract(body, h1, h2);
}

function main() { return makeSoftJaw(); }`,
  },

  // ─────────── 26. 벽걸이 후크 ───────────
  {
    id: 'hook-wall',
    nameKo: '벽걸이 후크',
    nameEn: 'Wall Hook',
    category: 'bracket',
    description: 'L 형 벽걸이 후크. 의류·가방·도구.',
    useCases: ['mount', 'support'],
    standards: [],
    compatibleMethods: ['cnc-milling', '3dprint-fdm', 'sheet-metal', 'casting-sand'],
    parameters: [
      { name: 'baseWidth', unit: 'mm', default: 30, min: 15, max: 80, description: '베이스 폭' },
      { name: 'baseHeight', unit: 'mm', default: 60, min: 20, max: 150, description: '베이스 높이' },
      { name: 'thickness', unit: 'mm', default: 5, min: 2, max: 15, description: '두께' },
      { name: 'hookLength', unit: 'mm', default: 40, min: 15, max: 120, description: '후크 길이' },
      { name: 'hookRadius', unit: 'mm', default: 10, min: 3, max: 30, description: '후크 끝 반경' },
    ],
    jscadSnippet: `const baseWidth = {{baseWidth}};
const baseHeight = {{baseHeight}};
const thickness = {{thickness}};
const hookLength = {{hookLength}};
const hookRadius = {{hookRadius}};

function makeHook() {
  const base = primitives.cuboid({ size: [baseWidth, thickness, baseHeight] });
  const arm = transforms.translate([0, hookLength/2 + thickness/2, -baseHeight/2 + thickness/2],
    primitives.cuboid({ size: [baseWidth, hookLength, thickness] }));
  const tip = transforms.translate([0, hookLength + thickness/2, -baseHeight/2 + hookRadius/2],
    primitives.cuboid({ size: [baseWidth, thickness, hookRadius] }));
  return booleans.union(base, arm, tip);
}

function main() { return makeHook(); }`,
  },

  // ─────────── 27. 러버 풋 (방진 패드) ───────────
  {
    id: 'foot-rubber',
    nameKo: '러버 풋',
    nameEn: 'Rubber Foot',
    category: 'mount',
    description: '장비 하부 방진 풋. 미끄럼 방지.',
    useCases: ['support', 'mount'],
    standards: [],
    compatibleMethods: ['injection', '3dprint-fdm', 'cnc-turning'],
    parameters: [
      { name: 'topRadius', unit: 'mm', default: 12, min: 5, max: 40, description: '상단 반경' },
      { name: 'baseRadius', unit: 'mm', default: 18, min: 8, max: 50, description: '바닥 반경' },
      { name: 'height', unit: 'mm', default: 12, min: 4, max: 40, description: '높이' },
      { name: 'mountRadius', unit: 'mm', default: 3, min: 1.5, max: 8, description: '나사 구멍 반경' },
    ],
    jscadSnippet: `const topRadius = {{topRadius}};
const baseRadius = {{baseRadius}};
const height = {{height}};
const mountRadius = {{mountRadius}};

function makeFoot() {
  const body = primitives.cylinderElliptic({
    startRadius: [baseRadius, baseRadius],
    endRadius: [topRadius, topRadius],
    height, segments: 64
  });
  const hole = primitives.cylinder({ radius: mountRadius, height: height + 1, segments: 32 });
  return booleans.subtract(body, hole);
}

function main() { return makeFoot(); }`,
  },

  // ─────────── 28. 폴/파이프 마운트 ───────────
  {
    id: 'mount-pole',
    nameKo: '폴 마운트',
    nameEn: 'Pole Mount',
    category: 'mount',
    description: '파이프/폴에 장비를 클램프로 고정.',
    useCases: ['mount', 'fix'],
    standards: [],
    compatibleMethods: ['cnc-milling', 'casting-sand', '3dprint-sls'],
    parameters: [
      { name: 'poleRadius', unit: 'mm', default: 12.5, min: 5, max: 50, description: '폴 반경' },
      { name: 'thickness', unit: 'mm', default: 6, min: 3, max: 20, description: '클램프 두께' },
      { name: 'height', unit: 'mm', default: 30, min: 15, max: 100, description: '높이' },
      { name: 'plateWidth', unit: 'mm', default: 60, min: 30, max: 200, description: '장착 플레이트 폭' },
      { name: 'plateThickness', unit: 'mm', default: 5, min: 2, max: 15, description: '플레이트 두께' },
    ],
    jscadSnippet: `const poleRadius = {{poleRadius}};
const thickness = {{thickness}};
const height = {{height}};
const plateWidth = {{plateWidth}};
const plateThickness = {{plateThickness}};

function makePoleMount() {
  const outer = primitives.cylinder({ radius: poleRadius + thickness, height, segments: 64 });
  const inner = primitives.cylinder({ radius: poleRadius, height: height + 1, segments: 64 });
  const clamp = booleans.subtract(outer, inner);
  const slot = transforms.translate([0, poleRadius + thickness/2, 0],
    primitives.cuboid({ size: [thickness*0.4, thickness*1.5, height + 1] }));
  const split = booleans.subtract(clamp, slot);
  const plate = transforms.translate([-(poleRadius + thickness + plateWidth/2 - 1), 0, 0],
    primitives.cuboid({ size: [plateWidth, plateThickness, height] }));
  return booleans.union(split, plate);
}

function main() { return makePoleMount(); }`,
  },

  // ─────────── 29. 링 스페이서 / 와셔 ───────────
  {
    id: 'spacer-ring',
    nameKo: '링 스페이서',
    nameEn: 'Ring Spacer',
    category: 'spacer',
    description: '평와셔/링 스페이서. 두께 조절 / 절연.',
    useCases: ['fix', 'align'],
    standards: ['DIN 125', 'DIN 988'],
    compatibleMethods: ['cnc-turning', 'laser-cut', 'waterjet'],
    parameters: [
      { name: 'outerRadius', unit: 'mm', default: 10, min: 3, max: 60, description: '외경 반경' },
      { name: 'innerRadius', unit: 'mm', default: 5, min: 1, max: 50, description: '내경 반경' },
      { name: 'thickness', unit: 'mm', default: 1.5, min: 0.3, max: 20, description: '두께' },
    ],
    jscadSnippet: `const outerRadius = {{outerRadius}};
const innerRadius = {{innerRadius}};
const thickness = {{thickness}};

function makeRing() {
  const outer = primitives.cylinder({ radius: outerRadius, height: thickness, segments: 96 });
  const inner = primitives.cylinder({ radius: innerRadius, height: thickness + 1, segments: 64 });
  return booleans.subtract(outer, inner);
}

function main() { return makeRing(); }`,
  },

  // ─────────── 30. 일자 경첩 ───────────
  {
    id: 'hinge-butt',
    nameKo: '일자 경첩',
    nameEn: 'Butt Hinge',
    category: 'bracket',
    description: '두 장의 리프 + 핀. 문/뚜껑 회전 결합.',
    useCases: ['connect'],
    standards: ['ANSI A156.7'],
    compatibleMethods: ['sheet-metal', 'stamping', 'cnc-milling'],
    parameters: [
      { name: 'leafWidth', unit: 'mm', default: 35, min: 15, max: 100, description: '리프 폭' },
      { name: 'leafLength', unit: 'mm', default: 70, min: 25, max: 200, description: '리프 길이' },
      { name: 'thickness', unit: 'mm', default: 2, min: 1, max: 6, description: '판 두께' },
      { name: 'pinRadius', unit: 'mm', default: 3, min: 1.5, max: 8, description: '핀 반경' },
    ],
    jscadSnippet: `const leafWidth = {{leafWidth}};
const leafLength = {{leafLength}};
const thickness = {{thickness}};
const pinRadius = {{pinRadius}};

function makeHinge() {
  const leaf1 = transforms.translate([leafWidth/2, 0, 0],
    primitives.cuboid({ size: [leafWidth, leafLength, thickness] }));
  const leaf2 = transforms.translate([-leafWidth/2, 0, 0],
    primitives.cuboid({ size: [leafWidth, leafLength, thickness] }));
  const knuckle = transforms.rotate([Math.PI/2, 0, 0],
    primitives.cylinder({ radius: pinRadius + thickness, height: leafLength, segments: 32 }));
  const pinHole = transforms.rotate([Math.PI/2, 0, 0],
    primitives.cylinder({ radius: pinRadius, height: leafLength + 1, segments: 24 }));
  return booleans.subtract(booleans.union(leaf1, leaf2, knuckle), pinHole);
}

function main() { return makeHinge(); }`,
  },

  // ─────────── 31. 베벨 기어 (간이) ───────────
  {
    id: 'gear-bevel',
    nameKo: '베벨 기어',
    nameEn: 'Bevel Gear',
    category: 'gear',
    description: '직각 동력 전달용 베벨 기어 (간이 콘 형상).',
    useCases: ['transmit'],
    standards: [],
    compatibleMethods: ['cnc-mill-5ax', 'hobbing', 'casting-sand'],
    parameters: [
      { name: 'baseRadius', unit: 'mm', default: 25, min: 8, max: 100, description: '베이스 반경' },
      { name: 'topRadius', unit: 'mm', default: 12, min: 3, max: 60, description: '상단 반경' },
      { name: 'height', unit: 'mm', default: 18, min: 5, max: 60, description: '높이' },
      { name: 'shaftRadius', unit: 'mm', default: 4, min: 2, max: 25, description: '축 구멍' },
      { name: 'teeth', unit: 'count', default: 24, min: 8, max: 80, description: '톱니 개수' },
    ],
    jscadSnippet: `const baseRadius = {{baseRadius}};
const topRadius = {{topRadius}};
const height = {{height}};
const shaftRadius = {{shaftRadius}};
const teeth = {{teeth}};

function makeBevel() {
  const cone = primitives.cylinderElliptic({
    startRadius: [baseRadius, baseRadius],
    endRadius: [topRadius, topRadius],
    height, segments: Math.max(24, teeth)
  });
  const shaft = primitives.cylinder({ radius: shaftRadius, height: height + 1, segments: 32 });
  return booleans.subtract(cone, shaft);
}

function main() { return makeBevel(); }`,
  },
];

// ID로 빠르게 찾기
export const PARTS_BY_ID: Record<string, PartTemplate> = Object.fromEntries(
  PARTS_CATALOG.map(p => [p.id, p])
);

// LLM에 전달할 간결한 카탈로그 요약 (metadata only)
export function partsCatalogSummary(): string {
  return PARTS_CATALOG.map(p =>
    `- ${p.id} (${p.nameKo}): ${p.description} [용도: ${p.useCases.join(',')}] [제조: ${p.compatibleMethods.join(',')}] [파라미터: ${p.parameters.map(pp => pp.name).join(', ')}]`
  ).join('\n');
}

// 템플릿 파라미터 치환 → 실행 가능한 JSCAD 코드 반환
export function renderPart(id: string, values: Record<string, number>): string {
  const tpl = PARTS_BY_ID[id];
  if (!tpl) throw new Error(`Unknown part: ${id}`);
  let code = tpl.jscadSnippet;
  for (const p of tpl.parameters) {
    const v = values[p.name] ?? p.default;
    code = code.replace(new RegExp(`{{${p.name}}}`, 'g'), String(v));
  }
  // 공통 헤더 보강
  const header = `const { primitives, booleans, transforms, expansions, extrusions, hulls } = jscad;\n\n`;
  return header + code;
}
