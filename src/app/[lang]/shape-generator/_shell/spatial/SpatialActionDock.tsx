'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { DesignDomainId } from '@/lib/ai/domainProfile';
import { dispatchSpatialCadCommand } from './spatialCadCommands';

type SpatialDomain = Exclude<DesignDomainId, 'mechanical'>;
type IconName = 'ai' | 'edit' | 'library' | 'send' | 'building' | 'civil' | 'landscape' | 'interior';
type Locale = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
type ItemKey = 'storey' | 'window' | 'inlet' | 'treeRow' | 'treeColumn' | 'table2' | 'table4' | 'sofa';
type Copy = { ai: string; edit: string; library: string; placeholder: string; send: string; hint: string; items: Record<ItemKey, string> };

// Keep translated UI copy in unicode escapes so this source remains stable on
// Windows checkouts that do not preserve UTF-8 console output.
const COPY: Record<Locale, Copy> = {
  ko: { ai: 'AI \uC785\uB825', edit: '\uC9C1\uC811 \uC218\uC815', library: '\uAC1D\uCCB4 \uAC00\uC838\uC624\uAE30', placeholder: '\uC608: \uCD9C\uC785\uAD6C\uB97C \uB113\uD788\uACE0 \uCC3D\uC744 \uB450 \uAC1C \uB354 \uBC30\uCE58\uD574\uC918', send: '\uB514\uC790\uC778 \uCC44\uD305\uC73C\uB85C \uACC4\uC18D', hint: '\uD604\uC7AC \uBAA8\uB378\uACFC \uAC80\uC99D \uC0C1\uD0DC\uAC00 \uD568\uAED8 \uC804\uB2EC\uB418\uBA70, \uD655\uC778 \uC804\uC5D0\uB294 \uD615\uC0C1\uC744 \uBC14\uAFB8\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.', items: { storey: '\uCE35 \uCD94\uAC00', window: '\uCC3D \uCD94\uAC00', inlet: '\uBC30\uC218\uAD6C \uCD94\uAC00', treeRow: '\uB098\uBB34 \uD589 \uCD94\uAC00', treeColumn: '\uB098\uBB34 \uC5F4 \uCD94\uAC00', table2: '2\uC778 \uD14C\uC774\uBE14', table4: '4\uC778 \uD14C\uC774\uBE14', sofa: '\uC18C\uD30C' } },
  en: { ai: 'AI input', edit: 'Direct edit', library: 'Place objects', placeholder: 'e.g. Widen the entrance and place two more windows', send: 'Continue in design chat', hint: 'The current model and verification state are transferred. Geometry is not changed before confirmation.', items: { storey: 'Add storey', window: 'Add window', inlet: 'Add inlet', treeRow: 'Add tree row', treeColumn: 'Add tree column', table2: '2-seat table', table4: '4-seat table', sofa: 'Sofa' } },
  ja: { ai: 'AI\u5165\u529B', edit: '\u76F4\u63A5\u7DE8\u96C6', library: '\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u914D\u7F6E', placeholder: '\u4F8B\uFF1A\u5165\u53E3\u3092\u5E83\u3052\u3066\u7A93\u30922\u3064\u8FFD\u52A0', send: '\u30C7\u30B6\u30A4\u30F3\u30C1\u30E3\u30C3\u30C8\u3067\u7D9A\u3051\u308B', hint: '\u73FE\u5728\u306E\u30E2\u30C7\u30EB\u3068\u691C\u8A3C\u72B6\u614B\u3092\u5F15\u304D\u7D99\u304E\u307E\u3059\u3002\u78BA\u8A8D\u524D\u306B\u5F62\u72B6\u306F\u5909\u66F4\u3055\u308C\u307E\u305B\u3093\u3002', items: { storey: '\u968E\u3092\u8FFD\u52A0', window: '\u7A93\u3092\u8FFD\u52A0', inlet: '\u6392\u6C34\u53E3\u3092\u8FFD\u52A0', treeRow: '\u6A39\u6728\u306E\u884C\u3092\u8FFD\u52A0', treeColumn: '\u6A39\u6728\u306E\u5217\u3092\u8FFD\u52A0', table2: '2\u4EBA\u7528\u30C6\u30FC\u30D6\u30EB', table4: '4\u4EBA\u7528\u30C6\u30FC\u30D6\u30EB', sofa: '\u30BD\u30D5\u30A1' } },
  zh: { ai: 'AI \u8F93\u5165', edit: '\u76F4\u63A5\u7F16\u8F91', library: '\u653E\u7F6E\u5BF9\u8C61', placeholder: '\u4F8B\u5982\uFF1A\u52A0\u5BBD\u5165\u53E3\u5E76\u518D\u653E\u7F6E\u4E24\u6247\u7A97', send: '\u5728\u8BBE\u8BA1\u5BF9\u8BDD\u4E2D\u7EE7\u7EED', hint: '\u5F53\u524D\u6A21\u578B\u548C\u9A8C\u8BC1\u72B6\u6001\u4F1A\u4E00\u5E76\u4F20\u9012\uFF1B\u786E\u8BA4\u524D\u4E0D\u4F1A\u4FEE\u6539\u51E0\u4F55\u4F53\u3002', items: { storey: '\u6DFB\u52A0\u697C\u5C42', window: '\u6DFB\u52A0\u7A97\u6237', inlet: '\u6DFB\u52A0\u6392\u6C34\u53E3', treeRow: '\u6DFB\u52A0\u6811\u884C', treeColumn: '\u6DFB\u52A0\u6811\u5217', table2: '\u53CC\u4EBA\u684C', table4: '\u56DB\u4EBA\u684C', sofa: '\u6C99\u53D1' } },
  es: { ai: 'Entrada IA', edit: 'Edici\u00F3n directa', library: 'Colocar objetos', placeholder: 'p. ej. Ampl\u00EDa la entrada y coloca dos ventanas m\u00E1s', send: 'Continuar en el chat de dise\u00F1o', hint: 'Se transfieren el modelo y su verificaci\u00F3n. La geometr\u00EDa no cambia antes de confirmar.', items: { storey: 'A\u00F1adir planta', window: 'A\u00F1adir ventana', inlet: 'A\u00F1adir sumidero', treeRow: 'A\u00F1adir fila de \u00E1rboles', treeColumn: 'A\u00F1adir columna de \u00E1rboles', table2: 'Mesa para 2', table4: 'Mesa para 4', sofa: 'Sof\u00E1' } },
  ar: { ai: '\u0625\u062F\u062E\u0627\u0644 \u0628\u0627\u0644\u0630\u0643\u0627\u0621', edit: '\u062A\u062D\u0631\u064A\u0631 \u0645\u0628\u0627\u0634\u0631', library: '\u0648\u0636\u0639 \u0627\u0644\u0639\u0646\u0627\u0635\u0631', placeholder: '\u0645\u062B\u0627\u0644: \u0648\u0633\u0639 \u0627\u0644\u0645\u062F\u062E\u0644 \u0648\u0623\u0636\u0641 \u0646\u0627\u0641\u0630\u062A\u064A\u0646', send: '\u0627\u0644\u0645\u062A\u0627\u0628\u0639\u0629 \u0641\u064A \u0645\u062D\u0627\u062F\u062B\u0629 \u0627\u0644\u062A\u0635\u0645\u064A\u0645', hint: '\u064A\u062A\u0645 \u0646\u0642\u0644 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062D\u0627\u0644\u064A \u0648\u062D\u0627\u0644\u0629 \u0627\u0644\u062A\u062D\u0642\u0642. \u0644\u0627 \u062A\u062A\u063A\u064A\u0631 \u0627\u0644\u0647\u0646\u062F\u0633\u0629 \u0642\u0628\u0644 \u0627\u0644\u062A\u0623\u0643\u064A\u062F.', items: { storey: '\u0625\u0636\u0627\u0641\u0629 \u0637\u0627\u0628\u0642', window: '\u0625\u0636\u0627\u0641\u0629 \u0646\u0627\u0641\u0630\u0629', inlet: '\u0625\u0636\u0627\u0641\u0629 \u0645\u0635\u0631\u0641', treeRow: '\u0625\u0636\u0627\u0641\u0629 \u0635\u0641 \u0623\u0634\u062C\u0627\u0631', treeColumn: '\u0625\u0636\u0627\u0641\u0629 \u0639\u0645\u0648\u062F \u0623\u0634\u062C\u0627\u0631', table2: '\u0637\u0627\u0648\u0644\u0629 \u0644\u0634\u062E\u0635\u064A\u0646', table4: '\u0637\u0627\u0648\u0644\u0629 \u0644\u0623\u0631\u0628\u0639\u0629', sofa: '\u0623\u0631\u064A\u0643\u0629' } },
};

