/**
 * refRelink.test.ts — R5 engine tests.
 *
 * Part 1 pins the LOSS FLOW itself (how blocked/lost actually leaves a rebuild)
 * with measured numbers, so the engine's inputs can't silently drift. Parts
 * 2–4 test the engine: collection, candidate ranking (same scorer as the
 * gate), the no-confident-candidate case (no auto-relink), and apply.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  bestEdgeMatch,
  MIN_CONFIDENCE_SCORE,
  MIN_MARGIN,
  type EdgeSig,
} from './edgeCorrespondence';
import { makeReferenceLostNotice } from './topologyEdgeFinder';
import { stampDowngrade, collectDowngrades, hasBlockingDowngrade } from './downgradeNotice';
import { buildExtrudeTopo, edgeMidpoint, namesOf } from '@/lib/cad/topoNaming';
import { fromAnchors, composeBooleanTopo, type EdgeAnchorSource } from '@/lib/cad/composedTopo';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';
import {
  collectLostRefs,
  suggestRelinkCandidates,
  applyRelink,
  formatRelinkRecord,
  type LostRef,
  type RelinkableConsumer,
} from './refRelink';

// ─── shared fixtures ─────────────────────────────────────────────────────────

/** Vertical edge of a z∈[0,8] prism at (x, y). */
const vert = (x: number, y: number): EdgeSig => ({ mid: [x, y, 4], dir: [0, 0, 1], length: 8 });

/** Four vertical edges of a 20×10×8 box. */
const BOX_VERTS: EdgeSig[] = [vert(0, 0), vert(20, 0), vert(20, 10), vert(0, 10)];

const pentaTopo = () => buildExtrudeTopo({
  kind: 'extrude', mode: 'add', direction: 'one_sided', depth: 8,
  loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 24, y: 5 }, { x: 20, y: 10 }, { x: 0, y: 10 }],
});
const rectTopo = () => buildExtrudeTopo({
  kind: 'extrude', mode: 'add', direction: 'one_sided', depth: 8,
  loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }],
});

function anchorsOf(topo: ReturnType<typeof rectTopo>): EdgeAnchorSource {
  return fromAnchors(new Map(namesOf(topo, 'edge').map((n) => [n, edgeMidpoint(topo, n)!])));
}

// ─── Part 1: loss-flow reproduction (measured; guards the engine's inputs) ───

describe('loss flow (rebuild → explicit loss, measured)', () => {
  it('margin gate: symmetric midpoint → ambiguous with margin 0; near edge → matched with margin 0.211', () => {
    // Remapped click point equidistant from edges 0 and 1 → identical scores.
    const amb = bestEdgeMatch({ mid: [10, 0, 4], dir: [0, 0, 1], length: 8 }, BOX_VERTS, { scale: 20 });
    expect(amb.lost).toBe(true);
    expect(amb.reason).toBe('ambiguous');
    expect(amb.score).toBeCloseTo(0.75, 10);
    expect(amb.runnerUpScore).toBeCloseTo(0.75, 10);
    expect(amb.margin).toBeCloseTo(0, 10);
    expect(amb.margin).toBeLessThan(MIN_MARGIN); // 0 < 0.08

    // Point near edge 1 → clear winner above the gate.
    const clear = bestEdgeMatch({ mid: [19, 0.5, 4], dir: [0, 0, 1], length: 8 }, BOX_VERTS, { scale: 20 });
    expect(clear.lost).toBe(false);
    expect(clear.index).toBe(1);
    expect(clear.score).toBeCloseTo(0.9720491502812526, 10);
    expect(clear.margin).toBeCloseTo(0.21086131496303762, 10);
    expect(clear.margin).toBeGreaterThan(MIN_MARGIN);

    // Lone far candidate → negative score below the confidence floor.
    const low = bestEdgeMatch({ mid: [200, 0, 4], dir: [0, 0, 1], length: 8 }, [vert(0, 0)], { scale: 20 });
    expect(low.lost).toBe(true);
    expect(low.reason).toBe('low_confidence');
    expect(low.score).toBeCloseTo(-4, 10);
    expect(low.score).toBeLessThan(MIN_CONFIDENCE_SCORE);
  });

  it('a lost edge ref flows out as a blocked reference.lost notice on the geometry', () => {
    const geo = new THREE.BufferGeometry();
    stampDowngrade(geo, makeReferenceLostNotice('Fillet', 'ambiguous', 'feat-1'));
    const notices = collectDowngrades(geo);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      op: 'Fillet', featureId: 'feat-1', severity: 'blocked',
      i18nKey: 'reference.lost', detail: 'ambiguous',
    });
    expect(hasBlockingDowngrade(geo)).toBe(true);
  });

  it('named refs: 5→4 profile vertices loses e.vert.4 (anchor was (0,10,4)); legacy names diagnose distinctly', () => {
    const penta = pentaTopo();
    const rect = rectTopo();
    expect(namesOf(penta, 'edge')).toHaveLength(15); // 5+5 rings + 5 verticals
    expect(namesOf(rect, 'edge')).toHaveLength(12);
    expect(edgeMidpoint(penta, 'e.vert.4')).toEqual({ x: 0, y: 10, z: 4 });
    expect(edgeMidpoint(rect, 'e.vert.4')).toBeNull();

    const src = anchorsOf(rect);
    expect(src.anchor('e.vert.4')).toBeNull();
    expect(src.lossReason?.('e.vert.4')).toBe('unknown');
    expect(src.lossReason?.('a/e.vert.0')).toBe('legacy-role');

    // History-mode composed topo reports a stale positional seam as legacy-seam.
    const composed = composeBooleanTopo(
      [{ featureId: 'base', names: ['e.vert.0'], anchorOf: () => ({ x: 0, y: 0, z: 4 }) }],
      [{ x: 0, y: 0, z: 4 }, { x: 5, y: 5, z: 8 }],
      { opId: 'op1', seamKeys: [null, 'base/f.cap.top∩H0/f.side.2'] },
    );
    expect(composed.lossReason?.('op1/seam.3')).toBe('legacy-seam');
  });
});

