'use client';

/**
 * STL export options dialog.
 *
 * Surfaces the unit (mm/cm/m) and origin (as-is/centered/feet-on-floor)
 * settings that the underlying exporter has supported since Round 24.
 * Without this UI the options were unreachable from the main app.
 *
 * Why a small dedicated dialog rather than reusing one of the existing
 * modal frameworks: the export action is a one-shot decision; persisting
 * the choice or routing through a global modal store adds complexity
 * for no gain. The component closes itself on confirm/cancel and sends
 * a single options object up.
 */

import { useState } from 'react';
import { useColorScheme, dialogPalette } from '@/hooks/useColorScheme';

export interface STLExportChoice {
  unit: 'mm' | 'cm' | 'm';
  origin: 'as-is' | 'centered' | 'feet-on-floor';
}

interface Props {
  open: boolean;
  lang?: string;
  onCancel: () => void;
  onConfirm: (choice: STLExportChoice) => void;
}

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict: Record<Lang, {
  title: string; subtitle: string;
  unitLabel: string; originLabel: string;
  unitMm: string; unitCm: string; unitM: string;
  originAsIs: string; originCentered: string; originFeet: string;
  cancel: string; confirm: string;
  hint: string;
}> = {
  ko: {
    title: 'STL 내보내기 옵션',
    subtitle: '단위와 원점 기준을 선택하세요. 기본값은 mm · 원본 위치입니다.',
    unitLabel: '단위',
    originLabel: '원점',
    unitMm: 'mm (CAD/3D프린팅 기본)',
    unitCm: 'cm',
    unitM: 'm (대형 어셈블리)',
    originAsIs: '원본 위치 유지',
    originCentered: '바운딩박스 중심을 원점으로',
    originFeet: '바닥에 안착 (Z=0)',
    cancel: '취소',
    confirm: '내보내기',
    hint: '뷰포트는 영향받지 않습니다. 변환은 다운로드 파일에만 적용됩니다.',
  },
  en: {
    title: 'STL Export Options',
    subtitle: 'Pick the unit and origin convention. Defaults are mm · as-is.',
    unitLabel: 'Unit',
    originLabel: 'Origin',
    unitMm: 'mm (CAD / 3D-printing default)',
    unitCm: 'cm',
    unitM: 'm (large assemblies)',
    originAsIs: 'Keep original position',
    originCentered: 'Center bounding box at origin',
    originFeet: 'Feet on floor (Z=0)',
    cancel: 'Cancel',
    confirm: 'Export',
    hint: 'The viewport is not modified. Transforms apply to the exported file only.',
  },
  ja: {
    title: 'STLエクスポートオプション',
    subtitle: '単位と原点の基準を選択。既定は mm・元位置のまま。',
    unitLabel: '単位',
    originLabel: '原点',
    unitMm: 'mm (CAD・3Dプリント既定)',
    unitCm: 'cm',
    unitM: 'm (大型アセンブリ)',
    originAsIs: '元の位置を維持',
    originCentered: 'バウンディングボックス中心を原点に',
    originFeet: '床に接地 (Z=0)',
    cancel: 'キャンセル',
    confirm: 'エクスポート',
    hint: 'ビューポートは変更されません。変換はファイルのみに適用されます。',
  },
  zh: {
    title: 'STL 导出选项',
    subtitle: '选择单位与原点。默认 mm · 保持原位。',
    unitLabel: '单位',
    originLabel: '原点',
    unitMm: 'mm (CAD/3D打印默认)',
    unitCm: 'cm',
    unitM: 'm (大型装配)',
    originAsIs: '保持原始位置',
    originCentered: '将包围盒中心置于原点',
    originFeet: '底面贴地 (Z=0)',
    cancel: '取消',
    confirm: '导出',
    hint: '视口不受影响，变换仅应用于导出的文件。',
  },
  es: {
    title: 'Opciones de exportación STL',
    subtitle: 'Elige unidad y origen. Predeterminado: mm · sin cambios.',
    unitLabel: 'Unidad',
    originLabel: 'Origen',
    unitMm: 'mm (predeterminado CAD/3D)',
    unitCm: 'cm',
    unitM: 'm (grandes ensamblajes)',
    originAsIs: 'Mantener posición original',
    originCentered: 'Centrar caja delimitadora en el origen',
    originFeet: 'Apoyo en el suelo (Z=0)',
    cancel: 'Cancelar',
    confirm: 'Exportar',
    hint: 'El visor no cambia. Las transformaciones solo se aplican al archivo.',
  },
  ar: {
    title: 'خيارات تصدير STL',
    subtitle: 'اختر الوحدة والأصل. الافتراضي: مم · بدون تغيير.',
    unitLabel: 'الوحدة',
    originLabel: 'الأصل',
    unitMm: 'مم (افتراضي CAD/3D)',
    unitCm: 'سم',
    unitM: 'م (تجميعات كبيرة)',
    originAsIs: 'الاحتفاظ بالموضع الأصلي',
    originCentered: 'توسيط المربع المحيط في الأصل',
    originFeet: 'الاستقرار على الأرضية (Z=0)',
    cancel: 'إلغاء',
    confirm: 'تصدير',
    hint: 'لا تتأثر نافذة العرض. التحويلات تنطبق على الملف فقط.',
  },
};

