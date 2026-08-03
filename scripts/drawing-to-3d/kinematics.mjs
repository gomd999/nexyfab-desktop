/**
 * 구속 야코비안 운동학 — **자유도를 세는 것이 아니라 푼다**. PBAS 0.7.3 이식 ③.
 *
 * ## 왜 Kutzbach 로는 부족한가
 * `mobility.mjs` 의 Kutzbach 는 **치수를 안 본다.** 링크 수와 운동쌍 종류만 세므로:
 * ```
 *   평행사변형 링크    Kutzbach M=0 (구조물)  ← 실제로는 움직인다(여분 구속)
 *   특이 자세         Kutzbach 는 못 본다     ← 순간적으로 자유도가 늘거나 잠긴다
 *   과구속 정도       음수만 나온다           ← 「몇 개가 여분인지」를 모른다
 * ```
 *
 * ## 방법
 * 각 운동쌍이 **허용하는 트위스트**(6벡터: [v, ω])의 여집합이 구속 행이다.
 * 그 행들을 모아 야코비안을 만들고 **수치 랭크**를 구하면:
 * ```
 *   자유도 M = 6(n−1) − rank(J)
 *   여분 구속 = (행 수) − rank(J)      ← 평행사변형이 여기서 잡힌다
 *   조건수    = σmax / σmin            ← 특이 자세가 여기서 잡힌다
 * ```
 * ⚠ **선형화된 순간 운동학**이다. 지금 자세에서의 자유도이고, 유한 변위 궤적이 아니다 —
 *   자세가 바뀌면 값이 달라질 수 있다(그래서 조건수를 함께 낸다).
 * ⚠ 랭크는 **공차에 달렸다.** 임계 근처에서는 M 이 흔들릴 수 있으므로 `rankTolerance` 와
 *   특이값을 그대로 내보낸다 — 숫자 하나만 주면 「확정된 자유도」로 읽힌다.
 */

const EPS = 1e-12;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm3 = (a) => Math.hypot(a[0], a[1], a[2]);

/** 축 → 정규직교 3축 {n, u, v}. 축이 0 이면 z 로 본다. */
function orthoAxes(axis) {
  const a = Array.isArray(axis) ? [num(axis[0]), num(axis[1]), num(axis[2])] : [0, 0, 1];
  const m = nrm3(a);
  const n = m > EPS ? scl(a, 1 / m) : [0, 0, 1];
  // n 과 가장 안 나란한 기저축을 골라 외적 — 수치적으로 안정적이다
  const pick = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [n[1] * pick[2] - n[2] * pick[1], n[2] * pick[0] - n[0] * pick[2], n[0] * pick[1] - n[1] * pick[0]];
  u = scl(u, 1 / Math.max(EPS, nrm3(u)));
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { n, u, v };
}

/** 운동쌍이 **허용하는** 트위스트 [vx,vy,vz, ωx,ωy,ωz] 목록. */
export function allowedTwists(joint) {
  const t = String(joint?.type ?? 'fixed').toLowerCase();
  const { n, u, v } = orthoAxes(joint?.axisVec ?? AXIS_VEC[joint?.axis] ?? [0, 0, 1]);
  const tr = (d) => [...d, 0, 0, 0];
  const ro = (d) => [0, 0, 0, ...d];
  if (['fixed', 'bonded'].includes(t)) return [];
  if (['revolute', 'hinge'].includes(t)) return [ro(n)];
  if (['prismatic', 'slider', 'guide'].includes(t)) return [tr(n)];
  if (t === 'cylindrical') return [tr(n), ro(n)];
  if (t === 'planar') return [tr(u), tr(v), ro(n)];
  if (['spherical', 'ball'].includes(t)) return [ro([1, 0, 0]), ro([0, 1, 0]), ro([0, 0, 1])];
  if (t === 'screw') {
    // 나사: 회전과 병진이 리드로 묶인 **한 자유도**
    const leadPerRad = num(joint?.leadMmPerRev, 0) / (2 * Math.PI);
    return [[...scl(n, leadPerRad), ...n]];
  }
  if (t === 'gear') return [ro(n)];      // 기어쌍은 한 자유도(감속비는 구속식이 별도)
  if (t === 'cam') return [tr(u), ro(n)]; // 캠: 구름+미끄럼
  if (Array.isArray(joint?.motionSubspace)) return joint.motionSubspace.map((r) => Array.from({ length: 6 }, (_, i) => num(r[i])));
  return [];
}
const AXIS_VEC = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** 허용 트위스트의 **직교 여집합** = 구속 행. Gram-Schmidt. */
export function constraintRows(allowed, dim = 6, tol = 1e-10) {
  const basis = [];
  const add = (cand) => {
    let x = Array.from({ length: dim }, (_, i) => num(cand[i]));
    for (const b of basis) {
      const p = b.reduce((s, bi, i) => s + bi * x[i], 0);
      x = x.map((xi, i) => xi - p * b[i]);
    }
    const m = Math.hypot(...x);
    if (m > tol) basis.push(x.map((xi) => xi / m));
  };
  allowed.forEach(add);
  const allowedCount = basis.length;
  for (let a = 0; a < dim; a++) { const e = Array(dim).fill(0); e[a] = 1; add(e); }
  return basis.slice(allowedCount);
}

