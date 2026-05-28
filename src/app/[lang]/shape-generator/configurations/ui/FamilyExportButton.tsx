'use client';

/**
 * FamilyExportButton.tsx — button + modal that exports one STEP file
 * per non-master configuration, bundled as a single zip.
 *
 * Wave 2 Phase 2 Track A Week 4 (A4). Spec §8.1 family export.
 *
 * **W4 scope decision** — the spec §8.1 flow re-activates each config
 * in sequence and round-trips through the OCCT worker. The worker call
 * (`applyFeaturePipelineDetailedAsync` → `exportToStepAsync`) is the
 * *full* path; doing it from a UI component requires injecting the
 * pipeline runner + the geometry result from the host, which is a
 * bigger surface change than W4 allows. **Per the W4 spec** ("Wire the
 * STEP export only if the existing path is straightforward to call;
 * otherwise emit placeholder zips and log the deferred work"), we ship
 * the UI + modal + a placeholder zip emitter.
 *
 * The placeholder zip contains:
 *   - One `.step` text file per selected config — content is a stub
 *     manifest (config id, name, resolved param overrides, suppress
 *     flags, expression vars). This is *not* a valid STEP file, but
 *     it's recognisably a per-config payload so the UX (download, save,
 *     unzip, count files) works end-to-end. The header marks it as
 *     a placeholder so users know.
 *   - `manifest.json` summarising the family.
 *
 * Wiring the real STEP path is one or two PRs down the road — it
 * requires (a) hoisting `exportToStepAsync` access into a hook the
 * panel can read, and (b) a fresh `applyFeaturePipelineDetailedAsync`
 * per config (handled by the W5 CRDT-soak harness anyway). For W4 the
 * UI shape is the deliverable.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import type { ConfigurationTable as ConfigurationTableRuntime } from '../ConfigurationTable';
import type { FeatureInstance } from '../../features/types';
import { pickDict, type Lang } from './dict';

export interface FamilyExportButtonProps {
  table: ConfigurationTableRuntime;
  features: FeatureInstance[];
  lang: Lang | string;
  /** Optional project name for the zip filename. */
  projectName?: string;
  /** Optional STEP exporter — when provided, we use it; otherwise the
   *  placeholder path. Lets the host wire the real worker later
   *  without touching this file's shape. The provider returns the
   *  STEP text body for the resolved feature list of a given config. */
  stepExporter?: (configId: string, resolved: FeatureInstance[]) => Promise<string>;
}

const C = {
  accent: 'var(--nx-accent-2)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  muted: 'var(--nx-text-2)',
  panel: 'var(--nx-panel)',
  overlay: 'rgba(0, 0, 0, 0.65)',
  bg2: 'var(--nx-panel-2)',
  danger: 'var(--nx-error)',
};

