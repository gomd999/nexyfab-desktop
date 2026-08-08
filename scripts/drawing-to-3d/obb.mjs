/**
 * obb — OBB(방향 상자) 내로우페이즈 (260808, C-L3 선행).
 *
 * 회전 배치 부재의 간섭 판정이 종전에는 "회전 코너를 감싼 월드 AABB"로만
 * 이뤄져, 피치(ry)가 걸린 장부재(경사 거더 30m급)는 쐐기 전체를 상자로 감싸
 * **대량 과탐**을 냈다. 여기서는 부품의 로컬 AABB를 회전 그대로 세운 OBB에
 * 대해 SAT(분리축 정리, 15축)를 돌린다.
 *
 * 보수성 계약: OBB(로컬 AABB) ⊇ 실형상 이므로 「분리」 판정은 실형상에서도
 * 분리임을 보증한다(누락 불가). 겹침 판정은 비상자 형상(원통 대각 등)에서
 * 여전히 과탐일 수 있다 — 방향은 항상 안전 측이다.
 *
 * 회전 규약: OpenSCAD rotate([rx,ry,rz]) = 월드 고정축 X→Y→Z 순 적용
 * (assembly.mjs rotatePoint 와 동일 수학) → R = Rz·Ry·Rx.
 */

const DEG = Math.PI / 180;

/** R = Rz(rz)·Ry(ry)·Rx(rx) — 3×3 행렬(행우선 3배열). */
export function rotationMatrix(rx = 0, ry = 0, rz = 0) {
  const cx = Math.cos(rx * DEG), sx = Math.sin(rx * DEG);
  const cy = Math.cos(ry * DEG), sy = Math.sin(ry * DEG);
  const cz = Math.cos(rz * DEG), sz = Math.sin(rz * DEG);
  // Rz·Ry·Rx (열벡터 곱 기준)
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

/**
 * 부품 → OBB. localAabb = partAabb 결과({min,max}, 로컬), at = {tx..rz}.
 * @returns { c:[x,y,z], e:[hx,hy,hz], R:number[][] } — 중심·반변·회전행렬
 */
export function obbFromPart(localAabb, at = {}) {
  const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = at;
  const R = rotationMatrix(rx, ry, rz);
  const cl = [
    (localAabb.min[0] + localAabb.max[0]) / 2,
    (localAabb.min[1] + localAabb.max[1]) / 2,
    (localAabb.min[2] + localAabb.max[2]) / 2,
  ];
  const c = [
    R[0][0] * cl[0] + R[0][1] * cl[1] + R[0][2] * cl[2] + tx,
    R[1][0] * cl[0] + R[1][1] * cl[1] + R[1][2] * cl[2] + ty,
    R[2][0] * cl[0] + R[2][1] * cl[1] + R[2][2] * cl[2] + tz,
  ];
  const e = [
    (localAabb.max[0] - localAabb.min[0]) / 2,
    (localAabb.max[1] - localAabb.min[1]) / 2,
    (localAabb.max[2] - localAabb.min[2]) / 2,
  ];
  return { c, e, R };
}

const col = (R, k) => [R[0][k], R[1][k], R[2][k]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * OBB-OBB SAT. @returns { overlap:boolean, depth:number }
 * depth = 전 축 최소 관통량(겹침일 때만 유효) — AABB overlapInfo.depth 대응.
 */
export function obbOverlap(A, B) {
  const axes = [];
  for (let k = 0; k < 3; k++) axes.push(col(A.R, k));
  for (let k = 0; k < 3; k++) axes.push(col(B.R, k));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const axis = cross3(col(A.R, i), col(B.R, j));
    const len = Math.hypot(...axis);
    if (len > 1e-9) axes.push([axis[0] / len, axis[1] / len, axis[2] / len]);
  }
  const d = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]];
  let minDepth = Infinity;
  for (const axis of axes) {
    const rA = A.e[0] * Math.abs(dot3(axis, col(A.R, 0))) + A.e[1] * Math.abs(dot3(axis, col(A.R, 1))) + A.e[2] * Math.abs(dot3(axis, col(A.R, 2)));
    const rB = B.e[0] * Math.abs(dot3(axis, col(B.R, 0))) + B.e[1] * Math.abs(dot3(axis, col(B.R, 1))) + B.e[2] * Math.abs(dot3(axis, col(B.R, 2)));
    const dist = Math.abs(dot3(axis, d));
    const overlap = rA + rB - dist;
    if (overlap <= 0) return { overlap: false, depth: 0 };
    if (overlap < minDepth) minDepth = overlap;
  }
  return { overlap: true, depth: minDepth };
}
