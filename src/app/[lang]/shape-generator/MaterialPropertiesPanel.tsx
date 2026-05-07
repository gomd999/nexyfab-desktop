'use client';

import React, { useRef } from 'react';
import { usePathname } from 'next/navigation';

export type EnvPreset =
  | 'apartment' | 'city' | 'dawn' | 'forest' | 'lobby'
  | 'night' | 'park' | 'studio' | 'sunset' | 'warehouse';

export interface MaterialOverride {
  color?: string;
  metalness?: number;
  roughness?: number;
  envMapIntensity?: number;
  /** Texture map URLs (blob: or data:) */
  normalMapUrl?: string;
  roughnessMapUrl?: string;
  metalnessMapUrl?: string;
  aoMapUrl?: string;
  displacementMapUrl?: string;
  normalScale?: number;
  displacementScale?: number;
}

interface MaterialPropertiesPanelProps {
  override: MaterialOverride;
  onOverrideChange: (next: MaterialOverride) => void;
  envPreset: EnvPreset;
  onEnvPresetChange: (p: EnvPreset) => void;
  presetName?: string;
  onReset: () => void;
  lang: string;
}

/* ─── i18n dict ────────────────────────────────────────────────────────────── */

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict = {
  ko: {
    title: '재료 프리뷰',
    livePreview: '실시간 미리보기',
    metallic: '금속',
    semiMetal: '반금속',
    dielectric: '비금속',
    color: '색상',
    metalnessLabel: '금속성 (Metalness)',
    roughnessLabel: '거칠기 (Roughness)',
    envIntensity: '환경광 강도',
    textureMaps: '텍스처 맵',
    normalMap: '노멀맵',
    normalScale: '노멀 강도',
    roughnessMap: '러프니스맵',
    metalnessMap: '메탈릭맵',
    aoMap: 'AO맵',
    displacementMap: '변위맵',
    displacementScale: '변위 강도',
    environment: '환경 프리셋 (HDR)',
    resetToPreset: '프리셋으로 초기화',
    applied: '✓ 적용됨',
    upload: '+ 업로드',
    studioCat: '스튜디오',
    outdoorCat: '실외',
    industrialCat: '산업',
    studio: '스튜디오',
    lobby: '로비',
    apartment: '실내',
    city: '도시',
    park: '공원',
    forest: '숲',
    dawn: '새벽',
    sunset: '석양',
    night: '야간',
    warehouse: '창고',
  },
  en: {
    title: 'Material Preview',
    livePreview: 'Live Preview',
    metallic: 'Metallic',
    semiMetal: 'Semi-metal',
    dielectric: 'Dielectric',
    color: 'Color',
    metalnessLabel: 'Metalness',
    roughnessLabel: 'Roughness',
    envIntensity: 'Env Intensity',
    textureMaps: 'Texture Maps',
    normalMap: 'Normal Map',
    normalScale: 'Normal Scale',
    roughnessMap: 'Roughness Map',
    metalnessMap: 'Metalness Map',
    aoMap: 'AO Map',
    displacementMap: 'Displacement Map',
    displacementScale: 'Displacement Scale',
    environment: 'Environment (HDR)',
    resetToPreset: 'Reset to Preset',
    applied: '✓ Applied',
    upload: '+ Upload',
    studioCat: 'Studio',
    outdoorCat: 'Outdoor',
    industrialCat: 'Industrial',
    studio: 'Studio',
    lobby: 'Lobby',
    apartment: 'Apartment',
    city: 'City',
    park: 'Park',
    forest: 'Forest',
    dawn: 'Dawn',
    sunset: 'Sunset',
    night: 'Night',
    warehouse: 'Warehouse',
  },
  ja: {
    title: 'マテリアルプレビュー',
    livePreview: 'リアルタイムプレビュー',
    metallic: '金属',
    semiMetal: '半金属',
    dielectric: '非金属',
    color: 'カラー',
    metalnessLabel: 'メタリック (Metalness)',
    roughnessLabel: 'ラフネス (Roughness)',
    envIntensity: '環境光の強さ',
    textureMaps: 'テクスチャマップ',
    normalMap: 'ノーマルマップ',
    normalScale: 'ノーマル強度',
    roughnessMap: 'ラフネスマップ',
    metalnessMap: 'メタリックマップ',
    aoMap: 'AO マップ',
    displacementMap: 'ディスプレイスメントマップ',
    displacementScale: 'ディスプレイス強度',
    environment: '環境プリセット (HDR)',
    resetToPreset: 'プリセットへリセット',
    applied: '✓ 適用済み',
    upload: '+ アップロード',
    studioCat: 'スタジオ',
    outdoorCat: '屋外',
    industrialCat: '産業',
    studio: 'スタジオ',
    lobby: 'ロビー',
    apartment: '室内',
    city: '都市',
    park: '公園',
    forest: '森',
    dawn: '夜明け',
    sunset: '夕焼け',
    night: '夜',
    warehouse: '倉庫',
  },
  zh: {
    title: '材质预览',
    livePreview: '实时预览',
    metallic: '金属',
    semiMetal: '半金属',
    dielectric: '非金属',
    color: '颜色',
    metalnessLabel: '金属度 (Metalness)',
    roughnessLabel: '粗糙度 (Roughness)',
    envIntensity: '环境光强度',
    textureMaps: '纹理贴图',
    normalMap: '法线贴图',
    normalScale: '法线强度',
    roughnessMap: '粗糙度贴图',
    metalnessMap: '金属度贴图',
    aoMap: 'AO 贴图',
    displacementMap: '置换贴图',
    displacementScale: '置换强度',
    environment: '环境预设 (HDR)',
    resetToPreset: '重置为预设',
    applied: '✓ 已应用',
    upload: '+ 上传',
    studioCat: '工作室',
    outdoorCat: '户外',
    industrialCat: '工业',
    studio: '工作室',
    lobby: '大厅',
    apartment: '室内',
    city: '城市',
    park: '公园',
    forest: '森林',
    dawn: '黎明',
    sunset: '日落',
    night: '夜晚',
    warehouse: '仓库',
  },
  es: {
    title: 'Vista de material',
    livePreview: 'Vista previa en vivo',
    metallic: 'Metálico',
    semiMetal: 'Semi-metal',
    dielectric: 'Dieléctrico',
    color: 'Color',
    metalnessLabel: 'Metalicidad (Metalness)',
    roughnessLabel: 'Rugosidad (Roughness)',
    envIntensity: 'Intensidad ambiental',
    textureMaps: 'Mapas de textura',
    normalMap: 'Mapa normal',
    normalScale: 'Escala normal',
    roughnessMap: 'Mapa de rugosidad',
    metalnessMap: 'Mapa metálico',
    aoMap: 'Mapa AO',
    displacementMap: 'Mapa de desplazamiento',
    displacementScale: 'Escala de desplazamiento',
    environment: 'Entorno (HDR)',
    resetToPreset: 'Restablecer preset',
    applied: '✓ Aplicado',
    upload: '+ Subir',
    studioCat: 'Estudio',
    outdoorCat: 'Exterior',
    industrialCat: 'Industrial',
    studio: 'Estudio',
    lobby: 'Vestíbulo',
    apartment: 'Interior',
    city: 'Ciudad',
    park: 'Parque',
    forest: 'Bosque',
    dawn: 'Amanecer',
    sunset: 'Atardecer',
    night: 'Noche',
    warehouse: 'Almacén',
  },
  ar: {
    title: 'معاينة المادة',
    livePreview: 'معاينة فورية',
    metallic: 'معدني',
    semiMetal: 'شبه معدني',
    dielectric: 'غير معدني',
    color: 'اللون',
    metalnessLabel: 'المعدنية (Metalness)',
    roughnessLabel: 'الخشونة (Roughness)',
    envIntensity: 'شدة الإضاءة المحيطة',
    textureMaps: 'خرائط النسيج',
    normalMap: 'خريطة نورمال',
    normalScale: 'شدة النورمال',
    roughnessMap: 'خريطة الخشونة',
    metalnessMap: 'خريطة المعدنية',
    aoMap: 'خريطة AO',
    displacementMap: 'خريطة الإزاحة',
    displacementScale: 'شدة الإزاحة',
    environment: 'قوالب البيئة (HDR)',
    resetToPreset: 'إعادة ضبط إلى القالب',
    applied: '✓ تم التطبيق',
    upload: '+ رفع',
    studioCat: 'استوديو',
    outdoorCat: 'خارجي',
    industrialCat: 'صناعي',
    studio: 'استوديو',
    lobby: 'ردهة',
    apartment: 'داخلي',
    city: 'مدينة',
    park: 'حديقة',
    forest: 'غابة',
    dawn: 'فجر',
    sunset: 'غروب',
    night: 'ليل',
    warehouse: 'مستودع',
  },
} as const;