/** 기준점 트위스트 → 조인트점 트위스트 사상. [v_j; ω] = [I, −skew(r); 0, I][v_ref; ω] */
function pointTwistMap(refM, jointM) {
  const r = sub(jointM, refM);
  return [
    [1, 0, 0, 0, r[2], -r[1]],
    [0, 1, 0, -r[2], 0, r[0]],
    [0, 0, 1, r[1], -r[0], 0],
    [0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0, 1],
  ];
}
const rowTimes = (row, m) => Array.from({ length: 6 }, (_, c) => row.reduce((s, ri, i) => s + ri * m[i][c], 0));

/**
 * 대칭행렬 고유값(Jacobi 회전) — 특이값 = √λ(JᵀJ).
 * ⚠ 작은 행렬(≤ 수십 열)에 쓴다. 부품이 많아지면 열 수가 6(n−1) 로 늘어난다.
 */
function symEigenvalues(A, sweeps = 60) {
  const n = A.length;
  const M = A.map((r) => [...r]);
  for (let s = 0; s < sweeps; s++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += M[p][q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(M[p][q]) < 1e-18) continue;
        const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), sn = t * c;
        for (let k = 0; k < n; k++) {
          const akp = M[k][p], akq = M[k][q];
          M[k][p] = c * akp - sn * akq;
          M[k][q] = sn * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = M[p][k], aqk = M[q][k];
          M[p][k] = c * apk - sn * aqk;
          M[q][k] = sn * apk + c * aqk;
        }
      }
    }
  }
  return Array.from({ length: n }, (_, i) => M[i][i]);
}