// ─── Part 2: collectLostRefs ─────────────────────────────────────────────────

const SEL: EdgeSelectionInfo = {
  type: 'edge', position: [10, 0, 4], length: 8, normal: [0, -1, 0], direction: [0, 0, 1],
  bbox: { min: [0, 0, 0], max: [20, 10, 8] },
};

describe('collectLostRefs', () => {
  it('collects a blocked notice into an edge-selection LostRef with the stored anchor', () => {
    const geo = new THREE.BufferGeometry();
    stampDowngrade(geo, makeReferenceLostNotice('Fillet', 'ambiguous', 'feat-1'));
    const lost = collectLostRefs({
      notices: collectDowngrades(geo),
      features: [{ id: 'feat-1', op: 'Fillet', edgeSelections: [SEL] }],
    });
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({
      id: 'feature:feat-1#sel0',
      consumer: { type: 'feature', id: 'feat-1', label: 'Fillet' },
      kind: 'edge-selection',
      selectionIndex: 0,
      reason: 'ambiguous',
      anchor: { position: [10, 0, 4], direction: [0, 0, 1], length: 8 },
    });
  });

  it('a multi-selection feature loss is not attributed to one selection (no guessing)', () => {
    const geo = new THREE.BufferGeometry();
    stampDowngrade(geo, makeReferenceLostNotice('Fillet', 'low_confidence', 'feat-2'));
    const lost = collectLostRefs({
      notices: collectDowngrades(geo),
      features: [{ id: 'feat-2', op: 'Fillet', edgeSelections: [SEL, { ...SEL, position: [0, 0, 4] }] }],
    });
    expect(lost).toHaveLength(1);
    expect(lost[0]!.selectionIndex).toBeUndefined();
    expect(lost[0]!.anchor).toBeNull();
  });

  it('ignores non-reference notices (approximated/reduced are not losses)', () => {
    const lost = collectLostRefs({
      notices: [{
        op: 'Fillet', severity: 'approximated', i18nKey: 'downgrade.approximated', fallbackMessage: 'x',
      }],
    });
    expect(lost).toHaveLength(0);
  });

  it('collects named dimension losses with reason + prior anchor; resolvable refs stay out', () => {
    const rect = anchorsOf(rectTopo());
    const penta = anchorsOf(pentaTopo());
    const lost = collectLostRefs({
      dimensions: [
        { id: 'dim-1', label: 'width', refs: ['e.vert.4', 'e.vert.0'] }, // e.vert.0 still resolves
        { id: 'dim-2', label: 'legacy', refs: ['a/e.vert.0'] },
      ],
      anchors: rect,
      priorAnchors: penta,
    });
    expect(lost).toHaveLength(2);
    expect(lost[0]).toMatchObject({
      id: 'dimension:dim-1#e.vert.4',
      consumer: { type: 'dimension', id: 'dim-1', label: 'width' },
      kind: 'named', name: 'e.vert.4', reason: 'unknown',
      anchor: { position: [0, 10, 4] }, // recovered from the PRIOR topology
    });
    expect(lost[1]).toMatchObject({
      id: 'dimension:dim-2#a/e.vert.0', reason: 'legacy-role', anchor: null,
    });
  });

  it('mate name refs go through the same named channel', () => {
    const rect = anchorsOf(rectTopo());
    const lost = collectLostRefs({
      mates: [{ id: 'mate-1', refs: ['e.vert.9'] }],
      anchors: rect,
    });
    expect(lost).toHaveLength(1);
    expect(lost[0]!.consumer.type).toBe('mate');
    expect(lost[0]!.reason).toBe('unknown');
  });
});

