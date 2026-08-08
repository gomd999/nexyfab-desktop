/**
 * broadphase — N5 of the complex-scale plan (260808).
 *
 * AABB 균일 그리드 브로드페이즈: O(n²) 전쌍 스캔을 "같은 셀을 공유하는 후보
 * 쌍"으로 줄인다. 셀 크기는 상위 90퍼센타일 최대 변(가늘고 긴 보가 수백 셀을
 * 덮지 않게)으로 잡고, `pad`로 접촉 판정 여유(TOL)까지 보존한다 — pad 이상
 * 떨어진 쌍만 걸러지므로 겹침/접촉 판정의 **누락이 없다**(보수적 후보 집합).
 *
 * 계약: 반환 쌍 집합 ⊇ {(i,j) | AABB_i 와 AABB_j 의 거리 ≤ pad}. 정밀 판정은
 * 호출부의 기존 로직이 그대로 수행한다(분류·면제 규칙 무변경).
 */

/**
 * @param {Array<{min:number[], max:number[]}>} boxes
 * @param {{pad?: number}} opts
 * @returns {Array<[number, number]>} i<j 후보 쌍
 */
export function aabbCandidatePairs(boxes, { pad = 4 } = {}) {
  const n = boxes.length;
  if (n < 2) return [];
  // 셀 크기: 최대 변의 p90 (최소 50mm) — 대부분 부품이 1~몇 셀만 덮는다.
  const extents = boxes.map(b => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
  const sorted = [...extents].sort((a, b) => a - b);
  const cell = Math.max(50, sorted[Math.min(n - 1, Math.floor(n * 0.9))]);

  const grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    const x0 = Math.floor((b.min[0] - pad) / cell), x1 = Math.floor((b.max[0] + pad) / cell);
    const y0 = Math.floor((b.min[1] - pad) / cell), y1 = Math.floor((b.max[1] + pad) / cell);
    const z0 = Math.floor((b.min[2] - pad) / cell), z1 = Math.floor((b.max[2] + pad) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = key(x, y, z);
      let bucket = grid.get(k);
      if (!bucket) grid.set(k, bucket = []);
      bucket.push(i);
    }
  }

  const seen = new Set();
  const pairs = [];
  for (const bucket of grid.values()) {
    for (let a = 0; a < bucket.length; a++) for (let b = a + 1; b < bucket.length; b++) {
      const i = Math.min(bucket[a], bucket[b]), j = Math.max(bucket[a], bucket[b]);
      const id = i * n + j;
      if (seen.has(id)) continue;
      seen.add(id);
      // 셀 공유는 필요조건일 뿐 — pad 확장 AABB 실교차로 한 번 더 거른다(싼 검사).
      const A = boxes[i], B = boxes[j];
      if (A.min[0] - pad > B.max[0] || B.min[0] - pad > A.max[0]) continue;
      if (A.min[1] - pad > B.max[1] || B.min[1] - pad > A.max[1]) continue;
      if (A.min[2] - pad > B.max[2] || B.min[2] - pad > A.max[2]) continue;
      pairs.push([i, j]);
    }
  }
  return pairs;
}