export default function FamilyExportButton(props: FamilyExportButtonProps): React.JSX.Element {
  const { table, features, lang, projectName = 'nexyfab-part', stepExporter } = props;
  const t = pickDict(lang as string);

  const configs = useMemo(() => table.list(), [table]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(configs.map(c => c.id)));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [deferredNotice, setDeferredNotice] = useState<string | null>(null);

  const handleToggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAll = useCallback(() => {
    setSelected(new Set(configs.map(c => c.id)));
  }, [configs]);

  const handleNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleExport = useCallback(async () => {
    if (selected.size === 0) return;
    setProgress({ done: 0, total: selected.size });

    // Preserve the original active id so a soak run doesn't lose it.
    const originalActive = table.getActiveId();
    const targets = configs.filter(c => selected.has(c.id));
    const filesToZip: Record<string, Uint8Array> = {};
    const manifest: FamilyManifest = {
      project: projectName,
      generatedAt: new Date().toISOString(),
      placeholder: !stepExporter,
      configs: [],
    };

    for (let i = 0; i < targets.length; i += 1) {
      const cfg = targets[i]!;
      table.activate(cfg.id);
      const resolved = table.resolveActive(features);
      const safeName = sanitizeFilename(`${projectName}_${cfg.name || cfg.id}`);
      try {
        const body = stepExporter
          ? await stepExporter(cfg.id, resolved)
          : buildPlaceholderStep(cfg, resolved);
        filesToZip[`${safeName}.step`] = strToU8(body);
        manifest.configs.push({
          id: cfg.id,
          name: cfg.name,
          parentId: cfg.parentId ?? null,
          featureCount: resolved.length,
          filename: `${safeName}.step`,
        });
      } catch (err) {
        manifest.configs.push({
          id: cfg.id,
          name: cfg.name,
          parentId: cfg.parentId ?? null,
          featureCount: resolved.length,
          filename: `${safeName}.step`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      setProgress({ done: i + 1, total: targets.length });
    }

    // Restore the prior active id so the user's session is unchanged.
    table.activate(originalActive);

    filesToZip['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
    const zipped = zipSync(filesToZip, { level: 6 });
    const zipName = `${projectName}_family.zip`;

    if (typeof window !== 'undefined') {
      try {
        const blob = new Blob([new Uint8Array(zipped)], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // jsdom doesn't implement download — tests detect this; UI is
        // tolerant.
      }
    }

    if (!stepExporter) {
      setDeferredNotice(t.familyExportDeferred);
    }
    setProgress(null);
  }, [table, features, configs, selected, projectName, stepExporter, t.familyExportDeferred]);

  if (configs.length === 0) {
    // Empty state — button is still rendered, but disabled.
    return (
      <button
        data-testid="family-export-button"
        disabled
        title={t.familyExport}
        style={disabledButtonStyle}
      >
        {t.familyExport}
      </button>
    );
  }

  return (
    <>
      <button
        data-testid="family-export-button"
        onClick={() => setOpen(true)}
        title={t.familyExport}
        style={buttonStyle}
      >
        {t.familyExport}
      </button>

      {open && (
        <div data-testid="family-export-modal" style={overlayStyle}>
          <div style={modalStyle}>
            <div style={modalHeaderStyle}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{t.familyExportTitle}</span>
              <button
                data-testid="family-export-close"
                onClick={() => {
                  setOpen(false);
                  setDeferredNotice(null);
                }}
                style={closeBtnStyle}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div style={modalBodyStyle}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button
                  data-testid="family-export-select-all"
                  onClick={handleAll}
                  style={chipStyle}
                >
                  {t.familyExportAll}
                </button>
                <button
                  data-testid="family-export-select-none"
                  onClick={handleNone}
                  style={chipStyle}
                >
                  {t.familyExportNone}
                </button>
              </div>

              <ul style={listStyle}>
                {configs.map(cfg => (
                  <li key={cfg.id} style={listItemStyle}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        data-testid={`family-export-pick-${cfg.id}`}
                        type="checkbox"
                        checked={selected.has(cfg.id)}
                        onChange={() => handleToggle(cfg.id)}
                      />
                      <span>{cfg.name}</span>
                      <span style={{ color: C.muted, fontSize: 10 }}>({cfg.id})</span>
                    </label>
                  </li>
                ))}
              </ul>

              {progress && (
                <div data-testid="family-export-progress" style={progressStyle}>
                  {t.familyExportProgress}: {progress.done} / {progress.total}
                </div>
              )}

              {deferredNotice && (
                <div data-testid="family-export-deferred-notice" style={deferredNoticeStyle}>
                  {deferredNotice}
                </div>
              )}
            </div>

            <div style={modalFooterStyle}>
              <button
                data-testid="family-export-cancel"
                onClick={() => {
                  setOpen(false);
                  setDeferredNotice(null);
                }}
                style={chipStyle}
              >
                {t.familyExportCancel}
              </button>
              <button
                data-testid="family-export-go"
                onClick={handleExport}
                disabled={selected.size === 0 || progress !== null}
                style={primaryBtnStyle(selected.size > 0 && progress === null)}
              >
                {t.familyExportGo}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface FamilyManifestEntry {
  id: string;
  name: string;
  parentId: string | null;
  featureCount: number;
  filename: string;
  error?: string;
}

interface FamilyManifest {
  project: string;
  generatedAt: string;
  placeholder: boolean;
  configs: FamilyManifestEntry[];
}

/** Produce a recognisable filename component. STEP downloads are read
 *  by partner shops who care about predictable file names, so we
 *  preserve case + Latin chars and strip everything else. */
function sanitizeFilename(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'config';
}

/** Build a placeholder STEP file body. NOT a valid STEP — it's a
 *  human-readable manifest so the user can verify the round-trip.
 *  The real STEP geometry path lands in W5+ (master tracker). */
function buildPlaceholderStep(cfg: import('../types').ConfigEntry, resolved: FeatureInstance[]): string {
  const lines = [
    '!! NEXYFAB FAMILY EXPORT — PLACEHOLDER STEP !!',
    `!! config.id   : ${cfg.id}`,
    `!! config.name : ${cfg.name}`,
    `!! parentId    : ${cfg.parentId ?? '(none)'}`,
    `!! featureCount: ${resolved.length}`,
    '',
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${cfg.name} family export placeholder'),'2;1');`,
    `FILE_NAME('${cfg.id}','${new Date().toISOString()}',('NexyFab'),('NexyFab'),'NexyFab Wave 2 Phase 2 A4','','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
    '!! Resolved features:',
  ];
  for (const f of resolved) {
    const paramSummary = Object.entries(f.params)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    lines.push(`!! - ${f.type}#${f.id} { ${paramSummary} }`);
  }
  lines.push('ENDSEC;', 'END-ISO-10303-21;');
  return lines.join('\n');
}

// ── Styles ─────────────────────────────────────────────────────────

const buttonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  border: `1px solid ${C.border}`,
  background: 'transparent',
  color: C.muted,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const disabledButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.4,
  cursor: 'not-allowed',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: C.overlay,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalStyle: React.CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  width: 'min(480px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 48px)',
  display: 'flex',
  flexDirection: 'column',
  color: C.text,
  boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
};

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: `1px solid ${C.border}`,
};

const modalBodyStyle: React.CSSProperties = {
  padding: '12px 14px',
  overflow: 'auto',
};

const modalFooterStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  padding: '8px 14px',
  borderTop: `1px solid ${C.border}`,
};

const closeBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  padding: 0,
  borderRadius: 4,
  background: 'transparent',
  border: 'none',
  color: C.muted,
  fontSize: 16,
  cursor: 'pointer',
};

const chipStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  border: `1px solid ${C.border}`,
  background: 'transparent',
  color: C.muted,
  fontSize: 11,
  cursor: 'pointer',
};

function primaryBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    borderRadius: 4,
    border: `1px solid ${C.accent}`,
    background: enabled ? C.accent : 'transparent',
    color: enabled ? 'white' : C.muted,
    fontSize: 11,
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.5,
  };
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  maxHeight: 240,
  overflow: 'auto',
};

const listItemStyle: React.CSSProperties = {
  padding: '4px 6px',
  borderBottom: `1px solid ${C.border}`,
  fontSize: 11,
};

const progressStyle: React.CSSProperties = {
  marginTop: 8,
  padding: 6,
  background: C.bg2,
  borderRadius: 4,
  fontSize: 11,
};

const deferredNoticeStyle: React.CSSProperties = {
  marginTop: 8,
  padding: 6,
  background: C.bg2,
  border: `1px dashed ${C.accent}`,
  borderRadius: 4,
  fontSize: 11,
  color: C.text,
};
