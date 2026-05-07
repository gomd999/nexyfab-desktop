'use client';

/**
 * Tauri-only first-run flow: welcome → privacy choices → files & sync → done.
 * Parent mounts this only when `showDesktopFirstRun` (Tauri + not yet completed).
 */

import React, { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import type { Lang } from '../hooks/useLang';
import { markDesktopFirstRunComplete, setTelemetryOptIn } from '@/lib/platform';
import { trackEvent } from '@/lib/analytics';
import { openUrlInBrowser } from '@/lib/tauri';
import { privacyProcessorsLine } from '@/lib/commercial/dataProcessors';

type Dict = {
  title: string;
  stepOf: (n: number, t: number) => string;
  /** “Technology preview” badge on the welcome ribbon (step 1). */
  techPreviewBadge: string;
  welcomeTitle: string;
  welcomeBody: string;
  /** Capability bullets (Assistant-style checklist). */
  welcomeBullets: readonly string[];
  privacyTitle: string;
  privacyRequired: string;
  termsLinkLabel: string;
  privacyLinkLabel: string;
  privacyOptionalLabel: string;
  privacyOptionalHint: string;
  filesTitle: string;
  filesBody: string;
  filesBullets: readonly string[];
  doneTitle: string;
  doneBody: string;
  /** Where to ask questions after setup (replaces a live Assistant input in first-run). */
  assistantHint: string;
  next: string;
  back: string;
  skip: string;
  start: string;
};

function pathLangFromUiLang(lang: Lang): string {
  if (lang === 'ko') return 'kr';
  return lang;
}

function legalUrl(lang: Lang, page: 'terms' | 'privacy'): string {
  const seg = pathLangFromUiLang(lang);
  const path = page === 'terms' ? 'terms-of-use' : 'privacy-policy';
  return `https://nexyfab.com/${seg}/${path}/`;
}

/** Light, high-contrast panel on top of the dark workspace. */
const V = {
  overlay: 'rgba(15, 23, 42, 0.42)',
  panelBg: '#ffffff',
  panelBorder: '#d0d7de',
  panelShadow: '0 16px 48px rgba(31, 35, 40, 0.22), 0 0 0 1px rgba(31, 35, 40, 0.06)',
  title: '#1f2328',
  body: '#24292f',
  muted: '#424a53',
  subtle: '#57606a',
  link: '#0969da',
  badgeBg: '#ddf4ff',
  badgeBorder: '#54aeff',
  badgeText: '#0550ae',
  wellBg: '#f6f8fa',
  wellBorder: '#d0d7de',
  primary: '#0969da',
  onPrimary: '#ffffff',
  outlineBorder: '#d0d7de',
  outlineBg: '#f6f8fa',
  outlineText: '#24292f',
} as const;

function BulletList({ items, style }: { items: readonly string[]; style?: React.CSSProperties }) {
  return (
    <ul
      style={{
        margin: '14px 0 0',
        paddingLeft: 22,
        fontSize: 14,
        lineHeight: 1.65,
        color: V.body,
        ...style,
      }}
    >
      {items.map((text, i) => (
        <li key={i} style={{ marginBottom: 8 }}>
          {text}
        </li>
      ))}
    </ul>
  );
}

function linkButtonStyle(): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    cursor: 'pointer',
    color: V.link,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: 'underline',
    textUnderlineOffset: 3,
  };
}

