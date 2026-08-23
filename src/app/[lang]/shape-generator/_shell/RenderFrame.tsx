'use client';

// Render Studio view (Phase 4) — shell-v2 styled photoreal preview screen.
// Mounted at /[lang]/shape-generator/render.
// Reuses existing useFreemiumGate.requirePhotoReal for the 1-use Free demo;
// real Three.js PBR viewport and HDRI sphere come in Phase 6.

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from './Shell';
import { I, type IconName } from './Icons';
import { useFreemiumGate } from '../hooks/useFreemiumGate';
import { PbrSpherePreview } from './PbrSpherePreview';
import { RenderRightPane } from './sidebars/RenderRightPane';
import { useSceneStore } from '../store/sceneStore';
import { loc } from '../lib/loc';
import { toRouteLang } from '@/lib/i18n/normalize';

interface RenderFrameProps {
  lang: string;
  /** Legacy caller compatibility; display strings use `lang` exclusively. */
  isKo?: boolean;
  projectId?: string;
}

type LocalizedLabel = { ko: string; en: string; ja: string; zh: string; es: string; ar: string };

interface MaterialSwatch {
  id: string;
  labels: LocalizedLabel;
  color: string;
  group: 'metal' | 'plastic' | 'wood' | 'glass';
}

const MATERIAL_LIBRARY: MaterialSwatch[] = [
  { id: 'aluminum', labels: { ko: '알루미늄', en: 'Aluminum', ja: 'アルミニウム', zh: '铝', es: 'Aluminio', ar: 'ألمنيوم' }, color: '#cdd2d8', group: 'metal' },
  { id: 'steel-brushed', labels: { ko: '브러시드 스틸', en: 'Steel · brushed', ja: 'ヘアラインスチール', zh: '拉丝钢', es: 'Acero · cepillado', ar: 'فولاذ · مصقول' }, color: '#a8acb1', group: 'metal' },
  { id: 'steel-mirror', labels: { ko: '미러 스틸', en: 'Steel · mirror', ja: 'ミラースチール', zh: '镜面钢', es: 'Acero · espejo', ar: 'فولاذ · مرآة' }, color: '#dde0e3', group: 'metal' },
  { id: 'anodized-black', labels: { ko: '아노다이징 블랙', en: 'Anodized black', ja: 'アルマイトブラック', zh: '黑色阳极氧化', es: 'Negro anodizado', ar: 'أسود مؤكسد' }, color: '#22262b', group: 'metal' },
  { id: 'copper', labels: { ko: '구리', en: 'Copper', ja: '銅', zh: '铜', es: 'Cobre', ar: 'نحاس' }, color: '#c97f50', group: 'metal' },
  { id: 'brass', labels: { ko: '황동', en: 'Brass', ja: '真鍮', zh: '黄铜', es: 'Latón', ar: 'نحاس أصفر' }, color: '#caa15e', group: 'metal' },
  { id: 'plastic-white', labels: { ko: '화이트 플라스틱', en: 'Plastic · white', ja: '白色プラスチック', zh: '白色塑料', es: 'Plástico · blanco', ar: 'بلاستيك · أبيض' }, color: '#eaeaea', group: 'plastic' },
  { id: 'plastic-black', labels: { ko: '블랙 플라스틱', en: 'Plastic · black', ja: '黒色プラスチック', zh: '黑色塑料', es: 'Plástico · negro', ar: 'بلاستيك · أسود' }, color: '#1a1a1a', group: 'plastic' },
  { id: 'carbon', labels: { ko: '카본 직조', en: 'Carbon weave', ja: 'カーボン織り', zh: '碳纤维编织', es: 'Tejido de carbono', ar: 'نسيج كربوني' }, color: '#262a30', group: 'plastic' },
  { id: 'walnut', labels: { ko: '월넛', en: 'Walnut', ja: 'ウォルナット', zh: '胡桃木', es: 'Nogal', ar: 'جوز' }, color: '#5a3a23', group: 'wood' },
  { id: 'oak', labels: { ko: '오크', en: 'Oak', ja: 'オーク', zh: '橡木', es: 'Roble', ar: 'بلوط' }, color: '#b9956a', group: 'wood' },
  { id: 'glass-clear', labels: { ko: '투명 유리', en: 'Glass · clear', ja: '透明ガラス', zh: '透明玻璃', es: 'Vidrio · transparente', ar: 'زجاج · شفاف' }, color: '#b6d8e5', group: 'glass' },
];

