'use client';

import React, { useState } from 'react';

export interface PropertyManagerProps {
  visible: boolean;
  lang: string;
  selectedFeatureId: string | null;
  featureName: string;
  featureType: string;
  featureParams: Record<string, number>;
  paramDefs: { name: string; label: string; min?: number; max?: number; step?: number }[];
  onParamChange: (param: string, value: number) => void;
  onClose: () => void;
  onApply: () => void;
}

const L: Record<string, Record<string, string>> = {
  ko: { params: '매개변수', info: '정보', type: '유형', apply: '적용', close: '닫기',
    extrude: '돌출', cut: '컷', fillet: '필렛', chamfer: '챔퍼', hole: '구멍',
    shell: '쉘', revolve: '회전', sweep: '스윕', loft: '로프트', mirror: '대칭',
    pattern: '패턴', thread: '나사산', draft: '구배', rib: '리브',
    sketchExtrude: '스케치 돌출', boolean: '부울 연산' },
  en: { params: 'Parameters', info: 'Info', type: 'Type', apply: 'Apply', close: 'Close',
    extrude: 'Extrude', cut: 'Cut', fillet: 'Fillet', chamfer: 'Chamfer', hole: 'Hole',
    shell: 'Shell', revolve: 'Revolve', sweep: 'Sweep', loft: 'Loft', mirror: 'Mirror',
    pattern: 'Pattern', thread: 'Thread', draft: 'Draft', rib: 'Rib',
    sketchExtrude: 'Sketch Extrude', boolean: 'Boolean' },
  ja: { params: 'パラメータ', info: '情報', type: 'タイプ', apply: '適用', close: '閉じる',
    extrude: '押し出し', cut: 'カット', fillet: 'フィレット', chamfer: '面取り', hole: '穴',
    shell: 'シェル', revolve: '回転', sweep: 'スイープ', loft: 'ロフト', mirror: 'ミラー',
    pattern: 'パターン', thread: 'ねじ山', draft: '勾配', rib: 'リブ',
    sketchExtrude: 'スケッチ押し出し', boolean: 'ブーリアン' },
  cn: { params: '参数', info: '信息', type: '类型', apply: '应用', close: '关闭',
    extrude: '拉伸', cut: '切除', fillet: '圆角', chamfer: '倒角', hole: '孔',
    shell: '抽壳', revolve: '旋转', sweep: '扫掠', loft: '放样', mirror: '镜像',
    pattern: '阵列', thread: '螺纹', draft: '拔模', rib: '筋',
    sketchExtrude: '草图拉伸', boolean: '布尔运算' },
  es: { params: 'Parámetros', info: 'Información', type: 'Tipo', apply: 'Aplicar', close: 'Cerrar',
    extrude: 'Extruir', cut: 'Cortar', fillet: 'Redondeo', chamfer: 'Chaflán', hole: 'Agujero',
    shell: 'Vaciado', revolve: 'Revolución', sweep: 'Barrido', loft: 'Recubrir', mirror: 'Simetría',
    pattern: 'Patrón', thread: 'Rosca', draft: 'Ángulo de desmoldeo', rib: 'Nervio',
    sketchExtrude: 'Extruir Boceto', boolean: 'Booleano' },
  ar: { params: 'المعاملات', info: 'معلومات', type: 'النوع', apply: 'تطبيق', close: 'إغلاق',
    extrude: 'بثق', cut: 'قطع', fillet: 'تقريب', chamfer: 'شطف', hole: 'ثقب',
    shell: 'تجويف', revolve: 'دوران', sweep: 'مسح', loft: 'تشكيل', mirror: 'انعكاس',
    pattern: 'نمط', thread: 'لولب', draft: 'ميل', rib: 'ضلع',
    sketchExtrude: 'بثق الرسم', boolean: 'عملية منطقية' },
};

function t(lang: string, key: string): string {
  return (L[lang] ?? L.en)[key] ?? (L.en[key] ?? key);
}

