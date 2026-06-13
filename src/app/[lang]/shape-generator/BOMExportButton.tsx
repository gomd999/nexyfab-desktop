'use client';

import React, { useCallback } from 'react';
import { useLang } from './hooks/useLang';
import { loc } from './lib/loc';

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
  void lang;
  const resolvedLang = useLang();

  const handleExportCSV = useCallback(() => {
    if (!parts.length) return;

    const header = [
      loc(resolvedLang, { ko: '번호', en: '#', ja: '番号', zh: '编号', es: 'N.º', ar: 'رقم' }),
      loc(resolvedLang, { ko: '파트명', en: 'Part Name', ja: '部品名', zh: '零件名称', es: 'Nombre de pieza', ar: 'اسم القطعة' }),
      loc(resolvedLang, { ko: '재료', en: 'Material', ja: '材料', zh: '材料', es: 'Material', ar: 'المادة' }),
      loc(resolvedLang, { ko: '수량', en: 'Qty', ja: '数量', zh: '数量', es: 'Cant.', ar: 'الكمية' }),
      loc(resolvedLang, { ko: '체적(cm³)', en: 'Volume(cm³)', ja: '体積(cm³)', zh: '体积(cm³)', es: 'Volumen(cm³)', ar: 'الحجم(cm³)' }),
      loc(resolvedLang, { ko: '무게(g)', en: 'Weight(g)', ja: '重量(g)', zh: '重量(g)', es: 'Peso(g)', ar: 'الوزن(g)' }),
    ];

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
  }, [parts, resolvedLang]);

  return (
    <button
      onClick={handleExportCSV}
      disabled={disabled || !parts.length}
      title={loc(resolvedLang, { ko: 'BOM CSV 다운로드', en: 'Download BOM as CSV', ja: 'BOM を CSV でダウンロード', zh: '下载 BOM 为 CSV', es: 'Descargar lista de materiales (BOM) en CSV', ar: 'تنزيل قائمة المواد (BOM) بصيغة CSV' })}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'var(--nx-glass-soft)',
        color: disabled || !parts.length ? 'var(--nx-border-strong)' : 'var(--nx-accent-2)',
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
        e.currentTarget.style.background = 'var(--nx-glass-soft)';
        e.currentTarget.style.borderColor = 'var(--nx-glass-soft)';
      }}
    >
      <span style={{ fontSize: 13 }}>📋</span>
      <span>{loc(resolvedLang, { ko: 'BOM 내보내기', en: 'Export BOM', ja: 'BOM をエクスポート', zh: '导出 BOM', es: 'Exportar BOM', ar: 'تصدير قائمة المواد (BOM)' })}</span>
    </button>
  );
}