const FILTER_GROUPS: {
  id: MaterialSwatch['group'] | 'all';
  label: { ko: string; en: string; ja: string; zh: string; es: string; ar: string };
}[] = [
  { id: 'all', label: { ko: '전체', en: 'All', ja: 'すべて', zh: '全部', es: 'Todos', ar: 'الكل' } },
  { id: 'metal', label: { ko: '금속', en: 'Metals', ja: '金属', zh: '金属', es: 'Metales', ar: 'المعادن' } },
  { id: 'plastic', label: { ko: '플라스틱', en: 'Plastics', ja: 'プラスチック', zh: '塑料', es: 'Plásticos', ar: 'البلاستيك' } },
  { id: 'wood', label: { ko: '목재', en: 'Wood', ja: '木材', zh: '木材', es: 'Madera', ar: 'الخشب' } },
  { id: 'glass', label: { ko: '유리', en: 'Glass', ja: 'ガラス', zh: '玻璃', es: 'Vidrio', ar: 'الزجاج' } },
];

const HDRI_PRESETS: { id: string; labels: LocalizedLabel; ico: IconName }[] = [
  { id: 'studio', labels: { ko: '스튜디오', en: 'Studio', ja: 'スタジオ', zh: '影棚', es: 'Estudio', ar: 'استوديو' }, ico: 'sun' },
  { id: 'workshop', labels: { ko: '작업장', en: 'Workshop', ja: '作業場', zh: '车间', es: 'Taller', ar: 'ورشة' }, ico: 'cog' },
  { id: 'overcast', labels: { ko: '흐림', en: 'Overcast', ja: '曇り', zh: '阴天', es: 'Nublado', ar: 'غائم' }, ico: 'moon' },
  { id: 'warehouse', labels: { ko: '창고', en: 'Warehouse', ja: '倉庫', zh: '仓库', es: 'Almacén', ar: 'مستودع' }, ico: 'cube' },
];

