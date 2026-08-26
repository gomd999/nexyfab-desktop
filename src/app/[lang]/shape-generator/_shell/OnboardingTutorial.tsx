'use client';

// First-touch tutorial overlay — 5-step guided tour of the 5-mode IA.
// Shows once per user (localStorage). Dismissable anytime via Esc / Skip.
// Triggered on first ModelerShell mount when `nexyfab.onboarded` is unset.

import { useEffect, useState } from 'react';
import { useLang } from '../hooks/useLang';
import { loc } from '../lib/loc';

const STORAGE_KEY = 'nexyfab.onboarded.v1';

interface StepText {
  ko: string;
  en: string;
  ja: string;
  zh: string;
  es: string;
  ar: string;
}

interface Step {
  id: string;
  title: StepText;
  body: StepText;
  /** CSS selector of the element to highlight. Empty string = center modal. */
  anchor?: string;
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: {
      ko: 'NexyFab 에 오신 것을 환영합니다',
      en: 'Welcome to NexyFab',
      ja: 'NexyFab へようこそ',
      zh: '欢迎使用 NexyFab',
      es: 'Bienvenido a NexyFab',
      ar: 'مرحبًا بك في NexyFab',
    },
    body: {
      ko: '6개 모드 (Solid · Sketch · Assembly · Sheet Metal · Drawing · Render) 가 상단 탭으로 전환됩니다. 60초 안에 둘러볼게요.',
      en: 'Six modes (Solid · Sketch · Assembly · Sheet Metal · Drawing · Render) switch via the top tabs. Quick 60-second tour.',
      ja: '6つのモード（Solid · Sketch · Assembly · Sheet Metal · Drawing · Render）は上部タブで切り替えます。60秒でご案内します。',
      zh: '六种模式（Solid · Sketch · Assembly · Sheet Metal · Drawing · Render）通过顶部标签切换。60秒快速导览。',
      es: 'Seis modos (Solid · Sketch · Assembly · Sheet Metal · Drawing · Render) se cambian desde las pestañas superiores. Un recorrido rápido de 60 segundos.',
      ar: 'يتم التبديل بين ستة أوضاع (Solid · Sketch · Assembly · Sheet Metal · Drawing · Render) عبر علامات التبويب العلوية. جولة سريعة مدتها 60 ثانية.',
    },
  },
  {
    id: 'left',
    title: {
      ko: '좌측 — Features / Bodies / Components',
      en: 'Left — Features / Bodies / Components',
      ja: '左側 — Features / Bodies / Components',
      zh: '左侧 — Features / Bodies / Components',
      es: 'Izquierda — Features / Bodies / Components',
      ar: 'اليسار — Features / Bodies / Components',
    },
    body: {
      ko: '모델 트리, 바디 리스트, ISO 표준부품 카탈로그가 여기 있습니다. 트리 row 를 클릭하면 우측에 속성이 표시됩니다.',
      en: 'Model tree, body list, ISO standard parts catalog. Click any tree row to see its properties on the right.',
      ja: 'モデルツリー、ボディリスト、ISO標準部品カタログがここにあります。ツリーの行をクリックすると右側にプロパティが表示されます。',
      zh: '模型树、实体列表、ISO 标准件目录都在这里。点击树中的任意行即可在右侧查看其属性。',
      es: 'Árbol del modelo, lista de cuerpos y catálogo de piezas estándar ISO. Haz clic en cualquier fila del árbol para ver sus propiedades a la derecha.',
      ar: 'شجرة النموذج، قائمة الأجسام، وكتالوج القطع القياسية ISO موجودة هنا. انقر على أي صف في الشجرة لعرض خصائصه على اليمين.',
    },
    anchor: '.nx-panel:not(.right)',
  },
  {
    id: 'right',
    title: {
      ko: '우측 — Inspector / Nexy AI / Comments',
      en: 'Right — Inspector / Nexy AI / Comments',
      ja: '右側 — Inspector / Nexy AI / Comments',
      zh: '右侧 — Inspector / Nexy AI / Comments',
      es: 'Derecha — Inspector / Nexy AI / Comments',
      ar: 'اليمين — Inspector / Nexy AI / Comments',
    },
    body: {
      ko: 'Inspector 에서 파라미터를 직접 편집하고, ANALYZE 섹션으로 DFM/FEA/Cost 분석을, Nexy AI 탭에서는 자연어 요청을 보냅니다.',
      en: 'Edit parameters directly, run DFM/FEA/Cost from ANALYZE, or chat in Nexy AI tab.',
      ja: 'Inspector でパラメータを直接編集し、ANALYZE から DFM/FEA/Cost を実行、または Nexy AI タブでチャットできます。',
      zh: '在 Inspector 中直接编辑参数，通过 ANALYZE 运行 DFM/FEA/Cost 分析，或在 Nexy AI 标签页中对话。',
      es: 'Edita los parámetros directamente, ejecuta DFM/FEA/Cost desde ANALYZE, o chatea en la pestaña Nexy AI.',
      ar: 'عدّل المعاملات مباشرة، وشغّل DFM/FEA/Cost من ANALYZE، أو تحدّث في تبويب Nexy AI.',
    },
    anchor: '.nx-panel.right',
  },
  {
    id: 'ribbon',
    title: {
      ko: '상단 리본 — 모드별 도구',
      en: 'Top ribbon — mode-aware tools',
      ja: '上部リボン — モード別ツール',
      zh: '顶部功能区 — 按模式显示工具',
      es: 'Cinta superior — herramientas según el modo',
      ar: 'الشريط العلوي — أدوات حسب الوضع',
    },
    body: {
      ko: '활성 모드의 도구가 그룹별로 정렬됩니다. 모드 탭을 클릭하면 리본 + 사이드바가 함께 전환됩니다.',
      en: 'Tools group per active mode. Click a mode tab to switch ribbon + sidebars together.',
      ja: 'アクティブなモードのツールがグループ化されます。モードタブをクリックするとリボンとサイドバーが一緒に切り替わります。',
      zh: '工具会按当前模式分组显示。点击模式标签即可同时切换功能区和侧边栏。',
      es: 'Las herramientas se agrupan según el modo activo. Haz clic en una pestaña de modo para cambiar la cinta y las barras laterales juntas.',
      ar: 'تتجمع الأدوات حسب الوضع النشط. انقر على علامة تبويب الوضع لتبديل الشريط والأشرطة الجانبية معًا.',
    },
    anchor: '.nx-ribbon',
  },
  {
    id: 'drawer',
    title: {
      ko: '하단 드로어 — DFM · FEA · 비용 · 변형 · 모션',
      en: 'Bottom drawer — DFM · FEA · Cost · Variants · Motion',
      ja: '下部ドロワー — DFM · FEA · コスト · バリエーション · モーション',
      zh: '底部抽屉 — DFM · FEA · 成本 · 变体 · 运动',
      es: 'Panel inferior — DFM · FEA · Costo · Variantes · Movimiento',
      ar: 'الدرج السفلي — DFM · FEA · التكلفة · المتغيرات · الحركة',
    },
    body: {
      ko: 'Inspector ANALYZE 행을 클릭하면 분석 드로어가 슬라이드업합니다. 모달 대신 모델 옆에서 즉시 결과 확인.',
      en: 'Click an ANALYZE row to slide the analytics drawer up. Results live alongside your model, not in a modal.',
      ja: 'ANALYZE の行をクリックすると分析ドロワーがスライドアップします。モーダルではなく、モデルの隣で結果を確認できます。',
      zh: '点击 ANALYZE 行即可展开分析抽屉。结果显示在模型旁边，而不是弹窗中。',
      es: 'Haz clic en una fila de ANALYZE para desplegar el panel de análisis. Los resultados aparecen junto a tu modelo, no en una ventana modal.',
      ar: 'انقر على صف ANALYZE لتحريك درج التحليلات لأعلى. تظهر النتائج بجانب نموذجك، وليس في نافذة منبثقة.',
    },
  },
  {
    // Wave 2 Phase 2 Track B5 — sheet metal onboarding step (spec §6.3 / §8 W5).
    // Inserted as the final step so the user has already learned the shell
    // before being introduced to the sheet-metal-specific right pane.
    id: 'sheet-metal',
    title: {
      ko: '판금 모드',
      en: 'Sheet metal mode',
      ja: '板金モード',
      zh: '钣金模式',
      es: 'Modo de chapa metálica',
      ar: 'وضع الصفائح المعدنية',
    },
    body: {
      ko: '피처 트리에서 판금 피처를 클릭하면 우측 패널에 K-팩터 표가 나타납니다. 재료 / 두께 / 절곡 허용량을 즉시 확인하고, 자동 도면 생성으로 PDF 까지 한 번에.',
      en: 'Click any sheet metal feature in the tree to see the right pane with K-factor table. Inspect material / thickness / bend allowance instantly, and run auto-drawing to PDF in one click.',
      ja: 'ツリーで板金フィーチャーをクリックすると、右側パネルに K-factor 表が表示されます。材料 / 板厚 / 曲げ代をすぐに確認し、ワンクリックで自動図面から PDF まで生成できます。',
      zh: '在树中点击任意钣金特征，即可在右侧面板看到 K 系数表。即时查看材料 / 厚度 / 折弯余量，一键生成自动工程图并导出 PDF。',
      es: 'Haz clic en cualquier característica de chapa en el árbol para ver la tabla del factor K en el panel derecho. Consulta material / espesor / tolerancia de doblado al instante, y genera el plano automático a PDF con un clic.',
      ar: 'انقر على أي ميزة صفائح معدنية في الشجرة لعرض جدول عامل K في اللوحة اليمنى. تحقق من المادة / السماكة / سماح الثني فورًا، وشغّل الرسم التلقائي إلى PDF بنقرة واحدة.',
    },
  },
];

