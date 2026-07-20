/**
 * g3AssemblyGate.test.ts — G3 게이트(어셈블리 설계) 실행형 실증.
 *
 * REPLACEMENT_ROADMAP §5: G3 = R1(하류 재생성) + R2(불리언/명명 안정) +
 * R3(실측 치수) + R5(참조 상실 목록+재지정). 네 기둥이 전부 랜딩된 지금,
 * 이 파일이 "어셈블리 설계 한 사이클"을 그대로 실행한다
 * (실행하지 않은 판정은 판정이 아니다):
 *
 *   1. 2부품 어셈블리를 프로그래밍 경로(solveMates 파사드=F14 해소)로
 *      구성하고 mate가 수렴 — 손계산 기대 위치 1e-6.
 *   2. gear 구동(W5-F2 kinematics)이 기어비를 실반영 — 90° → −45°(ratio 2).
 *   3. 부품 프로파일 편집(5각→4각) 후 사라진 참조가 **명시적으로** 상실
 *      목록에 잡히고(사유+구 앵커), 살아있는 참조는 잡히지 않는다.
 *   4. R5 재지정: 후보 제안(named 채널=midpoint 순위, confident 아님을
 *      정직하게 유지) → 원클릭 적용 → 새 토폴로지에서 참조 재해석 성공.
 *   5. R3: 편집된 부품 위에서 치수가 실측으로 다시 나온다(재지정된 참조
 *      포함, 값 손계산 일치).
 *   6. 편집 후 어셈블리 재수렴.
 *
 * G3의 명시 한계(게이트 표에도 기재): mate 구동은 운동학 전파(동역학
 * 아님) · named 채널 재지정은 확신 후보를 만들지 않으므로 사용자 확인
 * 전제 · RefRelinkPanel의 페이지 mount는 후속 배선.
 */
import { describe, it, expect } from 'vitest';
import { solveMates } from '@/lib/assembly/mateSolver';
import {
  collectLostRefs,
  suggestRelinkCandidates,
  applyRelink,
  type NamedRefInput,
} from '@/app/[lang]/shape-generator/features/refRelink';
import { buildExtrudeTopo, edgeMidpoint, namesOf } from '@/lib/cad/topoNaming';
import { fromAnchors, type EdgeAnchorSource } from '@/lib/cad/composedTopo';
import { measureSheetDimension } from '@/lib/drawing/associativeUpdate';
import type { Viewport } from '@/lib/drawing/sheet';
import type { Dimension } from '@/lib/drawing/dimension';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── 부품 fixtures ───────────────────────────────────────────────────────

/** 편집 전 브래킷: 5각 프로파일(코너 노치), z∈[0,8]. */
const pentaBracket: ExtrudeFeature = {
  kind: 'extrude', mode: 'add', direction: 'one_sided', depth: 8,
  loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 24, y: 5 }, { x: 20, y: 10 }, { x: 0, y: 10 }],
};
/** 편집 후: 4각 프로파일(노치 제거) — e.vert.4가 사라진다. */
const rectBracket: ExtrudeFeature = {
  kind: 'extrude', mode: 'add', direction: 'one_sided', depth: 8,
  loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }],
};

function anchorsOf(feature: ExtrudeFeature): EdgeAnchorSource {
  const topo = buildExtrudeTopo(feature);
  return fromAnchors(new Map(namesOf(topo, 'edge').map((n) => [n, edgeMidpoint(topo, n)!])));
}

const frontVp: Viewport = {
  id: 'front', sourceId: 'bracket',
  projection: { kind: 'standard', view: 'front' },
  centerOnSheet: { x: 150, y: 150 }, widthOnSheet: 100, scale: 1, label: 'FRONT',
};
const topVp: Viewport = {
  id: 'top', sourceId: 'bracket',
  projection: { kind: 'standard', view: 'top' },
  centerOnSheet: { x: 300, y: 150 }, widthOnSheet: 100, scale: 1, label: 'TOP',
};

// ─── 게이트 실증 ─────────────────────────────────────────────────────────

