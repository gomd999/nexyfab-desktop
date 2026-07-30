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
  if (t === 'composite') {
    props.subs = { type: 'ARRAY', items: { type: 'OBJECT', properties: { type: { type: 'STRING' } }, required: ['type'] } };
    required.push('subs');
  }
  if (t === 'extrude_profile') {
    // profile=[[x,y],…] · holes=[{x,y,d}] — 배열이라 PARAMS 로는 표현되지 않는다(특례).
    props.profile = { type: 'ARRAY', items: { type: 'ARRAY', items: NUM } };
    props.holes = { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, y: NUM, d: NUM }, required: ['x', 'y', 'd'] } };
    props.fillets = { type: 'ARRAY', items: { type: 'OBJECT', properties: { i: NUM, r: NUM }, required: ['i', 'r'] } };
    props.filletR = NUM;
    required.push('profile');
  }
  if (t === 'wall_with_openings') {
    props.openings = { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, w: NUM, h: NUM, sill: NUM }, required: ['x', 'w', 'h'] } };
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
  wall_with_openings: 'length,thickness,height,openings[{x,w,h,sill}] (벽체 — X길이·Y두께·Z높이, 문=sill 0·창=sill>0)',
  composite: 'subs[{type,params,at?,op?}] (복합 부품 — 하위의 합·차로 한 부품. `op:subtract` 는 뺀다. '
    + '코퍼스 실측 형상 aspect `complex` 447/1071=42%. ⚠ 중첩은 **1단만**(하위의 하위 금지). '
    + '⚠ add 끼리 **겹침은 공제하지 않는다** — 겹치면 부피가 과대하다. ⚠ 표면적은 접촉면을 '
    + '알 수 없어 **미산출**이며 BOQ 가 이름으로 고지한다',
  masonry_block: 'length,thickness,height,coreCount,coreW,coreD (조적 블록 — 속빈 공동 0~4개를 실제로 공제. '
    + 'KS F 4002 콘크리트 기본블록 390×190×(190·150·100). ⚠ 치수 기본값은 KS 표준이고 참고 코퍼스에서 나온 것이 아니다 '
    + '— 코퍼스는 조적의 **존재/빈도**만 알려줬다(부품 단위 치수 없음)',
  extrude_profile: 'profile[[x,y],…],depth,holes[{x,y,d,kind?,cbDia?,cbDepth?,csDia?,thread?,depth?,pattern?}],filletR?,fillets?[{i,r}] (임의 폐곡선 압출 — XY 평면 폴리라인을 +Z 로 depth 만큼. '
    + '실물 압출의 67.6%가 이 형태(참고 코퍼스 10,508 프로파일 실측). 마지막 점은 자동 닫음. '
    + '⚠ 홀은 **원형만** — 비원형 내부 루프는 지원하지 않는다. ⚠ 자기교차는 검사하지 않는다. '
    + '홀 가공 상세(cbore·csink·tap·blind)와 패턴(linear{count,pitch}·circular{count,bcd})을 받는다 — '
    + '`plate_with_holes` 와 **같은 단일 소스**라 부피·표면적·SCAD 가 갈리지 않는다. '
    + '필렛은 **볼록 꼭짓점만** 원호(현 분할)로 반영한다 — 형상·부피·표면적이 모두 같은 형상을 본다',
};