/** 특이값·랭크·조건수. */
export function rankDiagnostics(rows, opts = {}) {
  const m = rows.length, n = rows[0]?.length ?? 0;
  if (!m || !n) return { singularValues: [], rank: 0, conditionNumber: Infinity, smallest: 0, largest: 0, tolerance: 0 };
  const gram = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) =>
    rows.reduce((s, r) => s + num(r[i]) * num(r[j]), 0)));
  const sv = symEigenvalues(gram).map((v) => Math.sqrt(Math.max(0, v))).sort((a, b) => b - a);
  const largest = sv[0] ?? 0;
  /**
   * ⚠ 공차는 **최대 특이값에 상대적**이어야 한다. `max(1, largest)` 로 쓰면 값이 작은
   *   행렬에서 공차가 과하게 작아져 0 에 가까운 특이값까지 세고, **랭크가 행 수를 넘는다**
   *   (실측: 6축 로봇팔 rank 32 > rows 30 → 자유도 4 로 오답).
   * ⚠ 그리고 랭크는 정의상 **min(행, 열)** 을 못 넘는다 — 상한을 건다.
   *   Gram 행렬(n×n)의 고유값을 쓰므로 열 수만큼 값이 나오는 것이 원인이다.
   */
  /**
   * ⚠⚠ **Gram 행렬을 거치면 정밀도가 절반이다.** σ(J) 를 λ(JᵀJ) 의 √ 로 얻으므로 조건수가
   *   제곱되고, **참값이 0 인 특이값이 √eps·σmax ≈ 1.5e-8·σmax 로 뜬다.** 공차를
   *   `eps·σmax`(≈2e-16) 로 잡으면 그 노이즈를 랭크로 세어 **랭크가 과대평가**된다.
   *   실측: 슬라이더-크랭크 rank 18(참값 17) → 자유도 0 으로 오답. 4절은 우연히 맞아
   *   「한 사례만 맞으면 맞다」로 착각하기 쉬웠다.
   * ⚠ 랭크는 정의상 **min(행, 열)** 을 못 넘는다 — Gram(n×n) 고유값을 쓰니 상한을 건다.
   */
  const tol = num(opts.rankTolerance, Math.max(m, n) * Math.sqrt(Number.EPSILON) * largest);
  const kept = sv.filter((v) => v > tol).slice(0, Math.min(m, n));
  const smallest = kept[kept.length - 1] ?? 0;
  /**
   * ⚠ **공차 근처에 특이값이 있으면 랭크는 확정이 아니다.** 그때 M 은 ±1 흔들린다 —
   *   숫자만 주고 침묵하면 「확정된 자유도」로 읽힌다. 밖에서 판단하도록 내보낸다.
   */
  /**
   * ⚠ **min(행,열) 뒤의 특이값은 구조적으로 0 이다** — 세면 안 된다. 열이 행보다 많으면
   *   (부품 미지수 > 구속 행) 남는 값이 항상 노이즈로 뜨는데, 그걸 「경계」라 부르면
   *   멀쩡한 직렬 기구(6축 로봇팔: 행 30 · 열 36)가 매번 「랭크 불확정」으로 보고된다.
   */
  const borderline = sv.slice(0, Math.min(m, n)).filter((v) => v > tol / 100 && v < tol * 100).length;
  return {
    singularValues: sv.map((v) => +v.toExponential(4)),
    rank: kept.length,
    conditionNumber: smallest > 0 ? largest / smallest : Infinity,
    smallest, largest, tolerance: tol, borderline,
  };
}

/**
 * ★구속 야코비안으로 자유도를 **푼다**.
 *
 * @param {{parts:Array, joints:Array}} assembly `joints[].between:[a,b]` · `axis` · `at`(mm) 선택
 * @param {{ground?:string[], rankTolerance?:number}} opts
 * @returns {null|object} joints 선언이 없으면 null — 안 잰 것과 0 은 다르다
 */
