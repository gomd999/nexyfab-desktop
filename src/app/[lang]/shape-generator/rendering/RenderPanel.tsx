'use client';

import React, { useRef } from 'react';
import { usePathname } from 'next/navigation';
import type { EnvironmentPreset } from './RenderMode';

/* ─── i18n dict ──────────────────────────────────────────────────────────── */

const dict = {
  ko: { title: '렌더링 설정', envHdri: '환경 (HDRI)', upload: '+ .hdr / .exr 파일 업로드',
        display: '표시 옵션', showBg: '배경 표시', ground: '바닥면',
        ptDesc: '느리지만 사실적', lighting: '조명 & 노출', shadow: '그림자 강도', exposure: '노출',
        capture: '스크린샷 캡처', hiRes: '고해상도 렌더 (4K)',
        studio: '스튜디오', city: '도시', sunset: '일몰', forest: '숲', warehouse: '창고' },
  en: { title: 'Render Settings', envHdri: 'Environment (HDRI)', upload: '+ Upload .hdr / .exr file',
        display: 'Display', showBg: 'Show Background', ground: 'Ground Plane',
        ptDesc: 'Slower but realistic', lighting: 'Lighting & Exposure', shadow: 'Shadow Intensity', exposure: 'Exposure',
        capture: 'Capture Screenshot', hiRes: 'High-Res Render (4K)',
        studio: 'Studio', city: 'City', sunset: 'Sunset', forest: 'Forest', warehouse: 'Warehouse' },
  ja: { title: 'レンダー設定', envHdri: '環境 (HDRI)', upload: '+ .hdr / .exr ファイルをアップロード',
        display: '表示オプション', showBg: '背景表示', ground: '地面',
        ptDesc: '遅いがリアル', lighting: '照明 & 露出', shadow: '影の強度', exposure: '露出',
        capture: 'スクリーンショット', hiRes: '高解像度レンダー (4K)',
        studio: 'スタジオ', city: '都市', sunset: '夕焼け', forest: '森', warehouse: '倉庫' },
  zh: { title: '渲染设置', envHdri: '环境 (HDRI)', upload: '+ 上传 .hdr / .exr 文件',
        display: '显示选项', showBg: '显示背景', ground: '地面',
        ptDesc: '较慢但真实', lighting: '光照 & 曝光', shadow: '阴影强度', exposure: '曝光',
        capture: '截图', hiRes: '高分辨率渲染 (4K)',
        studio: '工作室', city: '城市', sunset: '日落', forest: '森林', warehouse: '仓库' },
  es: { title: 'Configuración de Render', envHdri: 'Entorno (HDRI)', upload: '+ Subir archivo .hdr / .exr',
        display: 'Visualización', showBg: 'Mostrar Fondo', ground: 'Plano de Suelo',
        ptDesc: 'Más lento pero realista', lighting: 'Iluminación & Exposición', shadow: 'Intensidad de Sombra', exposure: 'Exposición',
        capture: 'Capturar Pantalla', hiRes: 'Render Alta Resolución (4K)',
        studio: 'Estudio', city: 'Ciudad', sunset: 'Atardecer', forest: 'Bosque', warehouse: 'Almacén' },
  ar: { title: 'إعدادات التصيير', envHdri: 'البيئة (HDRI)', upload: '+ رفع ملف .hdr / .exr',
        display: 'عرض', showBg: 'إظهار الخلفية', ground: 'مستوى الأرض',
        ptDesc: 'أبطأ لكن واقعي', lighting: 'الإضاءة والتعريض', shadow: 'شدة الظل', exposure: 'التعريض',
        capture: 'التقاط لقطة شاشة', hiRes: 'تصيير عالي الدقة (4K)',
        studio: 'استوديو', city: 'مدينة', sunset: 'غروب', forest: 'غابة', warehouse: 'مستودع' },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export interface RenderSettings {
  environment: EnvironmentPreset;
  showBackground: boolean;
  shadowIntensity: number;
  bloomIntensity: number;
  showGround: boolean;
  exposure: number;
  /** Blob URL of user-uploaded .hdr file */
  customHdriUrl?: string;
  customHdriName?: string;
  /** Whether path tracing mode is on */
  pathTracing?: boolean;
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  environment: 'studio',
  showBackground: false,
  shadowIntensity: 0.4,
  bloomIntensity: 0,
  showGround: true,
  exposure: 1.0,
};

interface RenderPanelProps {
  settings: RenderSettings;
  onChange: (settings: RenderSettings) => void;
  onCapture: () => void;
  onHighResCapture?: () => void;
  lang: string;
}

const ENV_KEYS: { value: EnvironmentPreset; key: 'studio' | 'city' | 'sunset' | 'forest' | 'warehouse' }[] = [
  { value: 'studio',    key: 'studio' },
  { value: 'city',      key: 'city' },
  { value: 'sunset',    key: 'sunset' },
  { value: 'forest',    key: 'forest' },
  { value: 'warehouse', key: 'warehouse' },
];

const toggleStyle = (active: boolean): React.CSSProperties => ({
  width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
  background: active ? '#388bfd' : '#484f58',
  position: 'relative', transition: 'background 0.2s', flexShrink: 0,
});

const knobStyle = (active: boolean): React.CSSProperties => ({
  width: 16, height: 16, borderRadius: '50%', background: '#fff',
  position: 'absolute', top: 2, left: active ? 18 : 2, transition: 'left 0.2s',
});

export default function RenderPanel({ settings, onChange, onCapture, onHighResCapture, lang }: RenderPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const t = dict[langMap[seg] ?? 'en'];
  const hdriInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) =>
    onChange({ ...settings, [key]: value });

  const handleHdriUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Revoke old blob URL to avoid memory leak
    if (settings.customHdriUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(settings.customHdriUrl);
    }
    const url = URL.createObjectURL(file);
    onChange({ ...settings, customHdriUrl: url, customHdriName: file.name });
  };

  const clearHdri = () => {
    if (settings.customHdriUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(settings.customHdriUrl);
    }
    onChange({ ...settings, customHdriUrl: undefined, customHdriName: undefined });
    if (hdriInputRef.current) hdriInputRef.current.value = '';
  };

  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#c9d1d9' };
  const rowStyle: React.CSSProperties = { marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, marginTop: 4 };

  return (
    <div style={{ background: '#21262d', borderRadius: 10, border: '1px solid #30363d', padding: 12 }}>
      {/* Header */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14 }}>🎬</span>
        {t.title}
      </div>

      {/* ─ Environment ─ */}
      <div style={{ ...sectionLabel }}>{t.envHdri}</div>

      {/* Custom HDRI upload */}
      <div style={{ marginBottom: 8 }}>
        <input
          ref={hdriInputRef}
          type="file"
          accept=".hdr,.exr"
          style={{ display: 'none' }}
          onChange={handleHdriUpload}
        />
        {settings.customHdriUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: '5px 8px' }}>
            <span style={{ fontSize: 11, color: '#3fb950', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ✓ {settings.customHdriName ?? 'custom.hdr'}
            </span>
            <button onClick={clearHdri} style={{ fontSize: 10, background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', padding: '0 2px' }}>✕</button>
          </div>
        ) : (
          <button
            onClick={() => hdriInputRef.current?.click()}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px dashed #484f58', background: 'transparent', color: '#8b949e', fontSize: 11, cursor: 'pointer', textAlign: 'center' }}
          >
            {t.upload}
          </button>
        )}
      </div>

      {/* Preset selector (disabled when custom HDRI loaded) */}
      {!settings.customHdriUrl && (
        <div style={{ marginBottom: 10 }}>
          <select
            value={settings.environment}
            onChange={e => update('environment', e.target.value as EnvironmentPreset)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#c9d1d9', fontSize: 12, cursor: 'pointer', outline: 'none' }}
          >
            {ENV_KEYS.map(opt => (
              <option key={opt.value} value={opt.value}>{t[opt.key]}</option>
            ))}
          </select>
        </div>
      )}

      {/* ─ Toggles ─ */}
      <div style={{ ...sectionLabel }}>{t.display}</div>

      <div style={rowStyle}>
        <label style={labelStyle}>{t.showBg}</label>
        <button onClick={() => update('showBackground', !settings.showBackground)} style={toggleStyle(settings.showBackground)}>
          <div style={knobStyle(settings.showBackground)} />
        </button>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>{t.ground}</label>
        <button onClick={() => update('showGround', !settings.showGround)} style={toggleStyle(settings.showGround)}>
          <div style={knobStyle(settings.showGround)} />
        </button>
      </div>

      {/* Path Tracing toggle */}
      <div style={{ ...rowStyle, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Path Tracing</label>
          <div style={{ fontSize: 9, color: '#6e7681', marginTop: 1 }}>{t.ptDesc}</div>
        </div>
        <button onClick={() => update('pathTracing', !settings.pathTracing)} style={toggleStyle(!!settings.pathTracing)}>
          <div style={knobStyle(!!settings.pathTracing)} />
        </button>
      </div>

      {/* ─ Sliders ─ */}
      <div style={{ ...sectionLabel }}>{t.lighting}</div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={labelStyle}>{t.shadow}</label>
          <span style={{ fontSize: 10, color: '#6e7681', fontFamily: 'monospace' }}>{settings.shadowIntensity.toFixed(2)}</span>
        </div>
        <input type="range" min={0} max={1} step={0.05} value={settings.shadowIntensity}
          onChange={e => update('shadowIntensity', parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: '#388bfd', height: 4 }} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={labelStyle}>{t.exposure}</label>
          <span style={{ fontSize: 10, color: '#6e7681', fontFamily: 'monospace' }}>{settings.exposure.toFixed(2)}</span>
        </div>
        <input type="range" min={0.2} max={3} step={0.05} value={settings.exposure}
          onChange={e => update('exposure', parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: '#388bfd', height: 4 }} />
      </div>

      {/* ─ Capture buttons ─ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button onClick={onCapture}
          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #388bfd', background: 'linear-gradient(135deg, #1a2332, #0d1117)', color: '#58a6ff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          onMouseEnter={e => { e.currentTarget.style.background = '#388bfd'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #1a2332, #0d1117)'; e.currentTarget.style.color = '#58a6ff'; }}
        >
          <span>📸</span>{t.capture}
        </button>

        {onHighResCapture && (
          <button onClick={onHighResCapture}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #3fb950', background: 'linear-gradient(135deg, #1a2332, #0d1117)', color: '#3fb950', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#238636'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #1a2332, #0d1117)'; e.currentTarget.style.color = '#3fb950'; }}
          >
            <span>🖼️</span>{t.hiRes}
          </button>
        )}
      </div>
    </div>
  );
}
