'use client';

// Render mode right pane — material preview header + thumbnail strip +
// PBR PHYSICAL / ENVIRONMENT / CAMERA / OUTPUT four sections + Final CTA
// matching mockup #33.

import type { ReactNode } from 'react';
import { SidePanel, PropSection, PropRow, PropSelect, PropCheck } from './';
import { I } from '../Icons';
import { CustomMaterialUpload } from './CustomMaterialUpload';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';
import { loc } from '../../lib/loc';

// Wraps a control whose handler isn't wired yet so it reads as unavailable
// instead of pretending to work (dimmed + non-interactive + tooltip).
// (2026-06-12 honesty: disable dead controls rather than show fake-working ones)
function Soon({ children, isKo }: { children: ReactNode; isKo: boolean }) {
  return (
    <span
      title={isKo ? '준비 중 — 아직 적용되지 않습니다' : 'Coming soon — not yet wired'}
      style={{ display: 'block', opacity: 0.4, pointerEvents: 'none' }}
    >
      {children}
    </span>
  );
}

const RENDER_CATALOG_DICT_KO: CatalogPanelDict = {
  catalogTitle: '렌더/애니메이션 도구', catalogLoading: '불러오는 중…', catalogReady: '준비됨',
  catalogRun: '실행', catalogFailed: '불러오기 실패', catalogEmpty: '해당 기능이 없습니다',
};
const RENDER_CATALOG_DICT_EN: CatalogPanelDict = {
  catalogTitle: 'Render / Animation', catalogLoading: 'Loading…', catalogReady: 'Ready',
  catalogRun: 'Run', catalogFailed: 'Load failed', catalogEmpty: 'No matching feature',
};

export interface RenderRightPaneProps {
  isKo: boolean;
  lang: string;
  material: string;
  color: string;
  roughness: number;
  metalness: number;
  exposure: number;
  hdri: string;
  lens: number;
  /** Phase-2 PBR extras — optional so existing callers (older shells)
   *  keep working without forwarding setters that don't exist yet. */
  specular?: number;
  clearcoat?: number;
  anisotropy?: number;
  setRoughness: (v: number) => void;
  setMetalness: (v: number) => void;
  setExposure: (v: number) => void;
  setHdri: (v: string) => void;
  setLens: (v: number) => void;
  setSpecular?: (v: number) => void;
  setClearcoat?: (v: number) => void;
  setAnisotropy?: (v: number) => void;
  onRenderFinal: () => void;
}

