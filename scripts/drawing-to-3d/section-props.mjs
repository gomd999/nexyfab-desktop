/**
 * section-props.mjs — 형상 → 단면특성(결정론).
 *
 * ②(분야 상시검증)의 다리: 설계 형상(compose 피처)에서 부재 단면특성(A·Ix·Iy·Sx·
 * Sy·rx·ry)과 부재길이 L을 **결정론적으로** 뽑는다. 이 값들이 engineering-core의
 * 보/기둥 계산기 입력(Sx·Ix·Aw·Ag·r·L)을 채운다. 하중·재료(Fy·w·P·Pu)만 사용자
 * 입력 — 형상이 줄 수 있는 것과 없는 것을 정직하게 분리한다.
 *
 * 폴리곤 단면특성은 그린정리 폐형식(저작권 무관 순수수학):
 *   A   = ½Σ(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)
 *   Cx  = 1/(6A)·Σ(xᵢ+xᵢ₊₁)(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)
 *   Iₓ° = 1/12·Σ(yᵢ²+yᵢyᵢ₊₁+yᵢ₊₁²)(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)   (원점 기준)
 *   Iₓ  = Iₓ° − A·Cy²                                     (도심 이동)
 */

/** 폴리곤(닫힘 가정, 마지막≠첫 점이면 자동 폐합) → 도심 단면특성. */
export function polygonProps(pointsIn) {
  if (!Array.isArray(pointsIn) || pointsIn.length < 3) throw new Error('polygonProps: <3 points');
  const pts = pointsIn.slice();
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  if (fx !== lx || fy !== ly) pts.push([fx, fy]); // 자동 폐합
  const n = pts.length - 1;

  let A = 0, Cx = 0, Cy = 0, Ixo = 0, Iyo = 0;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[i + 1];
    const cross = xi * yj - xj * yi;
    A += cross;
    Cx += (xi + xj) * cross;
    Cy += (yi + yj) * cross;
    Ixo += (yi * yi + yi * yj + yj * yj) * cross;
    Iyo += (xi * xi + xi * xj + xj * xj) * cross;
  }
  A *= 0.5;
  if (Math.abs(A) < 1e-9) throw new Error('polygonProps: zero area');
  Cx /= 6 * A;
  Cy /= 6 * A;
  Ixo /= 12;
  Iyo /= 12;
  const area = Math.abs(A);
  // 도심 기준 2차모멘트(부호 무관하게 양수화)
  const Ix = Math.abs(Ixo - A * Cy * Cy);
  const Iy = Math.abs(Iyo - A * Cx * Cx);

  // 극한섬유 거리(도심 기준)
  const ys = pts.slice(0, n).map((p) => p[1] - Cy);
  const xs = pts.slice(0, n).map((p) => p[0] - Cx);
  const cmaxY = Math.max(...ys.map(Math.abs));
  const cmaxX = Math.max(...xs.map(Math.abs));

  const Sx = cmaxY > 0 ? Ix / cmaxY : 0;
  const Sy = cmaxX > 0 ? Iy / cmaxX : 0;
  const rx = Math.sqrt(Ix / area);
  const ry = Math.sqrt(Iy / area);

  return { A: area, Cx, Cy, Ix, Iy, Sx, Sy, rx, ry, cmaxX, cmaxY };
}

/** 직사각형 b(폭)×h(높이) 단면특성(축=수평/수직). */
export function rectProps(b, h) {
  return polygonProps([[0, 0], [b, 0], [b, h], [0, h]]);
}

/** 중공 직사각(외곽 bo×ho − 내부 bi×hi, 동심) 단면특성 — 폐형식. */
export function hollowRectProps(bo, ho, bi, hi) {
  const A = bo * ho - bi * hi;
  const Ix = (bo * ho ** 3 - bi * hi ** 3) / 12;
  const Iy = (ho * bo ** 3 - hi * bi ** 3) / 12;
  const cmaxY = ho / 2, cmaxX = bo / 2;
  return {
    A, Cx: 0, Cy: 0, Ix, Iy,
    Sx: Ix / cmaxY, Sy: Iy / cmaxX,
    rx: Math.sqrt(Ix / A), ry: Math.sqrt(Iy / A),
    cmaxX, cmaxY,
  };
}

