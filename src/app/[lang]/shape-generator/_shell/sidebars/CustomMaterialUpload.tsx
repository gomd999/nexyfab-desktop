'use client';

// Custom PBR material upload — drop 4 maps (albedo / normal / roughness /
// metalness) and the panel emits a custom-material descriptor via
// nexyfab:set-custom-material so ShapePreview / RenderMode can bind it
// to the active mesh. Files are turned into object URLs (no upload to
// server) so we don't pay R2 cost for one-off experiments.

import { useState } from 'react';
import { useLang } from '../../hooks/useLang';
import { loc } from '../../lib/loc';

export interface CustomMaterialUploadProps {
  isKo: boolean;
}

type Slot = 'albedo' | 'normal' | 'roughness' | 'metalness' | 'ao' | 'displacement';

const SLOT_LABELS: Record<Slot, { ko: string; en: string }> = {
  albedo: { ko: 'Albedo (Base color)', en: 'Albedo (Base color)' },
  normal: { ko: 'Normal map', en: 'Normal map' },
  roughness: { ko: '거칠기 (Roughness)', en: 'Roughness' },
  metalness: { ko: '금속성 (Metalness)', en: 'Metalness' },
  ao: { ko: 'AO map', en: 'AO map' },
  displacement: { ko: 'Displacement', en: 'Displacement' },
};

export function CustomMaterialUpload({ isKo }: CustomMaterialUploadProps) {
  const lang = useLang();
  const [urls, setUrls] = useState<Partial<Record<Slot, string>>>({});

  const onPick = (slot: Slot, file: File | null) => {
    if (!file) {
      setUrls(prev => {
        const next = { ...prev };
        if (next[slot]) URL.revokeObjectURL(next[slot]!);
        delete next[slot];
        emit(next);
        return next;
      });
      return;
    }
    const url = URL.createObjectURL(file);
    setUrls(prev => {
      if (prev[slot]) URL.revokeObjectURL(prev[slot]!);
      const next = { ...prev, [slot]: url };
      emit(next);
      return next;
    });
  };

  const emit = (next: Partial<Record<Slot, string>>) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nexyfab:set-custom-material', {
      detail: {
        normalMapUrl: next.normal,
        roughnessMapUrl: next.roughness,
        metalnessMapUrl: next.metalness,
        aoMapUrl: next.ao,
        displacementMapUrl: next.displacement,
        // albedo maps onto the base color texture — handled separately by
        // ShapePreview's TexturedMeshMaterial; we pass it via the same event.
        albedoMapUrl: next.albedo,
      },
    }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 4 }}>
        {loc(lang, {
          ko: 'PNG/JPG 텍스처를 드래그하거나 클릭하여 업로드',
          en: 'Drop or click to upload PNG/JPG texture maps',
          ja: 'PNG/JPGテクスチャをドラッグまたはクリックしてアップロード',
          zh: '拖放或点击上传 PNG/JPG 纹理贴图',
          es: 'Arrastre o haga clic para subir mapas de textura PNG/JPG',
          ar: 'اسحب أو انقر لتحميل خرائط نسيج PNG/JPG',
        })}
      </div>
      {(Object.keys(SLOT_LABELS) as Slot[]).map(slot => (
        <UploadSlot
          key={slot}
          slot={slot}
          label={isKo ? SLOT_LABELS[slot].ko : SLOT_LABELS[slot].en}
          url={urls[slot]}
          onPick={f => onPick(slot, f)}
        />
      ))}
      {Object.keys(urls).length > 0 && (
        <button
          onClick={() => {
            Object.values(urls).forEach(u => u && URL.revokeObjectURL(u));
            setUrls({});
            emit({});
          }}
          style={{
            marginTop: 6, padding: '4px 8px', height: 24,
            border: '1px solid var(--nx-border)', borderRadius: 3,
            background: 'transparent', color: 'var(--nx-text-2)',
            fontSize: 10, cursor: 'pointer',
          }}
        >
          {loc(lang, { ko: '모두 지우기', en: 'Clear all', ja: 'すべてクリア', zh: '全部清除', es: 'Borrar todo', ar: 'مسح الكل' })}
        </button>
      )}
    </div>
  );
}

function UploadSlot({ slot, label, url, onPick }: {
  slot: Slot;
  label: string;
  url?: string;
  onPick: (file: File | null) => void;
}) {
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    onPick(file);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0] ?? null;
    if (file && /^image\//.test(file.type)) onPick(file);
  };
  return (
    <label
      onDragOver={e => e.preventDefault()}
      onDrop={onDrop}
      htmlFor={`upload-${slot}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: 6, borderRadius: 4, cursor: 'pointer',
        border: `1px ${url ? 'solid' : 'dashed'} ${url ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
        background: url ? 'var(--nx-accent-soft)' : 'transparent',
      }}
    >
      <div
        style={{
          width: 36, height: 36, flex: '0 0 36px', borderRadius: 3,
          background: url
            ? `center / cover url(${url}) no-repeat`
            : 'repeating-conic-gradient(var(--nx-panel-2) 0 25%, transparent 0 50%) 0 0 / 8px 8px',
          border: '1px solid var(--nx-border)',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nx-text)' }}>{label}</div>
        <div style={{ fontSize: 9, color: 'var(--nx-text-3)' }}>{url ? 'Loaded' : 'Click or drop PNG / JPG'}</div>
      </div>
      {url && (
        <button
          type="button"
          onClick={e => { e.preventDefault(); onPick(null); }}
          style={{
            width: 18, height: 18, padding: 0, border: 0, background: 'transparent',
            color: 'var(--nx-text-3)', fontSize: 14, cursor: 'pointer',
          }}
        >×</button>
      )}
      <input
        id={`upload-${slot}`}
        type="file"
        accept="image/png,image/jpeg"
        onChange={onChange}
        style={{ display: 'none' }}
      />
    </label>
  );
}