export function RenderRightPane({
  isKo, lang, material, color, roughness, metalness, exposure, hdri, lens,
  specular = 0.5, clearcoat = 0, anisotropy = 0.3,
  setRoughness, setMetalness, setExposure, setHdri, setLens,
  setSpecular, setClearcoat, setAnisotropy,
  onRenderFinal,
}: RenderRightPaneProps) {
  return (
    <SidePanel
      side="right"
      title={material.toUpperCase()}
      titleIcon={<span style={{ width: 12, height: 12, borderRadius: 2, background: color, display: 'inline-block' }} />}
    >
      {/* Thumbnail strip — 4 procedural mat-balls */}
      <div style={{ display: 'flex', gap: 4, padding: 8, borderBottom: '1px solid var(--nx-border)' }}>
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            style={{
              flex: 1, aspectRatio: '1 / 1', borderRadius: 4,
              background: `radial-gradient(circle at 35% 30%, ${color}cc 0%, ${color}66 60%, #1a1a1a 100%)`,
              border: i === 0 ? '1px solid var(--nx-accent)' : '1px solid var(--nx-border)',
              cursor: 'pointer',
            }}
          />
        ))}
      </div>

      <PropSection title={loc(lang, { ko: 'PBR · 물리', en: 'PBR — Physical', ja: 'PBR · 物理', zh: 'PBR · 物理', es: 'PBR · Físico', ar: 'PBR · فيزيائي' })}>
        <Slider label={loc(lang, { ko: '거칠기', en: 'Roughness', ja: '粗さ', zh: '粗糙度', es: 'Rugosidad', ar: 'الخشونة' })} value={roughness} min={0} max={1} step={0.01} onChange={setRoughness} />
        <Slider label={loc(lang, { ko: '금속성', en: 'Metalness', ja: 'メタリック', zh: '金属度', es: 'Metalicidad', ar: 'المعدنية' })} value={metalness} min={0} max={1} step={0.01} onChange={setMetalness} />
        <Slider label={loc(lang, { ko: '반사', en: 'Specular', ja: '反射', zh: '高光', es: 'Especular', ar: 'انعكاس' })}    value={specular}    min={0} max={1} step={0.01} onChange={setSpecular    ?? (() => {})} />
        <Slider label={loc(lang, { ko: '클리어코트', en: 'Clearcoat', ja: 'クリアコート', zh: '清漆', es: 'Barniz', ar: 'طبقة شفافة' })} value={clearcoat} min={0} max={1} step={0.01} onChange={setClearcoat ?? (() => {})} />
        <Slider label={loc(lang, { ko: '이방성', en: 'Anisotropy', ja: '異方性', zh: '各向异性', es: 'Anisotropía', ar: 'التباين الاتجاهي' })}  value={anisotropy}  min={0} max={1} step={0.01} onChange={setAnisotropy  ?? (() => {})} />
        <PropRow label={loc(lang, { ko: '범프맵', en: 'Bump map', ja: 'バンプマップ', zh: '凹凸贴图', es: 'Mapa de relieve', ar: 'خريطة النتوء' })}>
          <span style={{ fontSize: 11, color: 'var(--nx-accent)', cursor: 'pointer' }}>brushed_x.exr ↗</span>
        </PropRow>
      </PropSection>

      <PropSection title={loc(lang, { ko: '커스텀 텍스처', en: 'Custom textures', ja: 'カスタムテクスチャ', zh: '自定义纹理', es: 'Texturas personalizadas', ar: 'مواد مخصصة' })} defaultExpanded={false}>
        <CustomMaterialUpload isKo={isKo} />
      </PropSection>

      <PropSection title={loc(lang, { ko: '환경', en: 'Environment', ja: '環境', zh: '环境', es: 'Entorno', ar: 'البيئة' })}>
        <PropRow label="HDRI">
          <PropSelect
            value={hdri}
            onChange={setHdri}
            options={[
              { value: 'studio', label: loc(lang, { ko: '스튜디오', en: 'Studio', ja: 'スタジオ', zh: '影棚', es: 'Estudio', ar: 'استوديو' }) },
              { value: 'workshop', label: loc(lang, { ko: '작업장', en: 'Workshop', ja: '作業場', zh: '车间', es: 'Taller', ar: 'ورشة' }) },
              { value: 'overcast', label: loc(lang, { ko: '흐림', en: 'Overcast', ja: '曇り', zh: '阴天', es: 'Nublado', ar: 'غائم' }) },
              { value: 'warehouse', label: loc(lang, { ko: '창고', en: 'Warehouse', ja: '倉庫', zh: '仓库', es: 'Almacén', ar: 'مستودع' }) },
            ]}
          />
        </PropRow>
        <Soon isKo={isKo}><Slider label={loc(lang, { ko: '회전', en: 'Rotation', ja: '回転', zh: '旋转', es: 'Rotación', ar: 'تدوير' })} value={0} min={0} max={360} step={1} onChange={() => { /* not wired */ }} /></Soon>
        <Slider label={loc(lang, { ko: '노출', en: 'Exposure', ja: '露出', zh: '曝光', es: 'Exposición', ar: 'التعريض' })} value={exposure} min={0.1} max={3} step={0.05} onChange={setExposure} />
        <PropRow label={loc(lang, { ko: '바닥 그림자', en: 'Ground shadow', ja: '地面の影', zh: '地面阴影', es: 'Sombra de suelo', ar: 'ظل الأرضية' })}>
          <Soon isKo={isKo}><PropCheck checked onChange={() => { /* not wired */ }} label={loc(lang, { ko: '받기', en: 'Catch', ja: '受光', zh: '接收', es: 'Recibir', ar: 'التقاط' })} /></Soon>
        </PropRow>
      </PropSection>

      <PropSection title={loc(lang, { ko: '카메라', en: 'Camera', ja: 'カメラ', zh: '相机', es: 'Cámara', ar: 'الكاميرا' })}>
        <PropRow label={loc(lang, { ko: '렌즈', en: 'Lens', ja: 'レンズ', zh: '镜头', es: 'Lente', ar: 'العدسة' })}>
          <input
            type="number"
            value={lens}
            min={14}
            max={200}
            onChange={e => setLens(parseInt(e.target.value, 10) || 50)}
            style={{
              width: '100%', height: 22, padding: '0 6px', borderRadius: 3,
              border: '1px solid var(--nx-border)', background: 'var(--nx-bg)',
              color: 'var(--nx-text)', fontSize: 11, fontFamily: 'ui-monospace, monospace', textAlign: 'right',
            }}
          />
        </PropRow>
        <Soon isKo={isKo}><Slider label={loc(lang, { ko: '조리개', en: 'Aperture', ja: '絞り', zh: '光圈', es: 'Apertura', ar: 'فتحة العدسة' })} value={0.5} min={0.95} max={32} step={0.1} onChange={() => { /* not wired */ }} /></Soon>
        <Soon isKo={isKo}><Slider label={loc(lang, { ko: '초점거리', en: 'Focus dist.', ja: '焦点距離', zh: '对焦距离', es: 'Dist. de enfoque', ar: 'مسافة التركيز' })} value={0.6} min={0} max={10} step={0.1} onChange={() => { /* not wired */ }} /></Soon>
        <PropRow label={loc(lang, { ko: '구도', en: 'Composition', ja: '構図', zh: '构图', es: 'Composición', ar: 'التكوين' })}>
          <Soon isKo={isKo}><PropSelect
            value="hero"
            onChange={() => { /* not wired */ }}
            options={[
              { value: 'hero', label: loc(lang, { ko: '히어로 · 3/4 iso', en: 'Hero · 3/4 iso', ja: 'ヒーロー · 3/4 iso', zh: '主视角 · 3/4 等距', es: 'Héroe · 3/4 iso', ar: 'بطولي · 3/4 متساوي' }) },
              { value: 'front', label: loc(lang, { ko: '정면', en: 'Front', ja: '正面', zh: '正面', es: 'Frontal', ar: 'أمامي' }) },
              { value: 'top', label: loc(lang, { ko: '상부', en: 'Top-down', ja: '上面', zh: '俯视', es: 'Superior', ar: 'علوي' }) },
            ]}
          /></Soon>
        </PropRow>
      </PropSection>

      <PropSection title={loc(lang, { ko: '출력', en: 'Output', ja: '出力', zh: '输出', es: 'Salida', ar: 'الإخراج' })}>
        <PropRow label={loc(lang, { ko: '해상도', en: 'Resolution', ja: '解像度', zh: '分辨率', es: 'Resolución', ar: 'الدقة' })}>
          <Soon isKo={isKo}><PropSelect
            value="4k"
            onChange={() => { /* not wired */ }}
            options={[
              { value: '4k', label: '3840 × 2160 · 4K' },
              { value: '2k', label: '2560 × 1440 · 2K' },
              { value: '1080', label: '1920 × 1080 · FHD' },
            ]}
          /></Soon>
        </PropRow>
        <PropRow label={loc(lang, { ko: '샘플', en: 'Samples', ja: 'サンプル', zh: '采样', es: 'Muestras', ar: 'العينات' })}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>256 spp</span>
        </PropRow>
        <PropRow label={loc(lang, { ko: '포맷', en: 'Format', ja: 'フォーマット', zh: '格式', es: 'Formato', ar: 'الصيغة' })}>
          <Soon isKo={isKo}><PropSelect
            value="png16"
            onChange={() => { /* not wired */ }}
            options={[
              { value: 'png16', label: 'PNG · 16-bit' },
              { value: 'png8', label: 'PNG · 8-bit' },
              { value: 'jpg', label: 'JPG · 90%' },
              { value: 'exr', label: 'OpenEXR · 32-bit float' },
            ]}
          /></Soon>
        </PropRow>
      </PropSection>

      <div style={{
        position: 'sticky', bottom: 0,
        padding: '10px 12px',
        background: 'var(--nx-panel)',
        borderTop: '1px solid var(--nx-border)',
      }}>
        <button
          onClick={onRenderFinal}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            width: '100%', height: 32, padding: '0 12px',
            border: 0, borderRadius: 4,
            background: 'var(--nx-accent)', color: '#fff',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          <I.bolt size={14} />
          {loc(lang, { ko: '최종 · 4K · 256 spp 렌더', en: 'Final · 4K · 256 spp Render', ja: '最終 · 4K · 256 spp レンダリング', zh: '最终 · 4K · 256 spp 渲染', es: 'Final · 4K · 256 spp Render', ar: 'نهائي · 4K · 256 spp تصيير' })}
        </button>
      </div>

      <PropSection title={loc(lang, { ko: '렌더 도구 (라이브)', en: 'Render Tools (live)', ja: 'レンダーツール (ライブ)', zh: '渲染工具（实时）', es: 'Herramientas de render (en vivo)', ar: 'أدوات التصيير (مباشر)' })}>
        <FeatureCatalogPanel
          route="render"
          license="pro"
          dict={isKo ? RENDER_CATALOG_DICT_KO : RENDER_CATALOG_DICT_EN}
          onRun={(featureId, entryFn) => {
             
            console.info(`[catalog] run ${featureId} via ${entryFn}()`);
          }}
        />
      </PropSection>
    </SidePanel>
  );
}

function Slider({
  label, value, min, max, step, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ padding: '3px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--nx-text)', marginBottom: 2 }}>
        <span style={{ color: 'var(--nx-text-2)' }}>{label}</span>
        <span className="mono" style={{ color: 'var(--nx-text)' }}>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--nx-accent)', height: 3 }}
      />
    </div>
  );
}
