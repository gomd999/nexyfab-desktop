'use client';

/**
 * EditingFocusIndicator.tsx — Wave 2 Phase 3 W5 Track Z5.
 *
 * Generic peer-focus highlight for input fields inside modal forms
 * (HoleWizardModalV2, AutoDrawingDialog, ToleranceStackPanel, etc.).
 *
 * Contract: a parent form publishes the *currently-edited* form-field id
 * via `updateLocalPresence({ selection: [focusId] })`. Other peers see
 * that focusId in their `remotePeers[*].selection`. This component:
 *
 *   1. Reads `remotePeers` from the collab context.
 *   2. Finds any peer whose `selection` contains `focusId`.
 *   3. Renders a colored border + tooltip around `children`.
 *
 * Pure presentation — does NOT mutate values, does NOT block input. Two
 * peers editing the same field race the LWW resolver in the underlying
 * data store; this component just SURFACES the race so the loser
 * understands why their value flickered.
 *
 * Usage:
 *
 *   <EditingFocusIndicator focusId="hole-wizard.diameter">
 *     <input ... />
 *   </EditingFocusIndicator>
 *
 * Tooltip i18n: the host passes labels. We keep this component i18n-agnostic
 * because the indicator wraps deep host UI; the dict already lives in the
 * host component (HoleWizardModalV2 owns its labels).
 */

import React, { useMemo } from 'react';
import { useCollabPresence } from './CollabProvider';
import { CollabSafe } from './CollabSafe';
import type { PeerInfo } from './awareness';

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Returns the first remote peer whose `selection` contains `focusId`, or
 * `null` if none. Stable across renders (memoized).
 *
 * Why "first" only: rendering N tooltips for N peers on the same field
 * is noise. The host can chain `useEditingPeer` calls if they want
 * multi-peer; W5 ships the common case.
 */
export function useEditingPeer(focusId: string | null | undefined): PeerInfo | null {
  const { remotePeers } = useCollabPresence();
  return useMemo(() => {
    if (!focusId) return null;
    const candidates = Object.values(remotePeers)
      .filter((p) => Array.isArray(p.selection) && p.selection.includes(focusId))
      // Stable order: prefer the most-recently-active peer.
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    return candidates[0] ?? null;
  }, [remotePeers, focusId]);
}

// ─── Public props ───────────────────────────────────────────────────────────

export interface EditingFocusIndicatorProps {
  /** Field identifier — should be stable and globally unique per doc. */
  focusId: string;
  /** Optional tooltip text formatter. Default `"Editing by @{name}"`. */
  tooltipFormat?: (peerName: string) => string;
  /** Override border width. Default 2px. */
  borderWidth?: number;
  /** Render the tooltip when there's an editing peer. Default true. */
  showTooltip?: boolean;
  /** The wrapped input / form group. */
  children: React.ReactNode;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Wraps the indicator in `<CollabSafe>` and renders the children un-decorated
 * when there's no `<CollabProvider>` upstream — pre-Z6 hosts (current production
 * shell) can drop the wrapper into existing modals without coupling them to
 * the collab tree.
 */
export function EditingFocusIndicator(props: EditingFocusIndicatorProps) {
  return (
    <CollabSafe fallback={<>{props.children}</>}>
      <EditingFocusIndicatorInner {...props} />
    </CollabSafe>
  );
}

function EditingFocusIndicatorInner(props: EditingFocusIndicatorProps) {
  const {
    focusId,
    tooltipFormat,
    borderWidth = 2,
    showTooltip = true,
    children,
  } = props;
  const peer = useEditingPeer(focusId);

  if (!peer) {
    // Pass children through untouched.
    return <>{children}</>;
  }

  const tooltipText = tooltipFormat
    ? tooltipFormat(peer.name)
    : `Editing by @${peer.name}`;

  return (
    <span
      data-testid="editing-focus-indicator"
      data-focus-id={focusId}
      data-peer-id={peer.id}
      style={{
        position: 'relative',
        display: 'inline-block',
        outline: `${borderWidth}px solid ${peer.color}`,
        outlineOffset: 1,
        borderRadius: 4,
        transition: 'outline-color 0.15s ease',
      }}
    >
      {children}
      {showTooltip && (
        <span
          role="tooltip"
          data-testid="editing-focus-tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            left: 0,
            background: peer.color,
            color: '#0a0a0a',
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 4,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {tooltipText}
        </span>
      )}
    </span>
  );
}

export default EditingFocusIndicator;
