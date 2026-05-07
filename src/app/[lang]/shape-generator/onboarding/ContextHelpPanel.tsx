'use client';

/**
 * ContextHelpPanel — context-aware help panel.
 *
 * Shows tips for the currently active mode (sketch / feature / render / general).
 * Opened automatically on first context entry, or by pressing ? at any time.
 * Has 4 tabs (one per context) so the user can browse other sections too.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { ContextKey } from './useContextHelp';

interface ContextHelpPanelProps {
  visible: boolean;
  context: ContextKey;
  lang: string;
  onClose: () => void;
  onDismissForever: (ctx: ContextKey) => void;
  onOpenShortcuts: () => void;
}

// ─── i18n ─────────────────────────────────────────────────────────────────────

type L = Record<string, string>;

const UI: Record<string, L> = {
  ko: {
    title: '도움말',
    tabGeneral: '🏠 일반',
    tabSketch: '✏️ 스케치',
    tabFeature: '⚙️ 피처',
    tabRender: '🎥 렌더링',
    shortcuts: '⌨️ 단축키',
    gotIt: '알겠어요',
    dontShow: '다시 보지 않기',
    close: '닫기',
    hint: '? 키로 언제든 다시 열 수 있어요',
  },
  en: {
    title: 'Help',
    tabGeneral: '🏠 General',
    tabSketch: '✏️ Sketch',
    tabFeature: '⚙️ Feature',
    tabRender: '🎥 Render',
    shortcuts: '⌨️ Shortcuts',
    gotIt: 'Got it',
    dontShow: "Don't show again",
    close: 'Close',
    hint: 'Press ? anytime to reopen',
  },
  ja: {
    title: 'ヘルプ',
    tabGeneral: '🏠 一般',
    tabSketch: '✏️ スケッチ',
    tabFeature: '⚙️ フィーチャー',
    tabRender: '🎥 レンダリング',
    shortcuts: '⌨️ ショートカット',
    gotIt: 'わかりました',
    dontShow: '再表示しない',
    close: '閉じる',
    hint: '?キーでいつでも再表示',
  },
  zh: {
    title: '帮助',
    tabGeneral: '🏠 常规',
    tabSketch: '✏️ 草图',
    tabFeature: '⚙️ 特征',
    tabRender: '🎥 渲染',
    shortcuts: '⌨️ 快捷键',
    gotIt: '明白了',
    dontShow: '不再显示',
    close: '关闭',
    hint: '随时按 ? 重新打开',
  },
  es: {
    title: 'Ayuda',
    tabGeneral: '🏠 General',
    tabSketch: '✏️ Boceto',
    tabFeature: '⚙️ Operación',
    tabRender: '🎥 Render',
    shortcuts: '⌨️ Atajos',
    gotIt: 'Entendido',
    dontShow: 'No mostrar más',
    close: 'Cerrar',
    hint: 'Pulsa ? para reabrir',
  },
  ar: {
    title: 'مساعدة',
    tabGeneral: '🏠 عام',
    tabSketch: '✏️ رسم',
    tabFeature: '⚙️ ميزة',
    tabRender: '🎥 تصيير',
    shortcuts: '⌨️ اختصارات',
    gotIt: 'فهمت',
    dontShow: 'لا تعرض مجدداً',
    close: 'إغلاق',
    hint: 'اضغط ? لإعادة الفتح',
  },
};

const LANG_MAP: Record<string, string> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

function normalizeLang(lang: string): string {
  return LANG_MAP[lang] ?? 'en';
}

function t(lang: string, key: string): string {
  const k = normalizeLang(lang);
  return (UI[k] ?? UI.en)[key] ?? (UI.en[key] ?? key);
}

// ─── Tip card content ─────────────────────────────────────────────────────────

interface TipCard { icon: string; heading: string; lines: string[]; color: string; }
interface ContextContent { title: string; subtitle: string; cards: TipCard[]; }
type ContentMap = Record<ContextKey, ContextContent>;

function getContent(lang: string): ContentMap {
  const nl = normalizeLang(lang);
  const ko = nl === 'ko';
  const ja = nl === 'ja';
  const zh = nl === 'zh';
  const es = nl === 'es';
  const ar = nl === 'ar';

  const s = (
    koStr: string,
    enStr: string,
    jaStr?: string,
    zhStr?: string,
    esStr?: string,
    arStr?: string,
  ) =>
    ko ? koStr
    : ja ? (jaStr ?? enStr)
    : zh ? (zhStr ?? enStr)
    : es ? (esStr ?? enStr)
    : ar ? (arStr ?? enStr)
    : enStr;

  return {
    general: {
      title: s('NexyFab 시작하기', 'Getting Started', 'はじめに', '入门指南', 'Introducción', 'البدء'),
      subtitle: s('기본 워크플로우', 'Basic workflow', '基本ワークフロー', '基本工作流程', 'Flujo básico', 'سير العمل الأساسي'),
      cards: [
        {
          icon: '🧊', color: '#58a6ff',
          heading: s('① 형상 선택', '① Pick a Shape', '① 形状を選択', '① 选择形状', '① Elige una forma', '① اختر شكلاً'),
          lines: [
            s('왼쪽 패널에서 기본 형상 선택', 'Choose a base shape from the left panel', '左パネルから基本形状を選択', '从左侧面板选择基础形状', 'Elige una forma en el panel izquierdo', 'اختر شكلاً أساسياً من اللوحة اليسرى'),
            s('스케치로 직접 그리거나 파일 불러오기', 'Or sketch from scratch / import a file', 'スケッチで描くかファイルを読み込む', '从头绘制或导入文件', 'Dibuja desde cero o importa un archivo', 'ارسم من الصفر أو استورد ملفاً'),
            s('S = 스케치 모드  T = 이동  R = 회전', 'S = Sketch  T = Translate  R = Rotate', 'S = Sketch  T = Translate  R = Rotate', 'S = Sketch  T = Translate  R = Rotate', 'S = Sketch  T = Translate  R = Rotate', 'S = Sketch  T = Translate  R = Rotate'),
          ],
        },
        {
          icon: '⚙️', color: '#3fb950',
          heading: s('② 피처 적용', '② Apply Features', '② フィーチャーを適用', '② 应用特征', '② Aplica operaciones', '② طبّق الميزات'),
          lines: [
            s('상단 Command Toolbar에서 피처 선택', 'Pick a feature from the Command Toolbar', 'Command Toolbarからフィーチャー選択', '从命令工具栏选择特征', 'Elige una operación en la Command Toolbar', 'اختر ميزة من شريط الأوامر'),
            s('스케치 → 돌출, 절삭, 쉘, 필렛…', 'Sketch → Extrude, Cut, Shell, Fillet…', 'Sketch → Extrude, Cut, Shell, Fillet…', 'Sketch → Extrude, Cut, Shell, Fillet…', 'Sketch → Extrude, Cut, Shell, Fillet…', 'Sketch → Extrude, Cut, Shell, Fillet…'),
            s('피처 트리에서 순서 변경·수정 가능', 'Reorder or edit features in the Feature Tree', 'Feature Treeで順序変更・編集可能', '在特征树中重新排序或编辑', 'Reordena o edita en el Feature Tree', 'أعد الترتيب أو عدّل في Feature Tree'),
          ],
        },
        {
          icon: '📦', color: '#f0883e',
          heading: s('③ 견적 요청', '③ Get a Quote', '③ 見積もりを取得', '③ 获取报价', '③ Solicita cotización', '③ احصل على عرض سعر'),
          lines: [
            s('재료 선택 → Get Quote 버튼 클릭', 'Select material → click "Get Quote"', '材料を選択 → "Get Quote"をクリック', '选择材料 → 点击 "Get Quote"', 'Selecciona material → clic en "Get Quote"', 'اختر المادة → انقر "Get Quote"'),
            s('DFM 분석으로 제조 가능성 확인', 'DFM analysis checks manufacturability', 'DFM分析で製造可能性を確認', 'DFM 分析检查可制造性', 'Análisis DFM verifica la manufacturabilidad', 'تحليل DFM يفحص قابلية التصنيع'),
            s('? = 이 도움말  Ctrl+S = 저장', '? = help  Ctrl+S = save  Ctrl+Z = undo', '? = help  Ctrl+S = save  Ctrl+Z = undo', '? = help  Ctrl+S = save  Ctrl+Z = undo', '? = help  Ctrl+S = save  Ctrl+Z = undo', '? = help  Ctrl+S = save  Ctrl+Z = undo'),
          ],
        },
      ],
    },

    sketch: {
      title: s('스케치 모드', 'Sketch Mode', 'スケッチモード', '草图模式', 'Modo Sketch', 'وضع الرسم'),
      subtitle: s('2D 프로파일 → 3D 솔리드', '2D Profile → 3D Solid', '2Dプロファイル → 3Dソリッド', '2D 轮廓 → 3D 实体', 'Perfil 2D → Sólido 3D', 'مظهر 2D → صلب 3D'),
      cards: [
        {
          icon: '🖊', color: '#388bfd',
          heading: s('① 도구 선택', '① Pick a Tool', '① ツールを選択', '① 选择工具', '① Elige una herramienta', '① اختر أداة'),
          lines: [
            'L=Line  A=Arc  C=Circle  R=Rect',
            'P=Poly  E=Ellipse  U=Slot  B=Spline',
            'F=Fillet  K=Mirror  X=Trim  V=Select',
          ],
        },
        {
          icon: '📐', color: '#3fb950',
          heading: s('② 그리고 닫기', '② Draw & Close', '② 描いて閉じる', '② 绘制并闭合', '② Dibuja y cierra', '② ارسم وأغلق'),
          lines: [
            s('캔버스 클릭 → 점 추가', 'Click canvas to add points', 'キャンバスクリックで点追加', '点击画布添加点', 'Clic en el lienzo para añadir puntos', 'انقر على اللوحة لإضافة نقاط'),
            s('시작점 재클릭 → 프로파일 닫힘', 'Click first point again to close profile', '始点を再クリック → プロファイル閉じる', '再次点击起点以闭合轮廓', 'Clic de nuevo en el primer punto para cerrar', 'انقر على أول نقطة لإغلاق المسار'),
            s('그리드 5mm · Shift = 각도 고정', 'Grid 5mm · Shift = lock angle', 'グリッド 5mm · Shift = 角度固定', '网格 5mm · Shift = 锁定角度', 'Rejilla 5mm · Shift = fijar ángulo', 'شبكة 5مم · Shift = تثبيت الزاوية'),
          ],
        },
        {
          icon: '⬆️', color: '#f0883e',
          heading: s('③ 3D 돌출', '③ Extrude to 3D', '③ 3D Extrude', '③ 3D Extrude', '③ Extrude a 3D', '③ Extrude إلى 3D'),
          lines: [
            s('닫힌 프로파일 → 하단 돌출 버튼 출현', 'Closed profile → Extrude button appears', '閉じたプロファイル → Extrudeボタン出現', '闭合轮廓 → 出现 Extrude 按钮', 'Perfil cerrado → aparece botón Extrude', 'مسار مغلق → يظهر زر Extrude'),
            s('깊이·방향·연산(추가/절삭) 설정', 'Set depth, direction, add/subtract', '深さ・方向・追加/除去を設定', '设置深度、方向、加/减', 'Configura profundidad, dirección, añadir/restar', 'اضبط العمق والاتجاه والإضافة/الطرح'),
            s('Esc = 스케치 종료  Ctrl+Z = 실행 취소', 'Esc = exit sketch  Ctrl+Z = undo', 'Esc = exit sketch  Ctrl+Z = undo', 'Esc = exit sketch  Ctrl+Z = undo', 'Esc = exit sketch  Ctrl+Z = undo', 'Esc = exit sketch  Ctrl+Z = undo'),
          ],
        },
      ],
    },

    feature: {
      title: s('피처 도구', 'Feature Tools', 'フィーチャーツール', '特征工具', 'Herramientas de operación', 'أدوات الميزات'),
      subtitle: s('형상에 3D 조작 적용', 'Apply 3D operations to geometry', '形状に3D操作を適用', '对几何体应用 3D 操作', 'Aplica operaciones 3D al modelo', 'طبّق عمليات 3D على الشكل'),
      cards: [
        {
          icon: '✏️', color: '#388bfd',
          heading: s('① 스케치 먼저', '① Sketch First', '① まずスケッチ', '① 先绘制草图', '① Boceto primero', '① الرسم أولاً'),
          lines: [
            s('S 키 → 스케치 모드 진입', 'Press S to enter Sketch Mode', 'Sキー → スケッチモード', '按 S 进入草图模式', 'Pulsa S para modo Sketch', 'اضغط S للدخول إلى وضع Sketch'),
            s('닫힌 프로파일 그리기 → 피처 적용', 'Draw a closed profile → apply feature', '閉じたプロファイルを描く → フィーチャー適用', '绘制闭合轮廓 → 应用特征', 'Dibuja perfil cerrado → aplica operación', 'ارسم مساراً مغلقاً → طبّق ميزة'),
            s('돌출, 절삭, 회전, 쉘 등 선택', 'Choose Extrude, Cut, Revolve, Shell…', 'Extrude, Cut, Revolve, Shellなど選択', '选择 Extrude, Cut, Revolve, Shell…', 'Elige Extrude, Cut, Revolve, Shell…', 'اختر Extrude, Cut, Revolve, Shell…'),
          ],
        },
        {
          icon: '⚙️', color: '#3fb950',
          heading: s('② 파라미터 조정', '② Adjust Parameters', '② パラメータ調整', '② 调整参数', '② Ajusta parámetros', '② اضبط المعاملات'),
          lines: [
            s('왼쪽 패널에서 깊이·각도·두께 설정', 'Set depth, angle, thickness in left panel', '左パネルで深さ・角度・厚み設定', '在左侧面板设置深度、角度、厚度', 'Configura profundidad, ángulo y grosor a la izquierda', 'اضبط العمق والزاوية والسماكة في اللوحة اليسرى'),
            s('연산 방식: 추가 / 절삭 / 교집합', 'Operation: Add / Subtract / Intersect', '演算: Add / Subtract / Intersect', '运算: Add / Subtract / Intersect', 'Operación: Add / Subtract / Intersect', 'العملية: Add / Subtract / Intersect'),
            s('3D 뷰포트에서 실시간 프리뷰', 'Real-time preview in 3D viewport', '3Dビューポートでリアルタイムプレビュー', '在 3D 视口实时预览', 'Vista previa en tiempo real en el viewport 3D', 'معاينة فورية في العرض ثلاثي الأبعاد'),
          ],
        },
        {
          icon: '🌳', color: '#d2a8ff',
          heading: s('③ 피처 트리', '③ Feature Tree', '③ Feature Tree', '③ Feature Tree', '③ Feature Tree', '③ Feature Tree'),
          lines: [
            s('왼쪽 패널 → 피처 순서 드래그', 'Left panel → drag to reorder features', '左パネル → フィーチャーをドラッグで並べ替え', '左侧面板 → 拖动重新排序特征', 'Panel izquierdo → arrastra para reordenar', 'اللوحة اليسرى → اسحب لإعادة الترتيب'),
            s('아이콘 클릭 → 해당 피처 수정', 'Click icon to edit any past feature', 'アイコンクリックで過去のフィーチャー編集', '点击图标编辑任何已有特征', 'Clic en ícono para editar una operación', 'انقر على الأيقونة لتعديل أي ميزة سابقة'),
            s('Ctrl+Z = 피처 실행 취소', 'Ctrl+Z = undo last feature', 'Ctrl+Z = undo last feature', 'Ctrl+Z = undo last feature', 'Ctrl+Z = undo last feature', 'Ctrl+Z = undo last feature'),
          ],
        },
      ],
    },

    render: {
      title: s('렌더링 / 미리보기', 'Rendering / Preview', 'レンダリング / プレビュー', '渲染 / 预览', 'Renderizado / Vista previa', 'التصيير / المعاينة'),
      subtitle: s('실시간 3D 렌더링', 'Real-time 3D rendering', 'リアルタイム3Dレンダリング', '实时 3D 渲染', 'Renderizado 3D en tiempo real', 'تصيير 3D فوري'),
      cards: [
        {
          icon: '🎨', color: '#f0883e',
          heading: s('① 재료 & 조명', '① Material & Lighting', '① 材料 & ライティング', '① 材料与光照', '① Material e iluminación', '① المادة والإضاءة'),
          lines: [
            s('왼쪽 패널에서 재료 선택', 'Select material from left panel', '左パネルから材料を選択', '从左侧面板选择材料', 'Selecciona material en el panel izquierdo', 'اختر المادة من اللوحة اليسرى'),
            s('Albedo / Roughness / Metalness 조정', 'Adjust Albedo / Roughness / Metalness', 'Albedo / Roughness / Metalness調整', '调整 Albedo / Roughness / Metalness', 'Ajusta Albedo / Roughness / Metalness', 'اضبط Albedo / Roughness / Metalness'),
            s('환경맵이 조명에 영향', 'Environment map affects lighting', '環境マップが照明に影響', '环境贴图影响光照', 'El mapa de entorno afecta la iluminación', 'خريطة البيئة تؤثر على الإضاءة'),
          ],
        },
        {
          icon: '📷', color: '#58a6ff',
          heading: s('② 뷰포트 조작', '② Viewport Controls', '② ビューポート操作', '② 视口操作', '② Controles de viewport', '② تحكم في العرض'),
          lines: [
            s('마우스 드래그 = 궤도  휠 = 줌', 'Drag = orbit  Scroll = zoom', 'ドラッグ = オービット  ホイール = ズーム', '拖动 = 轨道  滚轮 = 缩放', 'Arrastrar = orbitar  Rueda = zoom', 'السحب = دوران  العجلة = تكبير'),
            s('F = 카메라 피트  0 = 등각뷰', 'F = fit camera  0 = isometric', 'F = fit camera  0 = isometric', 'F = fit camera  0 = isometric', 'F = fit camera  0 = isometric', 'F = fit camera  0 = isometric'),
            s('7 = 상단  5 = 정면  6 = 우측', '7 = top  5 = front  6 = right', '7 = top  5 = front  6 = right', '7 = top  5 = front  6 = right', '7 = top  5 = front  6 = right', '7 = top  5 = front  6 = right'),
          ],
        },
        {
          icon: '📤', color: '#3fb950',
          heading: s('③ 내보내기', '③ Export', '③ エクスポート', '③ 导出', '③ Exportar', '③ تصدير'),
          lines: [
            s('STL / STEP / OBJ / GLTF 지원', 'STL / STEP / OBJ / GLTF supported', 'STL / STEP / OBJ / GLTF supported', 'STL / STEP / OBJ / GLTF supported', 'STL / STEP / OBJ / GLTF supported', 'STL / STEP / OBJ / GLTF supported'),
            s('스크린샷 공유: 툴바 카메라 버튼', 'Screenshot: toolbar camera button', 'スクリーンショット: ツールバーのカメラボタン', '截图：工具栏相机按钮', 'Captura: botón cámara en la barra', 'لقطة شاشة: زر الكاميرا في الشريط'),
            s('Ctrl+S = 프로젝트 저장 (.nfab)', 'Ctrl+S = save project (.nfab)', 'Ctrl+S = save project (.nfab)', 'Ctrl+S = save project (.nfab)', 'Ctrl+S = save project (.nfab)', 'Ctrl+S = save project (.nfab)'),
          ],
        },
      ],
    },
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

const TABS: ContextKey[] = ['general', 'sketch', 'feature', 'render'];

const NARROW_TIP_GRID_MQ = '(max-width: 640px)';

export default function ContextHelpPanel({
  visible, context, lang, onClose, onDismissForever, onOpenShortcuts,
}: ContextHelpPanelProps) {
  const [activeTab, setActiveTab] = useState<ContextKey>(context);
  const [exiting, setExiting] = useState(false);
  const [tipGridOneColumn, setTipGridOneColumn] = useState(false);
  const content = getContent(lang);

  // When context changes externally, switch to that tab
  useEffect(() => {
    if (visible) setActiveTab(context);
  }, [context, visible]);

  // 3 tips: one row on desktop (no empty 4th cell); stack on narrow viewports
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(NARROW_TIP_GRID_MQ);
    const sync = () => setTipGridOneColumn(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Keyboard: Esc closes
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    setExiting(true);
    setTimeout(() => { setExiting(false); onClose(); }, 200);
  }, [onClose]);

  if (!visible) return null;

  const tabLabel = (k: ContextKey) => t(lang, `tab${k.charAt(0).toUpperCase() + k.slice(1)}`);
  const current = content[activeTab];

  return (
    <div
      onClick={e => { if (e.currentTarget === e.target) close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
        opacity: exiting ? 0 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#161b22', border: '1px solid #30363d',
          borderRadius: 16,
          width: 'min(820px, 96vw)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          transform: exiting ? 'scale(0.97) translateY(6px)' : 'scale(1) translateY(0)',
          transition: 'transform 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px 0',
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f0f6fc', letterSpacing: -0.35, lineHeight: 1.25, wordBreak: 'keep-all' }}>
              {current.title}
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4, lineHeight: 1.45, wordBreak: 'keep-all' }}>
              {current.subtitle}
            </div>
          </div>
          <button onClick={close} style={{
            background: 'none', border: 'none', color: '#484f58', cursor: 'pointer',
            fontSize: 20, lineHeight: 1, padding: '2px 6px', borderRadius: 4,
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.background = '#21262d'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#484f58'; e.currentTarget.style.background = 'none'; }}
          >×</button>
        </div>

        {/* ── Context tabs ── */}
        <div style={{
          display: 'flex', gap: 4, padding: '12px 20px 0',
          borderBottom: '1px solid #21262d', marginBottom: 0,
        }}>
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 14px', borderRadius: '6px 6px 0 0',
                border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                background: activeTab === tab ? '#21262d' : 'transparent',
                color: activeTab === tab ? '#e6edf3' : '#6e7681',
                borderBottom: activeTab === tab ? '2px solid #388bfd' : '2px solid transparent',
                transition: 'all 0.15s',
                position: 'relative', bottom: -1,
              }}
              onMouseEnter={e => { if (activeTab !== tab) e.currentTarget.style.color = '#c9d1d9'; }}
              onMouseLeave={e => { if (activeTab !== tab) e.currentTarget.style.color = '#6e7681'; }}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>

        {/* ── Tip cards: always 3 columns on wide view (avoids 2+1 empty corner); 1 col on small screens ── */}
        <div style={{
          padding: '18px 20px',
          display: 'grid',
          gridTemplateColumns: tipGridOneColumn ? '1fr' : 'repeat(3, minmax(0, 1fr))',
          gap: 14,
        }}>
          {current.cards.map((card, i) => (
            <div key={i} style={{
              background: '#0d1117', borderRadius: 12,
              border: `1px solid ${card.color}33`,
              borderTop: `3px solid ${card.color}`,
              padding: '14px 16px',
              minHeight: 0,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 13.5, fontWeight: 800, color: card.color, marginBottom: 10,
                lineHeight: 1.3,
                wordBreak: 'keep-all',
              }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>{card.icon}</span>
                <span>{card.heading}</span>
              </div>
              {card.lines.map((line, li) => (
                <div key={li} style={{
                  fontSize: 13,
                  color: '#c9d1d9',
                  lineHeight: 1.65,
                  marginBottom: li < card.lines.length - 1 ? 8 : 0,
                  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                  /* CJK: 어절 단위 줄바꿈 (break-word는 한 글자씩 끊김) */
                  wordBreak: 'keep-all',
                  overflowWrap: 'break-word',
                }}>
                  {line}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 10,
          padding: '4px 20px 18px',
        }}>
          <span style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.45, maxWidth: '100%' }}>
            {t(lang, 'hint')}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={onOpenShortcuts} style={footerBtn('#8b949e')}>
              {t(lang, 'shortcuts')}
            </button>
            <button onClick={() => onDismissForever(activeTab)} style={footerBtn('#484f58')}>
              {t(lang, 'dontShow')}
            </button>
            <button onClick={close} style={primaryBtn}>
              {t(lang, 'gotIt')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function footerBtn(color: string): React.CSSProperties {
  return {
    padding: '7px 14px', borderRadius: 8,
    border: `1px solid ${color}55`, background: 'transparent',
    color, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  };
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 8,
  border: 'none', background: '#388bfd',
  color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