describe('G3 gate — assembly design loop (R1+R2+R3+R5, executed)', () => {
  it('1+2. programmatic assembly converges and a gear drive applies the REAL ratio', () => {
    // Point-coincident: bracket origin snaps to the base's declared anchor —
    // pure translation, hand-computed (10, -2, 7) (dogfood 06 semantics).
    const solved = solveMates(
      [
        {
          partId: 'base',
          fixed: true,
          refs: { anchor: { kind: 'point', origin: { x: 10, y: -2, z: 7 } } },
        },
        { partId: 'bracket', position: { x: 1, y: 1, z: 1 } },
      ],
      [
        {
          kind: 'coincident',
          a: { partId: 'bracket', refId: 'origin' },
          b: { partId: 'base', refId: 'anchor' },
        },
      ],
      { tolerance: 1e-9 },
    );
    expect(solved.converged).toBe(true);
    expect(solved.finalMaxResidual).toBeLessThan(1e-9);
    const b = solved.part('bracket');
    expect(b.position.x).toBeCloseTo(10, 6);
    expect(b.position.y).toBeCloseTo(-2, 6);
    expect(b.position.z).toBeCloseTo(7, 6);

    // Gear drive — ratio 2 must actually halve and invert the angle (W5-F2,
    // dogfood 07 pattern: fixed frame with two shafts + hinges + gear mate).
    const geared = solveMates(
      [
        {
          partId: 'frame',
          fixed: true,
          refs: {
            shaft_a: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
            shaft_b: { kind: 'axis', origin: { x: 30, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
          },
        },
        { partId: 'gear_a', position: { x: 1, y: 2, z: 3 } },
        { partId: 'gear_b', position: { x: 28, y: 1, z: -2 } },
      ],
      [
        { id: 'h_a', kind: 'hinge', a: { partId: 'gear_a', refId: 'z_axis' }, b: { partId: 'frame', refId: 'shaft_a' } },
        { id: 'h_b', kind: 'hinge', a: { partId: 'gear_b', refId: 'z_axis' }, b: { partId: 'frame', refId: 'shaft_b' } },
        {
          id: 'g', kind: 'gear', ratio: 2,
          a: { partId: 'gear_a', refId: 'z_axis' }, b: { partId: 'gear_b', refId: 'z_axis' },
        },
      ],
      { tolerance: 1e-9, drives: [{ mateId: 'g', angleDeg: 90 }] },
    );
    expect(geared.converged).toBe(true);
    expect(geared.driveEffects).toHaveLength(2);
    // +90° on the driven pinion, −45° coupled onto the wheel via mate 'g'.
    expect(geared.driveEffects[0]!.amount).toBeCloseTo(90, 9);
    expect(geared.driveEffects[1]!.amount).toBeCloseTo(-45, 9);
    expect(geared.driveEffects[1]!.viaMateId).toBe('g');
  });

  it('3+4. profile edit surfaces the lost ref EXPLICITLY, and relink restores resolution', () => {
    const before = anchorsOf(pentaBracket);
    const after = anchorsOf(rectBracket);

    const dims: NamedRefInput[] = [
      { id: 'd-notch', label: 'notch edge', refs: ['e.vert.4'] },
      { id: 'd-width', label: 'width', refs: ['e.vert.0', 'e.vert.1'] }, // both survive
    ];
    const lost = collectLostRefs({ dimensions: dims, anchors: after, priorAnchors: before });
    expect(lost).toHaveLength(1);
    expect(lost[0]!.name).toBe('e.vert.4');
    expect(lost[0]!.reason).toBe('unknown');
    // Old anchor recovered for ranking: penta e.vert.4 midpoint was (0,10,4).
    expect(lost[0]!.anchor?.position).toEqual([0, 10, 4]);

    const suggestion = suggestRelinkCandidates(lost[0]!, { anchors: after }, { scale: 20 });
    expect(suggestion.candidates.length).toBeGreaterThan(0);
    // 정직성: named 채널은 midpoint 순위 전용 — 절대 confident가 아니다.
    expect(suggestion.hasConfidentCandidate).toBe(false);
    expect(suggestion.note).toBe('midpoint-only-ranking');
    // Nearest current edge to (0,10,4) is the rect's e.vert.3 at (0,10,4).
    const top = suggestion.candidates[0]!;
    expect(top.target).toEqual({ kind: 'name', name: 'e.vert.3' });

    const applied = applyRelink(
      { type: 'dimension', id: 'd-notch', refs: dims[0]!.refs },
      lost[0]!,
      top.target,
    );
    if (applied.consumer.type === 'feature') throw new Error('expected a named consumer');
    expect(applied.consumer.refs).toEqual(['e.vert.3']);
    expect(applied.record.from).toBe('e.vert.4');
    expect(applied.record.to).toBe('e.vert.3');
    expect(applied.record.confident).toBe(false);
    // 재지정된 참조는 새 토폴로지에서 전부 해석된다.
    for (const name of applied.consumer.refs) {
      expect(after.anchor(name), name).not.toBeNull();
    }
  });

  it('5. dimensions re-measure on the EDITED part — including the relinked ref', () => {
    const topo = buildExtrudeTopo(rectBracket);
    const topologies = new Map([['bracket', topo]]);
    const vps = [frontVp, topVp];

    // 두께(불변 refs): front 뷰에서 캡 사이 8mm.
    const thick: Dimension = {
      id: 'd-thick', viewportId: 'front', kind: 'linear',
      refs: ['f.cap.bottom', 'f.cap.top'],
    };
    const rThick = measureSheetDimension(thick, vps, topologies);
    expect(rThick && rThick.ok && rThick.value).toBe(8);

    // 재지정된 참조 쌍: e.vert.0(0,0) ↔ e.vert.3(0,10) — top 뷰 y-스팬 10mm.
    const relinked: Dimension = {
      id: 'd-notch', viewportId: 'top', kind: 'linear',
      refs: ['e.vert.0', 'e.vert.3'],
    };
    const rRelinked = measureSheetDimension(relinked, vps, topologies);
    if (!rRelinked || !rRelinked.ok) {
      throw new Error(`relinked dimension failed: ${rRelinked ? rRelinked.reason : 'null'}`);
    }
    expect(rRelinked.value).toBeCloseTo(10, 6);
  });

  it('6. the assembly still converges after the part edit (assembly refs untouched)', () => {
    const solved = solveMates(
      [
        { partId: 'base', fixed: true },
        { partId: 'bracket', position: { x: 0, y: 25, z: 3 } },
      ],
      [
        {
          kind: 'coincident',
          a: { partId: 'bracket', refId: 'xy_plane' },
          b: { partId: 'base', refId: 'xy_plane' },
        },
      ],
      { tolerance: 1e-9 },
    );
    expect(solved.converged).toBe(true);
    expect(solved.part('bracket').position.z).toBeCloseTo(0, 6);
  });
});
