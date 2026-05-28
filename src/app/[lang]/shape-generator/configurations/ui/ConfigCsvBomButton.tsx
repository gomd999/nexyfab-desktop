'use client';

/**
 * ConfigCsvBomButton.tsx — exports a "BOM" (Bill of Materials) CSV
 * from the configuration table.
 *
 * Wave 2 Phase 2 Track A Week 4 (A4). Spec §8.2 second-CSV ("BOM CSV").
 *
 * Layout: one row per config, columns are:
 *   - configName
 *   - parentId
 *   - feature qty per feature (suppress=0, present=1; resolved via
 *     the runtime's full parent-chain walk so inheritance reflects).
 *
 * Pure JS, no fflate, no external dep. The `buildCsv` worker function
 * is exported so unit tests can pin the exact string output without
 * mocking DOM.
 *
 * Naming: `bom.csv` is a common convention for procurement handoffs;
 * we keep the date suffix so partners can diff revisions.
 */

import React, { useCallback } from 'react';
import type { ConfigurationTable as ConfigurationTableRuntime } from '../ConfigurationTable';
import type { ConfigEntry } from '../types';
import type { FeatureInstance } from '../../features/types';
import { pickDict, type Lang } from './dict';

export interface ConfigCsvBomButtonProps {
  table: ConfigurationTableRuntime;
  features: FeatureInstance[];
  lang: Lang | string;
  projectName?: string;
}

const C = {
  accent: 'var(--nx-accent-2)',
  border: 'var(--nx-border)',
  muted: 'var(--nx-text-2)',
};

export default function ConfigCsvBomButton(props: ConfigCsvBomButtonProps): React.JSX.Element {
  const { table, features, lang, projectName = 'nexyfab' } = props;
  const t = pickDict(lang as string);

  const handleClick = useCallback(() => {
    const configs = table.list();
    const csv = buildConfigBomCsv(table, configs, features);
    if (typeof window === 'undefined') return;
    try {
      const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName}-config-bom-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // jsdom — silent fallback. Tests verify the CSV via buildConfigBomCsv directly.
    }
  }, [table, features, projectName]);

  return (
    <button
      data-testid="config-csv-bom-button"
      onClick={handleClick}
      title={t.csvBomTooltip}
      style={buttonStyle}
    >
      {t.csvBom}
    </button>
  );
}

/** Pure CSV builder — testable. Quotes RFC 4180. */
export function buildConfigBomCsv(
  table: ConfigurationTableRuntime,
  configs: readonly ConfigEntry[],
  features: readonly FeatureInstance[],
): string {
  const escape = (s: string): string =>
    /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

  // Stable column order — `featureType#shortId`. Sort by type then id
  // so the same .nfab always produces the same CSV (golden testable).
  const featureCols = [...features].sort((a, b) =>
    a.type === b.type ? a.id.localeCompare(b.id) : a.type.localeCompare(b.type),
  );

  const header = ['configId', 'configName', 'parentId', ...featureCols.map(f => `${f.type}#${f.id}`)];

  const rows: string[] = [header.map(escape).join(',')];

  for (const cfg of configs) {
    const cells: string[] = [cfg.id, cfg.name, cfg.parentId ?? ''];
    // Resolve through the parent chain so inheritance reflects.
    const resolved = table.getResolved(cfg.id, features);
    const liveIds = new Set(resolved.map(f => f.id));
    for (const f of featureCols) {
      cells.push(liveIds.has(f.id) ? '1' : '0');
    }
    rows.push(cells.map(escape).join(','));
  }

  return rows.join('\n');
}

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
