'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import * as THREE from 'three';

/**
 * Multiplayer Architecture for Collaborative 3D CAD
 * 
 * In a true Onshape/Figma style multiplayer environment, state changes (feature tree modifications,
 * sketch dragging) are synchronized via CRDTs (like Yjs) and WebSockets.
 * 
 * This provider implements the foundational frontend architecture for multiplayer cursors
 * and state synchronization. Since there is no live backend in this prototype, it uses
 * BroadcastChannel to synchronize across browser tabs (simulating WebSocket broadcasting).
 */

interface CursorData {
  id: string;
  name: string;
  color: string;
  position: THREE.Vector3; // 3D world position of the cursor
  state: 'idle' | 'sketching' | 'editing_feature';
}

interface MultiplayerContextType {
  cursors: Map<string, CursorData>;
  myId: string;
  updateMyCursor: (pos: THREE.Vector3, state?: CursorData['state']) => void;
  broadcastAction: (actionType: string, payload: any) => void;
  subscribeToAction: (actionType: string, callback: (payload: any) => void) => () => void;
}

const MultiplayerContext = createContext<MultiplayerContextType | null>(null);

const COLORS = ['#ff0055', '#0099ff', '#00cc44', '#ffaa00', '#9933ff'];

export function MultiplayerProvider({ children, projectId }: { children: ReactNode, projectId: string }) {
  const [cursors, setCursors] = useState<Map<string, CursorData>>(new Map());
  const myId = useRef(`user_${Math.random().toString(36).slice(2, 9)}`).current;
  const myColor = useRef(COLORS[Math.floor(Math.random() * COLORS.length)]).current;
  const channelRef = useRef<BroadcastChannel | null>(null);
  
  // Custom event listeners for feature-level sync
  const actionListeners = useRef<Map<string, Set<(payload: any) => void>>>(new Map());

  useEffect(() => {
    // Setup generic sync channel for this specific project
    const channel = new BroadcastChannel(`nexyfab_sync_${projectId}`);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'CURSOR_UPDATE') {
        setCursors(prev => {
          const next = new Map(prev);
          next.set(msg.data.id, {
            ...msg.data,
            position: new THREE.Vector3().copy(msg.data.position)
          });
          return next;
        });
      } else if (msg.type === 'ACTION') {
        const listeners = actionListeners.current.get(msg.actionType);
        if (listeners) {
          listeners.forEach(cb => cb(msg.payload));
        }
      }
    };

    return () => {
      channel.close();
    };
  }, [projectId]);

  const updateMyCursor = (pos: THREE.Vector3, state: CursorData['state'] = 'idle') => {
    if (!channelRef.current) return;
    const data: CursorData = {
      id: myId,
      name: `Engineer ${myId.slice(-4)}`,
      color: myColor,
      position: pos,
      state
    };
    channelRef.current.postMessage({ type: 'CURSOR_UPDATE', data });
  };

  const broadcastAction = (actionType: string, payload: any) => {
    if (!channelRef.current) return;
    channelRef.current.postMessage({ type: 'ACTION', actionType, payload });
  };

  const subscribeToAction = (actionType: string, callback: (payload: any) => void) => {
    if (!actionListeners.current.has(actionType)) {
      actionListeners.current.set(actionType, new Set());
    }
    actionListeners.current.get(actionType)!.add(callback);
    
    return () => {
      actionListeners.current.get(actionType)?.delete(callback);
    };
  };

  return (
    <MultiplayerContext.Provider value={{ cursors, myId, updateMyCursor, broadcastAction, subscribeToAction }}>
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer() {
  const ctx = useContext(MultiplayerContext);
  // Default non-crashing mock context if provider is not wrapped
  if (!ctx) {
    return {
      cursors: new Map<string, CursorData>(),
      myId: 'local',
      updateMyCursor: () => {},
      broadcastAction: () => {},
      subscribeToAction: () => () => {},
    };
  }
  return ctx;
}
