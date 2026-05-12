'use client';

import { useMemo } from 'react';
import FeatureTree, { type PeerSelectionMarker } from '../FeatureTree';
import type { FeatureHistory } from '../useFeatureStack';
import type { FeatureType } from '../features/types';
import type { PresenceState } from './yjsDoc';

/**
 * FeatureTree wrapper that derives `peerSelectionsById` from the awareness
 * presence map automatically. Drop-in replacement for FeatureTree itself —
 * mount this from LeftPanel (or wherever you want to surface the design tree)
 * and the colored peer dots appear without further wiring.
 *
 * The local user is excluded from markers — they don't need to see their
 * own selection mirrored back.
 */

interface Props {
  history: FeatureHistory;
  presences: Map<number, PresenceState>;
  localClientId: number;
  onRollbackTo: (id: string) => void;
  onStartEditing: (id: string) => void;
  onFinishEditing: () => void;
  onToggleExpanded: (id: string) => void;
  onToggleEnabled: (id: string) => void;
  onRemoveNode: (id: string) => void;
  onUpdateParam: (id: string, key: string, value: number) => void;
  onAddFeature: (type: FeatureType) => void;
  onEditSketch?: (featureId: string) => void;
  onMoveFeature?: (fromId: string, toId: string) => void;
  onSelectFeature?: (id: string) => void;
  onEnsureExpanded?: (nodeIds: string[]) => void;
  t: Record<string, string>;
}

function fallbackColor(clientId: number): string {
  const hue = (clientId * 137) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export default function FeatureTreeWithPresence(props: Props) {
  const { presences, localClientId, ...rest } = props;

  const peerSelectionsById = useMemo<Record<string, PeerSelectionMarker[]>>(() => {
    const out: Record<string, PeerSelectionMarker[]> = {};
    presences.forEach((s, clientId) => {
      if (clientId === localClientId) return;
      // editingNodeId takes precedence over selectedFeatureId for the marker —
      // the row should highlight wherever the peer is most actively focused.
      const nodeId = s.editingNodeId ?? s.selectedFeatureId;
      if (!nodeId) return;
      const marker: PeerSelectionMarker = {
        name: s.name ?? `User ${clientId}`,
        color: s.color ?? fallbackColor(clientId),
        editing: Boolean(s.editingNodeId),
      };
      (out[nodeId] = out[nodeId] ?? []).push(marker);
    });
    return out;
  }, [presences, localClientId]);

  return <FeatureTree {...rest} peerSelectionsById={peerSelectionsById} />;
}
