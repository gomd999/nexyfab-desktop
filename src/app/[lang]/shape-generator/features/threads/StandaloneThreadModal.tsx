'use client';

/**
 * StandaloneThreadModal — Wave 2 Phase 2 Track D6 (W6) standalone Add/Edit thread.
 *
 * Spec §10.2 (Standalone Add Thread) + §10.3 (Edit-in-place).
 *
 * Two operating modes:
 *
 *   1. **New** — no `existing` prop. Submit calls `onSubmit(newFeature)`.
 *
 *   2. **Edit** — `existing` prop populates every field. Submit calls
 *      `onSubmit(updatedFeature)`; an additional `onDelete()` callback
 *      lets the host wipe the feature from the tree.
 *
 * The face/surface picker is a **placeholder dropdown** in W6 — until the
 * face-picking tool comes online, the host passes a list of selectable face
 * ids (e.g. derived from the feature tree's cylindrical faces). When the
 * list is empty the field accepts a free-form id so the modal stays usable
 * for testing / scripted entry.
 *
 * The "Add Thread" logic itself (series / designation / class pickers,
 * length, direction, mode badge) is delegated to `HoleWizardThreadsSection`
 * so the W6 PR has exactly one rendering pipeline for thread spec UI.
 */

import React, { useState } from 'react';
import HoleWizardThreadsSection, { type ThreadsSectionSpec } from './HoleWizardThreadsSection';
import { makeThreadFeature, type ThreadFeature } from './threadFeature';
import {
  updateThreadFeature,
  type ThreadFeaturePatch,
  type ThreadFeatureUpdateErrorCode,
} from './threadFeatureUpdate';
import { pickThreadsDict, type ThreadsDict } from './i18n';

// ─── Props ─────────────────────────────────────────────────────────────────