const DICT: Record<string, Dict> = {
  ko: {
    title: 'NexyFab 데스크톱에 오신 것을 환영합니다',
    stepOf: (n, t) => `${t}단계 중 ${n}단계`,
    techPreviewBadge: '기술 미리보기',
    welcomeTitle: '시작하기',
    welcomeBody:
      '이 앱은 브라우저 버전과 동일한 워크스페이스를 제공하며, 저장·가져오기·보내기는 운영체제 대화상자를 사용합니다. 계정·클라우드 프로젝트는 nexyfab.com과 동기화됩니다.',
    welcomeBullets: [
      '파라미터 기반 표준 형상·부품으로 빠르게 모델링할 수 있습니다.',
      'STEP·STL·OBJ 등 메시 가져오기와 스케치·특징 편집 워크플로를 지원합니다.',
      'DFM·구조·3D 프린트 등 분석으로 설계를 검증할 수 있습니다.',
      'BOM·제조용 ZIP 등보내기와 견적·협업 흐름과 연결됩니다.',
      '로그인 시 클라우드 프로젝트가 nexyfab.com과 동기화됩니다.',
    ],
    privacyTitle: '개인정보 및 선택 데이터',
    privacyRequired:
      '서비스 운영·보안·결제(해당 시)에 필요한 최소 정보는 약관 및 개인정보처리방침에 따릅니다. 이 화면에서 추가로 보내는 것은 아래 선택 항목뿐입니다.',
    termsLinkLabel: '이용약관',
    privacyLinkLabel: '개인정보처리방침',
    privacyOptionalLabel: '익명 사용 통계로 제품 개선에 참여',
    privacyOptionalHint: '체크하지 않아도 앱은 정상 동작합니다.',
    filesTitle: '파일과 네트워크',
    filesBody:
      '프로젝트(.nfab)는 저장 시 시스템 대화상자로 기록됩니다. STEP·STL·제조용 ZIP 등보내기도 동일합니다. API 요청은 설정에 따라 nexyfab.com으로 연결될 수 있습니다.',
    filesBullets: [
      '프로젝트(.nfab) 저장·다른 이름 저장은 운영체제 파일 대화상자를 사용합니다.',
      'STEP·STL 등 가져오기와 보내기는 로컬 경로와 앱 권한 범위에서 처리됩니다.',
      '데스크톱 빌드의 /api 요청은 환경에 따라 nexyfab.com으로 연결될 수 있습니다.',
      '동기화·댓글 등 온라인 기능은 로그인과 네트워크가 필요합니다.',
    ],
    doneTitle: '준비 완료',
    doneBody: '이제 형상을 만들거나 프로젝트를 열어보세요. 이 안내는 파일 메뉴에서 다시 볼 수 있습니다.',
    assistantHint:
      '모델링·분석에 대한 질문은 워크스페이스의 AI 채팅 패널이나 도움말에서 이어서 물어볼 수 있습니다.',
    next: '다음',
    back: '이전',
    skip: '건너뛰기',
    start: '시작하기',
  },
  en: {
    title: 'Welcome to NexyFab Desktop',
    stepOf: (n, t) => `Step ${n} of ${t}`,
    techPreviewBadge: 'Technology Preview',
    welcomeTitle: 'Get started',
    welcomeBody:
      'This app offers the same workspace as the web version. Save, import, and export use your system dialogs. Accounts and cloud projects sync with nexyfab.com.',
    welcomeBullets: [
      'Model quickly with parametric standard shapes and part workflows.',
      'Import STEP, STL, OBJ meshes and edit with sketch and feature tools.',
      'Validate designs with DFM, structural, and 3D print-oriented analysis.',
      'Connect BOM, manufacturing ZIP exports, quoting, and collaboration.',
      'When signed in, cloud projects stay in sync with nexyfab.com.',
    ],
    privacyTitle: 'Privacy & optional data',
    privacyRequired:
      'Minimum data required to run the service, security, and billing (if any) is described in our Terms and Privacy Policy. Nothing extra is sent unless you opt in below.',
    termsLinkLabel: 'Terms of Use',
    privacyLinkLabel: 'Privacy Policy',
    privacyOptionalLabel: 'Share anonymous usage to help improve NexyFab',
    privacyOptionalHint: 'You can use the app fully with this unchecked.',
    filesTitle: 'Files & network',
    filesBody:
      'Project (.nfab) files are written through the native save dialog. STEP, STL, manufacturing ZIP exports work the same way. API calls may route to nexyfab.com as configured.',
    filesBullets: [
      'Save and Save As for .nfab use your operating system file dialogs.',
      'Import and export to local paths stay within this app’s permissions.',
      'Desktop builds may route /api traffic to nexyfab.com as configured.',
      'Online features such as sync and comments need sign-in and network access.',
    ],
    doneTitle: 'You are set',
    doneBody: 'Create a shape or open a project. You can replay this tour from the File menu anytime.',
    assistantHint:
      'For how-to questions about modeling or analysis, continue in the workspace AI chat panel or Help.',
    next: 'Next',
    back: 'Back',
    skip: 'Skip setup',
    start: 'Start using NexyFab',
  },
  ja: {
    title: 'NexyFab デスクトップへようこそ',
    stepOf: (n, t) => `${t} ステップ中 ${n}`,
    techPreviewBadge: 'テクノロジープレビュー',
    welcomeTitle: 'はじめに',
    welcomeBody:
      'ブラウザ版と同じワークスペースです。保存・インポート・エクスポートは OS のダイアログを使用します。アカウントとクラウドは nexyfab.com と同期します。',
    welcomeBullets: [
      'パラメータ駆動の標準形状・パートで素早くモデリングできます。',
      'STEP・STL・OBJ メッシュの取り込みとスケッチ・フィーチャ編集に対応します。',
      'DFM・構造・3D プリント向け解析で設計を検証できます。',
      'BOM・製造用 ZIP などの出力と見積・コラボレーションに連携します。',
      'サインイン時はクラウド案件が nexyfab.com と同期します。',
    ],
    privacyTitle: 'プライバシーと任意データ',
    privacyRequired:
      'サービス運用・セキュリティ・課金に必要な最小限の情報は利用規約とプライバシーポリシーに従います。追加で送信するのは下の任意オプションのみです。',
    termsLinkLabel: '利用規約',
    privacyLinkLabel: 'プライバシーポリシー',
    privacyOptionalLabel: '匿名の利用統計で製品改善に協力する',
    privacyOptionalHint: 'オフのままでも問題なく使えます。',
    filesTitle: 'ファイルとネットワーク',
    filesBody:
      'プロジェクト (.nfab) は保存時にシステムのダイアログを使用します。STEP・STL・製造用 ZIP も同様です。API は設定により nexyfab.com へ接続される場合があります。',
    filesBullets: [
      '.nfab の保存・別名保存は OS のファイルダイアログを使います。',
      'メッシュのインポート・エクスポートはローカルパスとアプリ権限内で行われます。',
      'デスクトップ版の /api は設定により nexyfab.com に転送されることがあります。',
      '同期やコメントなどオンライン機能はサインインとネットワークが必要です。',
    ],
    doneTitle: '準備完了',
    doneBody: '形状の作成やプロジェクトを開いてください。ファイルメニューからいつでも再表示できます。',
    assistantHint:
      'モデリングや解析の使い方は、ワークスペースの AI チャットやヘルプから続けて質問できます。',
    next: '次へ',
    back: '戻る',
    skip: 'スキップ',
    start: '使い始める',
  },
  cn: {
    title: '欢迎使用 NexyFab 桌面版',
    stepOf: (n, t) => `第 ${n} 步，共 ${t} 步`,
    techPreviewBadge: '技术预览',
    welcomeTitle: '开始',
    welcomeBody:
      '与网页版相同的工作区。保存、导入、导出使用系统对话框。账户与云端项目与 nexyfab.com 同步。',
    welcomeBullets: [
      '使用参数化标准形体与零件流程快速建模。',
      '支持 STEP、STL、OBJ 网格导入及草图与特征编辑。',
      '通过 DFM、结构、3D 打印相关分析验证设计。',
      '衔接 BOM、制造 ZIP 导出、报价与协作流程。',
      '登录后云端项目与 nexyfab.com 同步。',
    ],
    privacyTitle: '隐私与可选数据',
    privacyRequired:
      '服务运行、安全与计费（如适用）所需的最少信息见条款与隐私政策。除下方选择外不会额外发送。',
    termsLinkLabel: '使用条款',
    privacyLinkLabel: '隐私政策',
    privacyOptionalLabel: '通过匿名使用统计帮助改进 NexyFab',
    privacyOptionalHint: '不勾选也可完整使用。',
    filesTitle: '文件与网络',
    filesBody:
      '项目 (.nfab) 通过系统保存对话框写入。STEP、STL、制造 ZIP 导出同样。API 可能按配置连接至 nexyfab.com。',
    filesBullets: [
      '.nfab 的保存与另存为使用操作系统文件对话框。',
      '导入与导出在本地路径与应用权限范围内处理。',
      '桌面版 /api 请求可能按配置转发至 nexyfab.com。',
      '同步、评论等在线功能需要登录与网络。',
    ],
    doneTitle: '准备就绪',
    doneBody: '开始建模或打开项目。可随时在「文件」菜单中再次查看此引导。',
    assistantHint: '建模与分析相关问题可在工作区 AI 聊天或帮助中继续提问。',
    next: '下一步',
    back: '上一步',
    skip: '跳过',
    start: '开始使用',
  },
  es: {
    title: 'Bienvenido a NexyFab Escritorio',
    stepOf: (n, t) => `Paso ${n} de ${t}`,
    techPreviewBadge: 'Vista previa de tecnología',
    welcomeTitle: 'Empezar',
    welcomeBody:
      'La misma área de trabajo que la versión web. Guardar, importar y exportar usan los diálogos del sistema. Cuentas y proyectos en la nube con nexyfab.com.',
    welcomeBullets: [
      'Modela rápido con formas estándar paramétricas y flujos de piezas.',
      'Importa mallas STEP, STL, OBJ y edita con boceto y operaciones.',
      'Valida diseños con DFM, análisis estructural y orientado a impresión 3D.',
      'Conecta BOM, exportación ZIP de fabricación, cotización y colaboración.',
      'Al iniciar sesión, los proyectos en la nube se sincronizan con nexyfab.com.',
    ],
    privacyTitle: 'Privacidad y datos opcionales',
    privacyRequired:
      'Los datos mínimos para operar el servicio, seguridad y facturación están en los Términos y la Política de privacidad. Nada extra salvo lo que elijas abajo.',
    termsLinkLabel: 'Términos de uso',
    privacyLinkLabel: 'Política de privacidad',
    privacyOptionalLabel: 'Compartir uso anónimo para mejorar NexyFab',
    privacyOptionalHint: 'Puedes usar la app sin marcar esto.',
    filesTitle: 'Archivos y red',
    filesBody:
      'Los proyectos (.nfab) se guardan con el diálogo nativo. STEP, STL, ZIP de fabricación igual. Las API pueden ir a nexyfab.com según configuración.',
    filesBullets: [
      'Guardar y Guardar como para .nfab usan los diálogos del sistema.',
      'Importar y exportar a rutas locales permanece dentro de los permisos de la app.',
      'Las compilaciones de escritorio pueden enrutar /api a nexyfab.com según configuración.',
      'Funciones en línea (sincronización, comentarios) requieren sesión y red.',
    ],
    doneTitle: 'Listo',
    doneBody: 'Crea una forma o abre un proyecto. Puedes repetir este tour en el menú Archivo.',
    assistantHint:
      'Para preguntas de modelado o análisis, continúa en el chat de IA del espacio de trabajo o en Ayuda.',
    next: 'Siguiente',
    back: 'Atrás',
    skip: 'Omitir',
    start: 'Empezar',
  },
  ar: {
    title: 'مرحبًا بك في NexyFab للسطح المكتب',
    stepOf: (n, t) => `الخطوة ${n} من ${t}`,
    techPreviewBadge: 'معاينة تقنية',
    welcomeTitle: 'لنبدأ',
    welcomeBody:
      'نفس مساحة العمل كالنسخة على الويب. الحفظ والاستيراد والتصدير يستخدمان نوافذ النظام. الحسابات ومشاريع السحابة تتزامن مع nexyfab.com.',
    welcomeBullets: [
      'نمذجة سريعة بأشكال قياسية معلماتية وتدفقات للمكوّنات.',
      'استيراد شبكات STEP و STL و OBJ والتحرير بالرسم والميزات.',
      'التحقق من التصميم عبر DFM والتحليل الإنشائي ومسار الطباعة ثلاثية الأبعاد.',
      'ربط قائمة المواد وتصدير ZIP للتصنيع والعروض والتعاون.',
      'عند تسجيل الدخول تبقى مشاريع السحابة متزامنة مع nexyfab.com.',
    ],
    privacyTitle: 'الخصوصية والبيانات الاختيارية',
    privacyRequired:
      'أقل البيانات اللازمة للتشغيل والأمان والفوترة (إن وجدت) مذكورة في الشروط وسياسة الخصوصية. لا يُرسل شيء إضافي إلا إذا اخترت أدناه.',
    termsLinkLabel: 'شروط الاستخدام',
    privacyLinkLabel: 'سياسة الخصوصية',
    privacyOptionalLabel: 'مشاركة إحصاءات استخدام مجهولة لتحسين NexyFab',
    privacyOptionalHint: 'يمكنك استخدام التطبيق بالكامل دون تفعيله.',
    filesTitle: 'الملفات والشبكة',
    filesBody:
      'ملفات المشروع (.nfab) تُحفظ عبر نافذة الحفظ الأصلية. STEP و STL وحزمة ZIP للتصنيع كذلك. قد تتجه طلبات API إلى nexyfab.com حسب الإعدادات.',
    filesBullets: [
      'يستدعي الحفظ و«حفظ باسم» لملفات .nfab مربعات حوار الملفات في النظام.',
      'يبقى الاستيراد والتصدير إلى مسارات محلية ضمن أذونات التطبيق.',
      'قد يُوجَّه مسار /api في إصدارات سطح المكتب إلى nexyfab.com حسب الإعداد.',
      'تتطلب المزامنة والتعليقات وغيرها من الميزات عبر الإنترنت حسابًا وشبكة.',
    ],
    doneTitle: 'جاهز',
    doneBody: 'أنشئ شكلًا أو افتح مشروعًا. يمكنك إعادة هذا الدليل من قائمة الملف.',
    assistantHint:
      'لأسئلة النمذجة أو التحليل، تابع في لوحة الدردشة الذكية داخل مساحة العمل أو التعليمات.',
    next: 'التالي',
    back: 'السابق',
    skip: 'تخطي',
    start: 'ابدأ',
  },
};

