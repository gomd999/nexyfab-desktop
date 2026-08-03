/**
 * 기구 자유도(mobility) 판정 — 갭 매트릭스 빈칸 ②.
 *
 * ## 왜 필요한가
 * 「조립이 되나」(간섭·부유)와 「움직이나」는 다른 질문이다. 4절 링크는 부품이 안 겹치고
 * 다 받쳐져 있어도 **자유도가 0 이면 안 움직이는 구조물**이고, 2 이상이면 흐느적거린다.
 * 상용 CAD 는 이걸 조인트 선언에서 계산한다. 우리 어휘에는 조인트가 없었다 —
 * `constraints`(offset·onFace·concentric…)는 **조립 배치**이지 운동 쌍이 아니다.
 *
 * ## 방법 — Kutzbach/Grübler (폐형)
 * ```
 *   공간:  M = 6(n−1) − Σ(6 − fᵢ)
 *   평면:  M = 3(n−1) − Σ(3 − fᵢ)      (전 회전축이 평행하고 이동이 그 평면 안일 때)
 *   n = 링크 수(접지 포함) · fᵢ = 조인트 i 의 자유도
 * ```
 * ⚠ **Kutzbach 는 치수를 안 본다.** 특수 치수에서 생기는 여분 자유도(오버컨스트레인트인데
 *   실제로는 움직이는 평행사변형 링크 등)를 못 잡는다. 그래서 M 만 주지 않고
 *   **어느 식으로 셌는지·무엇을 못 보는지**를 함께 낸다. 그것이 이 모듈의 정직성 규약이다.
 *
 * ⚠ 조인트는 **선언**이다. 배치가 우연히 동축이라고 회전쌍으로 치지 않는다 —
 *   그렇게 하면 「간섭이 없다」를 「움직인다」로 잘못 읽게 된다.
 */

/** 운동쌍별 자유도(공간 기준 f, 평면 기준 fPlanar). null=평면 기구에 못 쓰는 쌍. */
export const JOINT_DOF = {
  revolute: { f: 1, planar: 1, ko: '회전쌍(핀)' },
  prismatic: { f: 1, planar: 1, ko: '병진쌍(슬라이더)' },
  cylindrical: { f: 2, planar: null, ko: '원통쌍' },
  screw: { f: 1, planar: null, ko: '나사쌍' },
  spherical: { f: 3, planar: null, ko: '구면쌍(볼)' },
  planar: { f: 3, planar: null, ko: '평면쌍' },
  gear: { f: 1, planar: 1, ko: '기어쌍' },
  cam: { f: 2, planar: 2, ko: '캠쌍(구름+미끄럼)' },
  fixed: { f: 0, planar: 0, ko: '고정(용접·볼팅)' },
};

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * 어셈블리의 `joints[]` 로 자유도를 계산한다.
 *
 * @param {{parts:Array, joints?:Array<{type:string, between:[string,string], axis?:string}>}} assembly
 * @param {{ground?:string[]}} opts ground=고정 링크 id(없으면 role frame/base/ground 를 접지로 본다)
 * @returns {null|{mobility:number, formula:'planar'|'spatial', links:number, joints:number,
 *   verdict:'mechanism'|'structure'|'overconstrained'|'unstable', note:string, breakdown:Array, errors:string[]}}
 *   `joints` 선언이 없으면 **null** — 「자유도 0」이 아니다. 안 잰 것과 0 은 다르다.
 */
