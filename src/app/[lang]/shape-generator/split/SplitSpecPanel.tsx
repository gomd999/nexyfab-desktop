'use client';

/**
 * Split-screen spec/parameter mirror.
 *
 * `splitMode === 'side-spec'` shows a read-only summary of the current scene
 * (selected shape, parameters, feature count) on the left of the 3D viewport.
 *
 * Use case: power users keep the spec readable while orbiting/measuring on
 * the right; CAD pros don't have to keep flicking the right panel open.
 *
 * Why a separate component (and not the existing right panel):
 *   - The right panel mixes editing controls + viewport chrome. We only need
 *     the *displayed* values here, not the controls.
 *   - Avoids weird scroll-jacking that would happen if we duplicated a
 *     stateful editing widget.
 */

import { useSceneStore } from '../store/sceneStore';

type LangKey = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
const langMap: Record<string, LangKey> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};
const dict: Record<LangKey, {
  title: string;
  shape: string;
  material: string;
  parameters: string;
  noShape: string;
  exportSheet: string;
  generatedAt: string;
  close: string;
}> = {
  ko: { title: '시방',     shape: '형상',     material: '재질',  parameters: '파라미터', noShape: '아직 형상이 없습니다.', exportSheet: '시방 시트',         generatedAt: '생성', close: '닫기' },
  en: { title: 'Spec',     shape: 'Shape',    material: 'Material', parameters: 'Parameters', noShape: 'No shape selected yet.', exportSheet: 'Export sheet',   generatedAt: 'Generated', close: 'Close' },
  ja: { title: '仕様',     shape: '形状',     material: '材料',  parameters: 'パラメータ', noShape: '形状がまだありません。', exportSheet: '仕様書',             generatedAt: '生成日時', close: '閉じる' },
  zh: { title: '规格',     shape: '形状',     material: '材料',  parameters: '参数',     noShape: '尚未选择形状。',         exportSheet: '导出规格',           generatedAt: '生成时间', close: '关闭' },
  es: { title: 'Espec.',   shape: 'Forma',    material: 'Material', parameters: 'Parámetros', noShape: 'Aún no hay forma.', exportSheet: 'Exportar ficha',  generatedAt: 'Generado', close: 'Cerrar' },
  ar: { title: 'مواصفات',   shape: 'الشكل',    material: 'المادة', parameters: 'المعاملات', noShape: 'لم يتم اختيار شكل بعد.', exportSheet: 'تصدير ورقة',     generatedAt: 'تم التوليد', close: 'إغلاق' },
};

interface Props {
  lang?: string;
  onClose: () => void;
}

export default function SplitSpecPanel({ lang = 'en', onClose }: Props) {
  const t = dict[langMap[lang] ?? 'en'];
  // Subscribe to the live scene state — render whatever the user is doing
  // in the main viewport. Read-only.
  const selectedId = useSceneStore(s => s.selectedId);
  const params = useSceneStore(s => s.params);
  const materialId = useSceneStore(s => s.materialId);

  const paramRows = Object.entries(params)
    .filter(([, v]) => Number.isFinite(v))
    .sort(([a], [b]) => a.localeCompare(b));

  // Build a printable HTML spec sheet and stream it to a hidden iframe so the
  // user can use the browser's "Print → Save as PDF" without us shipping a
  // PDF library. Keeps the sheet self-contained and copy-pasteable.
  const handleExportSheet = () => {
    if (!selectedId) return;
    const stamp = new Date().toLocaleString();
    const escape = (s: string) => s.replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
    ));
    const rows = paramRows.map(([k, v]) =>
      `<tr><td>${escape(k)}</td><td style="text-align:right">${typeof v === 'number' ? (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)) : escape(String(v))}</td></tr>`,
    ).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(t.title)} — ${escape(selectedId)}</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 32px auto; color: #0f172a; padding: 0 24px; }
        h1 { font-size: 22px; margin: 0 0 6px; }
        .meta { color: #64748b; font-size: 12px; margin-bottom: 24px; }
        section { margin-bottom: 18px; }
        h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; margin: 0 0 6px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        td { padding: 6px 0; border-bottom: 1px solid #e2e8f0; }
        td:first-child { color: #64748b; font-family: monospace; }
        .footer { color: #94a3b8; font-size: 11px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
      </style></head><body>
      <h1>${escape(t.title)} — ${escape(selectedId)}</h1>
      <div class="meta">${escape(t.generatedAt)}: ${escape(stamp)} · NexyFab</div>
      <section><h2>${escape(t.material)}</h2><div>${escape(materialId || '—')}</div></section>
      <section><h2>${escape(t.parameters)}</h2>
        <table>${rows || `<tr><td colspan="2">—</td></tr>`}</table>
      </section>
      <div class="footer">nexyfab.com</div>
      <script>window.onload = () => { setTimeout(() => window.print(), 200); };</script>
      </body></html>`;
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  return (
    <aside
      style={{
        position: 'absolute', top: 0, left: 0, bottom: 0,
        width: 320, zIndex: 20,
        background: 'rgba(13,17,23,0.92)',
        borderRight: '1px solid var(--nx-border)',
        display: 'flex', flexDirection: 'column',
        backdropFilter: 'blur(4px)',
        color: 'var(--nx-text)',
      }}
    >
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid var(--nx-border)',
        fontSize: 12, fontWeight: 700, color: 'var(--nx-text)',
      }}>
        <span>📐 {t.title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={handleExportSheet}
            disabled={!selectedId}
            style={{
              fontSize: 11, color: 'var(--nx-text-2)', background: 'none',
              border: '1px solid var(--nx-border)', borderRadius: 4,
              cursor: selectedId ? 'pointer' : 'default',
              padding: '2px 8px', opacity: selectedId ? 1 : 0.5,
            }}
            title={t.exportSheet}
          >⬇ {t.exportSheet}</button>
          <button
            onClick={onClose}
            style={{
              fontSize: 12, color: 'var(--nx-text-2)', background: 'none',
              border: 'none', cursor: 'pointer', padding: 4,
            }}
            aria-label={t.close}
          >×</button>
        </span>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 18px', fontFamily: 'monospace', fontSize: 12 }}>
        {!selectedId ? (
          <div style={{ color: 'var(--nx-text-2)', fontStyle: 'italic' }}>{t.noShape}</div>
        ) : (
          <>
            <section style={{ marginBottom: 14 }}>
              <div style={{ color: 'var(--nx-text-2)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                {t.shape}
              </div>
              <div style={{ color: 'var(--nx-text)', fontSize: 14, fontWeight: 700 }}>{selectedId}</div>
            </section>

            <section style={{ marginBottom: 14 }}>
              <div style={{ color: 'var(--nx-text-2)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                {t.material}
              </div>
              <div>{materialId || '—'}</div>
            </section>

            <section>
              <div style={{ color: 'var(--nx-text-2)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                {t.parameters}
              </div>
              {paramRows.length === 0 ? (
                <div style={{ color: 'var(--nx-text-3)', fontStyle: 'italic' }}>—</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {paramRows.map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: '1px solid var(--nx-panel-2)' }}>
                        <td style={{ padding: '4px 0', color: 'var(--nx-text-2)' }}>{k}</td>
                        <td style={{ padding: '4px 0', textAlign: 'right', color: 'var(--nx-text)' }}>
                          {typeof v === 'number' ? v.toFixed(v % 1 === 0 ? 0 : 2) : String(v)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