// ─── Part 3: suggestRelinkCandidates ─────────────────────────────────────────

describe('suggestRelinkCandidates — edge-selection channel (gate scorer)', () => {
  const lostAt = (pos: [number, number, number]): LostRef => ({
    id: 'feature:f#sel0',
    consumer: { type: 'feature', id: 'f', label: 'Fillet' },
    kind: 'edge-selection', selectionIndex: 0, reason: 'ambiguous',
    anchor: { position: pos, direction: [0, 0, 1], length: 8 },
  });

  it('clear winner: top candidate is gate-confident with the measured score/margin', () => {
    const s = suggestRelinkCandidates(lostAt([19, 0.5, 4]), { edgeSigs: BOX_VERTS }, { scale: 20 });
    expect(s.note).toBe('gated-match');
    expect(s.hasConfidentCandidate).toBe(true);
    expect(s.candidates[0]!.target).toMatchObject({ kind: 'sig', sigIndex: 1 });
    expect(s.candidates[0]!.confident).toBe(true);
    expect(s.candidates[0]!.score).toBeCloseTo(0.9720491502812526, 10);
    expect(s.margin).toBeCloseTo(0.21086131496303762, 10);
    expect(s.gate).toEqual({ minScore: MIN_CONFIDENCE_SCORE, minMargin: MIN_MARGIN });
    // Ranked descending by the SAME scorer the gate used.
    const scores = s.candidates.map((c) => c.score!);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // Only the gate-accepted candidate is confident.
    expect(s.candidates.filter((c) => c.confident)).toHaveLength(1);
  });

  it('ambiguous: candidates listed WITH numbers but hasConfidentCandidate=false (no auto-relink)', () => {
    const s = suggestRelinkCandidates(lostAt([10, 0, 4]), { edgeSigs: BOX_VERTS }, { scale: 20 });
    expect(s.note).toBe('below-gate');
    expect(s.hasConfidentCandidate).toBe(false);
    expect(s.candidates.length).toBeGreaterThanOrEqual(2);
    // Top-2 tie at 0.75/0.75 → margin 0, below the 0.08 gate.
    expect(s.candidates[0]!.score).toBeCloseTo(0.75, 10);
    expect(s.candidates[1]!.score).toBeCloseTo(0.75, 10);
    expect(s.margin).toBeCloseTo(0, 10);
    expect(s.margin!).toBeLessThan(MIN_MARGIN);
    // The engine never promotes any of them.
    expect(s.candidates.every((c) => !c.confident)).toBe(true);
  });

  it('no parallel candidate → explicit empty result, nothing fabricated', () => {
    const horizontals: EdgeSig[] = [
      { mid: [10, 0, 0], dir: [1, 0, 0], length: 20 },
      { mid: [10, 10, 0], dir: [1, 0, 0], length: 20 },
    ];
    const s = suggestRelinkCandidates(lostAt([10, 0, 4]), { edgeSigs: horizontals }, { scale: 20 });
    expect(s.note).toBe('no-parallel-candidate');
    expect(s.candidates).toHaveLength(0);
    expect(s.hasConfidentCandidate).toBe(false);
  });

  it('no stored direction → distance-only ranking, never confident (근사 명시)', () => {
    const noDir: LostRef = {
      ...lostAt([19, 0.5, 4]),
      anchor: { position: [19, 0.5, 4] },
    };
    const s = suggestRelinkCandidates(noDir, { edgeSigs: BOX_VERTS }, { scale: 20 });
    expect(s.note).toBe('midpoint-only-ranking');
    expect(s.hasConfidentCandidate).toBe(false);
    expect(s.candidates[0]!.target).toMatchObject({ kind: 'sig', sigIndex: 1 });
    expect(s.candidates[0]!.score).toBeNull();
    expect(s.candidates[0]!.distance).toBeCloseTo(Math.hypot(1, 0.5, 0), 10); // ≈1.118mm
  });
});