export interface OnboardingTutorialProps {
  isKo: boolean;
}

// isKo kept for prop-compat with callers (ModelerShell); step content now
// resolves off the full 6-lang `lang` via useLang()/loc() below instead.
export function OnboardingTutorial({ isKo: _isKo }: OnboardingTutorialProps) {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Auto-show retired (2026-06-09 UX cleanup): the 6-mode welcome tour was one of
  // several first-run modals firing at once. New users now open straight into the
  // blank workspace (pro-CAD style); the empty-canvas Shape Library / AI cards +
  // the first-steps checklist are the guidance. The tour stays mounted so it can
  // be replayed manually from help. (Was: auto-open 600ms after mount when unseen;
  // dismiss() still persists STORAGE_KEY for the manual-replay path.)

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  if (!open) return null;
  const s = STEPS[step];
  const text = { title: loc(lang, s.title), body: loc(lang, s.body) };

  const next = () => {
    if (step >= STEPS.length - 1) dismiss();
    else setStep(s => s + 1);
  };
  const prev = () => setStep(s => Math.max(0, s - 1));
  const dismiss = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '1');
    }
    setOpen(false);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={dismiss}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
        }}
      />
      {/* Card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-onboarding-title"
        aria-describedby="nx-onboarding-body"
        style={{
          position: 'fixed', zIndex: 9001,
          left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(480px, 92vw)',
          background: 'var(--nx-panel)',
          border: '1px solid var(--nx-border)',
          borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          padding: 20,
          color: 'var(--nx-text)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--nx-accent)', color: '#fff',
            fontSize: 13, fontWeight: 700,
          }}>
            {step + 1}
          </span>
          <h2 id="nx-onboarding-title" style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 700 }}>{text.title}</h2>
          <button
            onClick={dismiss}
            aria-label={loc(lang, { ko: '닫기', en: 'Close', ja: '閉じる', zh: '关闭', es: 'Cerrar', ar: 'إغلاق' })}
            style={{
              width: 24, height: 24, border: 0, background: 'transparent',
              color: 'var(--nx-text-3)', fontSize: 18, cursor: 'pointer',
            }}
          >×</button>
        </div>
        <p id="nx-onboarding-body" style={{
          fontSize: 13, lineHeight: 1.6,
          color: 'var(--nx-text-2)',
          margin: '0 0 16px',
        }}>
          {text.body}
        </p>

        {/* Step dots */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i <= step ? 'var(--nx-accent)' : 'var(--nx-border)',
              }}
            />
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={dismiss}
            style={{
              padding: '8px 12px', height: 32,
              border: 0, background: 'transparent',
              color: 'var(--nx-text-3)', fontSize: 12, cursor: 'pointer',
            }}
          >
            {loc(lang, { ko: '건너뛰기', en: 'Skip tour', ja: 'スキップ', zh: '跳过', es: 'Omitir', ar: 'تخطّي' })}
          </button>
          <span style={{ flex: 1 }} />
          {step > 0 && (
            <button
              onClick={prev}
              style={{
                padding: '8px 14px', height: 32,
                border: '1px solid var(--nx-border)', borderRadius: 6,
                background: 'transparent', color: 'var(--nx-text)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              ← {loc(lang, { ko: '이전', en: 'Back', ja: '戻る', zh: '上一步', es: 'Atrás', ar: 'رجوع' })}
            </button>
          )}
          <button
            onClick={next}
            style={{
              padding: '8px 16px', height: 32,
              border: 0, borderRadius: 6,
              background: 'var(--nx-accent)', color: '#fff',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {step >= STEPS.length - 1
              ? loc(lang, { ko: '시작하기', en: 'Get started', ja: '始める', zh: '开始', es: 'Empezar', ar: 'ابدأ' })
              : loc(lang, { ko: '다음 →', en: 'Next →', ja: '次へ →', zh: '下一步 →', es: 'Siguiente →', ar: 'التالي →' })}
          </button>
        </div>
      </div>
    </>
  );
}
