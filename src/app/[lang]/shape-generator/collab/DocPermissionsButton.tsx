'use client';

/**
 * DocPermissionsButton.tsx — Z8 entry point.
 *
 * Renders a single icon button (`👥`) next to the share controls; opening
 * it mounts `PermissionsPanel`. Hidden entirely when there is no cloud
 * document bound to the current session (`documentId` undefined / null).
 */

import React, { useState } from 'react';
import { PermissionsPanel, pickPermDict } from './PermissionsPanel';

export interface DocPermissionsButtonProps {
  readonly documentId: string | null | undefined;
  readonly currentUserId: string | null | undefined;
  readonly lang: string;
  readonly canManage: boolean;
  /** Visible label override (defaults to dict.title). */
  readonly label?: string;
  readonly testId?: string;
}

export function DocPermissionsButton(props: DocPermissionsButtonProps): React.ReactElement | null {
  const { documentId, currentUserId, lang, canManage, label, testId = 'doc-perm-btn' } = props;
  const [open, setOpen] = useState(false);

  if (!documentId || !currentUserId) return null;

  const dict = pickPermDict(lang);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label ?? dict.title}
        data-testid={testId}
        style={{
          width: 30,
          height: 28,
          padding: 0,
          borderRadius: 6,
          border: '1px solid var(--nx-border)',
          background: 'transparent',
          color: 'var(--nx-text-2)',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label={label ?? dict.title}
      >
        👥
      </button>
      {open && (
        <PermissionsPanel
          documentId={documentId}
          currentUserId={currentUserId}
          lang={lang}
          canManage={canManage}
          onClose={() => setOpen(false)}
          testId={`${testId}-panel`}
        />
      )}
    </>
  );
}
