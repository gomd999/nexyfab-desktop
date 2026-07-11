/**
 * 타입별 최소 responseSchema — gemini-2.5-flash/pro가 union 스키마(전 필드)에서
 * bent_sheet 등에 엉뚱한 필드(width)를 채우려다 degenerate-number로 폭주(MAX_TOKENS)
 * 하는 실패를 제거한다. 2단계: 분류(CLASSIFY_SCHEMA) → 타입별 최소 스키마 추출.
 *
 * PARAMS(reconstruct)에서 필드 목록을 끌어와 스키마를 파생 — 단일 출처.
 */
import { PARAMS } from './reconstruct.mjs';

const NUM = { type: 'NUMBER' };
export const ALL_TYPES = Object.keys(PARAMS); // 7종

export const CLASSIFY_SCHEMA = {
  type: 'OBJECT', required: ['type'],
  properties: { type: { type: 'STRING', enum: [...ALL_TYPES, 'unknown'] }, confidence: NUM },
};

/** 타입별 스키마: 해당 파라미터 + confidence(+ plate는 holes 배열). */
export const TYPE_SCHEMAS = Object.fromEntries(ALL_TYPES.map((t) => {
  const props = { confidence: NUM };
  for (const k of PARAMS[t]) props[k] = NUM;
  if (t === 'plate_with_holes') {
    props.holes = { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, y: NUM, d: NUM }, required: ['x', 'y', 'd'] } };
  }
  return [t, { type: 'OBJECT', required: [...PARAMS[t]], properties: props }];
}));

/** 타입별 필드 힌트(프롬프트용) */
export const TYPE_HINTS = {
  plate_with_holes: 'width,depth,thickness,holes[{x,y,d}] (좌하단 원점, 대칭구멍 좌표계산)',
  stepped_plate: 'width,depth,thickness,stepWidth,stepThickness',
  l_bracket: 'legA,legB,width,thickness',
  flange: 'outerDia,boreDia,thickness,bcd,boltHoleD,boltCount',
  bent_sheet: 'webWidth,flangeHeight,length,thickness (U채널 절곡판금)',
  tube: 'outerDia,innerDia,length (원형 파이프/중공 원통)',
  rect_tube: 'width,height,wallThk,length (각관/사각 중공재)',
};