function locale(lang: string): Locale {
  if (lang === 'ko' || lang === 'kr') return 'ko';
  if (lang === 'ja' || lang === 'zh' || lang === 'cn' || lang === 'es' || lang === 'ar') return lang === 'cn' ? 'zh' : lang;
  return 'en';
}

function SpatialIcon({ name }: { name: IconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const body: Record<IconName, ReactNode> = {
    ai: <><path d="M12 2.8l1.15 3.05L16.2 7l-3.05 1.15L12 11.2l-1.15-3.05L7.8 7l3.05-1.15L12 2.8Z"/><path d="M5.5 11.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/></>,
    edit: <><path d="M4 15.8l.7-3.2L13.9 3.4a1.4 1.4 0 0 1 2 2l-9.2 9.2-2.7 1.2Z"/><path d="M11.9 5.4l2.7 2.7"/></>,
    library: <><path d="M3.5 6.5L10 3l6.5 3.5L10 10 3.5 6.5Z"/><path d="M3.5 10L10 13.5l6.5-3.5M3.5 13.5L10 17l6.5-3.5"/></>,
    send: <><path d="M3 4l14 6-14 6 2-6-2-6Z"/><path d="M5 10h7"/></>,
    building: <><path d="M3.5 17V6.5L10 3l6.5 3.5V17"/><path d="M7 17v-4h6v4M7 8h.1M10 8h.1M13 8h.1"/></>,
    civil: <><path d="M3 15h14M5 12l2-7h6l2 7M8 8h4M7 12h6"/></>,
    landscape: <><path d="M10 17v-5M6 12h8L12 9h2l-4-6-4 6h2l-2 3Z"/></>,
    interior: <><path d="M4 10h12v6H4zM6 10V7h8v3M6 16v1.5M14 16v1.5"/></>,
  };
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 20 20" {...common}>{body[name]}</svg>;
}

const ITEMS: Record<SpatialDomain, Array<{ id: string; label: ItemKey }>> = {
  building: [{ id: 'storey', label: 'storey' }, { id: 'window', label: 'window' }],
  civil: [{ id: 'inlet', label: 'inlet' }],
  landscape: [{ id: 'tree-row', label: 'treeRow' }, { id: 'tree-column', label: 'treeColumn' }],
  interior: [{ id: 'table2', label: 'table2' }, { id: 'table4', label: 'table4' }, { id: 'sofa', label: 'sofa' }],
};

export function SpatialActionDock({ domain, lang, onAiDesign }: { domain: SpatialDomain; lang: string; onAiDesign: (instruction?: string) => void }) {
  const t = COPY[locale(lang)];
  const [panel, setPanel] = useState<'ai' | 'library' | null>(null);
  const [instruction, setInstruction] = useState('');
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const rtl = locale(lang) === 'ar';
  const submit = (event: FormEvent) => { event.preventDefault(); onAiDesign(instruction.trim() || undefined); };
  const togglePanel = (next: 'ai' | 'library') => {
    if (panel === null) returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(current => current === next ? null : next);
  };
  useEffect(() => {
    if (panel !== null || !returnFocusRef.current) return;
    returnFocusRef.current.focus();
    returnFocusRef.current = null;
  }, [panel]);
  const action = (id: string, label: string, icon: IconName, onClick: () => void, active = false) => <button type="button" aria-pressed={active || undefined} aria-expanded={id === 'ai' || id === 'library' ? active : undefined} aria-controls={id === 'ai' || id === 'library' ? `spatial-${id}-panel` : undefined} onClick={onClick} title={label} data-testid={`spatial-action-${id}`} style={{ minWidth: 78, minHeight: 48, padding: '5px 10px', border: 0, borderInlineEnd: '1px solid var(--nx-border)', background: active ? 'color-mix(in srgb, var(--nx-accent) 17%, var(--nx-panel))' : 'var(--nx-panel)', color: active ? 'var(--nx-accent)' : 'var(--nx-text)', display: 'grid', placeItems: 'center', gap: 2, cursor: 'pointer', fontSize: 10.5, fontWeight: 750 }}><SpatialIcon name={icon} /><span>{label}</span></button>;
  return <section dir={rtl ? 'rtl' : 'ltr'} aria-label={t.library} data-testid="spatial-action-dock" onKeyDown={event => { if (event.key === 'Escape' && panel !== null) { event.preventDefault(); setPanel(null); } }} style={{ position: 'absolute', insetInlineStart: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 35, maxWidth: 'min(720px, calc(100% - 28px))', color: 'var(--nx-text)' }}>
    {panel === 'ai' && <form id="spatial-ai-panel" onSubmit={submit} style={{ width: 'min(620px, calc(100vw - 34px))', marginBottom: 8, padding: 10, border: '1px solid var(--nx-border)', borderRadius: 10, background: 'var(--nx-panel)', boxShadow: '0 14px 34px rgba(0,0,0,.2)' }}><div style={{ display: 'flex', gap: 7 }}><input autoFocus value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={t.placeholder} aria-label={t.ai} style={{ flex: 1, minWidth: 0, height: 38, paddingInline: 11, border: '1px solid var(--nx-border)', borderRadius: 7, background: 'var(--nx-panel-2)', color: 'var(--nx-text)' }} /><button type="submit" aria-label={t.send} style={{ minWidth: 44, border: 0, borderRadius: 7, background: 'var(--nx-accent)', color: 'var(--nx-on-accent, #fff)', cursor: 'pointer' }}><SpatialIcon name="send" /></button></div><div style={{ marginTop: 6, color: 'var(--nx-text-3)', fontSize: 10.5 }}>{t.hint}</div></form>}
    {panel === 'library' && <div id="spatial-library-panel" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 8, padding: 8, border: '1px solid var(--nx-border)', borderRadius: 10, background: 'var(--nx-panel)', boxShadow: '0 14px 34px rgba(0,0,0,.2)' }}>{ITEMS[domain].map(item => <button key={item.id} type="button" draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-nexyfab-spatial-object', item.id); }} onClick={() => dispatchSpatialCadCommand(`spatial.add.${item.id}`)} style={{ minHeight: 34, padding: '0 11px', border: '1px solid var(--nx-border)', borderRadius: 7, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', cursor: 'grab', fontSize: 11, fontWeight: 700 }}>{t.items[item.label]}</button>)}</div>}
    <div style={{ display: 'flex', width: 'max-content', maxWidth: '100%', overflow: 'hidden', border: '1px solid var(--nx-border)', borderRadius: 11, background: 'var(--nx-panel)', boxShadow: '0 9px 24px rgba(0,0,0,.24)' }}>{action('ai', t.ai, 'ai', () => togglePanel('ai'), panel === 'ai')}{action('edit', t.edit, 'edit', () => dispatchSpatialCadCommand('spatial.dimensions'))}{action('library', t.library, domain, () => togglePanel('library'), panel === 'library')}</div>
  </section>;
}
