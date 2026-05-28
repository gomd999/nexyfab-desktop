'use client';

/**
 * StandaloneAddThreadButton — Wave 2 Phase 2 Track D6 (W6).
 *
 * Toolbar/ribbon button that opens the `StandaloneThreadModal` for adding a
 * thread to any existing cylindrical surface. The button label is localised
 * via the threads dict (`Add Thread` / `나사 추가` / ...).
 *
 * Spec §10.2. The button is intentionally lightweight — host renders it
 * wherever it fits its toolbar idiom (no styling assumptions about where
 * "the toolbar" is). The component owns the modal-open boolean.
 */

import React, { useState, useCallback } from 'react';
import StandaloneThreadModal, {
  type StandaloneThreadModalProps,
} from './StandaloneThreadModal';
import { pickThreadsDict } from './i18n';
import type { ThreadFeature } from './threadFeature';

export interface StandaloneAddThreadButtonProps {
  /** Active language. */
  lang: string;
  /** Faces the user can pick when adding a new thread. */
  availableFaceIds?: readonly string[];
  /** Optional parent-feature id to seed the modal with. */
  initialParentFeatureId?: string;
  /** Optional initial face id (e.g. the currently-selected face). */
  initialFaceId?: string;
  /** Custom feature-id factory; defaults to a Math.random fallback. */
  idFactory?: () => string;
  /** Called when the user saves a new thread. */
  onCreate: (feature: ThreadFeature) => void;
  /** Optional `className` override for the button. */
  className?: string;
  /** Optional `style` override for the button. */
  style?: React.CSSProperties;
}

export default function StandaloneAddThreadButton({
  lang,
  availableFaceIds,
  initialParentFeatureId,
  initialFaceId,
  idFactory,
  onCreate,
  className,
  style,
}: StandaloneAddThreadButtonProps): React.ReactElement {
  const dict = pickThreadsDict(lang);
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const handleSubmit = useCallback<StandaloneThreadModalProps['onSubmit']>(
    (feature) => {
      onCreate(feature);
      setOpen(false);
    },
    [onCreate],
  );

  return (
    <>
      <button
        data-testid="standalone-add-thread-button"
        type="button"
        onClick={handleOpen}
        className={className}
        style={
          style ?? {
            padding: '6px 10px',
            background: '#0ea5e9',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }
        }
      >
        {dict.addThreadButton}
      </button>
      <StandaloneThreadModal
        open={open}
        lang={lang}
        availableFaceIds={availableFaceIds}
        initialFaceId={initialFaceId}
        initialParentFeatureId={initialParentFeatureId}
        idFactory={idFactory}
        onSubmit={handleSubmit}
        onClose={handleClose}
      />
    </>
  );
}
