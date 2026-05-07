import { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { BodyEntry } from '../panels/BodyPanel';
import type { PlacedPart } from '../assembly/PartPlacementPanel';
import type { AssemblyMate } from '../assembly/AssemblyMates';
import type { InterferenceResult } from '../assembly/InterferenceDetection';

export const BODY_COLORS = [
  '#8b9cf4', '#f4a28b', '#8bf4b0', '#f4e08b',
  '#c48bf4', '#8bd8f4', '#f48bb0', '#b0f48b',
];

// ─── Yjs Collaboration Setup ────────────────────────────────────────────────

// Global singleton so the document persists across HMR and component unmounts.
const doc = new Y.Doc();
let provider: WebsocketProvider | null = null;

function initYjs() {
  if (typeof window !== 'undefined' && !provider) {
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room') || 'nexyfab-collab-default';
    
    // Using y-websocket public server for demonstration
    // In production, you would run your own y-websocket or PartyKit server.
    provider = new WebsocketProvider('wss://demos.yjs.dev/ws', room, doc);
    
    provider.on('status', (event: { status: string }) => {
      console.log(`[Yjs] Connection status: ${event.status} (Room: ${room})`);
    });
  }
}

/**
 * A custom hook that synchronizes a React array state with a Yjs Map.
 * Using a Map keyed by `id` ensures that concurrent edits to different items
 * (e.g. User A moves part 1, User B changes color of part 2) merge cleanly
 * without wiping each other out like a basic array replacement would.
 */
function useYjsMapAsArray<T extends { id: string }>(key: string): [T[], (action: T[] | ((prev: T[]) => T[])) => void] {
  const [items, setItems] = useState<T[]>([]);

  useEffect(() => {
    initYjs();
    const yMap = doc.getMap<T>(key);
    
    const observer = () => {
      // Sort by ID to keep a stable rendering order
      const arr = Array.from(yMap.values()).sort((a, b) => a.id.localeCompare(b.id));
      setItems(arr);
    };
    
    // Initial populate
    setItems(Array.from(yMap.values()).sort((a, b) => a.id.localeCompare(b.id)));
    
    yMap.observe(observer);
    return () => {
      yMap.unobserve(observer);
    };
  }, [key]);

  const setItemWrapper = useCallback((action: T[] | ((prev: T[]) => T[])) => {
    const yMap = doc.getMap<T>(key);
    // Build the current array from the map
    const currentArray = Array.from(yMap.values()).sort((a, b) => a.id.localeCompare(b.id));
    const newItems =
      typeof action === 'function' ? (action as (prev: T[]) => T[])(currentArray) : action;
    
    doc.transact(() => {
      // 1. Delete items that no longer exist
      const newIds = new Set(newItems.map(i => i.id));
      for (const id of yMap.keys()) {
        if (!newIds.has(id)) {
          yMap.delete(id);
        }
      }
      // 2. Insert or update existing items
      for (const item of newItems) {
        yMap.set(item.id, item);
      }
    });
  }, [key]);

  return [items, setItemWrapper];
}

/**
 * 어셈블리 관련 state를 관리합니다.
 * Yjs CRDT 구조가 적용되어 다중 사용자가 동시에 파트를 추가하거나 이동해도 충돌하지 않습니다.
 */
export function useAssemblyState() {
  const [bodies, setBodies] = useYjsMapAsArray<BodyEntry>('bodies');
  const [placedParts, setPlacedParts] = useYjsMapAsArray<PlacedPart>('placedParts');
  const [assemblyMates, setAssemblyMates] = useYjsMapAsArray<AssemblyMate>('assemblyMates');

  // Local/UI states (not synchronized over CRDT)
  const [activeBodyId, setActiveBodyId] = useState<string | null>(null);
  const [selectedBodyIds, setSelectedBodyIds] = useState<string[]>([]);
  const [showBodyPanel, setShowBodyPanel] = useState(false);
  const [showPartPlacement, setShowPartPlacement] = useState(false);
  const [interferenceResults, setInterferenceResults] = useState<InterferenceResult[]>([]);
  const [interferenceLoading, setInterferenceLoading] = useState(false);
  const [onlineCount, setOnlineCount] = useState(1);

  useEffect(() => {
    initYjs();
    if (!provider) return;
    const awareness = provider.awareness;
    
    // Set our local state
    awareness.setLocalStateField('user', { name: 'User_' + Math.floor(Math.random() * 1000) });
    
    const onAwarenessChange = () => {
      const states = awareness.getStates();
      setOnlineCount(states.size);
    };
    
    awareness.on('change', onAwarenessChange);
    setOnlineCount(awareness.getStates().size);
    
    return () => {
      awareness.off('change', onAwarenessChange);
    };
  }, []);

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
    onlineCount,
  };
}