const langMap: Record<string, Lang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

type PresetKey = 'studio' | 'lobby' | 'apartment' | 'city' | 'park' | 'forest' | 'dawn' | 'sunset' | 'night' | 'warehouse';
type CategoryKey = 'studioCat' | 'outdoorCat' | 'industrialCat';

interface EnvPresetGroup {
  categoryKey: CategoryKey;
  items: { id: EnvPreset; icon: string; labelKey: PresetKey }[];
}

const ENV_PRESET_GROUPS: EnvPresetGroup[] = [
  {
    categoryKey: 'studioCat',
    items: [
      { id: 'studio',    icon: '💡', labelKey: 'studio' },
      { id: 'lobby',     icon: '🏛️', labelKey: 'lobby' },
      { id: 'apartment', icon: '🛋️', labelKey: 'apartment' },
    ],
  },
  {
    categoryKey: 'outdoorCat',
    items: [
      { id: 'city',    icon: '🏙️', labelKey: 'city' },
      { id: 'park',    icon: '🌳', labelKey: 'park' },
      { id: 'forest',  icon: '🌲', labelKey: 'forest' },
      { id: 'dawn',    icon: '🌅', labelKey: 'dawn' },
      { id: 'sunset',  icon: '🌇', labelKey: 'sunset' },
      { id: 'night',   icon: '🌃', labelKey: 'night' },
    ],
  },
  {
    categoryKey: 'industrialCat',
    items: [
      { id: 'warehouse', icon: '🏭', labelKey: 'warehouse' },
    ],
  },
];