export function solveMobility(assembly, opts = {}) {
  const joints = assembly?.joints;
  if (!Array.isArray(joints) || !joints.length) return null;
  const parts = assembly?.parts ?? [];
  const byId = new Map(parts.map((p) => [p.id, p]));

  const GROUND_ROLES = new Set(['frame', 'base', 'ground', 'slab', 'floor']);
  const grounded = new Set(opts.ground ?? parts.filter((p) => GROUND_ROLES.has(p.role)).map((p) => p.id));

  // 조인트가 잇는 부품만 링크로 센다(형상만 있고 안 물린 부품은 기구가 아니다)
  const linked = new Set();
  const valid = [];
  const errors = [];
  for (const [i, j] of joints.entries()) {
    const [a, b] = j.between ?? [];
    if (!a || !b || a === b) { errors.push(`joint[${i}]: between:[A,B] 가 필요하고 서로 달라야 한다`); continue; }
    linked.add(a); linked.add(b);
    valid.push(j);
  }
  if (!valid.length) return { mobility: null, errors, note: '유효한 운동쌍이 없다 — 계산하지 않았다(0 이 아니다)' };

  // 접지는 하나로 묶는다(지면에 고정된 부재가 여럿이어도 한 링크다)
  const groundedLinked = [...linked].filter((id) => grounded.has(id));
  const free = [...linked].filter((id) => !grounded.has(id));
  const offset = new Map(free.map((id, i) => [id, i * 6]));
  const nLinks = free.length + (groundedLinked.length ? 1 : 0);
  const totalDof = free.length * 6;
  if (!totalDof) {
    return { mobility: 0, rank: 0, rows: 0, redundant: 0, links: nLinks, errors,
      note: '모든 링크가 접지다 — 움직일 수 있는 부재가 없다' };
  }

  /** 조인트 위치(m). `at`(mm) 이 있으면 그것, 없으면 두 부품 배치의 중점. */
  const jointPoint = (j) => {
    if (Array.isArray(j.atMm)) return scl([num(j.atMm[0]), num(j.atMm[1]), num(j.atMm[2])], 1e-3);
    const pa = byId.get(j.between[0])?.at ?? {};
    const pb = byId.get(j.between[1])?.at ?? {};
    return scl([
      (num(pa.tx) + num(pb.tx)) / 2, (num(pa.ty) + num(pb.ty)) / 2, (num(pa.tz) + num(pb.tz)) / 2,
    ], 1e-3);
  };
  const partPoint = (id) => {
    const at = byId.get(id)?.at ?? {};
    return scl([num(at.tx), num(at.ty), num(at.tz)], 1e-3);
  };

  const rows = [];
  const perJoint = [];
  for (const j of valid) {
    const jp = jointPoint(j);
    const allowed = allowedTwists(j);
    const cons = constraintRows(allowed, 6);
    const from = rows.length;
    for (const c of cons) {
      const row = Array(totalDof).fill(0);
      for (const [id, sign] of [[j.between[0], -1], [j.between[1], 1]]) {
        const off = offset.get(id);
        if (off == null) continue; // 접지 링크는 미지수가 없다
        const local = rowTimes(c, pointTwistMap(partPoint(id), jp));
        for (let k = 0; k < 6; k++) row[off + k] += sign * local[k];
      }
      rows.push(row);
    }
    perJoint.push({ type: j.type, between: j.between, allowedDof: allowed.length, constraintRows: cons.length, rowRange: [from, rows.length - 1] });
  }

  const d = rankDiagnostics(rows, opts);
  const mobility = Math.max(0, totalDof - d.rank);
  const redundant = Math.max(0, rows.length - d.rank);
  /**
   * ⚠ **임계값은 공차가 정한다.** 살아남은 최소 특이값은 정의상 `tol = max(m,n)·√eps·σmax`
   *   보다 크므로 조건수는 **구조적으로 1/(max(m,n)·√eps) ≈ 3e6 을 못 넘는다.**
   *   1e10 같은 값을 쓰면 그 플래그는 **영원히 안 걸린다**(처음에 그렇게 써 놨다 — 죽은
   *   경보는 없는 경보보다 나쁘다. 「검사했는데 정상」으로 읽히기 때문이다).
   *   그래서 공차 대비 상대치로 잡는다: 최소 특이값이 공차의 100배 안쪽이면 위험 구간이다.
   */
  const condCeiling = d.tolerance > 0 && d.largest > 0 ? d.largest / d.tolerance : Infinity;
  const illConditioned = Number.isFinite(d.conditionNumber) && d.conditionNumber > condCeiling / 100;

  return {
    method: '선형화 6자유도 구속 야코비안 + 수치 랭크(Jacobi 고유값)',
    mobility, links: nLinks, freeParts: free.length, totalDof,
    rows: rows.length, rank: d.rank, redundant,
    singularValues: d.singularValues.slice(0, 8),
    conditionNumber: Number.isFinite(d.conditionNumber) ? +d.conditionNumber.toExponential(3) : null,
    illConditioned, rankTolerance: d.tolerance, borderline: d.borderline,
    rankCertain: d.borderline === 0,
    perJoint, errors,
    ...(groundedLinked.length ? { grounded: groundedLinked } : {}),
    /**
     * ⚠ 반드시 함께 낸다 — 숫자 하나만 주면 「확정된 자유도」로 읽힌다.
     */
    note: `자유도 ${mobility}${redundant ? ` · 여분 구속 ${redundant}개(평행사변형 링크 등 — Kutzbach 는 이걸 음수로만 말한다)` : ''}`
      + `${illConditioned ? ' · ⚠특이 자세에 가깝다(조건수 큼 — 이 자세에서만 성립할 수 있다)' : ''}`
      + `${d.borderline ? ` · ⚠랭크가 공차에 민감하다(경계 특이값 ${d.borderline}개 — 자유도가 ±1 흔들릴 수 있다)` : ''}`
      + '. **선형화된 순간 운동학**이라 지금 자세 기준이고 유한 변위 궤적이 아니다.',
  };
}