const langMap: Record<string, Lang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export default function STLExportDialog({ open, lang = 'en', onCancel, onConfirm }: Props) {
  const [unit, setUnit] = useState<STLExportChoice['unit']>('mm');
  const [origin, setOrigin] = useState<STLExportChoice['origin']>('as-is');
  const t = dict[langMap[lang] ?? 'en'];
  // Round 37: respect prefers-color-scheme so the dialog isn't dark-on-bright
  // when the user's OS is in light mode (common during outdoor / coffee-shop
  // use). Palette uses high-enough contrast to keep WCAG AA either way.
  const scheme = useColorScheme();
  const p = dialogPalette(scheme);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      style={{
        position: 'fixed', inset: 0, zIndex: 9400,
        background: p.overlay, backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: p.bg, border: `1px solid ${p.border}`,
          borderRadius: 12, padding: '24px 22px', width: 380,
          fontFamily: 'system-ui, sans-serif',
          color: p.textPrimary,
          boxShadow: scheme === 'light'
            ? '0 20px 48px rgba(15,23,42,0.18)'
            : '0 20px 48px rgba(0,0,0,0.55)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t.title}</div>
          <div style={{ fontSize: 12, color: p.textSecondary }}>{t.subtitle}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--nx-text)', marginBottom: 6 }}>{t.unitLabel}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { v: 'mm' as const, label: t.unitMm },
              { v: 'cm' as const, label: t.unitCm },
              { v: 'm' as const,  label: t.unitM },
            ].map(o => (
              <label key={o.v} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 6,
                background: unit === o.v ? '#1f2937' : 'transparent',
                border: `1px solid ${unit === o.v ? 'var(--nx-accent)' : 'var(--nx-panel-2)'}`,
                cursor: 'pointer', fontSize: 13,
              }}>
                <input
                  type="radio" name="stl-unit" value={o.v}
                  checked={unit === o.v}
                  onChange={() => setUnit(o.v)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--nx-text)', marginBottom: 6 }}>{t.originLabel}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { v: 'as-is' as const,         label: t.originAsIs },
              { v: 'centered' as const,      label: t.originCentered },
              { v: 'feet-on-floor' as const, label: t.originFeet },
            ].map(o => (
              <label key={o.v} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 6,
                background: origin === o.v ? '#1f2937' : 'transparent',
                border: `1px solid ${origin === o.v ? 'var(--nx-accent)' : 'var(--nx-panel-2)'}`,
                cursor: 'pointer', fontSize: 13,
              }}>
                <input
                  type="radio" name="stl-origin" value={o.v}
                  checked={origin === o.v}
                  onChange={() => setOrigin(o.v)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--nx-text-3)', marginBottom: 16 }}>{t.hint}</div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button" onClick={onCancel}
            style={{
              padding: '7px 14px', borderRadius: 6,
              background: 'transparent', color: 'var(--nx-text)',
              border: '1px solid var(--nx-border)', cursor: 'pointer', fontSize: 13,
            }}
          >{t.cancel}</button>
          <button
            type="button" onClick={() => onConfirm({ unit, origin })}
            style={{
              padding: '7px 14px', borderRadius: 6,
              background: 'var(--nx-accent)', color: 'var(--nx-text)',
              border: '1px solid var(--nx-accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >{t.confirm}</button>
        </div>
      </div>
    </div>
  );
}
