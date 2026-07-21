'use client';

/**
 * useRefRelinkWiring — G3 해소: RefRelinkPanel 페이지 배선 계층.
 *
 * ShapeGeneratorInner 가 쥔 리빌드 결과 geometry 에서
 *   1. downgradeNotice.collectDowngrades → 'reference.lost' 통지 수집
 *   2. refRelink.collectLostRefs        → 상실 참조 인벤토리
 *   3. refRelink.suggestRelinkCandidates → 후보 랭킹 (userData.topoEdgeSignatures
 *      = 파이프라인이 워커 경계 너머로 실어 보낸 현재 솔리드의 EdgeSig 목록)
 * 을 조립해 RefRelinkPanel props(items)로 내놓고, 사용자가 후보를 클릭하면
 * refRelink.applyRelink 로 피처의 edgeSelections 를 (불변으로) 갱신한 뒤
 * 호스트 콜백(onApplyFeatureSelections → useFeatureStack.updateNode)에 넘긴다.
 * updateNode 가 nodeMap→features 메모를 바꾸므로 재빌드는 기존 파이프라인
 * effect([features] dep)가 자동으로 트리거한다 — 여기서 따로 굴리지 않는다.
 *
 * 정직 규칙:
 *  - 엔진(refRelink)은 소비만 한다 — 랭킹/게이트 수치는 그대로 전달.
 *  - topoEdgeSignatures 가 없으면(비-OCCT 리빌드 등) 후보는 'no-candidates'
 *    로 정직하게 비고, 패널은 재선택 CTA 를 보여준다.
 *  - applyRelink 의 거부(throw)는 onRefused 로 사유와 함께 표면화하고
 *    아무것도 적용하지 않는다.
 *  - named 채널(도면 치수/메이트)은 이 페이지가 EdgeAnchorSource 를 쥐고
 *    있지 않아 여기서는 배선하지 않는다(근사 아님 — 미배선 명시).
 *
 * 페이지 전체 mount 없이 jsdom 으로 단위 테스트 가능하도록 React 훅 한 장으로
 * 분리했다 (RefRelinkPanel 자체는 props-주입 프레젠테이션 그대로).
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { collectDowngrades } from '../features/downgradeNotice';
import {
  applyRelink,
  collectLostRefs,
  suggestRelinkCandidates,
  type LostRef,
  type RelinkRecord,
  type RelinkTarget,
} from '../features/refRelink';
import type { EdgeSig } from '../features/edgeCorrespondence';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';
import type { RefRelinkItem } from './RefRelinkPanel';

/** 훅이 피처에서 읽는 최소 형상 (useFeatureStack.features 의 부분집합). */
export interface RelinkableFeatureLike {
  id: string;
  type: string;
  edgeSelections?: readonly EdgeSelectionInfo[];
}

export interface UseRefRelinkWiringArgs {
  /** 리빌드 결과 geometry (effectiveResult?.geometry ?? null). */
  geometry: THREE.BufferGeometry | null;
  features: readonly RelinkableFeatureLike[];
  /** 적용 성공 시 호스트가 피처 노드를 갱신한다(updateNode → 재빌드 트리거). */
  onApplyFeatureSelections: (featureId: string, edgeSelections: EdgeSelectionInfo[]) => void;
  /** applyRelink 거부(사유 포함) 표면화 — 토스트 등. */
  onRefused?: (reason: string) => void;
}

export interface UseRefRelinkWiringResult {
  /** RefRelinkPanel items — 비면 패널은 렌더하지 않는다. */
  items: RefRelinkItem[];
  history: RelinkRecord[];
  apply: (lostRef: LostRef, target: RelinkTarget) => void;
  /** 현재 상실 집합을 닫는다 — 다음 리빌드에서 새 상실이 나오면 다시 뜬다. */
  dismiss: () => void;
}

type Bbox3 = { min: [number, number, number]; max: [number, number, number] };

/** geometry 바운딩박스 → {min,max} 튜플 (applyRelink currentBbox / scorer scale 용). */
function geometryBbox(geo: THREE.BufferGeometry): Bbox3 | undefined {
  if (!geo.boundingBox) {
    try { geo.computeBoundingBox(); } catch { return undefined; }
  }
  const bb = geo.boundingBox;
  if (!bb) return undefined;
  return {
    min: [bb.min.x, bb.min.y, bb.min.z],
    max: [bb.max.x, bb.max.y, bb.max.z],
  };
}

