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
 *   { type:'offset',     to, dx,dy,dz, anchor? } 대상 기준 상대 배치.
 *                                              anchor='origin'(기본) = 대상 **원점**에서 dx,dy,dz
 *                                              anchor='center'       = 이 부품의 **중심**을 대상 **중심**+델타에
 *   { type:'concentric', to, axis, offset? }   지정 축에서 중심 정렬(AABB 중심)
 *   { type:'onFace',     to, face, gap? }      대상 부품 해당 면에 밀착(이 부품 반대면 접촉)
 *   { type:'mirror',     to, plane }           대상 부품 배치를 월드 평면 대칭
 *   { type:'centerline', axis }                이 부품의 중심선을 월드 axis 축에 맞춘다(to 불필요).
 *                                              ⚠ axis 자신은 건드리지 않고 **나머지 두 축**을 0 으로 정렬한다.
 *
 * 면(face) 규약(box 로컬 AABB [0,0,0]~[w,d,h] 기준):
 *   right=+x  left=-x   back=+y  front=-y   top=+z  bottom=-z
 *
 * ## 축 소유권 — 구속끼리 같은 축을 다투면 구체적인 쪽이 이긴다 (260803 실측 버그)
 * 각 구속은 자기가 확정하는 축이 정해져 있다(아래 `claimedAxes`). 한 부품에 여러 구속을
 * 선언해 같은 축을 다투면 **구체성 순위(`SPECIFICITY`)가 높은 쪽이 그 축을 소유**하고,
 * 같은 순위면 먼저 선언한 쪽이 이긴다. 선언 순서만으로 정하지 않는 이유:
 * `centerline` 은 `to` 도 없이 "월드 원점 기준 정렬"만 말하는 가장 약한 구속인데,
 * 그것을 먼저 쓴 것만으로 `onFace` 의 접촉면을 이기면 부품이 대상 속으로 박힌다.
 *
 * 이 규칙이 없을 때 실제로 벌어진 일 — 라우트 프롬프트의 출력 예시가 바로 이 조합이었다:
 * ```
 *   [{onFace, to:base, face:'top'}, {centerline, axis:'x'}]
 *     onFace     -> tz = 6        (판 상면에 안착)
 *     centerline -> tz = -15  ★   (x 외 두 축을 0 중심 → tz 를 덮어씀)
 *   결과: 기둥이 판 속으로 15mm 박힌 채 간섭 1 건. 부유 검사는 통과하므로 조용히 틀린다.
 * ```
 * 조용히 틀린 모델은 에러보다 나쁘다. 그래서 **버리지 않고 기록**한다 — 충돌한 축은
 * 무시하되 `conflicts[]` 로 보고해 결과는 나오게 하고 사람이 볼 수 있게 둔다.
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

/**
 * 축 다툼의 구체성 순위(높을수록 이긴다).
 * `to` 로 대상을 지목하는 구속은 설계 의도가 분명하고, `centerline` 은 대상 없는 약한 정렬이다.
 */
const SPECIFICITY = { offset: 3, onFace: 3, concentric: 3, mirror: 3, centerline: 1 };

/**
 * 이 구속이 확정하는 축 인덱스 집합. 축 소유권 판정의 단일 소스.
 * ⚠ applyConstraint 의 실제 대입과 반드시 일치해야 한다 — 갈리면 조용히 틀린다.
 */
