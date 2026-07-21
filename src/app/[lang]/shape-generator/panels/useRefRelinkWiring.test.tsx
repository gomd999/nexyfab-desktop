// @vitest-environment jsdom
/**
 * useRefRelinkWiring — G3 배선 계층 테스트.
 *
 * 전체 페이지(ShapeGeneratorInner) mount 없이, 훅 + RefRelinkPanel 만 얹은
 * 하네스로 실제 배선 경로를 그대로 굴린다:
 *   리빌드 geometry(userData.meshDowngrades = reference.lost 통지,
 *   userData.topoEdgeSignatures = 현재 솔리드 엣지 서명)
 *   → collectLostRefs → suggestRelinkCandidates → 패널 표시
 *   → 후보 클릭 → applyRelink → onApplyFeatureSelections(featureId, 새 selections)
 * onApplyFeatureSelections 는 페이지에서 useFeatureStack.updateNode 로 이어져
 * features 메모 변경 → 파이프라인 effect 재실행(재빌드)을 트리거한다.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import * as THREE from 'three';
import RefRelinkPanel from './RefRelinkPanel';
import { useRefRelinkWiring, type RelinkableFeatureLike } from './useRefRelinkWiring';
import { makeReferenceLostNotice } from '../features/topologyEdgeFinder';
import type { EdgeSig } from '../features/edgeCorrespondence';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';

// 20×10×8 박스의 수직 엣지 4개 (refRelink.test.ts 와 같은 코퍼스).
const vert = (x: number, y: number): EdgeSig & { id: string } => ({
  id: `e.vert.${x}.${y}`, mid: [x, y, 4], dir: [0, 0, 1], length: 8,
});
const BOX_VERTS = [vert(0, 0), vert(20, 0), vert(20, 10), vert(0, 10)];

function makeGeometry(opts: { lost?: boolean; sigs?: boolean } = {}): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  // 스코어러 scale 용 bbox 를 실측으로 만들 최소 정점 (20×10×8 박스 대각).
  geo.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([0, 0, 0, 20, 10, 8, 0, 10, 8]), 3));
  if (opts.lost !== false) {
    geo.userData.meshDowngrades = [makeReferenceLostNotice('Fillet', 'ambiguous', 'feat-1')];
  }
  if (opts.sigs !== false) {
    geo.userData.topoEdgeSignatures = BOX_VERTS;
  }
  return geo;
}

const FEATURES: RelinkableFeatureLike[] = [{
  id: 'feat-1',
  type: 'fillet',
  edgeSelections: [{
    type: 'edge',
    position: [19, 0.5, 4],   // vert(20,0) 근접 — 게이트 통과 시나리오
    direction: [0, 0, 1],
    length: 8,
    normal: [0, -1, 0],
  } satisfies EdgeSelectionInfo],
}];

function Harness(props: {
  geometry: THREE.BufferGeometry | null;
  features: RelinkableFeatureLike[];
  onApply: (featureId: string, sels: EdgeSelectionInfo[]) => void;
  onRefused?: (reason: string) => void;
}) {
  const r = useRefRelinkWiring({
    geometry: props.geometry,
    features: props.features,
    onApplyFeatureSelections: props.onApply,
    onRefused: props.onRefused,
  });
  return r.items.length > 0
    ? <RefRelinkPanel lang="en" items={r.items} onApply={r.apply} onClose={r.dismiss} history={r.history} />
    : <div data-testid="no-panel" />;
}

describe('useRefRelinkWiring (G3)', () => {
  it('no reference.lost notice → no panel', () => {
    const { queryByTestId, getByTestId } = render(
      <Harness geometry={makeGeometry({ lost: false })} features={FEATURES} onApply={vi.fn()} />,
    );
    expect(getByTestId('no-panel')).toBeTruthy();
    expect(queryByTestId('refrelink-panel')).toBeNull();
  });

  it('rebuild loss → panel shows 1 item with the loss reason', () => {
    const { getByTestId } = render(
      <Harness geometry={makeGeometry()} features={FEATURES} onApply={vi.fn()} />,
    );
    expect(getByTestId('refrelink-panel').textContent).toContain('Lost references (1)');
    expect(getByTestId('refrelink-item-0').textContent).toContain('fillet');
    expect(getByTestId('refrelink-0-reason').textContent)
      .toContain('several current edges match equally well');
  });

  it('candidate click → applyRelink runs and the feature-update callback gets the relinked selection', () => {
    const onApply = vi.fn();
    const { getByTestId } = render(
      <Harness geometry={makeGeometry()} features={FEATURES} onApply={onApply} />,
    );
    fireEvent.click(getByTestId('refrelink-0-candidate-0'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [featureId, sels] = onApply.mock.calls[0]! as [string, EdgeSelectionInfo[]];
    expect(featureId).toBe('feat-1');
    expect(sels).toHaveLength(1);
    // 최상위 후보 = vert(20,0): 재지정된 selection 은 그 엣지의 실측 mid/dir 을 갖는다.
    expect(sels[0]!.position).toEqual([20, 0, 4]);
    expect(sels[0]!.direction).toEqual([0, 0, 1]);
    // applyRelink 가 현재 bbox 를 스탬프해 다음 리빌드가 현재 형상 기준으로 재매핑.
    expect(sels[0]!.bbox).toEqual({ min: [0, 0, 0], max: [20, 10, 8] });
  });

  it('no topoEdgeSignatures (non-OCCT rebuild) → item shown honestly with no candidates', () => {
    const { getByTestId } = render(
      <Harness geometry={makeGeometry({ sigs: false })} features={FEATURES} onApply={vi.fn()} />,
    );
    expect(getByTestId('refrelink-panel')).toBeTruthy();
    expect(getByTestId('refrelink-0-empty')).toBeTruthy(); // 'No candidates …' — 날조 없음
  });

  it('dismiss hides the current loss set (panel unmounts)', () => {
    const { getByTestId, queryByTestId } = render(
      <Harness geometry={makeGeometry()} features={FEATURES} onApply={vi.fn()} />,
    );
    fireEvent.click(getByTestId('refrelink-close'));
    expect(queryByTestId('refrelink-panel')).toBeNull();
    expect(getByTestId('no-panel')).toBeTruthy();
  });
});
