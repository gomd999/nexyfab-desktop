/**
 * svgCircleExtract — F-4(260808g): HLR 투영 SVG 경로에서 **완전 원**(구멍/보스
 * 원형 실루엣)을 추출한다. 치수의 소스를 피처 목록이 아니라 **B-rep 투영
 * 기하**에서 얻는다 — 구멍의 기원(스케치 원 절삭·다중 프로파일·불리언 원통)과
 * 무관하게 동작하고, 값은 커널 투영 그대로라 모델값이다(픽셀 측정 아님).
 *
 * 실측 형식(drawingProjectionMapping.test.ts — replicad toSVGPaths):
 *   완전 원 = "M 38 10 A 8 8 0 0 1 22 10 A 8 8 0 0 1 38 10 Z"
 *   (지름 대척점 2개를 잇는 동일 반지름 아크 2개 + Z)
 * 필렛 모서리 등 부분 아크는 L 명령과 섞인 외곽 경로에 나타난다 — 아크만으로
 * 구성된 닫힌 경로만 원으로 인정(과추출 방지).
 */

export interface ProjectedCircle {
  cx: number;
  cy: number;
  r: number;
}

const NUM = /-?\d+(?:\.\d+)?(?:e-?\d+)?/gi;

/** 단일 경로 문자열 → 완전 원이면 {cx,cy,r}, 아니면 null. */
export function circleFromPath(d: string): ProjectedCircle | null {
  if (!/z\s*$/i.test(d.trim())) return null;
  // 명령 분해 — M 1개 + A 2개 이외의 그리기 명령(L/C/Q 등)이 있으면 원이 아니다.
  const cmds = d.match(/[A-Za-y]/g)?.filter(c => /[a-z]/i.test(c) && c.toUpperCase() !== 'Z') ?? [];
  const upper = cmds.map(c => c.toUpperCase());
  if (upper[0] !== 'M' || upper.length < 3 || upper.slice(1).some(c => c !== 'A')) return null;

  const mMatch = /M\s*((?:-?[\d.e]+[\s,]*){2})/i.exec(d);
  if (!mMatch) return null;
  const mNums = (mMatch[1].match(NUM) ?? []).map(Number);
  if (mNums.length < 2) return null;
  const start = { x: mNums[0], y: mNums[1] };

  const ends: Array<{ x: number; y: number }> = [];
  const radii: number[] = [];
  const arcRe = /A\s*((?:-?[\d.e]+[\s,]*){7})/gi;
  let am: RegExpExecArray | null;
  while ((am = arcRe.exec(d)) !== null) {
    const nums = (am[1].match(NUM) ?? []).map(Number);
    if (nums.length < 7) return null;
    const [rx, ry] = nums;
    if (!(rx > 0) || Math.abs(rx - ry) > 1e-6 * Math.max(1, rx)) return null; // 타원 제외
    radii.push(rx);
    ends.push({ x: nums[5], y: nums[6] });
  }
  if (radii.length < 2) return null; // 반원 이하 단일 아크는 완전 원 증거 부족
  const r = radii[0];
  if (radii.some(v => Math.abs(v - r) > 1e-6 * Math.max(1, r))) return null;

  // 끝점이 시작점으로 복귀해야 닫힌 원(마지막 아크 끝 ≈ M 시작).
  const lastEnd = ends[ends.length - 1];
  const tol = Math.max(1e-6, r * 1e-4);
  if (Math.hypot(lastEnd.x - start.x, lastEnd.y - start.y) > tol) return null;

  // 중심 = 전체 통과점(시작+아크 끝점들)의 평균이 아니라, 모든 점이 중심에서
  // 반지름 r 에 있어야 한다는 조건으로 검증한다(대척 2아크면 중점=중심).
  const pts = [start, ...ends.slice(0, -1)];
  const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
  const cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
  for (const q of pts) {
    if (Math.abs(Math.hypot(q.x - cx, q.y - cy) - r) > Math.max(1e-3, r * 1e-2)) return null;
  }
  return { cx, cy, r };
}

/** 뷰의 경로 집합(visible+hidden, 중첩 배열 허용)에서 완전 원 전부 —
 *  visible/hidden 양쪽에 같은 원이 오면 중복 제거(중심·반지름 1e-3 일치). */
export function extractCircles(paths: unknown[]): ProjectedCircle[] {
  const out: ProjectedCircle[] = [];
  for (const d of (paths as unknown[]).flat(3).map(String)) {
    const c = circleFromPath(d);
    if (!c) continue;
    if (out.some(o => Math.abs(o.cx - c.cx) < 1e-3 && Math.abs(o.cy - c.cy) < 1e-3 && Math.abs(o.r - c.r) < 1e-3)) continue;
    out.push(c);
  }
  return out;
}