function claimedAxes(c) {
  switch (c.type) {
    case 'offset': return [0, 1, 2];       // dx,dy,dz 를 모두 명시적으로 준다
    case 'mirror': return [0, 1, 2];       // 대상 배치를 평면 대칭 → 세 축 모두 확정
    case 'concentric': return [AXIS[c.axis]];
    case 'onFace': return [FACE[c.face].axis];
    case 'centerline': return [0, 1, 2].filter((k) => k !== AXIS[c.axis]); // 축 자신은 제외
    default: throw new Error(`알 수 없는 구속 타입 '${c.type}'`);
  }
}

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
export function resolveConstraints(assembly, opts = {}) {
  if (!assembly || !Array.isArray(assembly.parts)) {
    throw new Error('resolveConstraints: assembly.parts[] 필요');
  }
  const parts = assembly.parts;
  const n = parts.length;
  const label = (i) => String(parts[i]?.id ?? `#${i}`);
  /**
   * ★관용 모드(260803) — **망가진 구속 하나로 조립 전체를 잃지 않는다.**
   *
   * 실측: 5도메인 자유형 12건 중 「외부 피난계단」 29부품이 통째로 죽었다. 사유는
   * `onFace 알 수 없는 face 'undefined'` **한 건** — 모델이 face 를 안 채운 구속 하나였다.
   * 나머지 28부품은 멀쩡한데 결과가 0 이 됐다. 「고객은 error 만 나는 서비스를 쓰지 않는다」.
   *
   * 그래서 **형태가 망가진 구속은 버리고 기록한다**(조용히 넘기는 게 아니다 — `conflicts` 로
   * 나가고, 배치를 못 받은 부품은 부유 검사에 그대로 걸려 드러난다).
   * ⚠ **구조가 망가진 것은 여전히 throw 한다** — 순환 구속·중복 id 는 「이 부품만 빼면 된다」가
   *   성립하지 않는다(무엇을 뺄지 우리가 정할 수 없다). 버릴 수 있는 것만 버린다.
   *
   * ⚠⚠ **기본값은 엄격(throw)이다.** 관용은 제품 경로(`buildAssembly`·`autoPlaceCorrect`)가
   *   `{lenient:true}` 로 **명시해서** 켠다. 이 모듈의 계약(§정직성 규칙 — 조용히 폴백하지
   *   않는다)은 그대로 두고, 「결과를 내야 한다」는 **제품 판단**을 호출부에 남긴다.
   *   기본을 관용으로 뒀다가 `.test.mjs` 4건이 깨졌다 — 계약을 바꾸는 것과 제품이 관용을
   *   고르는 것은 다른 일이다.
   */
  const lenient = opts.lenient === true;
  const dropped = [];

  // id -> index (중복 id 는 참조 모호 -> 거부)
  const idToIndex = new Map();
  parts.forEach((p, i) => {
    if (p.id == null) return;
    if (idToIndex.has(p.id)) throw new Error(`중복 부품 id '${p.id}' — 구속 참조 모호`);
    idToIndex.set(p.id, i);
  });

  /**
   * 구속 유효성 검사 + 의존 간선(this -> to) 수집.
   * 관용 모드에서는 **형태 오류를 버리고 기록**한다(위 §관용 모드). 엄격 모드는 throw.
   * `usable[i]` = 그 부품에서 실제로 적용할 구속들(원본을 변형하지 않는다).
   */
  const deps = Array.from({ length: n }, () => new Set());
  const usable = Array.from({ length: n }, () => null);
  for (let i = 0; i < n; i++) {
    const cs = parts[i].constraints;
    if (cs == null) continue;
    if (!Array.isArray(cs)) throw new Error(`부품 ${label(i)}: constraints 는 배열이어야 함`);
    const keep = [];
    for (const c of cs) {
      /** 형태 오류 처리 — 관용이면 버리고 기록, 아니면 throw. @returns 버렸으면 true */
      const bad = (why) => {
        if (!lenient) throw new Error(`부품 ${label(i)}: ${why}`);
        dropped.push(`부품 ${label(i)}: ${why} — 이 구속만 버렸다(다른 부품은 그대로 만든다)`);
        return true;
      };
      if (!c || typeof c !== 'object') { if (bad('구속 항목이 객체가 아님')) continue; }
      if (!KNOWN_TYPES.has(c.type)) { if (bad(`알 수 없는 구속 타입 '${c.type}'`)) continue; }
      // 타입별 열거 값 사전 검증(해석 전 조기 실패)
      if (c.type === 'concentric' && AXIS[c.axis] === undefined) { if (bad(`concentric 알 수 없는 axis '${c.axis}'`)) continue; }
      if (c.type === 'centerline' && AXIS[c.axis] === undefined) { if (bad(`centerline 알 수 없는 axis '${c.axis}'`)) continue; }
      if (c.type === 'onFace' && !FACE[c.face]) { if (bad(`onFace 알 수 없는 face '${c.face}'`)) continue; }
      if (c.type === 'mirror' && PLANE[c.plane] === undefined) { if (bad(`mirror 알 수 없는 plane '${c.plane}'`)) continue; }
      if (NEEDS_TO.has(c.type)) {
        if (c.to == null) { if (bad(`구속 '${c.type}' 에 to 필요`)) continue; }
        const j = idToIndex.get(c.to);
        if (j === undefined) { if (bad(`알 수 없는 to id '${c.to}'`)) continue; }
        if (j === i) { if (bad(`자기참조 구속 '${c.type}'`)) continue; }
        deps[i].add(j);
      }
      keep.push(c);
    }
    usable[i] = keep;
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

  // 해석: 원 순서 보존한 결과 배열. **쓸 수 있는** 구속이 있는 부품만 at 를 새로 복사·설정
  // (버려진 구속만 있던 부품은 원래 at 를 그대로 둔다 — 없으면 부유로 드러난다).
  const resolved = parts.map((p, i) => (usable[i]?.length ? { ...p, at: { ...(p.at ?? {}) } } : p));

  const conflicts = [...dropped];
  for (const i of order) {
    const cs = usable[i]; // ⚠ 원본이 아니라 **살아남은 구속**으로 푼다(관용 모드에서 갈린다)
    if (!cs || !cs.length) continue;
    const self = resolved[i];
    // 축 소유권(위 §축 소유권): 축마다 구체성 높은 구속이 이기고, 동률이면 먼저 선언한 쪽.
    // 순서와 무관하게 결정되도록 **적용 전에** 승자를 먼저 확정한다.
    const owner = new Map(); // 축 인덱스 -> 이긴 구속의 선언 위치
    cs.forEach((c, ci) => {
      for (const k of claimedAxes(c)) {
        const prev = owner.get(k);
        if (prev === undefined || SPECIFICITY[c.type] > SPECIFICITY[cs[prev].type]) owner.set(k, ci);
      }
    });
    cs.forEach((c, ci) => {
      const allow = new Set(claimedAxes(c).filter((k) => owner.get(k) === ci));
      for (const k of claimedAxes(c)) {
        if (allow.has(k)) continue;
        conflicts.push(
          `부품 ${label(i)}: 구속 '${c.type}' 의 ${TKEY[k]} 는 더 구체적인 '${cs[owner.get(k)].type}' 가 확정 — 무시`,
        );
      }
      applyConstraint(self, c, (id) => resolved[idToIndex.get(id)], allow);
    });
  }

  return { ...assembly, parts: resolved, ...(conflicts.length ? { constraintConflicts: conflicts } : {}) };
}

/**
 * 단일 구속을 self.at 에 적용(translation 만 설정, 회전 보존).
 * @param getTarget id->해석완료 부품
 * @param allow     이 구속이 쓸 수 있는 축 인덱스 집합. 밖의 축은 대입하지 않는다(축 소유권).
 */
function applyConstraint(self, c, getTarget, allow) {
  const set = (k, v) => { if (allow.has(k)) self.at[TKEY[k]] = v; };
  switch (c.type) {
    /**
     * ★`anchor`(260803) — **기준점을 말할 수 있게 한다.**
     *
     * 실측: 「3000×3000 슬래브 위 기둥 4개」를 모델이 `offset{dx:±750, dy:±750}` 로 썼다.
     * 사람 머릿속 기준은 **슬래브 중심**인데 우리 `offset` 은 **대상 원점(최소 모서리)**
     * 기준이라, 슬래브가 0~3000 인데 기둥이 -750 에 놓여 판 밖으로 나갔다 → 부유.
     * 5도메인 자유형 부유 41건의 주된 형태였다.
     *
     * 프롬프트로 「원점 기준이다」라고 알려 주는 것만으로는 부족하다 — 대칭 배치는
     * **중심 기준으로 말하는 게 자연스럽고**, 그럴 말을 안 주면 계속 틀린다.
     * ⚠ 기본값은 `origin` 이다 — 기존 선언의 의미를 바꾸지 않는다.
     */
    case 'offset': {
      const tgt = getTarget(c.to);
      if (c.anchor === 'center') {
        const tc = centerOf(worldAabb(tgt));
        const sc = centerOf(rotatedLocalAabb(self));
        set(0, tc[0] + num(c.dx) - sc[0]);
        set(1, tc[1] + num(c.dy) - sc[1]);
        set(2, tc[2] + num(c.dz) - sc[2]);
        return;
      }
      const t = tgt.at ?? {};
      set(0, num(t.tx) + num(c.dx));
      set(1, num(t.ty) + num(c.dy));
      set(2, num(t.tz) + num(c.dz));
      return;
    }
    case 'concentric': {
      const ai = AXIS[c.axis];
      const tgtC = centerOf(worldAabb(getTarget(c.to)))[ai];
      const selfC = centerOf(rotatedLocalAabb(self))[ai];
      set(ai, tgtC + num(c.offset) - selfC);
      return;
    }
    case 'onFace': {
      const f = FACE[c.face];
      const gap = num(c.gap);
      const tgt = worldAabb(getTarget(c.to));
      const loc = rotatedLocalAabb(self);
      const k = f.axis;
      // sign>0: 대상 max 면에 이 부품 min 이 접촉 / sign<0: 대상 min 면에 이 부품 max 가 접촉
      set(k, f.sign > 0
        ? tgt.max[k] + gap - loc.min[k]
        : tgt.min[k] - gap - loc.max[k]);
      return;
    }
    case 'mirror': {
      const p = PLANE[c.plane];
      const tgtC = centerOf(worldAabb(getTarget(c.to)));
      const selfC = centerOf(rotatedLocalAabb(self));
      for (let k = 0; k < 3; k++) {
        const target = k === p ? -tgtC[k] : tgtC[k];
        set(k, target - selfC[k]);
      }
      return;
    }
    case 'centerline': {
      const ai = AXIS[c.axis];
      const selfC = centerOf(rotatedLocalAabb(self));
      for (let k = 0; k < 3; k++) {
        if (k === ai) continue; // 축 방향은 그대로, 수직 두 축만 0 으로 중심 정렬
        set(k, -selfC[k]);
      }
      return;
    }
    default:
      // 사전 검증에서 걸러지지만 방어적으로 유지(조용한 폴백 금지)
      throw new Error(`알 수 없는 구속 타입 '${c.type}'`);
  }
}
