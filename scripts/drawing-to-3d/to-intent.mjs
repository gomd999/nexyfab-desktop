/**
 * 2D→3D ③ — 추출 JSON → shape-generator ComponentIntent 정식 브리지.
 * 스키마: src/app/[lang]/shape-generator/intent/schema.ts (op:'subtract' 확장 사용).
 * 게이트(reconstruct.gate) 통과본만 넣을 것 — 브리지는 매핑만, 검증은 게이트 담당.
 */
const rect = (id, x0, y0, w, h) => ({
  id, points: [
    { x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h },
  ],
});

const MAP = {
  plate_with_holes(x, id) {
    return {
      id, name: `plate ${x.width}x${x.depth}x${x.thickness}`, shapeClass: 'prismatic',
      features: [
        { id: 'body', kind: 'extrude', profile: rect('p-body', 0, 0, x.width, x.depth), height: x.thickness },
        ...(x.holes ?? []).map((h, i) => ({
          id: `hole-${i + 1}`, kind: 'cylinder', diameter: h.d, height: x.thickness + 2,
          at: { translate: [h.x, h.y, -1] }, op: 'subtract',
        })),
      ],
    };
  },
  stepped_plate(x, id) {
    return {
      id, name: `stepped plate ${x.width}x${x.depth}`, shapeClass: 'prismatic',
      features: [
        { id: 'step', kind: 'extrude', profile: rect('p-step', 0, 0, x.stepWidth, x.depth), height: x.stepThickness },
        { id: 'body', kind: 'extrude', profile: rect('p-body', x.stepWidth, 0, x.width - x.stepWidth, x.depth), height: x.thickness },
      ],
    };
  },
  l_bracket(x, id) {
    return {
      id, name: `L-bracket ${x.legA}x${x.legB}`, shapeClass: 'prismatic',
      features: [
        { id: 'leg-a', kind: 'extrude', profile: rect('p-a', 0, 0, x.legA, x.width), height: x.thickness },
        { id: 'leg-b', kind: 'extrude', profile: rect('p-b', 0, 0, x.thickness, x.width), height: x.legB },
      ],
    };
  },
  flange(x, id) {
    return {
      id, name: `flange OD${x.outerDia}`, shapeClass: 'revolute',
      features: [
        { id: 'disc', kind: 'cylinder', diameter: x.outerDia, height: x.thickness },
        { id: 'bore', kind: 'cylinder', diameter: x.boreDia, height: x.thickness + 2, at: { translate: [0, 0, -1] }, op: 'subtract' },
        {
          id: 'bolt-holes', kind: 'cylinder', diameter: x.boltHoleD, height: x.thickness + 2,
          at: { translate: [x.bcd / 2, 0, -1] }, pattern: { type: 'circular', count: x.boltCount }, op: 'subtract',
        },
      ],
    };
  },
  bent_sheet(x, id) {
    return {
      id, name: `U-channel ${x.webWidth}x${x.flangeHeight}`, shapeClass: 'sheetMetal',
      material: { grade: 'SS275', thicknessMm: x.thickness },
      features: [
        { id: 'web', kind: 'extrude', profile: rect('p-web', 0, 0, x.length, x.webWidth), height: x.thickness },
        { id: 'flange-1', kind: 'extrude', profile: rect('p-f1', 0, 0, x.length, x.thickness), height: x.flangeHeight },
        { id: 'flange-2', kind: 'extrude', profile: rect('p-f2', 0, x.webWidth - x.thickness, x.length, x.thickness), height: x.flangeHeight },
      ],
    };
  },
  tube(x, id) {
    return {
      id, name: `tube OD${x.outerDia} ID${x.innerDia} L${x.length}`, shapeClass: 'revolute',
      features: [
        { id: 'outer', kind: 'cylinder', diameter: x.outerDia, height: x.length },
        { id: 'bore', kind: 'cylinder', diameter: x.innerDia, height: x.length + 2, at: { translate: [0, 0, -1] }, op: 'subtract' },
      ],
    };
  },
  rect_tube(x, id) {
    return {
      id, name: `rect-tube ${x.width}x${x.height} t${x.wallThk}`, shapeClass: 'sheetMetal',
      material: { grade: 'SS275', thicknessMm: x.wallThk },
      features: [
        { id: 'outer', kind: 'extrude', profile: rect('rt-o', 0, 0, x.length, x.width), height: x.height },
        {
          id: 'bore', kind: 'extrude', profile: rect('rt-i', -1, x.wallThk, x.length + 2, x.width - 2 * x.wallThk),
          height: x.height - 2 * x.wallThk, at: { translate: [0, 0, x.wallThk] }, op: 'subtract',
        },
      ],
    };
  },
};

/** 추출 JSON → ComponentIntent (schema.ts). PMI로 판독 출처를 남긴다. */
export function toComponentIntent(extraction, id = 'dwg-part') {
  const m = MAP[extraction.type];
  if (!m) throw new Error(`bridge: unsupported type '${extraction.type}'`);
  const c = m(extraction, id);
  c.pmi = [{ target: 'source', note: `2D→3D extraction (confidence ${extraction.confidence ?? '?'})` }];
  return c;
}
