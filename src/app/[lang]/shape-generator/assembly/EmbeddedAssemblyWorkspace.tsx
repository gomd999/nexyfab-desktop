'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { AssemblyBrowserLang } from './AssemblyBrowserModal';
import type { AssemblyMate } from './AssemblyMates';
import type { PlacedPart } from './PartPlacementPanel';
import { solveAssemblyFromBrowser } from './assemblySolveClient';
import {
  canonicalAssemblyToLegacy,
  legacyAssemblyToCanonical,
  type AssemblyBridgeIssue,
} from './canonicalAssemblyBridge';
import { loc } from '../lib/loc';
import { useLang } from '../hooks/useLang';

function AssemblyWorkspaceLoading() {
  const lang = useLang();
  return <div className="nx-assembly-loading" aria-busy="true">{loc(lang, { ko: '어셈블리 작업공간을 불러오는 중…', en: 'Loading assembly workspace…', ja: 'アセンブリワークスペースを読み込み中…', zh: '正在加载装配工作区…', es: 'Cargando el espacio de trabajo de ensamblaje…', ar: 'جارٍ تحميل مساحة عمل التجميع…' })}</div>;
}

const AssemblyBrowserModal = dynamic(() => import('./AssemblyBrowserModal'), {
  ssr: false,
  loading: () => <AssemblyWorkspaceLoading />,
});

export interface EmbeddedAssemblyWorkspaceProps {
  lang: AssemblyBrowserLang;
  placedParts: PlacedPart[];
  assemblyMates: AssemblyMate[];
  featureTrees: Record<string, FeatureTree>;
  featureTreeProvisionIssues?: ReadonlyArray<string>;
  onPlacedPartsChange: (parts: PlacedPart[]) => void;
  onAssemblyMatesChange: (mates: AssemblyMate[]) => void;
  onFeatureTreesChange: (trees: Record<string, FeatureTree>) => void;
  onClose: () => void;
}

export function EmbeddedAssemblyWorkspace({
  lang,
  placedParts,
  assemblyMates,
  featureTrees,
  featureTreeProvisionIssues = [],
  onPlacedPartsChange,
  onAssemblyMatesChange,
  onFeatureTreesChange,
  onClose,
}: EmbeddedAssemblyWorkspaceProps) {
  const seed = useMemo(
    () => legacyAssemblyToCanonical(placedParts, assemblyMates),
    // The modal owns its state after mount. Re-seeding on each CRDT echo would erase history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [bridgeIssues, setBridgeIssues] = useState<AssemblyBridgeIssue[]>(seed.issues);
  const placedPartsRef = useRef(placedParts);
  const assemblyMatesRef = useRef(assemblyMates);
  useEffect(() => { placedPartsRef.current = placedParts; }, [placedParts]);
  useEffect(() => { assemblyMatesRef.current = assemblyMates; }, [assemblyMates]);

  const publishState = useCallback((state: AssemblyState) => {
    const result = canonicalAssemblyToLegacy(state, placedPartsRef.current, assemblyMatesRef.current);
    onPlacedPartsChange(result.placedParts);
    onAssemblyMatesChange(result.assemblyMates);
    const unstableMateIds = new Set(state.mates
      .filter(mate => mate.a.refId.startsWith('legacy-') || mate.b.refId.startsWith('legacy-'))
      .map(mate => mate.id));
    setBridgeIssues(previous => [
      ...previous.filter(issue =>
        issue.code === 'UNSUPPORTED_LEGACY_MATE' ||
        ((issue.code === 'DERIVED_TOPOLOGY_REFERENCE' || issue.code === 'UNRESOLVED_DERIVED_REFERENCE') && unstableMateIds.has(issue.mateId)),
      ),
      ...result.issues,
    ]);
  }, [onAssemblyMatesChange, onPlacedPartsChange]);

  const blockingCount = bridgeIssues.filter(issue => issue.blocking).length;
  const solveBridgeBlockers = bridgeIssues
    .filter(issue => issue.blocking && issue.code !== 'DERIVED_TOPOLOGY_REFERENCE')
    .map(issue => `${issue.code}:${issue.mateId}`);
  const releaseBridgeBlockers = [
    ...bridgeIssues.filter(issue => issue.blocking).map(issue => `${issue.code}:${issue.mateId}`),
    ...featureTreeProvisionIssues.map(issue => `FEATURE_TREE:${issue}`),
  ];

  return (
    <div className="nx-embedded-assembly" data-testid="embedded-assembly-workspace">
      {blockingCount > 0 && (
        <div className="nx-assembly-bridge-gate" role="status" data-testid="assembly-bridge-gate">
          <strong>{loc(lang, { ko: '릴리스 검토 필요', en: 'Release review required', ja: 'リリース確認が必要', zh: '需要发布审核', es: 'Se requiere revisión de publicación', ar: 'تلزم مراجعة الإصدار' })}</strong>
          <span>
            {loc(lang, {
              ko: `파생/미지원 구속조건 ${blockingCount}건은 자동 PASS하지 않습니다.`,
              en: `${blockingCount} derived or unsupported constraints remain blocked; none are auto-passed.`,
              ja: `派生または未対応の拘束 ${blockingCount} 件はブロックされたままで、自動合格にはなりません。`,
              zh: `${blockingCount} 个派生或不支持的约束仍处于阻止状态，不会自动通过。`,
              es: `${blockingCount} restricciones derivadas o no compatibles siguen bloqueadas; ninguna se aprueba automáticamente.`,
              ar: `لا تزال ${blockingCount} قيود مشتقة أو غير مدعومة محظورة، ولا يتم اجتياز أي منها تلقائيًا.`,
            })}
          </span>
        </div>
      )}
      <AssemblyBrowserModal
        embedded
        lang={lang}
        initialState={seed.state}
        initialFeatureTrees={featureTrees}
        onStateChange={publishState}
        onFeatureTreesChange={onFeatureTreesChange}
        onClose={onClose}
        onSolve={solveAssemblyFromBrowser}
        exactSolveRequired
        externalSolveBlockers={solveBridgeBlockers}
        externalReleaseBlockers={releaseBridgeBlockers}
        default3DView
      />
    </div>
  );
}
