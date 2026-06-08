/**
 * downgradeNotice — surface OCCT→mesh downgrades (commercial-trust gate #3).
 * Verifies the classify truth-table and the userData stamp/collect side-channel.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  classifyMeshDowngrade,
  stampDowngrade,
  collectDowngrades,
  hasBlockingDowngrade,
} from './downgradeNotice';

describe('classifyMeshDowngrade — truth table', () => {
  it('no downgrade when the user explicitly chose mesh (!wantedOcct)', () => {
    expect(
      classifyMeshDowngrade({ op: 'Fillet', wantedOcct: false, occtRan: false, isNoOp: true }),
    ).toBeNull();
    expect(
      classifyMeshDowngrade({ op: 'Fillet', wantedOcct: false, occtRan: false, isNoOp: false }),
    ).toBeNull();
  });

  it('no downgrade when OCCT genuinely ran (delivered B-rep)', () => {
    expect(
      classifyMeshDowngrade({ op: 'Chamfer', wantedOcct: true, occtRan: true }),
    ).toBeNull();
  });

  it('B-rep wanted but mesh produced nothing (no-op) → blocked (hard)', () => {
    const n = classifyMeshDowngrade({ op: 'Fillet', wantedOcct: true, occtRan: false, isNoOp: true });
    expect(n).not.toBeNull();
    expect(n!.severity).toBe('blocked');
    expect(n!.i18nKey).toBe('downgrade.blocked');
    expect(n!.op).toBe('Fillet');
  });

  it('B-rep wanted, mesh DID round but only approximately → approximated (soft)', () => {
    const n = classifyMeshDowngrade({
      op: 'Chamfer', featureId: 'f7', wantedOcct: true, occtRan: false, isNoOp: false,
    });
    expect(n).not.toBeNull();
    expect(n!.severity).toBe('approximated');
    expect(n!.i18nKey).toBe('downgrade.approximated');
    expect(n!.featureId).toBe('f7');
    // soft notice must never read as a hard failure
    expect(n!.fallbackMessage.toLowerCase()).toContain('approximation');
  });

  it('isNoOp defaults to false (approximated) when omitted', () => {
    const n = classifyMeshDowngrade({ op: 'Fillet', wantedOcct: true, occtRan: false });
    expect(n!.severity).toBe('approximated');
  });
});

describe('stamp / collect via userData side-channel', () => {
  it('a fresh geometry has no downgrades', () => {
    const g = new THREE.BufferGeometry();
    expect(collectDowngrades(g)).toEqual([]);
    expect(hasBlockingDowngrade(g)).toBe(false);
  });

  it('stampDowngrade(null) is a no-op (call-site convenience)', () => {
    const g = new THREE.BufferGeometry();
    stampDowngrade(g, null);
    expect(collectDowngrades(g)).toEqual([]);
  });

  it('accumulates multiple notices in order', () => {
    const g = new THREE.BufferGeometry();
    stampDowngrade(g, classifyMeshDowngrade({ op: 'Fillet', wantedOcct: true, occtRan: false }));
    stampDowngrade(g, classifyMeshDowngrade({ op: 'Draft', wantedOcct: true, occtRan: false, isNoOp: true }));
    const list = collectDowngrades(g);
    expect(list.map((n) => n.op)).toEqual(['Fillet', 'Draft']);
    expect(list.map((n) => n.severity)).toEqual(['approximated', 'blocked']);
  });

  it('hasBlockingDowngrade is true only when a blocked notice is present', () => {
    const soft = new THREE.BufferGeometry();
    stampDowngrade(soft, classifyMeshDowngrade({ op: 'Fillet', wantedOcct: true, occtRan: false }));
    expect(hasBlockingDowngrade(soft)).toBe(false);

    const hard = new THREE.BufferGeometry();
    stampDowngrade(hard, classifyMeshDowngrade({ op: 'Fillet', wantedOcct: true, occtRan: false, isNoOp: true }));
    expect(hasBlockingDowngrade(hard)).toBe(true);
  });
});
