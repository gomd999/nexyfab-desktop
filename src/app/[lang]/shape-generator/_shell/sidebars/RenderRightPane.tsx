'use client';

// Render mode right pane — material preview header + thumbnail strip +
// PBR PHYSICAL / ENVIRONMENT / CAMERA / OUTPUT four sections + Final CTA
// matching mockup #33.

import { SidePanel, PropSection, PropRow, PropSelect, PropCheck } from './';
import { I } from '../Icons';
import { CustomMaterialUpload } from './CustomMaterialUpload';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';

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
  isKo, material, color, roughness, metalness, exposure, hdri, lens,
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

      <PropSection title={isKo ? 'PBR · 물리' : 'PBR — Physical'}>
        <Slider label={isKo ? '거칠기' : 'Roughness'} value={roughness} min={0} max={1} step={0.01} onChange={setRoughness} />
        <Slider label={isKo ? '금속성' : 'Metalness'} value={metalness} min={0} max={1} step={0.01} onChange={setMetalness} />
        <Slider label={isKo ? '반사' : 'Specular'}    value={specular}    min={0} max={1} step={0.01} onChange={setSpecular    ?? (() => {})} />
        <Slider label={isKo ? '클리어코트' : 'Clearcoat'} value={clearcoat} min={0} max={1} step={0.01} onChange={setClearcoat ?? (() => {})} />
        <Slider label={isKo ? '이방성' : 'Anisotropy'}  value={anisotropy}  min={0} max={1} step={0.01} onChange={setAnisotropy  ?? (() => {})} />
        <PropRow label={isKo ? '범프맵' : 'Bump map'}>
          <span style={{ fontSize: 11, color: 'var(--nx-accent)', cursor: 'pointer' }}>brushed_x.exr ↗</span>
        </PropRow>
      </PropSection>

      <PropSection title={isKo ? '커스텀 텍스처' : 'Custom textures'} defaultExpanded={false}>
        <CustomMaterialUpload isKo={isKo} />
      </PropSection>

      <PropSection title={isKo ? '환경' : 'Environment'}>
        <PropRow label="HDRI">
          <PropSelect
            value={hdri}
            onChange={setHdri}
            options={[
              { value: 'studio', label: isKo ? '스튜디오' : 'Studio' },
              { value: 'workshop', label: isKo ? '작업장' : 'Workshop' },
              { value: 'overcast', label: isKo ? '흐림' : 'Overcast' },
              { value: 'warehouse', label: isKo ? '창고' : 'Warehouse' },
            ]}
          />
        </PropRow>
        <Slider label={isKo ? '회전' : 'Rotation'} value={0} min={0} max={360} step={1} onChange={() => { /* TODO */ }} />
        <Slider label={isKo ? '노출' : 'Exposure'} value={exposure} min={0.1} max={3} step={0.05} onChange={setExposure} />
        <PropRow label={isKo ? '바닥 그림자' : 'Ground shadow'}>
          <PropCheck checked onChange={() => { /* TODO */ }} label={isKo ? '받기' : 'Catch'} />
        </PropRow>
      </PropSection>

      <PropSection title={isKo ? '카메라' : 'Camera'}>
        <PropRow label={isKo ? '렌즈' : 'Lens'}>
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
        <Slider label={isKo ? '조리개' : 'Aperture'} value={0.5} min={0.95} max={32} step={0.1} onChange={() => { /* TODO */ }} />
        <Slider label={isKo ? '초점거리' : 'Focus dist.'} value={0.6} min={0} max={10} step={0.1} onChange={() => { /* TODO */ }} />
        <PropRow label={isKo ? '구도' : 'Composition'}>
          <PropSelect
            value="hero"
            onChange={() => { /* TODO */ }}
            options={[
              { value: 'hero', label: isKo ? '히어로 · 3/4 iso' : 'Hero · 3/4 iso' },
              { value: 'front', label: isKo ? '정면' : 'Front' },
              { value: 'top', label: isKo ? '상부' : 'Top-down' },
            ]}
          />
        </PropRow>
      </PropSection>

      <PropSection title={isKo ? '출력' : 'Output'}>
        <PropRow label={isKo ? '해상도' : 'Resolution'}>
          <PropSelect
            value="4k"
            onChange={() => { /* TODO */ }}
            options={[
              { value: '4k', label: '3840 × 2160 · 4K' },
              { value: '2k', label: '2560 × 1440 · 2K' },
              { value: '1080', label: '1920 × 1080 · FHD' },
            ]}
          />
        </PropRow>
        <PropRow label={isKo ? '샘플' : 'Samples'}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>256 spp</span>
        </PropRow>
        <PropRow label={isKo ? '포맷' : 'Format'}>
          <PropSelect
            value="png16"
            onChange={() => { /* TODO */ }}
            options={[
              { value: 'png16', label: 'PNG · 16-bit' },
              { value: 'png8', label: 'PNG · 8-bit' },
              { value: 'jpg', label: 'JPG · 90%' },
              { value: 'exr', label: 'OpenEXR · 32-bit float' },
            ]}
          />
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
          {isKo ? '최종 · 4K · 256 spp 렌더' : 'Final · 4K · 256 spp Render'}
        </button>
      </div>

      <PropSection title={isKo ? '렌더 도구 (라이브)' : 'Render Tools (live)'}>
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