/** 원형(지름 d) 단면특성 — 폐형식. */
export function circleProps(d) {
  const R = d / 2;
  const A = Math.PI * R * R;
  const I = (Math.PI * Math.pow(d, 4)) / 64;
  const S = I / R;
  const r = R / 2; // √(I/A)=R/2
  return { A, Cx: 0, Cy: 0, Ix: I, Iy: I, Sx: S, Sy: S, rx: r, ry: r, cmaxX: R, cmaxY: R };
}

/**
 * compose 피처 → 프리즘형 부재 {section, L}. 축정렬 프리즘만(빔/기둥/포스트).
 * - extrude: 단면=profile 폴리곤, L=height(압출축).
 * - box:     size[3]. lengthAxis(기본=최장축)=L, 나머지 두 변=직사각 단면.
 * - cylinder:원형 단면(diameter), L=height.
 * 그 외(revolve/sphere 등)=null(프리즘형 부재 아님).
 * @returns {section, L, kind, note} | null
 */
export function featureToMember(feature, { lengthAxis } = {}) {
  if (!feature || typeof feature !== 'object') return null;
  switch (feature.kind) {
    case 'extrude': {
      if (!Array.isArray(feature.profile) || !(feature.height > 0)) return null;
      return { section: polygonProps(feature.profile), L: feature.height, kind: 'extrude', note: '단면=압출 프로파일, L=압출높이' };
    }
    case 'box': {
      const s = feature.size;
      if (!Array.isArray(s) || s.length < 3 || !s.every((v) => v > 0)) return null;
      // 길이축: 지정 없으면 최장축
      const axis = lengthAxis ?? s.indexOf(Math.max(...s));
      const rest = s.filter((_, i) => i !== axis);
      return { section: rectProps(rest[0], rest[1]), L: s[axis], kind: 'box', note: `단면=${rest[0]}×${rest[1]}, L=${s[axis]}(축${axis})` };
    }
    case 'cylinder': {
      if (!(feature.diameter > 0) || !(feature.height > 0)) return null;
      return { section: circleProps(feature.diameter), L: feature.height, kind: 'cylinder', note: '원형단면, L=높이' };
    }
    default:
      return null;
  }
}

/** intent에서 프리즘형 부재 후보 목록(피처 id/index + 파생 L·A). UI 부재선택용. */
export function memberCandidates(intent) {
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  const out = [];
  feats.forEach((f, i) => {
    const m = featureToMember(f);
    if (m) out.push({ index: i, id: f.id ?? `f${i}`, kind: m.kind, L: m.L, A: +m.section.A.toFixed(1), rmin: +Math.min(m.section.rx, m.section.ry).toFixed(2) });
  });
  return out;
}

// --- self-test: 직사각/원형 폐형식 대조 ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('section-props.mjs');
if (isMain) {
  const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  let pass = 0, fail = 0;
  const t = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL', name); } };

  // 직사각 b=100 h=200: A=20000, Ix=bh³/12=66.67e6, Sx=bh²/6=666666.7, rx=h/√12=57.735
  const r = rectProps(100, 200);
  t('rect A', approx(r.A, 20000));
  t('rect Ix', approx(r.Ix, (100 * 200 ** 3) / 12));
  t('rect Iy', approx(r.Iy, (200 * 100 ** 3) / 12));
  t('rect Sx', approx(r.Sx, (100 * 200 ** 2) / 6));
  t('rect rx', approx(r.rx, 200 / Math.sqrt(12)));
  t('rect ry', approx(r.ry, 100 / Math.sqrt(12)));

  // 원형 d=50: A=1963.5, I=306796, S=12271.8, r=12.5
  const c = circleProps(50);
  t('circle A', approx(c.A, Math.PI * 625));
  t('circle Ix', approx(c.Ix, (Math.PI * 50 ** 4) / 64));
  t('circle rx', approx(c.rx, 12.5));

  // 각관(rect tube) 100×100, 벽 5 → 외곽-내곽 폴리곤(구멍은 CW). 여기선 solid 근사 대신
  // 외곽만: 100×100 A=10000. (중공 단면은 domain-verify에서 별도 표기)
  const box = featureToMember({ kind: 'box', size: [50, 80, 3000] });
  t('box longest=L', box.L === 3000);
  t('box section A', approx(box.section.A, 50 * 80));

  const cyl = featureToMember({ kind: 'cylinder', diameter: 60, height: 2000 });
  t('cyl L', cyl.L === 2000);
  t('cyl A', approx(cyl.section.A, Math.PI * 900));

  const none = featureToMember({ kind: 'sphere', diameter: 100 });
  t('sphere → null', none === null);

  console.log(`section-props self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
