'use client';

// M1 — CSG + Body manager dock.
//
// Bundles the two body-related modal panels (CSG Boolean + Body Manager).
// They're frequently used together (split bodies, then boolean them) and
// share state with the multi-body workflow.

import React from 'react';
import dynamic from 'next/dynamic';
import type { CSGOperation, CSGToolParams } from '../editing/CSGOperations';
import type { BodyEntry } from './BodyPanel';

const CSGPanel = dynamic(() => import('../editing/CSGPanel'), { ssr: false });
const BodyPanel = dynamic(() => import('./BodyPanel'), { ssr: false });

interface BodyCsgDockProps {
  lang: string;

  // CSG modal
  showCSGPanel: boolean;
  setShowCSGPanel: (v: boolean) => void;
  onCSGApply: (op: CSGOperation, params: CSGToolParams) => void;

  // Body manager modal
  showBodyPanel: boolean;
  setShowBodyPanel: (v: boolean) => void;
  bodies: BodyEntry[];
  setBodies: React.Dispatch<React.SetStateAction<BodyEntry[]>>;
  activeBodyId: string | null;
  setActiveBodyId: (id: string | null) => void;
  selectedBodyIds: string[];
  setSelectedBodyIds: React.Dispatch<React.SetStateAction<string[]>>;
  setHighlightedPartId: (name: string | null) => void;
  /** Reference to body geometry map — caller owns the ref. Used on delete to
   *  free the buffer alongside the body row. */
  bodyGeosRef: React.RefObject<Map<string, unknown>>;
  onSplit: (bodyId: string, plane: number, offset: number) => void;
  onMerge: (bodyIds: string[]) => void;
}

export default function BodyCsgDock({
  lang,
  showCSGPanel, setShowCSGPanel, onCSGApply,
  showBodyPanel, setShowBodyPanel,
  bodies, setBodies, activeBodyId, setActiveBodyId,
  selectedBodyIds, setSelectedBodyIds,
  setHighlightedPartId, bodyGeosRef,
  onSplit, onMerge,
}: BodyCsgDockProps) {
  return (
    <>
      {showCSGPanel && (
        <CSGPanel
          lang={lang}
          onApply={onCSGApply}
          onClose={() => setShowCSGPanel(false)}
        />
      )}

      {showBodyPanel && (
        <BodyPanel
          lang={lang}
          bodies={bodies}
          activeBodyId={activeBodyId}
          selectedBodyIds={selectedBodyIds}
          onHighlightPart={setHighlightedPartId}
          onSetActive={(id) => setActiveBodyId(id)}
          onToggleSelect={(id) =>
            setSelectedBodyIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
            )
          }
          onToggleVisible={(id) =>
            setBodies((prev) =>
              prev.map((b) => (b.id === id ? { ...b, visible: !b.visible } : b)),
            )
          }
          onRename={(id, name) =>
            setBodies((prev) =>
              prev.map((b) => (b.id === id ? { ...b, name } : b)),
            )
          }
          onDelete={(id) => {
            bodyGeosRef.current?.delete(id);
            setBodies((prev) => {
              const next = prev.filter((b) => b.id !== id);
              if (activeBodyId === id) setActiveBodyId(next[0]?.id ?? null);
              return next;
            });
            setSelectedBodyIds((prev) => prev.filter((x) => x !== id));
          }}
          onSplit={onSplit}
          onMerge={onMerge}
          onClose={() => setShowBodyPanel(false)}
        />
      )}
    </>
  );
}