export interface StandaloneThreadModalProps {
  /** Visibility flag from the host. */
  open: boolean;
  /** Active language. Forwarded to the threads section + dict. */
  lang: string;
  /** Existing feature to edit; omit for "new" mode. */
  existing?: ThreadFeature;
  /**
   * Optional list of face ids the user can pick from. Each face id is the
   * stable OCCT face identifier — for W6 we don't lift this to a real
   * face-picker tool, the host just passes the candidate ids.
   */
  availableFaceIds?: readonly string[];
  /** Optional initial face id. Defaults to the first `availableFaceIds` if any. */
  initialFaceId?: string;
  /** Initial parent feature id (the hole/cylinder this thread belongs to). */
  initialParentFeatureId?: string;
  /** Generate fresh feature ids — defaults to a Math.random fallback. */
  idFactory?: () => string;
  /** Submit handler — receives the validated, fully-built ThreadFeature. */
  onSubmit: (feature: ThreadFeature) => void;
  /** Delete handler — only meaningful in edit mode. */
  onDelete?: (id: string) => void;
  /** Close (cancel) handler. */
  onClose: () => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function defaultIdFactory(): string {
  // Deterministic-ish fallback for environments without crypto.randomUUID.
  return `feat_thread_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function StandaloneThreadModal({
  open,
  lang,
  existing,
  availableFaceIds,
  initialFaceId,
  initialParentFeatureId,
  idFactory,
  onSubmit,
  onDelete,
  onClose,
}: StandaloneThreadModalProps): React.ReactElement | null {
  const dict: ThreadsDict = pickThreadsDict(lang);
  const isEdit = existing !== undefined;

  // Seed the section with the existing feature's values when editing.
  const initialSpec: Partial<ThreadsSectionSpec> | undefined = existing
    ? {
        series: existing.threadRef.series,
        designation: existing.threadRef.designation,
        class: existing.class,
        threadKind: existing.threadKind,
        threadDirection: existing.threadDirection,
        mode: existing.mode,
        length: existing.length,
        startOffset: existing.startOffset,
      }
    : undefined;

  const [spec, setSpec] = useState<ThreadsSectionSpec | null>(null);
  const [faceId, setFaceId] = useState<string>(
    initialFaceId ?? availableFaceIds?.[0] ?? '',
  );
  const [parentFeatureId, setParentFeatureId] = useState<string>(
    initialParentFeatureId ?? existing?.parentFeatureId ?? '',
  );
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function handleSubmit(): void {
    setError(null);
    const s = spec;
    if (!s) {
      setError(dict.errorUnknownDesignation);
      return;
    }
    if (!faceId.trim() && !isEdit) {
      setError(dict.errorMissingFace);
      return;
    }

    try {
      if (isEdit && existing) {
        const patch: ThreadFeaturePatch = {
          threadRef: { series: s.series, designation: s.designation },
          class: s.class,
          mode: s.mode,
          threadDirection: s.threadDirection,
          threadKind: s.threadKind,
          length: s.length,
          startOffset: s.startOffset,
          parentFeatureId: parentFeatureId || existing.parentFeatureId,
        };
        const r = updateThreadFeature(existing, patch);
        if (!r.ok) {
          setError(localiseUpdateError(dict, r.code, r.message));
          return;
        }
        onSubmit(r.feature);
      } else {
        const id = (idFactory ?? defaultIdFactory)();
        const created = makeThreadFeature({
          id,
          threadRef: { series: s.series, designation: s.designation },
          parentFeatureId: parentFeatureId || undefined,
          threadKind: s.threadKind,
          mode: s.mode,
          threadDirection: s.threadDirection,
          length: s.length,
          startOffset: s.startOffset,
          class: s.class,
        });
        onSubmit(created);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleDelete(): void {
    if (!isEdit || !existing || !onDelete) return;
    onDelete(existing.id);
  }

  return (
    <div
      data-testid="standalone-thread-modal"
      role="dialog"
      aria-labelledby="standalone-thread-modal-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: 'min(720px, 92vw)',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: 'var(--nx-panel-1)',
          border: '1px solid var(--nx-border-strong)',
          borderRadius: 8,
          padding: 16,
          color: 'var(--nx-text-1)',
        }}
      >
        <div
          id="standalone-thread-modal-title"
          style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}
        >
          {isEdit ? dict.editThreadTitle : dict.newThreadTitle}
        </div>

        {/* Face picker (placeholder dropdown until face-pick tool) */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginBottom: 4 }}>
            {dict.labelFace}
          </div>
          {availableFaceIds && availableFaceIds.length > 0 ? (
            <select
              data-testid="standalone-thread-face-select"
              value={faceId}
              onChange={(e) => setFaceId(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 6px',
                background: 'var(--nx-bg)',
                color: 'var(--nx-panel-2)',
                border: '1px solid var(--nx-border-strong)',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {availableFaceIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          ) : (
            <input
              data-testid="standalone-thread-face-input"
              type="text"
              value={faceId}
              onChange={(e) => setFaceId(e.target.value)}
              placeholder={dict.hintFacePlaceholder}
              style={{
                width: '100%',
                padding: '4px 6px',
                background: 'var(--nx-bg)',
                color: 'var(--nx-panel-2)',
                border: '1px solid var(--nx-border-strong)',
                borderRadius: 4,
                fontSize: 12,
              }}
            />
          )}
        </div>

        {/* Reuse the threads-section composable for the actual spec pickers. */}
        <HoleWizardThreadsSection
          initialSpec={initialSpec}
          lang={lang}
          onChange={setSpec}
        />

        {/* Error */}
        {error && (
          <div
            data-testid="standalone-thread-error"
            role="alert"
            style={{
              marginTop: 8,
              padding: 6,
              background: '#7f1d1d',
              color: '#fff',
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            {error}
          </div>
        )}

        {/* Footer actions */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 12,
          }}
        >
          {isEdit && onDelete ? (
            <button
              data-testid="standalone-thread-delete"
              type="button"
              onClick={handleDelete}
              style={{
                padding: '6px 12px',
                background: '#b91c1c',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {dict.deleteThread}
            </button>
          ) : (
            <span />
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="standalone-thread-cancel"
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 12px',
                background: 'var(--nx-border-strong)',
                color: 'var(--nx-panel-2)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {dict.cancel}
            </button>
            <button
              data-testid="standalone-thread-save"
              type="button"
              onClick={handleSubmit}
              style={{
                padding: '6px 12px',
                background: '#0ea5e9',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {dict.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function localiseUpdateError(
  dict: ThreadsDict,
  code: ThreadFeatureUpdateErrorCode,
  fallback: string,
): string {
  switch (code) {
    case 'length_range':
      return dict.errorLengthRange;
    case 'startoffset_negative':
      return dict.errorStartOffsetNegative;
    case 'invalid_class':
      return dict.errorInvalidClass;
    case 'unknown_designation':
      return dict.errorUnknownDesignation;
    case 'geometric_unavailable':
      return dict.hintGeometricW7;
    default:
      return fallback;
  }
}