const TOTAL = 4;

function pickDict(lang: Lang): Dict {
  if (lang === 'ko') return DICT.ko;
  if (lang === 'ja') return DICT.ja;
  if (lang === 'cn') return DICT.cn;
  if (lang === 'es') return DICT.es;
  if (lang === 'ar') return DICT.ar;
  return DICT.en;
}

export interface DesktopFirstRunWizardProps {
  lang: Lang;
  onClose: () => void;
}

export default function DesktopFirstRunWizard({ lang, onClose }: DesktopFirstRunWizardProps) {
  const t = useMemo(() => pickDict(lang), [lang]);
  const [step, setStep] = useState(1);
  const [optIn, setOptIn] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const openLegal = useCallback((page: 'terms' | 'privacy') => {
    void openUrlInBrowser(legalUrl(lang, page));
  }, [lang]);

  const finish = useCallback(() => {
    setTelemetryOptIn(optIn);
    if (optIn) {
      trackEvent('desktop_telemetry_opt_in', { source: 'first_run_wizard' });
    }
    markDesktopFirstRunComplete();
    onClose();
  }, [optIn, onClose]);

  const skipAll = useCallback(() => {
    setTelemetryOptIn(false);
    markDesktopFirstRunComplete();
    onClose();
  }, [onClose]);

  useLayoutEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        skipAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skipAll]);

  const panelTitle =
    step === 1 ? t.welcomeTitle : step === 2 ? t.privacyTitle : step === 3 ? t.filesTitle : t.doneTitle;

  const isRtl = lang === 'ar';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200000,
        background: V.overlay,
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nf-first-run-title"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        dir={isRtl ? 'rtl' : 'ltr'}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: 'min(90dvh, 720px)',
          overflowY: 'auto',
          background: V.panelBg,
          border: `1px solid ${V.panelBorder}`,
          borderRadius: 10,
          boxShadow: V.panelShadow,
          padding: '28px 32px 22px',
          color: V.title,
          fontFamily: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          outline: 'none',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: V.subtle,
            letterSpacing: '0.04em',
            marginBottom: 8,
          }}
        >
          {t.stepOf(step, TOTAL)}
        </div>
        {step === 1 && (
          <div
            style={{
              display: 'inline-block',
              fontSize: 11,
              fontWeight: 800,
              color: V.badgeText,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              marginBottom: 10,
              padding: '4px 10px',
              borderRadius: 4,
              border: `1px solid ${V.badgeBorder}`,
              background: V.badgeBg,
            }}
          >
            {t.techPreviewBadge}
          </div>
        )}
        <h1
          id="nf-first-run-title"
          style={{
            fontSize: 22,
            fontWeight: 800,
            margin: '0 0 16px',
            lineHeight: 1.3,
            color: V.title,
            letterSpacing: '-0.02em',
          }}
        >
          {step === 1 ? t.title : panelTitle}
        </h1>

        {step === 1 && (
          <>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: V.body, margin: 0 }}>{t.welcomeBody}</p>
            <BulletList items={t.welcomeBullets} />
          </>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: V.body, margin: 0 }}>{t.privacyRequired}</p>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: V.muted, margin: '14px 0 0' }}>
              {privacyProcessorsLine(String(lang))}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <button type="button" style={linkButtonStyle()} onClick={() => openLegal('terms')}>
                {t.termsLinkLabel}
              </button>
              <span style={{ color: V.subtle, userSelect: 'none' }} aria-hidden>
                ·
              </span>
              <button type="button" style={linkButtonStyle()} onClick={() => openLegal('privacy')}>
                {t.privacyLinkLabel}
              </button>
            </div>
            <label
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                cursor: 'pointer',
                padding: '14px 16px',
                borderRadius: 8,
                border: `1px solid ${V.wellBorder}`,
                background: V.wellBg,
              }}
            >
              <input
                type="checkbox"
                checked={optIn}
                onChange={(e) => setOptIn(e.target.checked)}
                style={{ marginTop: 4, width: 18, height: 18, flexShrink: 0, accentColor: V.primary }}
              />
              <span>
                <span style={{ fontSize: 15, fontWeight: 600, color: V.title }}>{t.privacyOptionalLabel}</span>
                <span style={{ display: 'block', fontSize: 13, color: V.muted, marginTop: 6, lineHeight: 1.5 }}>
                  {t.privacyOptionalHint}
                </span>
              </span>
            </label>
          </div>
        )}

        {step === 3 && (
          <>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: V.body, margin: 0 }}>{t.filesBody}</p>
            <BulletList items={t.filesBullets} />
          </>
        )}

        {step === 4 && (
          <>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: V.body, margin: 0 }}>{t.doneBody}</p>
            <div
              style={{
                marginTop: 18,
                padding: '14px 16px',
                borderRadius: 8,
                border: `1px solid ${V.wellBorder}`,
                background: V.wellBg,
                fontSize: 14,
                lineHeight: 1.6,
                color: V.muted,
              }}
            >
              {t.assistantHint}
            </div>
          </>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 26,
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={skipAll}
            style={{
              fontSize: 14,
              color: V.subtle,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              padding: '4px 0',
              fontWeight: 600,
            }}
          >
            {t.skip}
          </button>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                style={{
                  padding: '10px 18px',
                  borderRadius: 6,
                  border: `1px solid ${V.outlineBorder}`,
                  background: V.outlineBg,
                  color: V.outlineText,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 1px 0 rgba(31,35,40,0.04)',
                }}
              >
                {t.back}
              </button>
            )}
            {step < TOTAL ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                style={{
                  padding: '10px 22px',
                  borderRadius: 6,
                  border: 'none',
                  background: V.primary,
                  color: V.onPrimary,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(31,35,40,0.12)',
                }}
              >
                {t.next}
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                style={{
                  padding: '10px 22px',
                  borderRadius: 6,
                  border: 'none',
                  background: V.primary,
                  color: V.onPrimary,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(31,35,40,0.12)',
                }}
              >
                {t.start}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