type TextureMapKey = 'normalMapUrl' | 'roughnessMapUrl' | 'metalnessMapUrl' | 'aoMapUrl' | 'displacementMapUrl';

export default function MaterialPropertiesPanel({
  override,
  onOverrideChange,
  envPreset,
  onEnvPresetChange,
  presetName,
  onReset,
  lang,
}: MaterialPropertiesPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const tt = dict[langMap[seg] ?? 'en'];

  const inputRefs = useRef<Partial<Record<TextureMapKey, HTMLInputElement | null>>>({});

  const set = (key: keyof MaterialOverride, value: string | number | undefined) =>
    onOverrideChange({ ...override, [key]: value });

  const handleTextureUpload = (key: TextureMapKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const old = override[key];
    if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(file);
    onOverrideChange({ ...override, [key]: url });
  };

  const clearTexture = (key: TextureMapKey) => {
    const old = override[key];
    if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
    const next = { ...override };
    delete next[key];
    onOverrideChange(next);
    const el = inputRefs.current[key];
    if (el) el.value = '';
  };

  const panelStyle: React.CSSProperties = {
    position: 'fixed', top: 60, right: 20, zIndex: 500, width: 260,
    maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
    backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 12,
    color: '#e6edf3', fontFamily: 'sans-serif', fontSize: 13,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  };

  const sectionTitle: React.CSSProperties = {
    fontWeight: 700, fontSize: 10, color: '#8b949e',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, marginTop: 10,
  };

  const sliderRow = (label: string, key: 'metalness' | 'roughness' | 'envMapIntensity' | 'normalScale' | 'displacementScale', min: number, max: number, step: number, defaultVal: number) => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...sectionTitle, marginTop: 0, marginBottom: 0 }}>{label}</span>
        <span style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11 }}>
          {(override[key] ?? defaultVal).toFixed(2)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step}
        value={override[key] ?? defaultVal}
        onChange={e => set(key, parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#58a6ff', cursor: 'pointer', marginTop: 3 }} />
    </div>
  );

  const textureRow = (label: string, key: TextureMapKey) => {
    const url = override[key];
    return (
      <div style={{ marginBottom: 6 }}>
        <input
          type="file" accept="image/*" style={{ display: 'none' }}
          ref={el => { inputRefs.current[key] = el; }}
          onChange={handleTextureUpload(key)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#8b949e', minWidth: 80 }}>{label}</span>
          {url ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, padding: '3px 6px' }}>
              <span style={{ fontSize: 10, color: '#3fb950', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tt.applied}</span>
              <button onClick={() => clearTexture(key)} style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 10, padding: 0 }}>✕</button>
            </div>
          ) : (
            <button
              onClick={() => inputRefs.current[key]?.click()}
              style={{ flex: 1, padding: '3px 6px', borderRadius: 5, border: '1px dashed #484f58', background: 'transparent', color: '#6e7681', fontSize: 10, cursor: 'pointer' }}
            >
              {tt.upload}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #30363d', fontWeight: 600, fontSize: 13 }}>
        <span>🎨 {tt.title}</span>
        {presetName && <span style={{ fontSize: 10, color: '#8b949e', fontWeight: 400 }}>{presetName}</span>}
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* ─ Live preview swatch ─ */}
        {(() => {
          const baseColor = override.color ?? '#888';
          const metal = Math.max(0, Math.min(1, override.metalness ?? 0));
          const rough = Math.max(0, Math.min(1, override.roughness ?? 0.5));
          // Sharper highlight when smoother (low roughness) AND when more metallic
          const highlightSize = 35 + rough * 50; // 35% (sharp) → 85% (diffuse)
          const highlightAlpha = 0.45 + (1 - rough) * 0.5 + metal * 0.2;
          // Metals tint reflections with the base color; dielectrics reflect white
          const highlightColor = metal > 0.5 ? baseColor : '#ffffff';
          // Darker rim for metallic look
          const rimDark = metal > 0.3 ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)';
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: `radial-gradient(circle at 30% 25%, ${highlightColor} 0%, rgba(255,255,255,${highlightAlpha.toFixed(2)}) ${highlightSize * 0.2}%, ${baseColor} ${highlightSize}%, ${rimDark} 100%)`,
                boxShadow: 'inset -4px -4px 10px rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.4)',
                border: '1px solid #30363d',
                flexShrink: 0,
              }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: '#8b949e' }}>
                <div>{tt.livePreview}</div>
                <div style={{ fontSize: 9 }}>
                  M: <span style={{ color: '#58a6ff', fontWeight: 700 }}>{metal.toFixed(2)}</span>
                  {' · '}R: <span style={{ color: '#58a6ff', fontWeight: 700 }}>{rough.toFixed(2)}</span>
                </div>
                <div style={{ fontSize: 9, color: metal > 0.7 ? '#d29922' : metal > 0.3 ? '#8b949e' : '#3fb950' }}>
                  {metal > 0.7 ? tt.metallic : metal > 0.3 ? tt.semiMetal : tt.dielectric}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ─ Color ─ */}
        <div>
          <div style={sectionTitle}>{tt.color}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="color" value={override.color ?? '#888888'} onChange={e => set('color', e.target.value)}
              style={{ width: 32, height: 24, borderRadius: 4, border: '1px solid #30363d', cursor: 'pointer', padding: 0, background: 'none' }} />
            <input type="text" value={override.color ?? ''} placeholder="#888888"
              onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) set('color', e.target.value); }}
              style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, color: '#e6edf3', fontSize: 11, padding: '3px 7px', fontFamily: 'monospace' }} />
          </div>
        </div>

        {/* ─ PBR Sliders ─ */}
        {sliderRow(tt.metalnessLabel, 'metalness', 0, 1, 0.01, 0)}
        {sliderRow(tt.roughnessLabel, 'roughness', 0, 1, 0.01, 0.5)}
        {sliderRow(tt.envIntensity, 'envMapIntensity', 0, 3, 0.1, 1)}

        {/* ─ Texture Maps ─ */}
        <div>
          <div style={sectionTitle}>{tt.textureMaps}</div>
          {textureRow(tt.normalMap, 'normalMapUrl')}
          {override.normalMapUrl && sliderRow(tt.normalScale, 'normalScale', 0, 3, 0.05, 1)}
          {textureRow(tt.roughnessMap, 'roughnessMapUrl')}
          {textureRow(tt.metalnessMap, 'metalnessMapUrl')}
          {textureRow(tt.aoMap, 'aoMapUrl')}
          {textureRow(tt.displacementMap, 'displacementMapUrl')}
          {override.displacementMapUrl && sliderRow(tt.displacementScale, 'displacementScale', 0, 10, 0.1, 1)}
        </div>

        {/* ─ Environment Preset ─ */}
        <div>
          <div style={sectionTitle}>{tt.environment}</div>
          {ENV_PRESET_GROUPS.map(group => (
            <div key={group.categoryKey} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {tt[group.categoryKey]}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {group.items.map(({ id, icon, labelKey }) => (
                  <button key={id} onClick={() => onEnvPresetChange(id)} style={{
                    padding: '4px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    border: envPreset === id ? '1px solid #388bfd' : '1px solid #30363d',
                    background: envPreset === id ? 'rgba(56,139,253,0.15)' : '#21262d',
                    color: envPreset === id ? '#388bfd' : '#8b949e',
                  }} title={tt[labelKey]}>
                    <span style={{ fontSize: 11 }}>{icon}</span>
                    <span>{tt[labelKey]}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          style={{ width: '100%', padding: '5px 0', backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: 6, color: '#8b949e', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}
          onClick={onReset}
        >
          {tt.resetToPreset}
        </button>
      </div>
    </div>
  );
}
