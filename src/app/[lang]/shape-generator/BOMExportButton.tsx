'use client';

import React, { useCallback } from 'react';

interface BomRow {
  partId: string;
  name: string;
  material?: string;
  quantity: number;
  volume_cm3?: number;
  weight_g?: number;
}

interface BOMExportButtonProps {
  parts: BomRow[];
  disabled?: boolean;
  lang: string;
}

export default function BOMExportButton({ parts, disabled, lang }: BOMExportButtonProps) {
  const isKo = lang === 'ko' || lang === 'kr';

  const handleExportCSV = useCallback(() => {
    if (!parts.length) return;

    const header = isKo
      ? ['번호', '파트명', '재료', '수량', '체적(cm³)', '무게(g)']
      : ['#', 'Part Name', 'Material', 'Qty', 'Volume(cm³)', 'Weight(g)'];

    const rows = parts.map((p, i) => [
      i + 1,
      p.name,
      p.material || '-',
      p.quantity,
      p.volume_cm3?.toFixed(2) ?? '-',
      p.weight_g?.toFixed(1) ?? '-',
    ].join(','));

    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexyfab_bom_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [parts, isKo]);

  return (
    <button
      onClick={handleExportCSV}
      disabled={disabled || !parts.length}
      title={isKo ? 'BOM CSV 다운로드' : 'Download BOM as CSV'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
        color: disabled || !parts.length ? '#484f58' : '#58a6ff',
        fontSize: 11,
        fontWeight: 600,
        cursor: disabled || !parts.length ? 'not-allowed' : 'pointer',
        transition: 'all 0.12s',
        opacity: disabled || !parts.length ? 0.5 : 1,
      }}
      onMouseEnter={e => {
        if (!disabled && parts.length) {
          e.currentTarget.style.background = 'rgba(88,166,255,0.1)';
          e.currentTarget.style.borderColor = 'rgba(88,166,255,0.3)';
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
      }}
    >
      <span style={{ fontSize: 13 }}>📋</span>
      <span>{isKo ? 'BOM 내보내기' : 'Export BOM'}</span>
    </button>
  );
}
