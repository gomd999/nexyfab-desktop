import { useState } from 'react';
import type { BodyEntry } from '../panels/BodyPanel';
import type { PlacedPart } from '../assembly/PartPlacementPanel';
import type { AssemblyMate } from '../assembly/AssemblyMates';
import type { InterferenceResult } from '../assembly/InterferenceDetection';

export const BODY_COLORS = [
  '#8b9cf4', '#f4a28b', '#8bf4b0', '#f4e08b',
  '#c48bf4', '#8bd8f4', '#f48bb0', '#b0f48b',
];

/**
 * 어셈블리 관련 state를 한 곳에서 관리합니다.
 * page.tsx의 bodies / activeBodyId / assemblyMates / interferenceResults 등을 통합합니다.
 */
export function useAssemblyState() {
  const [bodies, setBodies] = useState<BodyEntry[]>([]);
  const [activeBodyId, setActiveBodyId] = useState<string | null>(null);
  const [selectedBodyIds, setSelectedBodyIds] = useState<string[]>([]);
  const [showBodyPanel, setShowBodyPanel] = useState(false);
  const [placedParts, setPlacedParts] = useState<PlacedPart[]>([]);
  const [showPartPlacement, setShowPartPlacement] = useState(false);
  const [assemblyMates, setAssemblyMates] = useState<AssemblyMate[]>([]);
  const [interferenceResults, setInterferenceResults] = useState<InterferenceResult[]>([]);
  const [interferenceLoading, setInterferenceLoading] = useState(false);

  return {
    bodies, setBodies,
    activeBodyId, setActiveBodyId,
    selectedBodyIds, setSelectedBodyIds,
    showBodyPanel, setShowBodyPanel,
    placedParts, setPlacedParts,
    showPartPlacement, setShowPartPlacement,
    assemblyMates, setAssemblyMates,
    interferenceResults, setInterferenceResults,
    interferenceLoading, setInterferenceLoading,
  };
}