describe('suggestRelinkCandidates — named channel', () => {
  const lostName: LostRef = {
    id: 'dimension:dim-1#e.vert.4',
    consumer: { type: 'dimension', id: 'dim-1', label: 'width' },
    kind: 'named', name: 'e.vert.4', reason: 'unknown',
    anchor: { position: [0, 10, 4] },
  };

  it('ranks by distance with numbers; nearest is e.vert.3 at 0mm; never confident', () => {
    const s = suggestRelinkCandidates(lostName, { anchors: anchorsOf(rectTopo()) });
    expect(s.note).toBe('midpoint-only-ranking');
    expect(s.hasConfidentCandidate).toBe(false);
    expect(s.candidates[0]!.target).toEqual({ kind: 'name', name: 'e.vert.3' });
    expect(s.candidates[0]!.distance).toBeCloseTo(0, 10); // rect e.vert.3 mid = (0,10,4)
    expect(s.candidates[0]!.confident).toBe(false);
    expect(s.candidates[0]!.score).toBeNull(); // no gate-comparable score — none invented
    // Ranked ascending by distance.
    const d = s.candidates.map((c) => c.distance!);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    // Runner-up: e.top.0-3 mid = (0,5,8) → √(0+25+16) ≈ 6.403mm.
    expect(s.candidates[1]!.distance).toBeCloseTo(Math.hypot(0, 5, 4), 10);
  });

  it('no prior anchor → unranked alphabetical list, explicit note', () => {
    const s = suggestRelinkCandidates(
      { ...lostName, reason: 'legacy-role', name: 'a/e.vert.0', anchor: null },
      { anchors: anchorsOf(rectTopo()) },
    );
    expect(s.note).toBe('no-prior-anchor');
    expect(s.hasConfidentCandidate).toBe(false);
    expect(s.candidates.every((c) => c.score === null && c.distance === null)).toBe(true);
  });

  it('empty topology → no-candidates', () => {
    const s = suggestRelinkCandidates(lostName, { anchors: fromAnchors(new Map()) });
    expect(s.note).toBe('no-candidates');
    expect(s.candidates).toHaveLength(0);
  });
});

// ─── Part 4: applyRelink — substitution + audit + post-apply resolution ──────