const FEATURE_ICONS: Record<string, string> = {
  extrude: '⬆️', cut: '✂️', fillet: '◠', chamfer: '◢', hole: '⊙',
  shell: '⊡', revolve: '🔄', sweep: '〰️', loft: '◈', mirror: '🪞',
  pattern: '⊞', thread: '🔩', draft: '◣', rib: '▭',
  sketchExtrude: '✏️', boolean: '⊕',
};

export default function PropertyManager({
  visible, lang, selectedFeatureId, featureName, featureType,
  featureParams, paramDefs, onParamChange, onClose, onApply,
}: PropertyManagerProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!visible || !selectedFeatureId) return null;

  const typeLabel = t(lang, featureType);

  return (
    <div style={{
      position: 'absolute', top: 8, right: 8, width: 260, zIndex: 50,
      background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column', maxHeight: 'calc(100% - 16px)',
      overflow: 'hidden',
      direction: lang === 'ar' ? 'rtl' : 'ltr',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '10px 12px', borderBottom: '1px solid #21262d',
        background: 'rgba(56,139,253,0.06)',
      }}>
        <span style={{ fontSize: 16 }}>{FEATURE_ICONS[featureType] || '⬡'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>{featureName}</div>
          <div style={{ fontSize: 10, color: '#6e7681' }}>{typeLabel}</div>
        </div>
        <button onClick={onClose} style={{
          width: 20, height: 20, borderRadius: 4, border: 'none', background: 'transparent',
          color: '#6e7681', fontSize: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>✕</button>
      </div>

      {/* Parameters */}
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, cursor: 'pointer' }}
          onClick={() => setCollapsed(c => ({ ...c, params: !c.params }))}>
          <span style={{ fontSize: 8, color: '#6e7681' }}>{collapsed.params ? '▶' : '▼'}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase' }}>
            {t(lang, 'params')}
          </span>
          <div style={{ flex: 1, height: 1, background: '#21262d' }} />
        </div>

        {!collapsed.params && paramDefs.map(def => {
          const value = featureParams[def.name] ?? 0;
          return (
            <div key={def.name} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: '#8b949e' }}>{def.label}</label>
                <input type="number" value={value} min={def.min} max={def.max} step={def.step ?? 1}
                  onChange={e => onParamChange(def.name, parseFloat(e.target.value) || 0)}
                  style={{
                    width: 60, padding: '2px 6px', borderRadius: 4,
                    border: '1px solid #30363d', background: '#0d1117',
                    color: '#c9d1d9', fontSize: 11, fontWeight: 700,
                    fontFamily: 'ui-monospace, monospace', textAlign: 'right',
                  }}
                />
              </div>
              {def.min !== undefined && def.max !== undefined && (
                <input type="range" min={def.min} max={def.max} step={def.step ?? 1} value={value}
                  onChange={e => onParamChange(def.name, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#388bfd', height: 3 }} />
              )}
            </div>
          );
        })}

        {/* Info section */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, marginBottom: 6, cursor: 'pointer' }}
          onClick={() => setCollapsed(c => ({ ...c, info: !c.info }))}>
          <span style={{ fontSize: 8, color: '#6e7681' }}>{collapsed.info ? '▶' : '▼'}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase' }}>
            {t(lang, 'info')}
          </span>
          <div style={{ flex: 1, height: 1, background: '#21262d' }} />
        </div>

        {!collapsed.info && (
          <div style={{ padding: '4px 8px', background: '#0d1117', borderRadius: 6, fontSize: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span style={{ color: '#6e7681' }}>ID</span>
              <span style={{ color: '#484f58', fontFamily: 'monospace' }}>{selectedFeatureId?.slice(0, 8)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span style={{ color: '#6e7681' }}>{t(lang, 'type')}</span>
              <span style={{ color: '#484f58', fontFamily: 'monospace' }}>{featureType}</span>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid #21262d' }}>
        <button onClick={onApply} style={{
          flex: 1, padding: '6px 0', borderRadius: 6, border: 'none',
          background: '#388bfd', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}>{t(lang, 'apply')}</button>
        <button onClick={onClose} style={{
          padding: '6px 12px', borderRadius: 6, border: '1px solid #30363d',
          background: 'transparent', color: '#8b949e', fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}>{t(lang, 'close')}</button>
      </div>
    </div>
  );
}
