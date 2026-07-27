/**
 * design-driver/refGeometry — 치수 ref 이름 → 실제 좌표, 그리고 그 둘이 어떻게 떨어져
 * 있는가. 계획 프리플라이트(llmPlanner)와 drawing 게이트(drawingGate)가 **같은 것**을 쓴다.
 *
 * 왜 모듈로 나왔나 (260728): 프리플라이트가 "이 뷰에서는 잴 수 없다"를 판정하려고 이미
 * 이 계산을 하고 있었는데, 게이트 쪽에서 "왜 8이 나왔나"를 설명하려면 같은 계산이 필요했다.
 * 복제하면 두 곳이 서로 다른 말을 하게 되고, 그게 이 레포가 반복해서 데인 드리프트다
 * (검도 리포트 렌더러·REV 규약·구멍표 태그에서 같은 판단을 했다).
 *
 * 앵커는 `buildExtrudeTopo`(게이트가 쓰는 바로 그 토폴로지)와 `viewBasis`(도면이 쓰는 바로
 * 그 기저)를 재사용한다 — 여기서 새로 정의하는 기하는 없다.
 */
import type { NamedTopology } from '@/lib/cad/topoNaming';
import { viewBasis } from '@/lib/drawing/projectView';

/** 좌표만 읽는 최소 3D 점(topoNaming/projectView 공용). */
export type Vec3Like = { x: number; y: number; z: number };

export const UNMEASURABLE_EPS = 1e-9;

export const WORLD_AXES: Array<{ name: 'X' | 'Y' | 'Z'; dir: Vec3Like }> = [
  { name: 'X', dir: { x: 1, y: 0, z: 0 } },
  { name: 'Y', dir: { x: 0, y: 1, z: 0 } },
  { name: 'Z', dir: { x: 0, y: 0, z: 1 } },
];

export const DIM_VIEWS: Array<'front' | 'top' | 'right'> = ['front', 'top', 'right'];

/** ref 이름이 가리키는 엔티티의 점들. 이름이 없거나 엔티티가 없으면 null. */
export function refPoints(topo: NamedTopology, ref: string): Vec3Like[] | null {
  const loc = topo.byName.get(ref);
  if (!loc) return null;
  if (loc.kind === 'face') {
    const f = topo.poly.faces[loc.index];
    return f ? f.vertices.map((i) => topo.poly.vertices[i]) : null;
  }
  const e = topo.edges[loc.index];
  return e ? [topo.poly.vertices[e.a], topo.poly.vertices[e.b]] : null;
}

/** 두 점 집합이 어떤 단위 방향으로 떨어진 간격(겹치면 0). */
export function gapAlong(a: Vec3Like[], b: Vec3Like[], dir: Vec3Like): number {
  const proj = (ps: Vec3Like[]) => ps.map((p) => p.x * dir.x + p.y * dir.y + p.z * dir.z);
  const pa = proj(a), pb = proj(b);
  const loA = Math.min(...pa), hiA = Math.max(...pa);
  const loB = Math.min(...pb), hiB = Math.max(...pb);
  return Math.max(0, Math.max(loA, loB) - Math.min(hiA, hiB));
}

/** 어떤 표준 뷰들이 이 월드 축을 실제로 보여주는가(뷰 평면에 성분이 0 이 아님). */
export function viewsShowing(axis: Vec3Like): string[] {
  return DIM_VIEWS.filter((v) => {
    const b = viewBasis(v);
    const r = Math.abs(axis.x * b.right.x + axis.y * b.right.y + axis.z * b.right.z);
    const u = Math.abs(axis.x * b.up.x + axis.y * b.up.y + axis.z * b.up.z);
    return r > 1e-9 || u > 1e-9;
  });
}

/** 스케일 의존 eps — 큰 부품에서 상대 오차로 판정하기 위한 것(프리플라이트와 동일 규칙). */
export function epsForTopo(topo: NamedTopology): number {
  const scale = Math.max(1, ...topo.poly.vertices.map((p) => Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z)));
  return UNMEASURABLE_EPS * scale;
}

export interface RefSpanReport {
  /** 이 뷰의 가로/세로 축으로 두 ref 가 떨어진 간격(mm). */
  alongViewRight: number;
  alongViewUp: number;
  /** 월드 축별 간격 — 어느 축으로 갈렸는지 보여준다. */
  alongWorld: Array<{ name: 'X' | 'Y' | 'Z'; gap: number }>;
  /** 간격이 있는 월드 축을 실제로 보여주는 표준 뷰들. */
  betterViews: string[];
}

/**
 * 두 ref 가 **실제로** 어떻게 떨어져 있는지 보고한다 (260728 §7-1).
 *
 * 게이트가 "measured 8 deviates from expected 40" 만 말하면, 모델도 사람도 왜 8 인지 알 수
 * 없다. 실측(bench v1)에서 L-브래킷이 3회 전부 이 실패를 냈고, 원인은 값이 아니라 **ref
 * 선택**이었다 — 40 을 재려 했는데 벽두께 8 을 가르는 두 엔티티를 골랐다.
 *
 * ⚠ 이 함수는 **보고만 한다**. 어떤 ref 를 골랐어야 하는지 제안하지 않는다 — "40 이 나오는
 * 쌍"을 찾아 알려주면 모델이 숫자를 맞추려고 의미가 다른 엣지를 고를 수 있고, 그러면
 * 게이트는 통과하는데 도면은 틀린다(§6-1 에서 배격한 것과 같은 종류의 자기충족).
 */
export function describeRefSpan(
  topo: NamedTopology,
  view: string,
  refA: string,
  refB: string,
): RefSpanReport | null {
  if (!DIM_VIEWS.includes(view as 'front' | 'top' | 'right')) return null;
  const a = refPoints(topo, refA);
  const b = refPoints(topo, refB);
  if (!a || !b || a.length === 0 || b.length === 0) return null;
  const basis = viewBasis(view as 'front' | 'top' | 'right');
  const eps = epsForTopo(topo);
  const alongWorld = WORLD_AXES.map((ax) => ({ name: ax.name, gap: gapAlong(a, b, ax.dir) }));
  return {
    alongViewRight: gapAlong(a, b, basis.right),
    alongViewUp: gapAlong(a, b, basis.up),
    alongWorld,
    betterViews: [...new Set(alongWorld.filter((w) => w.gap > eps).flatMap((w) =>
      viewsShowing(WORLD_AXES.find((x) => x.name === w.name)!.dir)))],
  };
}

/** 사람이 읽는 한 줄 — 게이트 사유에 덧붙인다. */
export function refSpanLine(refA: string, refB: string, view: string, s: RefSpanReport): string {
  const world = s.alongWorld.map((w) => `${w.name}=${+w.gap.toFixed(6)}`).join(' ');
  return (
    `refs '${refA}'↔'${refB}' are separated by [${world}] mm in world axes ` +
    `(in view '${view}': horizontal ${+s.alongViewRight.toFixed(6)}, vertical ${+s.alongViewUp.toFixed(6)}) — ` +
    `the measured value is the distance between THOSE entities, so if it is not the number you meant, ` +
    `you picked the wrong pair, not the wrong view` +
    (s.betterViews.length ? ` (axes with a real gap are shown in view ${s.betterViews.map((v) => `'${v}'`).join(' or ')})` : '')
  );
}