describe('applyRelink', () => {
  it('named: relinks e.vert.4 → e.vert.3 and the ref then RESOLVES on the current topology', () => {
    const rect = anchorsOf(rectTopo());
    const dim: RelinkableConsumer = { type: 'dimension', id: 'dim-1', refs: ['e.vert.4', 'e.top.0-1'] };
    const lost = collectLostRefs({
      dimensions: [{ id: 'dim-1', label: 'width', refs: dim.type === 'dimension' ? dim.refs : [] }],
      anchors: rect, priorAnchors: anchorsOf(pentaTopo()),
    })[0]!;
    const s = suggestRelinkCandidates(lost, { anchors: rect });
    const { consumer, record } = applyRelink(dim, lost, s.candidates[0]!.target, { at: 1234 });

    expect((consumer as { refs: readonly string[] }).refs).toEqual(['e.vert.3', 'e.top.0-1']);
    // Post-apply: every ref of the consumer resolves — the loss is repaired.
    for (const r of (consumer as { refs: readonly string[] }).refs) {
      expect(rect.anchor(r)).not.toBeNull();
    }
    expect(rect.anchor('e.vert.3')).toEqual({ x: 0, y: 10, z: 4 }); // numeric resolution
    expect(record).toEqual({
      at: 1234, consumerType: 'dimension', consumerId: 'dim-1',
      lostRefId: 'dimension:dim-1#e.vert.4', reason: 'unknown',
      from: 'e.vert.4', to: 'e.vert.3', confident: false,
    });
    expect(formatRelinkRecord(record)).toContain('e.vert.4 → e.vert.3');
    // Immutability: the input consumer is untouched.
    expect(dim.refs).toEqual(['e.vert.4', 'e.top.0-1']);
  });

  it('edge-selection: replaces the stored selection with the chosen sig and the new selection then gate-resolves', () => {
    const feat: RelinkableConsumer = { type: 'feature', id: 'feat-1', op: 'Fillet', edgeSelections: [SEL] };
    const lost: LostRef = {
      id: 'feature:feat-1#sel0',
      consumer: { type: 'feature', id: 'feat-1', label: 'Fillet' },
      kind: 'edge-selection', selectionIndex: 0, reason: 'ambiguous',
      anchor: { position: SEL.position, direction: SEL.direction!, length: SEL.length },
    };
    const chosen = BOX_VERTS[1]!; // user confirms edge at (20,0)
    const bbox = { min: [0, 0, 0] as [number, number, number], max: [20, 10, 8] as [number, number, number] };
    const { consumer, record } = applyRelink(feat, lost, { kind: 'sig', sigIndex: 1, sig: chosen }, {
      at: 99, confident: false, currentBbox: bbox,
    });
    const sels = (consumer as { edgeSelections: readonly EdgeSelectionInfo[] }).edgeSelections;
    expect(sels[0]).toMatchObject({
      type: 'edge', position: [20, 0, 4], direction: [0, 0, 1], length: 8,
      normal: SEL.normal, // approximation kept explicit: EdgeSig has no face normal
      bbox,               // anchored to CURRENT geometry, not the stale pre-loss bbox
    });
    expect(record.from).toBe('@(10,0,4)');
    expect(record.to).toBe('@(20,0,4)');

    // Post-apply resolution: the relinked selection now matches its edge through
    // the SAME gate that refused before — score 1.0, unopposed margin.
    const re = bestEdgeMatch(
      { mid: sels[0]!.position, dir: sels[0]!.direction!, length: sels[0]!.length },
      [chosen], { scale: 20 },
    );
    expect(re.lost).toBe(false);
    expect(re.index).toBe(0);
    expect(re.score).toBeCloseTo(1.0, 10);
  });

  it('K7-S4: fresh topoName is stamped, a stale one never survives the relink', () => {
    const staleSel: EdgeSelectionInfo = { ...SEL, topoName: 'e.vert.99' };
    const feat: RelinkableConsumer = { type: 'feature', id: 'feat-1', op: 'Fillet', edgeSelections: [staleSel] };
    const lost: LostRef = {
      id: 'feature:feat-1#sel0',
      consumer: { type: 'feature', id: 'feat-1', label: 'Fillet' },
      kind: 'edge-selection', selectionIndex: 0, reason: 'name_gone',
      anchor: { position: SEL.position, direction: SEL.direction!, length: SEL.length },
    };
    const chosen = BOX_VERTS[1]!;
    // 호출측이 현재 이름표에서 해석한 새 이름을 넘기면 병기 저장
    const withName = applyRelink(feat, lost, { kind: 'sig', sigIndex: 1, sig: chosen }, {
      at: 99, topoName: 'e.vert.1',
    });
    const sels1 = (withName.consumer as { edgeSelections: readonly EdgeSelectionInfo[] }).edgeSelections;
    expect(sels1[0]!.topoName).toBe('e.vert.1');
    // 이름 해석이 없으면 낡은 이름이 절대 승계되지 않는다(무이름이 정직)
    const withoutName = applyRelink(feat, lost, { kind: 'sig', sigIndex: 1, sig: chosen }, { at: 99 });
    const sels2 = (withoutName.consumer as { edgeSelections: readonly EdgeSelectionInfo[] }).edgeSelections;
    expect(sels2[0]!.topoName).toBeUndefined();
  });

  it('refuses mismatches instead of silently applying', () => {
    const feat: RelinkableConsumer = { type: 'feature', id: 'feat-1', edgeSelections: [SEL] };
    const dim: RelinkableConsumer = { type: 'dimension', id: 'dim-1', refs: ['e.vert.0'] };
    const featLost: LostRef = {
      id: 'feature:feat-1#sel0', consumer: { type: 'feature', id: 'feat-1', label: 'Fillet' },
      kind: 'edge-selection', selectionIndex: 0, reason: 'ambiguous', anchor: null,
    };
    const namedLost: LostRef = {
      id: 'dimension:dim-1#e.vert.9', consumer: { type: 'dimension', id: 'dim-1', label: 'd' },
      kind: 'named', name: 'e.vert.9', reason: 'unknown', anchor: null,
    };
    // Wrong consumer for the lost ref.
    expect(() => applyRelink(dim, featLost, { kind: 'name', name: 'x' })).toThrow(/does not own/);
    // Feature consumer needs a sig target.
    expect(() => applyRelink(feat, featLost, { kind: 'name', name: 'e.vert.0' })).toThrow(/edge-signature target/);
    // Name not among the consumer's refs.
    expect(() => applyRelink(dim, namedLost, { kind: 'name', name: 'e.vert.1' })).toThrow(/has no ref/);
    // Unattributable multi-selection loss.
    const multiLost: LostRef = { ...featLost, selectionIndex: undefined };
    expect(() => applyRelink(feat, multiLost, { kind: 'sig', sigIndex: 0, sig: BOX_VERTS[0]! }))
      .toThrow(/not attributable/);
  });
});