export function mobilityCheck(assembly, opts = {}) {
  const joints = assembly?.joints;
  if (!Array.isArray(joints) || joints.length === 0) return null;

  const partIds = new Set((assembly.parts ?? []).map((p) => p.id).filter(Boolean));
  const errors = [];

  // ── 링크 집합: 조인트가 잇는 부품들 + 접지 ──────────────────────────────────
  const GROUND_ROLES = new Set(['frame', 'base', 'ground', 'slab', 'floor']);
  const declaredGround = new Set(opts.ground ?? []);
  if (!declaredGround.size) {
    for (const p of assembly.parts ?? []) if (GROUND_ROLES.has(p.role)) declaredGround.add(p.id);
  }

  const linkSet = new Set();
  const valid = [];
  for (const [i, j] of joints.entries()) {
    const spec = JOINT_DOF[j?.type];
    if (!spec) { errors.push(`joint[${i}]: 알 수 없는 운동쌍 '${j?.type}' — ${Object.keys(JOINT_DOF).join('·')} 중 하나`); continue; }
    const [a, b] = j.between ?? [];
    if (!a || !b) { errors.push(`joint[${i}]: between:[부품A, 부품B] 필요`); continue; }
    if (a === b) { errors.push(`joint[${i}]: 자기 자신과의 운동쌍은 없다 ('${a}')`); continue; }
    for (const id of [a, b]) if (partIds.size && !partIds.has(id)) errors.push(`joint[${i}]: 알 수 없는 부품 '${id}'`);
    if (j.axis && !AXES[j.axis]) errors.push(`joint[${i}]: 알 수 없는 axis '${j.axis}' (x·y·z)`);
    linkSet.add(a); linkSet.add(b);
    valid.push({ ...j, spec });
  }
  if (!valid.length) {
    return { mobility: null, formula: null, links: 0, joints: 0, verdict: 'unstable', errors, breakdown: [],
      note: '유효한 운동쌍 선언이 없다 — 자유도를 계산하지 않았다(0 이 아니다)' };
  }

  // ── 평면 기구인가: 회전·병진쌍만 쓰고 축이 전부 같은 방향이면 평면 ─────────────
  const spatialOnly = valid.some((j) => j.spec.planar === null);
  const axes = new Set(valid.filter((j) => j.type === 'revolute').map((j) => j.axis ?? 'z'));
  const planar = !spatialOnly && axes.size <= 1;
  const formula = planar ? 'planar' : 'spatial';
  const dofSpace = planar ? 3 : 6;

  // ── Kutzbach ────────────────────────────────────────────────────────────────
  // 접지는 하나로 센다(여러 부재가 접지여도 지면에 고정돼 있으면 한 링크다).
  const groundedLinks = [...linkSet].filter((id) => declaredGround.has(id));
  const n = linkSet.size - Math.max(0, groundedLinks.length - 1);
  let constrained = 0;
  const breakdown = [];
  for (const j of valid) {
    const f = planar ? j.spec.planar : j.spec.f;
    constrained += dofSpace - f;
    breakdown.push({ type: j.type, ko: j.spec.ko, between: j.between, f });
  }
  const mobility = dofSpace * (n - 1) - constrained;

  const verdict = mobility > 0 ? 'mechanism' : mobility === 0 ? 'structure' : 'overconstrained';
  const NOTE = {
    mechanism: `자유도 ${mobility} — 움직인다(입력 ${mobility}개 필요)`,
    structure: '자유도 0 — 움직이지 않는 구조물이다(기구로 쓰려면 링크나 운동쌍이 부족하다)',
    overconstrained: `자유도 ${mobility} — 과구속이다. 특수 치수(평행사변형 등)면 실제로는 움직일 수 있다`,
  };
  return {
    mobility, formula, links: n, joints: valid.length, verdict, breakdown,
    ...(groundedLinks.length ? { grounded: groundedLinks } : {}),
    errors,
    /**
     * ⚠ 이 문장을 반드시 함께 낸다 — Kutzbach 는 **치수를 안 본다.**
     * 값만 주면 「해석했다」로 읽히고, 못 보는 것을 모르는 채로 쓰게 된다.
     */
    note: `${NOTE[verdict]}. ${planar ? '평면' : '공간'} 식 M=${dofSpace}(n−1)−Σ(${dofSpace}−f), n=${n}, Σ=${constrained}. `
      + '⚠ Kutzbach 는 치수를 보지 않는다 — 특수 치수에서 생기는 여분 자유도(평행사변형 링크 등)는 못 잡는다.',
  };
}

/**
 * 4절 링크 등 **평면 폐루프**의 Grashof 판정(폐형) — 회전 가능성.
 * `mobilityCheck` 이 「움직이나」를 세고, 이쪽은 「크랭크가 한 바퀴 도나」를 본다. 다른 질문이다.
 * @param {number[]} lengths 링크 4개 길이
 */
export function grashof(lengths) {
  if (!Array.isArray(lengths) || lengths.length !== 4 || lengths.some((v) => !(v > 0))) return null;
  const s = [...lengths].sort((a, b) => a - b);
  const ok = s[0] + s[3] <= s[1] + s[2];
  return {
    grashof: ok,
    shortest: s[0], longest: s[3],
    note: ok
      ? 'Grashof 충족 — 최단 링크가 완전 회전할 수 있다(크랭크 성립)'
      : 'Grashof 미충족 — 어떤 링크도 완전 회전하지 못한다(전부 요동 링크)',
  };
}
