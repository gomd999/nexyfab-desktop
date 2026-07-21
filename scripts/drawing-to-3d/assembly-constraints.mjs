/**
 * 결정론적 조립 구속 리졸버 — 부품을 절대좌표가 아니라 "관계"로 배치한다.
 *
 * 각 부품의 선택적 `constraints:[]` 를 읽어 위상정렬 순서로 해석하고, 각 부품의
 * `at` 절대 배치(translation)를 확정한 **새 어셈블리**를 반환한다. 구속이 없는
 * 부품은 기존 `at` 를 그대로 둔다. 구속은 translation 만 설정하며 회전(rx/ry/rz)은
 * 보존한다(부품이 이미 회전을 가질 수 있음).
 *
 * 정직성 규칙(최우선):
 *   - 결정론적. `to` 의존성의 위상정렬 순서로 해석.
 *   - 순환 구속·알 수 없는 to id·알 수 없는 타입/face/axis/plane·해석 불가는 throw.
 *   - 절대 조용히 기본 위치로 폴백하지 않는다(오류를 숨기면 이 기능의 존재 이유가 사라진다).
 *   - 부품 자신의 AABB(회전 반영)를 고려해 배치한다.
 *
 * 지오메트리 extents 는 reconstruct.partAabb / assembly.placedAabb 를 재사용한다
 * (재구현 금지 — 배치·회전 규칙 단일 소스).
 *
 * 지원 구속 타입(v1):
 *   { type:'offset',     to, dx,dy,dz }        대상 부품 원점 기준 상대 배치
 *   { type:'concentric', to, axis, offset? }   지정 축에서 중심 정렬(AABB 중심)
 *   { type:'onFace',     to, face, gap? }      대상 부품 해당 면에 밀착(이 부품 반대면 접촉)
 *   { type:'mirror',     to, plane }           대상 부품 배치를 월드 평면 대칭
 *   { type:'centerline', axis }                이 부품을 월드 축에 중심 정렬(to 불필요)
 *
 * 면(face) 규약(box 로컬 AABB [0,0,0]~[w,d,h] 기준):
 *   right=+x  left=-x   back=+y  front=-y   top=+z  bottom=-z
 */
import { placedAabb } from './assembly.mjs';

const AXIS = { x: 0, y: 1, z: 2 };
const TKEY = ['tx', 'ty', 'tz'];
// 면 -> { axis, sign }. sign +1 = 대상의 max 면(이 부품 min 이 접촉), -1 = 대상의 min 면.
const FACE = {
  right: { axis: 0, sign: 1 }, left: { axis: 0, sign: -1 },
  back: { axis: 1, sign: 1 }, front: { axis: 1, sign: -1 },
  top: { axis: 2, sign: 1 }, bottom: { axis: 2, sign: -1 },
};
const PLANE = { yz: 0, xz: 1, xy: 2 }; // 대칭면 -> 반전 축
const NEEDS_TO = new Set(['offset', 'concentric', 'onFace', 'mirror']);
const KNOWN_TYPES = new Set([...NEEDS_TO, 'centerline']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 회전만 반영한 로컬 AABB(배치 전) — translation 은 0. placedAabb 재사용. */
function rotatedLocalAabb(part) {
  const at = part.at ?? {};
  return placedAabb({ type: part.type, params: part.params, at: { rx: num(at.rx), ry: num(at.ry), rz: num(at.rz) } });
}
/** 최종 at(회전+translation) 반영 월드 AABB — placedAabb 재사용. */
function worldAabb(part) {
  return placedAabb({ type: part.type, params: part.params, at: part.at ?? {} });
}
const centerOf = (bb) => [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];

/**
 * 어셈블리의 부품 구속을 결정론적으로 해석해 각 부품 `at` 절대값을 확정한 새 어셈블리 반환.
 * @param {{parts:Array}} assembly
 * @returns {{parts:Array}} 입력을 변형하지 않은 새 객체(부품/at 은 얕은 복사).
 */
export function resolveConstraints(assembly) {
  if (!assembly || !Array.isArray(assembly.parts)) {
    throw new Error('resolveConstraints: assembly.parts[] 필요');
  }
  const parts = assembly.parts;
  const n = parts.length;
  const label = (i) => String(parts[i]?.id ?? `#${i}`);

  // id -> index (중복 id 는 참조 모호 -> 거부)
  const idToIndex = new Map();
  parts.forEach((p, i) => {
    if (p.id == null) return;
    if (idToIndex.has(p.id)) throw new Error(`중복 부품 id '${p.id}' — 구속 참조 모호`);
    idToIndex.set(p.id, i);
  });

  // 구속 유효성 검사 + 의존 간선(this -> to) 수집
  const deps = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < n; i++) {
    const cs = parts[i].constraints;
    if (cs == null) continue;
    if (!Array.isArray(cs)) throw new Error(`부품 ${label(i)}: constraints 는 배열이어야 함`);
    for (const c of cs) {
      if (!c || typeof c !== 'object') throw new Error(`부품 ${label(i)}: 구속 항목이 객체가 아님`);
      if (!KNOWN_TYPES.has(c.type)) throw new Error(`부품 ${label(i)}: 알 수 없는 구속 타입 '${c.type}'`);
      // 타입별 열거 값 사전 검증(해석 전 조기 실패)
      if (c.type === 'concentric' && AXIS[c.axis] === undefined) throw new Error(`부품 ${label(i)}: concentric 알 수 없는 axis '${c.axis}'`);
      if (c.type === 'centerline' && AXIS[c.axis] === undefined) throw new Error(`부품 ${label(i)}: centerline 알 수 없는 axis '${c.axis}'`);
      if (c.type === 'onFace' && !FACE[c.face]) throw new Error(`부품 ${label(i)}: onFace 알 수 없는 face '${c.face}'`);
      if (c.type === 'mirror' && PLANE[c.plane] === undefined) throw new Error(`부품 ${label(i)}: mirror 알 수 없는 plane '${c.plane}'`);
      if (NEEDS_TO.has(c.type)) {
        if (c.to == null) throw new Error(`부품 ${label(i)}: 구속 '${c.type}' 에 to 필요`);
        const j = idToIndex.get(c.to);
        if (j === undefined) throw new Error(`부품 ${label(i)}: 알 수 없는 to id '${c.to}'`);
        if (j === i) throw new Error(`부품 ${label(i)}: 자기참조 구속 '${c.type}'`);
        deps[i].add(j);
      }
    }
  }

  // 위상정렬(DFS post-order) — 순환 감지. 의존(to 대상)이 먼저 오도록.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Array(n).fill(WHITE);
  const order = [];
  const visit = (i) => {
    color[i] = GRAY;
    for (const j of deps[i]) {
      if (color[j] === GRAY) throw new Error(`순환 구속 감지: ${label(i)} 와 ${label(j)}`);
      if (color[j] === WHITE) visit(j);
    }
    color[i] = BLACK;
    order.push(i);
  };
  for (let i = 0; i < n; i++) if (color[i] === WHITE) visit(i);

  // 해석: 원 순서 보존한 결과 배열. 구속 있는 부품만 at 를 새로 복사·설정.
  const resolved = parts.map((p) => (p.constraints?.length ? { ...p, at: { ...(p.at ?? {}) } } : p));

  for (const i of order) {
    const cs = parts[i].constraints;
    if (!cs || !cs.length) continue;
    const self = resolved[i];
    for (const c of cs) applyConstraint(self, c, (id) => resolved[idToIndex.get(id)]);
  }

  return { ...assembly, parts: resolved };
}