export function RenderFrame({ lang, projectId }: RenderFrameProps) {
  const router = useRouter();
  const gate = useFreemiumGate();
  const [activeTab, setActiveTab] = useState('render');

  const langSeg = toRouteLang(lang);
  const project = projectId ? `?expert=1&project=${encodeURIComponent(projectId)}` : '?expert=1';

  // Cross-mode tab navigation — clicking File/Solid/Assembly/Drawing/Inspect/
  // View from inside Render jumps to the relevant route (or back to modeler).
  const handleTabChange = (id: string) => {
    setActiveTab(id);
    if (id === 'drawing') router.push(`/${langSeg}/shape-generator/drawing${project}`);
    else if (id === 'solid' || id === 'file' || id === 'inspect' || id === 'view')
      router.push(`/${langSeg}/shape-generator${project}`);
    else if (id === 'assembly')
      router.push(`/${langSeg}/shape-generator${project}&entry=assembly`);
  };
  const [matFilter, setMatFilter] = useState<MaterialSwatch['group'] | 'all'>('all');
  const [selectedMaterial, setSelectedMaterialLocal] = useState(() => useSceneStore.getState().materialId ?? 'aluminum');
  // Material picks in Render Studio also propagate to the main modeler
  // viewport so the user sees the same material everywhere. Falls back to
  // local-only when the chosen swatch id isn't a sceneStore material preset.
  const setSelectedMaterial = (id: string) => {
    setSelectedMaterialLocal(id);
    try { useSceneStore.getState().setMaterialId(id); } catch { /* materialId schema may evolve */ }
  };
  const [hdri, setHdri] = useState('studio');
  const [roughness, setRoughness] = useState(0.35);
  const [metalness, setMetalness] = useState(0.85);
  const [exposure, setExposure] = useState(1.0);
  const [_hdriRot, _setHdriRot] = useState(0);
  const [lens, setLens] = useState(50);

  // PBR extras (Specular / Clearcoat / Anisotropy). Local state drives the
  // slider UI; on every change we also push to sceneStore.renderSettings so
  // the main modeler viewport's MeshPhysicalMaterial picks it up live.
  const renderSettings = useSceneStore(s => s.renderSettings);
  const setRenderSettings = useSceneStore(s => s.setRenderSettings);
  const [specular, setSpecularLocal]   = useState<number>(renderSettings?.specular   ?? 0.5);
  const [clearcoat, setClearcoatLocal] = useState<number>(renderSettings?.clearcoat  ?? 0);
  const [anisotropy, setAnisoLocal]    = useState<number>(renderSettings?.anisotropy ?? 0.3);

  const pushPbr = useCallback(
    (patch: { specular?: number; clearcoat?: number; anisotropy?: number }) => {
      const base = useSceneStore.getState().renderSettings;
      setRenderSettings({
        environment:       base?.environment       ?? 'studio',
        showBackground:    base?.showBackground    ?? false,
        shadowIntensity:   base?.shadowIntensity   ?? 0.4,
        bloomIntensity:    base?.bloomIntensity    ?? 0,
        showGround:        base?.showGround        ?? true,
        exposure:          base?.exposure          ?? 1.0,
        customHdriUrl:     base?.customHdriUrl,
        customHdriName:    base?.customHdriName,
        pathTracing:       base?.pathTracing,
        specular:          patch.specular   ?? base?.specular,
        clearcoat:         patch.clearcoat  ?? base?.clearcoat,
        anisotropy:        patch.anisotropy ?? base?.anisotropy,
      });
    },
    [setRenderSettings],
  );
  const setSpecular   = useCallback((v: number) => { setSpecularLocal(v);   pushPbr({ specular: v });   }, [pushPbr]);
  const setClearcoat  = useCallback((v: number) => { setClearcoatLocal(v);  pushPbr({ clearcoat: v });  }, [pushPbr]);
  const setAnisotropy = useCallback((v: number) => { setAnisoLocal(v);      pushPbr({ anisotropy: v }); }, [pushPbr]);

  const visibleMats = MATERIAL_LIBRARY.filter(m => matFilter === 'all' || m.group === matFilter);

  // Path-traced final render — dispatches `nexyfab:start-path-trace` which
  // PbrSphereImpl listens for to enable the existing PathTracer node + take
  // a high-res screenshot when samples reach the target.
  const onRenderFinal = () => {
    gate.requirePhotoReal(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nexyfab:start-path-trace', {
          detail: { resolution: '4k', targetSamples: 256, format: 'png16' },
        }));
      }
    });
  };

  return (
    <>
      <Shell
        mode="render"
        titleBar={{
          filename: loc(lang, { ko: '렌더 — 무제 파트', en: 'Render — Untitled Part', ja: 'レンダリング — 無題パート', zh: '渲染 — 未命名零件', es: 'Render — Pieza sin título', ar: 'تصيير — قطعة بدون عنوان' }),
          savedAt: loc(lang, { ko: '자동 저장됨', en: 'Auto-saved', ja: '自動保存済み', zh: '已自动保存', es: 'Guardado automáticamente', ar: 'تم الحفظ تلقائيًا' }),
          breadcrumbs: ['Projects', 'Render Studio'],
          onBrandClick: () => { try { sessionStorage.setItem('nexyfab:hub-visited', '1'); } catch { /* ignore */ } router.push(`/${langSeg}/nexyfab/hub`); },
          mode: loc(lang, { ko: '렌더 모드', en: 'RENDER STUDIO', ja: 'レンダースタジオ', zh: '渲染工作室', es: 'ESTUDIO DE RENDER', ar: 'استوديو التصيير' }),
          // No file/undo/share plumbing on this surface yet — TitleBar hides
          // quick buttons + Share when their handlers are omitted.
          onPublish: onRenderFinal,
          publishLabel: loc(lang, { ko: '최종 렌더 · 4K', en: 'Render · Final 4K', ja: '最終レンダリング · 4K', zh: '最终渲染 · 4K', es: 'Render · Final 4K', ar: 'تصيير · نهائي 4K' }),
        }}
        ribbon={{
          activeTab,
          onTabChange: handleTabChange,
          onTool: id => {
            // Honest wiring — the only ribbon tool left is the real
            // path-traced final render (same flow as the Publish button).
            if (id === 'render.final') onRenderFinal();
          },
        }}
        leftWidth={280}
        rightWidth={320}
        left={
          <MaterialLibraryPane
            lang={lang}
            materials={visibleMats}
            selectedId={selectedMaterial}
            onSelect={setSelectedMaterial}
            filter={matFilter}
            onFilter={setMatFilter}
          />
        }
        right={
          <RenderRightPane
            lang={lang}
            material={loc(lang, MATERIAL_LIBRARY.find(m => m.id === selectedMaterial)?.labels ?? { ko: selectedMaterial, en: selectedMaterial, ja: selectedMaterial, zh: selectedMaterial, es: selectedMaterial, ar: selectedMaterial })}
            color={MATERIAL_LIBRARY.find(m => m.id === selectedMaterial)?.color ?? '#888'}
            roughness={roughness}
            metalness={metalness}
            exposure={exposure}
            hdri={hdri}
            lens={lens}
            setRoughness={setRoughness}
            setMetalness={setMetalness}
            setExposure={setExposure}
            setHdri={setHdri}
            setLens={setLens}
            specular={specular}
            clearcoat={clearcoat}
            anisotropy={anisotropy}
            setSpecular={setSpecular}
            setClearcoat={setClearcoat}
            setAnisotropy={setAnisotropy}
            onRenderFinal={onRenderFinal}
          />
        }
        viewport={
          <RenderCanvas
            lang={lang}
            material={selectedMaterial}
            color={MATERIAL_LIBRARY.find(m => m.id === selectedMaterial)?.color ?? '#888'}
            roughness={roughness}
            metalness={metalness}
            exposure={exposure}
            hdri={hdri}
            projectId={projectId}
            onBackToModeling={() =>
              router.push(`/${langSeg}/shape-generator?shell=v2${projectId ? `&project=${projectId}` : ''}`)
            }
          />
        }
          statusBar={{
          left: [
            { id: 'cam', items: [`${lens}mm`] },
            { id: 'hdri', items: [`HDRI · ${loc(lang, HDRI_PRESETS.find(p => p.id === hdri)?.labels ?? { ko: hdri, en: hdri, ja: hdri, zh: hdri, es: hdri, ar: hdri })}`] },
          ],
          pills: [
            { id: 'engine', label: 'PBR · WebGL2' },
            { id: 'spp', label: '32 spp preview' },
          ],
        }}
      />

      {gate.showUpgradePrompt && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
          }}
          onClick={() => gate.setShowUpgradePrompt(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--nx-panel)',
              border: '1px solid var(--nx-border-strong)',
              borderRadius: 10,
              padding: 24,
              maxWidth: 420,
              color: 'var(--nx-text)',
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>
              {loc(lang, { ko: '사실적 렌더는 Pro 기능입니다', en: 'Photoreal render is a Pro feature', ja: 'フォトリアルレンダリングはPro機能です', zh: '真实感渲染是 Pro 功能', es: 'El render fotorrealista es una función Pro', ar: 'التصيير الواقعي ميزة احترافية (Pro)' })}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--nx-text-2)' }}>
              {loc(lang, {
                ko: '무료 플랜은 기기당 1회 체험이 제공됩니다. 무제한 렌더링은 Pro 이상에서 사용할 수 있습니다.',
                en: 'Free plan gets 1 photoreal render per device. Upgrade for unlimited.',
                ja: '無料プランはデバイスごとに1回お試しいただけます。無制限のレンダリングはPro以上でご利用いただけます。',
                zh: '免费方案每台设备可体验 1 次。升级到 Pro 即可无限渲染。',
                es: 'El plan gratuito incluye 1 render por dispositivo. Actualiza a Pro para uso ilimitado.',
                ar: 'تتيح الخطة المجانية تصييرًا واحدًا لكل جهاز. قم بالترقية إلى Pro للحصول على تصيير غير محدود.',
              })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="nx-pillbtn"
                onClick={() => gate.setShowUpgradePrompt(false)}
              >
                {loc(lang, { ko: '나중에', en: 'Later', ja: '後で', zh: '稍后', es: 'Más tarde', ar: 'لاحقًا' })}
              </button>
              <button
                type="button"
                className="nx-pillbtn primary"
                onClick={() => router.push(`/${langSeg}/nexyfab/pricing`)}
              >
                {loc(lang, { ko: 'Pro 업그레이드', en: 'Upgrade to Pro', ja: 'Proにアップグレード', zh: '升级到 Pro', es: 'Actualizar a Pro', ar: 'الترقية إلى Pro' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MaterialLibraryPane({
  lang,
  materials,
  selectedId,
  onSelect,
  filter,
  onFilter,
}: {
  lang: string;
  materials: MaterialSwatch[];
  selectedId: string;
  onSelect: (id: string) => void;
  filter: MaterialSwatch['group'] | 'all';
  onFilter: (id: MaterialSwatch['group'] | 'all') => void;
}) {
  return (
    <>
      <div className="nx-panel-h">
        <I.paint size={14} />
        {loc(lang, { ko: '머티리얼 라이브러리', en: 'Material Library', ja: 'マテリアルライブラリ', zh: '材质库', es: 'Biblioteca de materiales', ar: 'مكتبة الخامات' })}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 8px',
          borderBottom: '1px solid var(--nx-border)',
          flexWrap: 'wrap',
        }}
      >
        {FILTER_GROUPS.map(g => (
          <button
            key={g.id}
            type="button"
            className="nx-chip"
            style={{
              cursor: 'pointer',
              borderColor: filter === g.id ? 'var(--nx-accent-line)' : 'var(--nx-border)',
              color: filter === g.id ? 'var(--nx-accent)' : 'var(--nx-text-2)',
              background: filter === g.id ? 'var(--nx-accent-soft)' : 'var(--nx-panel-2)',
            }}
            onClick={() => onFilter(g.id)}
          >
            {loc(lang, g.label)}
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 10,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          alignContent: 'start',
        }}
      >
        {materials.map(m => (
          <button
            type="button"
            key={m.id}
            onClick={() => onSelect(m.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              alignItems: 'center',
              padding: 8,
              background: selectedId === m.id ? 'var(--nx-accent-soft)' : 'var(--nx-panel-2)',
              border: `1px solid ${selectedId === m.id ? 'var(--nx-accent-line)' : 'var(--nx-border)'}`,
              borderRadius: 6,
              cursor: 'pointer',
              color: 'var(--nx-text)',
            }}
          >
            <div
              style={{
                width: 56,
                height: 40,
                borderRadius: 4,
                background: `radial-gradient(ellipse at 30% 30%, ${shade(m.color, 0.15)}, ${m.color} 60%, ${shade(m.color, -0.25)})`,
                border: '1px solid rgba(0,0,0,0.25)',
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: 'var(--nx-text-2)',
                textAlign: 'center',
                lineHeight: 1.2,
              }}
            >
              {loc(lang, m.labels)}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function _RenderPropsPane({
  lang,
  roughness,
  setRoughness,
  metalness,
  setMetalness,
  exposure,
  setExposure,
  hdri,
  setHdri,
  hdriRot,
  setHdriRot,
  lens,
  setLens,
}: {
  lang: string;
  roughness: number;
  setRoughness: (v: number) => void;
  metalness: number;
  setMetalness: (v: number) => void;
  exposure: number;
  setExposure: (v: number) => void;
  hdri: string;
  setHdri: (v: string) => void;
  hdriRot: number;
  setHdriRot: (v: number) => void;
  lens: number;
  setLens: (v: number) => void;
}) {
  return (
    <>
      <div className="nx-panel-h">
        <I.cog size={14} />
        {loc(lang, { ko: '렌더 설정', en: 'Render Settings', ja: 'レンダリング設定', zh: '渲染设置', es: 'Ajustes de render', ar: 'إعدادات التصيير' })}
      </div>

      <div className="nx-props" style={{ padding: '8px 0' }}>
        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>PBR
          </div>
          <SliderRow lbl={loc(lang, { ko: '거칠기', en: 'Roughness', ja: 'ラフネス', zh: '粗糙度', es: 'Rugosidad', ar: 'الخشونة' })} value={roughness} onChange={setRoughness} />
          <SliderRow lbl={loc(lang, { ko: '금속성', en: 'Metalness', ja: 'メタルネス', zh: '金属度', es: 'Metalicidad', ar: 'المعدنية' })} value={metalness} onChange={setMetalness} />
          <SliderRow lbl={loc(lang, { ko: '클리어코트', en: 'Clearcoat', ja: 'クリアコート', zh: '清漆层', es: 'Capa transparente', ar: 'الطبقة الشفافة' })} value={0.2} onChange={() => {}} disabled />
        </div>

        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>
            {loc(lang, { ko: '환경 HDRI', en: 'Environment', ja: '環境', zh: '环境', es: 'Entorno', ar: 'البيئة' })}
          </div>
          <div
            style={{
              padding: '4px 10px 8px',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 4,
            }}
          >
            {HDRI_PRESETS.map(h => {
              const Icon = I[h.ico] ?? I.sun;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setHdri(h.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: 6,
                    fontSize: 9,
                    color: hdri === h.id ? 'var(--nx-accent)' : 'var(--nx-text-2)',
                    background: hdri === h.id ? 'var(--nx-accent-soft)' : 'transparent',
                    border: `1px solid ${hdri === h.id ? 'var(--nx-accent-line)' : 'var(--nx-border)'}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={14} />
                  {loc(lang, h.labels)}
                </button>
              );
            })}
          </div>
          <SliderRow lbl={loc(lang, { ko: '회전', en: 'Rotation', ja: '回転', zh: '旋转', es: 'Rotación', ar: 'تدوير' })} value={hdriRot} max={360} step={1} unit="°" onChange={setHdriRot} />
          <SliderRow lbl={loc(lang, { ko: '노출', en: 'Exposure', ja: '露出', zh: '曝光', es: 'Exposición', ar: 'التعريض الضوئي' })} value={exposure} max={2} step={0.05} onChange={setExposure} />
        </div>

        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>
            {loc(lang, { ko: '카메라', en: 'Camera', ja: 'カメラ', zh: '相机', es: 'Cámara', ar: 'الكاميرا' })}
          </div>
          <SliderRow lbl={loc(lang, { ko: '렌즈', en: 'Lens', ja: 'レンズ', zh: '镜头', es: 'Lente', ar: 'العدسة' })} value={lens} max={200} min={20} step={1} unit="mm" onChange={setLens} />
          <SliderRow lbl={loc(lang, { ko: '심도', en: 'DoF', ja: '被写界深度', zh: '景深', es: 'Profundidad de campo', ar: 'عمق الميدان' })} value={0.0} max={1} step={0.05} onChange={() => {}} disabled />
        </div>

        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>
            {loc(lang, { ko: '출력', en: 'Output', ja: '出力', zh: '输出', es: 'Salida', ar: 'الإخراج' })}
          </div>
          <div className="row">
            <span className="k">{loc(lang, { ko: '해상도', en: 'Resolution', ja: '解像度', zh: '分辨率', es: 'Resolución', ar: 'الدقة' })}</span>
            <span className="v">3840 × 2160</span>
          </div>
          <div className="row">
            <span className="k">{loc(lang, { ko: '샘플', en: 'Samples', ja: 'サンプル', zh: '采样', es: 'Muestras', ar: 'العينات' })}</span>
            <span className="v">256 spp</span>
          </div>
        </div>
      </div>
    </>
  );
}

function SliderRow({
  lbl,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  unit,
  disabled,
}: {
  lbl: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <div className="row" style={{ opacity: disabled ? 0.45 : 1 }}>
      <span className="k">{lbl}</span>
      <span className="v" style={{ gap: 6, alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--nx-accent)' }}
        />
        <span className="mono" style={{ fontSize: 10, minWidth: 40, textAlign: 'right' }}>
          {step >= 1 ? Math.round(value) : value.toFixed(2)}
          {unit ?? ''}
        </span>
      </span>
    </div>
  );
}

function RenderCanvas({
  lang,
  material,
  color,
  roughness,
  metalness,
  exposure,
  hdri,
  projectId,
  onBackToModeling,
}: {
  lang: string;
  material: string;
  color: string;
  roughness: number;
  metalness: number;
  exposure: number;
  hdri: string;
  projectId?: string;
  onBackToModeling: () => void;
}) {
  return (
    <>
      <div className="nx-viewport-overlay">
        <div className="nx-readout tl">
          <div>
            <span className="k">MATERIAL</span> <span className="v mono">{material}</span>
          </div>
          <div>
            <span className="k">R/M</span> <span className="v mono">{roughness.toFixed(2)} / {metalness.toFixed(2)}</span>
          </div>
          <div>
            <span className="k">HDRI</span> <span className="v mono">{hdri}</span>
          </div>
        </div>
        <div className="nx-readout bl">
          <div>{loc(lang, { ko: '실시간 PBR · WebGL2', en: 'Live PBR · WebGL2', ja: 'リアルタイム PBR · WebGL2', zh: '实时 PBR · WebGL2', es: 'PBR en tiempo real · WebGL2', ar: 'PBR مباشر · WebGL2' })}</div>
        </div>
      </div>

      <div style={{ position: 'absolute', inset: 0 }}>
        <PbrSpherePreview
          color={color}
          roughness={roughness}
          metalness={metalness}
          exposure={exposure}
          hdri={hdri}
          projectId={projectId}
        />
      </div>

      <div className="nx-floater" style={{ bottom: 12, left: 12 }}>
        <button type="button" className="nx-pillbtn" onClick={onBackToModeling}>
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
            <I.caret_r size={12} />
          </span>
          {loc(lang, { ko: '모델링으로 돌아가기', en: 'Back to Modeling', ja: 'モデリングに戻る', zh: '返回建模', es: 'Volver al modelado', ar: 'العودة إلى النمذجة' })}
        </button>
      </div>
    </>
  );
}

// Naive color shading helper for swatch previews.
function shade(hex: string, amt: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amt)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amt)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round(255 * amt)));
  return `rgb(${r}, ${g}, ${b})`;
}
