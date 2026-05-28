'use client';

/**
 * CollabSafe.tsx — Wave 2 Phase 3 W5 Track Z5.
 *
 * Tiny ErrorBoundary that swallows the
 * `"[CollabProvider] hooks must be used within a <CollabProvider>"`
 * throw and renders nothing instead.
 *
 * Why this exists:
 *   Z5 awareness components (`PresencePanel`, `SketchPeerCursors`,
 *   `FeatureTreePeerHighlight`, `EditingFocusIndicator`) consume Z1's
 *   `useCollabPresence()` hook. During Wave 2 Phase 3 the production
 *   editor shell is NOT YET wrapped in `<CollabProvider>` — that wiring
 *   is a later phase task. We still want the awareness components to be
 *   safe to drop into existing surfaces (SketchPanel touchpoint, dialogs)
 *   without crashing the page when a Provider isn't present.
 *
 *   The right shape is an ErrorBoundary because React forbids try/catch
 *   around hook calls. The boundary catches the throw, renders its
 *   `fallback` (default `null`), and never retries until React unmounts
 *   the boundary itself.
 *
 *   Once the production shell is wrapped in `<CollabProvider>` (Z6 / W6
 *   territory), this boundary is a defensive no-op — it only ever
 *   triggers when a Z5 component is used outside its intended scope,
 *   which is exactly the "render nothing" UX we want.
 *
 * Z5 deliberately does NOT modify `CollabProvider.tsx` itself (the Z1
 * contract is frozen — see ADR-012 §5). Adding a sibling ErrorBoundary
 * is the least-invasive way to get safe-mount semantics without
 * touching the Z1-finalized API surface.
 */

import React from 'react';

interface CollabSafeProps {
  children: React.ReactNode;
  /** What to render when the inner subtree throws. Default `null`. */
  fallback?: React.ReactNode;
}

interface CollabSafeState {
  hasError: boolean;
}

export class CollabSafe extends React.Component<CollabSafeProps, CollabSafeState> {
  static getDerivedStateFromError(): CollabSafeState {
    return { hasError: true };
  }

  // Constructor + state init explicit (TS strict mode keeps inferred
  // initial state happier than class-property assignment in the
  // shape-generator's tsconfig).
  constructor(props: CollabSafeProps) {
    super(props);
    this.state = { hasError: false };
  }

  // We intentionally do NOT call console.error here — the throw is
  // expected when no <CollabProvider> wraps the subtree (production
  // pre-Z6 path). Noise-free by design.
  override componentDidCatch(): void {
    /* swallowed by design */
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

export default CollabSafe;
