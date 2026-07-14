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
  const required = [...PARAMS[t]];
  if (t === 'sheet_profile') {
    props.segments = { type: 'ARRAY', items: NUM };
    props.angles = { type: 'ARRAY', items: NUM };
    required.push('segments', 'angles');
  }
  return [t, { type: 'OBJECT', required, properties: props }];
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
  box: 'width,depth,height (속찬 직육면체 블록)',
  cylinder: 'diameter,length (속찬 원기둥 봉·포스트)',
  gusset: 'legA,legB,thickness (직각삼각 거셋 보강판)',
  base_plate: 'width,depth,thickness,boltDia (4모서리 볼트홀 베이스판)',
  spur_gear: 'module,teeth,thickness,boreDia (인벌류트 스퍼기어 — 외경=m(z+2), boreDia 0=무보어)',
  hex_bolt: 'threadDia,length (육각볼트 M3~M36 — 머리치수 ISO 표준표 자동, 나사산 미형상 관례)',
  sheet_profile: 'thickness,width,segments[],angles[] (다단 절곡 판금 — 세그먼트 길이열+절곡각열(|a|≤120°), Z/햇/채널 단면. width=압출 길이)',
};
