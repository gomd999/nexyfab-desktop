'use client';

// Phase-1 GD&T picker — opens from the ribbon `note.gdt` button (or any
// other entry point that calls `setGdtPickerOpen(true)`). User clicks a
// symbol, optionally edits the tolerance / modifier / datums, and either
// copies the formatted feature control frame to clipboard or dispatches
// `nexyfab:gdt-pick` so a downstream listener (Drawing surface, dimension
// overlay, etc.) can place it on the sheet.
//
// Phase 2 will wire `nexyfab:gdt-pick` into `AutoDrawingPanel` so the
// chosen frame becomes a draggable annotation on the active drawing.

import { useState } from 'react';
import { useLang } from '../hooks/useLang';
import { loc } from '../lib/loc';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import {
  GDT_MODIFIERS,
  GDT_CATEGORY_LABELS,
  gdtSymbolsByCategory,
  formatFeatureControlFrame,
  type GdtSymbol,
  type FeatureControlFrame,
} from './gdt';

interface Props {
  open: boolean;
  isKo: boolean;
  onClose: () => void;
}

export default function GdtPicker({ open, isKo: _isKo, onClose }: Props) {
  const lang = useLang();
  const L = createCommercialLocalizer(lang);
  const [selected, setSelected] = useState<GdtSymbol | null>(null);
  const [tolerance, setTolerance] = useState(0.1);
  const [modifier, setModifier] = useState<FeatureControlFrame['modifier']>(undefined);
  const [datums, setDatums] = useState<[string, string, string]>(['A', '', '']);
  const [toast, setToast] = useState('');

  if (!open) return null;
  const grouped = gdtSymbolsByCategory();

  const frame: FeatureControlFrame | null = selected ? {
    symbolId: selected.id,
    tolerance,
    modifier: selected.acceptsModifier ? modifier : undefined,
    datums: selected.requiresDatum ? [datums[0] || undefined, datums[1] || undefined, datums[2] || undefined] : undefined,
  } : null;
  const frameText = frame ? formatFeatureControlFrame(frame) : '';

  const handleCopy = async () => {
    if (!frameText) return;
    try {
      await navigator.clipboard.writeText(frameText);
      setToast(loc(lang, { ko: '복사됨', en: 'Copied', ja: 'コピーしました', zh: '已复制', es: 'Copiado', ar: 'تم النسخ' }));
      setTimeout(() => setToast(''), 1200);
    } catch { /* unsecured context */ }
  };

  const handleInsert = () => {
    if (!frame) return;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexyfab:gdt-pick', { detail: { frame, text: frameText } }));
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="GD&T picker"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--nx-panel)', color: 'var(--nx-text)',
        border: '1px solid var(--nx-border)', borderRadius: 12,
        width: 'min(640px, 100%)', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 48px rgba(0,0,0,0.35)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--nx-border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>
            {loc(lang, { ko: 'GD&T 기호 선택', en: 'GD&T symbol picker', ja: 'GD&T 記号の選択', zh: 'GD&T 符号选择', es: 'Selector de símbolos GD&T', ar: 'منتقي رموز GD&T' })}
          </span>
          <button type="button" onClick={onClose} style={{ width: 24, height: 24, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--nx-text-3)' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
          {(Object.keys(grouped) as (keyof typeof grouped)[]).map(cat => (
            <div key={cat} style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'var(--nx-text-3)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                marginBottom: 6,
              }}>
                {/* ⚠ 260802: `isKo ? ko : en` 2분기라 ja·zh·es·ar 이 영어로 떨어졌다. */}
                {loc(lang, GDT_CATEGORY_LABELS[cat])}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
                {grouped[cat].map(s => {
                  const active = selected?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelected(s)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px',
                        background: active ? 'var(--nx-accent-soft)' : 'var(--nx-panel-2)',
                        border: active ? '1px solid var(--nx-accent)' : '1px solid var(--nx-border)',
                        borderRadius: 6,
                        cursor: 'pointer', textAlign: 'left',
                        color: active ? 'var(--nx-accent-2)' : 'var(--nx-text)',
                      }}
                    >
                      <span style={{ fontSize: 16, width: 18, textAlign: 'center' }}>{s.symbol}</span>
                      <span style={{ fontSize: 11 }}>{L(s.nameKo, s.nameEn)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer — params + actions */}
        {selected && (
          <div style={{ borderTop: '1px solid var(--nx-border)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{loc(lang, { ko: '공차', en: 'Tolerance', ja: '公差', zh: '公差', es: 'Tolerancia', ar: 'التفاوت' })}</span>
                <input
                  type="number"
                  step={0.01}
                  min={0.001}
                  value={tolerance}
                  onChange={e => setTolerance(parseFloat(e.target.value) || 0.1)}
                  style={{
                    width: 70, padding: '4px 6px',
                    background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
                    color: 'var(--nx-text)', borderRadius: 4, fontSize: 11,
                  }}
                />
                <span style={{ color: 'var(--nx-text-3)' }}>mm</span>
              </label>

              {selected.acceptsModifier && (
                <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{loc(lang, { ko: '조건', en: 'Modifier', ja: '条件記号', zh: '修饰符', es: 'Modificador', ar: 'مُعدِّل' })}</span>
                  <select
                    value={modifier ?? ''}
                    onChange={e => setModifier((e.target.value || undefined) as FeatureControlFrame['modifier'])}
                    style={{
                      padding: '4px 6px',
                      background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
                      color: 'var(--nx-text)', borderRadius: 4, fontSize: 11,
                    }}
                  >
                    <option value="">—</option>
                    {GDT_MODIFIERS.map(m => (
                      <option key={m.id} value={m.id}>{m.symbol} {L(m.nameKo, m.nameEn)}</option>
                    ))}
                  </select>
                </label>
              )}

              {selected.requiresDatum && (
                <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>{loc(lang, { ko: '데이텀', en: 'Datums', ja: 'データム', zh: '基准', es: 'Datums', ar: 'المراجع' })}</span>
                  {[0, 1, 2].map(i => (
                    <input
                      key={i}
                      type="text"
                      value={datums[i]}
                      onChange={e => {
                        const next: [string, string, string] = [...datums];
                        next[i] = e.target.value.slice(0, 1).toUpperCase();
                        setDatums(next);
                      }}
                      placeholder={i === 0 ? 'A' : ''}
                      maxLength={1}
                      style={{
                        width: 24, padding: '4px 0',
                        background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
                        color: 'var(--nx-text)', borderRadius: 4,
                        fontSize: 11, textAlign: 'center', fontWeight: 600,
                      }}
                    />
                  ))}
                </label>
              )}
            </div>

            {/* Preview */}
            <div style={{
              padding: 10, borderRadius: 6,
              background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
              fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
              fontSize: 16, letterSpacing: '0.05em',
              textAlign: 'center',
              color: 'var(--nx-text)',
              minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {frameText || '—'}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              {toast && <span style={{ fontSize: 11, color: 'var(--nx-ok)' }}>✓ {toast}</span>}
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  padding: '6px 12px', borderRadius: 4,
                  background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
                  color: 'var(--nx-text)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {loc(lang, { ko: '복사', en: 'Copy', ja: 'コピー', zh: '复制', es: 'Copiar', ar: 'نسخ' })}
              </button>
              <button
                type="button"
                onClick={handleInsert}
                style={{
                  padding: '6px 14px', borderRadius: 4,
                  background: 'var(--nx-accent)', border: 'none',
                  color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {loc(lang, { ko: '도면에 삽입 →', en: 'Insert to drawing →', ja: '図面に挿入 →', zh: '插入到图纸 →', es: 'Insertar en plano →', ar: 'إدراج في الرسم →' })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
