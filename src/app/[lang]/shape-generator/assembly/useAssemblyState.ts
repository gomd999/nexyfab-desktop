'use client';

import { useState, useCallback } from 'react';
import * as THREE from 'three';
import type { AssemblyState, AssemblyBody, Mate } from './matesSolver';

const DEFAULT_ASSEMBLY: AssemblyState = {
  bodies: [],
  mates: [],
};

/**
 * Minimal hook for managing AssemblyState (bodies + mates).
 *
 * Consumers who already maintain their own state can ignore this hook and
 * pass an AssemblyState + setter directly to AssemblyMatesPanel.
 */
export function useAssemblyState() {
  const [assembly, setAssembly] = useState<AssemblyState>(DEFAULT_ASSEMBLY);

  /** Add a new body to the assembly */
  const addBody = useCallback((name: string, fixed = false): void => {
    const body: AssemblyBody = {
      name,
      position: new THREE.Vector3(),
      rotation: new THREE.Euler(),
      fixed,
    };
    setAssembly(prev => ({
      ...prev,
      bodies: [...prev.bodies, body],
    }));
  }, []);

  /** Remove a body by index and clean up any mates that reference it */
  const removeBody = useCallback((index: number): void => {
    setAssembly(prev => {
      const bodies = prev.bodies.filter((_, i) => i !== index);
      // Drop mates that referenced the removed body, and remap indices
      const mates = prev.mates
        .filter(m =>
          m.selections[0].bodyIndex !== index &&
          m.selections[1].bodyIndex !== index,
        )
        .map(m => ({
          ...m,
          selections: [
            {
              ...m.selections[0],
              bodyIndex: m.selections[0].bodyIndex > index
                ? m.selections[0].bodyIndex - 1
                : m.selections[0].bodyIndex,
            },
            {
              ...m.selections[1],
              bodyIndex: m.selections[1].bodyIndex > index
                ? m.selections[1].bodyIndex - 1
                : m.selections[1].bodyIndex,
            },
          ] as [typeof m.selections[0], typeof m.selections[1]],
        }));
      return { bodies, mates };
    });
  }, []);

  /** Add a mate constraint */
  const addMate = useCallback((mate: Mate): void => {
    setAssembly(prev => ({
      ...prev,
      mates: [...prev.mates, mate],
    }));
  }, []);

  /** Remove a mate by ID */
  const removeMate = useCallback((id: string): void => {
    setAssembly(prev => ({
      ...prev,
      mates: prev.mates.filter(m => m.id !== id),
    }));
  }, []);

  /** Update a mate by ID */
  const updateMate = useCallback((id: string, patch: Partial<Mate>): void => {
    setAssembly(prev => ({
      ...prev,
      mates: prev.mates.map(m => m.id === id ? { ...m, ...patch } : m),
    }));
  }, []);

  /** Toggle a mate's enabled state */
  const toggleMate = useCallback((id: string): void => {
    setAssembly(prev => ({
      ...prev,
      mates: prev.mates.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m),
    }));
  }, []);

  return {
    assembly,
    setAssembly,
    addBody,
    removeBody,
    addMate,
    removeMate,
    updateMate,
    toggleMate,
  };
}
