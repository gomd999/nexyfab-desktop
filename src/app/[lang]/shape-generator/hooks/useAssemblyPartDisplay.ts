'use client';

/**
 * useAssemblyPartDisplay — owns the per-part viewport display overrides for an
 * assembly: which parts are hidden, which are shown transparent, and any
 * per-part colour overrides. Pure UI display state (driven by the assembly
 * context menu + snapshot load), so it lifts cleanly out of the
 * ShapeGeneratorInner monolith.
 */

import { useState, type Dispatch, type SetStateAction } from 'react';

export interface AssemblyPartDisplay {
  hiddenParts: Set<string>;
  setHiddenParts: Dispatch<SetStateAction<Set<string>>>;
  transparentParts: Set<string>;
  setTransparentParts: Dispatch<SetStateAction<Set<string>>>;
  partColors: Record<string, string>;
  setPartColors: Dispatch<SetStateAction<Record<string, string>>>;
}

export function useAssemblyPartDisplay(): AssemblyPartDisplay {
  const [hiddenParts, setHiddenParts] = useState<Set<string>>(new Set());
  const [transparentParts, setTransparentParts] = useState<Set<string>>(new Set());
  const [partColors, setPartColors] = useState<Record<string, string>>({});
  return { hiddenParts, setHiddenParts, transparentParts, setTransparentParts, partColors, setPartColors };
}