export function useRefRelinkWiring(args: UseRefRelinkWiringArgs): UseRefRelinkWiringResult {
  const { geometry, features, onApplyFeatureSelections, onRefused } = args;
  const [history, setHistory] = useState<RelinkRecord[]>([]);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // items 계산 시점의 컨텍스트를 apply 가 재사용 (stale-prop 클릭 방지용 ref).
  const applyCtxRef = useRef<{ bbox?: Bbox3 } | null>(null);

  const { items, lossKey } = useMemo((): { items: RefRelinkItem[]; lossKey: string | null } => {
    if (!geometry) return { items: [], lossKey: null };
    const notices = collectDowngrades(geometry);
    if (notices.length === 0) return { items: [], lossKey: null };
    const lost = collectLostRefs({
      notices,
      features: features.map(f => ({
        id: f.id,
        op: f.type,
        edgeSelections: f.edgeSelections,
      })),
    });
    if (lost.length === 0) return { items: [], lossKey: null };

    // 현재 솔리드의 엣지 서명 — 파이프라인이 userData 로 실어 보낸 값만 사용.
    // 없으면(메시 전용 리빌드) 랭킹 불가 → suggest 가 'no-candidates' 로 정직 보고.
    const edgeSigs =
      (geometry.userData?.topoEdgeSignatures as (EdgeSig & { id?: string })[] | undefined) ?? [];
    const bbox = geometryBbox(geometry);
    const scale = bbox
      ? Math.max(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2])
      : undefined;
    applyCtxRef.current = bbox ? { bbox } : {};

    const items: RefRelinkItem[] = lost.map(lostRef => ({
      lostRef,
      suggestion: suggestRelinkCandidates(
        lostRef,
        { edgeSigs },
        scale ? { scale } : {},
      ),
    }));
    return { items, lossKey: lost.map(l => `${l.id}|${l.reason}`).sort().join(';') };
  }, [geometry, features]);

  const apply = useCallback((lostRef: LostRef, target: RelinkTarget) => {
    if (lostRef.consumer.type !== 'feature') {
      // named 채널(치수/메이트)은 이 페이지에 소유 스토어가 없어 미배선 —
      // 조용히 삼키지 않고 명시적으로 거부한다.
      onRefused?.(`relink: ${lostRef.consumer.type} refs are not wired on this page yet`);
      return;
    }
    const feature = features.find(f => f.id === lostRef.consumer.id);
    if (!feature) {
      onRefused?.(`relink: feature ${lostRef.consumer.id} no longer exists`);
      return;
    }
    // 감사 기록용 confident 플래그: 클릭된 후보의 게이트 판정을 그대로 복원
    // (패널 onApply 는 target 만 넘기므로 items 에서 역참조). 못 찾으면 false —
    // 게이트 통과를 날조하지 않는다.
    const clickedCandidate = items
      .find(it => it.lostRef.id === lostRef.id)
      ?.suggestion.candidates.find(c =>
        c.target.kind === 'sig' && target.kind === 'sig'
          ? c.target.sigIndex === target.sigIndex
          : c.target.kind === 'name' && target.kind === 'name' && c.target.name === target.name,
      );
    try {
      const { consumer, record } = applyRelink(
        {
          type: 'feature',
          id: feature.id,
          op: feature.type,
          edgeSelections: feature.edgeSelections ?? [],
        },
        lostRef,
        target,
        {
          confident: clickedCandidate?.confident ?? false,
          ...(applyCtxRef.current?.bbox ? { currentBbox: applyCtxRef.current.bbox } : {}),
        },
      );
      if (consumer.type !== 'feature') return; // 타입상 도달 불가 (applyRelink 가 보존)
      setHistory(prev => [...prev, record]);
      // 호스트: updateNode(featureId, { edgeSelections }) → features 갱신 → 재빌드.
      onApplyFeatureSelections(feature.id, [...consumer.edgeSelections]);
    } catch (err) {
      onRefused?.(err instanceof Error ? err.message : String(err));
    }
  }, [features, items, onApplyFeatureSelections, onRefused]);

  const dismiss = useCallback(() => setDismissedKey(lossKey), [lossKey]);

  const visibleItems = dismissedKey !== null && dismissedKey === lossKey ? [] : items;
  return { items: visibleItems, history, apply, dismiss };
}