/** 단일 구속을 self.at 에 적용(translation 만 설정, 회전 보존). getTarget: id->해석완료 부품. */
function applyConstraint(self, c, getTarget) {
  switch (c.type) {
    case 'offset': {
      const t = getTarget(c.to).at ?? {};
      self.at.tx = num(t.tx) + num(c.dx);
      self.at.ty = num(t.ty) + num(c.dy);
      self.at.tz = num(t.tz) + num(c.dz);
      return;
    }
    case 'concentric': {
      const ai = AXIS[c.axis];
      const tgtC = centerOf(worldAabb(getTarget(c.to)))[ai];
      const selfC = centerOf(rotatedLocalAabb(self))[ai];
      self.at[TKEY[ai]] = tgtC + num(c.offset) - selfC;
      return;
    }
    case 'onFace': {
      const f = FACE[c.face];
      const gap = num(c.gap);
      const tgt = worldAabb(getTarget(c.to));
      const loc = rotatedLocalAabb(self);
      const k = f.axis;
      // sign>0: 대상 max 면에 이 부품 min 이 접촉 / sign<0: 대상 min 면에 이 부품 max 가 접촉
      self.at[TKEY[k]] = f.sign > 0
        ? tgt.max[k] + gap - loc.min[k]
        : tgt.min[k] - gap - loc.max[k];
      return;
    }
    case 'mirror': {
      const p = PLANE[c.plane];
      const tgtC = centerOf(worldAabb(getTarget(c.to)));
      const selfC = centerOf(rotatedLocalAabb(self));
      for (let k = 0; k < 3; k++) {
        const target = k === p ? -tgtC[k] : tgtC[k];
        self.at[TKEY[k]] = target - selfC[k];
      }
      return;
    }
    case 'centerline': {
      const ai = AXIS[c.axis];
      const selfC = centerOf(rotatedLocalAabb(self));
      for (let k = 0; k < 3; k++) {
        if (k === ai) continue; // 축 방향은 그대로, 수직 두 축만 0 으로 중심 정렬
        self.at[TKEY[k]] = -selfC[k];
      }
      return;
    }
    default:
      // 사전 검증에서 걸러지지만 방어적으로 유지(조용한 폴백 금지)
      throw new Error(`알 수 없는 구속 타입 '${c.type}'`);
  }
}
