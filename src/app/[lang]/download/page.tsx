'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

// ─── i18n ────────────────────────────────────────────────────────────────────
type LangKey = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';
const dict: Record<LangKey, {
  hero: string; heroSub: string; version: string; releaseDate: string;
  releaseNotes: string; loading: string; noRelease: string;
  winBtn: string; macBtn: string; macIntelBtn: string; linuxBtn: string;
  osNote: string; changelogTitle: string;
  proTitle: string; proSub: string;
  proFeatures: string[]; proCtaFree: string; proCtaPro: string;
  alreadyPro: string; openTool: string;
  sysReq: string; sysReqWin: string; sysReqMac: string; sysReqLinux: string;
  smartScreenTitle: string; smartScreenDesc: string;
  smartScreenStep1: string; smartScreenStep2: string;
}> = {
  kr: {
    hero: 'NexyFab 데스크톱 다운로드',
    heroSub: '로컬에서 실행되는 3D 설계 툴 — 오프라인 모델링, 네이티브 파일 저장',
    version: '최신 버전',
    releaseDate: '출시일',
    releaseNotes: '릴리즈 노트',
    loading: '릴리즈 정보 로딩 중...',
    noRelease: '릴리즈 정보를 불러오지 못했습니다.',
    winBtn: 'Windows 다운로드',
    macBtn: 'macOS (Apple Silicon)',
    macIntelBtn: 'macOS (Intel)',
    linuxBtn: 'Linux AppImage',
    osNote: '현재 운영체제가 자동 감지됩니다.',
    changelogTitle: '변경 사항',
    proTitle: '더 많은 기능이 필요하신가요?',
    proSub: 'Pro 플랜으로 업그레이드하면 AI 제조 조달, DFM 무제한 분석, 제조사 자동 매칭까지 사용할 수 있습니다.',
    proFeatures: [
      'DFM 분석 무제한',
      'AI 제조사 자동 매칭',
      'CAM 파일 내보내기 (G-code, DXF)',
      '어시스턴트 채팅 무제한',
      'RFQ 자동 발송 무제한',
      '팀 협업 & 프로젝트 공유',
    ],
    proCtaFree: '무료로 시작하기',
    proCtaPro: 'Pro 플랜 보기',
    alreadyPro: '이미 계정이 있으신가요?',
    openTool: '3D 툴 바로 열기',
    sysReq: '시스템 요구사항',
    sysReqWin: 'Windows 10/11 (x64)',
    sysReqMac: 'macOS 10.15 Catalina 이상',
    sysReqLinux: 'Ubuntu 20.04+ / Debian 기반',
    smartScreenTitle: 'Windows 보안 경고가 표시되나요?',
    smartScreenDesc: 'Microsoft SmartScreen이 인식되지 않은 앱을 차단할 수 있습니다. 아직 인증서를 취득하지 않은 초기 릴리즈라 발생하는 현상으로, 앱 자체는 안전합니다.',
    smartScreenStep1: '① "추가 정보" 클릭',
    smartScreenStep2: '② "실행" 클릭',
  },
  en: {
    hero: 'Download NexyFab Desktop',
    heroSub: 'A locally-run 3D design tool — offline modeling, native file saving',
    version: 'Latest Version',
    releaseDate: 'Release Date',
    releaseNotes: 'Release Notes',
    loading: 'Loading release info...',
    noRelease: 'Failed to load release information.',
    winBtn: 'Download for Windows',
    macBtn: 'macOS (Apple Silicon)',
    macIntelBtn: 'macOS (Intel)',
    linuxBtn: 'Linux AppImage',
    osNote: 'Your OS is auto-detected.',
    changelogTitle: 'Changelog',
    proTitle: 'Need more power?',
    proSub: 'Upgrade to Pro for AI procurement, unlimited DFM analysis, and auto manufacturer matching.',
    proFeatures: [
      'Unlimited DFM Analysis',
      'AI Manufacturer Auto-Matching',
      'CAM Export (G-code, DXF)',
      'Unlimited AI Chat',
      'Unlimited RFQ Dispatch',
      'Team Collaboration & Project Sharing',
    ],
    proCtaFree: 'Start for Free',
    proCtaPro: 'View Pro Plans',
    alreadyPro: 'Already have an account?',
    openTool: 'Open 3D Tool',
    sysReq: 'System Requirements',
    sysReqWin: 'Windows 10/11 (x64)',
    sysReqMac: 'macOS 10.15 Catalina or later',
    sysReqLinux: 'Ubuntu 20.04+ / Debian-based',
    smartScreenTitle: 'Seeing a Windows security warning?',
    smartScreenDesc: 'Microsoft SmartScreen may block unrecognized apps. This is expected for early releases without a commercial certificate — the app is safe.',
    smartScreenStep1: '① Click "More info"',
    smartScreenStep2: '② Click "Run anyway"',
  },
  ja: {
    hero: 'NexyFab デスクトップをダウンロード',
    heroSub: 'ローカルで動作する3D設計ツール — オフラインモデリング対応',
    version: '最新バージョン',
    releaseDate: 'リリース日',
    releaseNotes: 'リリースノート',
    loading: 'リリース情報を読み込み中...',
    noRelease: 'リリース情報を取得できませんでした。',
    winBtn: 'Windows ダウンロード',
    macBtn: 'macOS (Apple Silicon)',
    macIntelBtn: 'macOS (Intel)',
    linuxBtn: 'Linux AppImage',
    osNote: '現在のOSが自動検出されます。',
    changelogTitle: '変更履歴',
    proTitle: 'もっと機能が必要ですか？',
    proSub: 'Proプランにアップグレードして、AI調達・DFM無制限分析・メーカー自動マッチングをご利用ください。',
    proFeatures: ['DFM分析無制限', 'AIメーカー自動マッチング', 'CAMエクスポート', 'AIチャット無制限', 'RFQ自動送信無制限', 'チームコラボレーション'],
    proCtaFree: '無料で始める',
    proCtaPro: 'Proプランを見る',
    alreadyPro: 'すでにアカウントをお持ちですか？',
    openTool: '3Dツールを開く',
    sysReq: 'システム要件',
    sysReqWin: 'Windows 10/11 (x64)',
    sysReqMac: 'macOS 10.15以降',
    sysReqLinux: 'Ubuntu 20.04+ / Debianベース',
    smartScreenTitle: 'Windowsのセキュリティ警告が表示されますか？',
    smartScreenDesc: 'SmartScreenが未認識アプリをブロックすることがあります。初期リリースのため証明書未取得ですが、アプリ自体は安全です。',
    smartScreenStep1: '①「詳細情報」をクリック',
    smartScreenStep2: '②「実行」をクリック',
  },
  cn: {
    hero: '下载 NexyFab 桌面版',
    heroSub: '本地运行的3D设计工具 — 离线建模，原生文件保存',
    version: '最新版本',
    releaseDate: '发布日期',
    releaseNotes: '发行说明',
    loading: '加载发行信息...',
    noRelease: '无法加载发行信息。',
    winBtn: 'Windows 下载',
    macBtn: 'macOS (Apple Silicon)',
    macIntelBtn: 'macOS (Intel)',
    linuxBtn: 'Linux AppImage',
    osNote: '自动检测当前操作系统。',
    changelogTitle: '更新日志',
    proTitle: '需要更多功能？',
    proSub: '升级到Pro计划，解锁AI采购、无限DFM分析和制造商自动匹配。',
    proFeatures: ['无限DFM分析', 'AI制造商自动匹配', 'CAM文件导出', '无限AI对话', '无限RFQ发送', '团队协作'],
    proCtaFree: '免费开始',
    proCtaPro: '查看Pro计划',
    alreadyPro: '已有账号？',
    openTool: '打开3D工具',
    sysReq: '系统要求',
    sysReqWin: 'Windows 10/11 (x64)',
    sysReqMac: 'macOS 10.15 或更高',
    sysReqLinux: 'Ubuntu 20.04+ / Debian系',
    smartScreenTitle: '出现 Windows 安全警告？',
    smartScreenDesc: 'SmartScreen 可能会阻止未识别的应用。这是初期版本未申请证书的正常现象，应用本身是安全的。',
    smartScreenStep1: '① 点击"更多信息"',
    smartScreenStep2: '② 点击"仍要运行"',
  },
  es: {
    hero: 'Descargar NexyFab Desktop',
    heroSub: 'Herramienta de diseño 3D local — modelado offline, guardado nativo',
    version: 'Última versión',
    releaseDate: 'Fecha de lanzamiento',
    releaseNotes: 'Notas de la versión',
    loading: 'Cargando información...',
    noRelease: 'No se pudo cargar la información de la versión.',
    winBtn: 'Descargar para Windows',
    macBtn: 'macOS (Apple Silicon)',
    macIntelBtn: 'macOS (Intel)',
    linuxBtn: 'Linux AppImage',
    osNote: 'Tu sistema operativo se detecta automáticamente.',
    changelogTitle: 'Registro de cambios',
    proTitle: '¿Necesitas más funciones?',
    proSub: 'Actualiza al plan Pro para IA de adquisición, DFM ilimitado y matching automático.',
    proFeatures: ['DFM ilimitado', 'Matching automático de fabricantes', 'Exportar CAM', 'Chat IA ilimitado', 'RFQ ilimitado', 'Colaboración en equipo'],
    proCtaFree: 'Comenzar gratis',
    proCtaPro: 'Ver planes Pro',
    alreadyPro: '¿Ya tienes cuenta?',
    openTool: 'Abrir herramienta 3D',
    sysReq: 'Requisitos del sistema',
    sysReqWin: 'Windows 10/11 (x64)',
    sysReqMac: 'macOS 10.15 o superior',
    sysReqLinux: 'Ubuntu 20.04+ / basado en Debian',
    smartScreenTitle: '¿Ves una advertencia de seguridad de Windows?',
    smartScreenDesc: 'SmartScreen puede bloquear aplicaciones no reconocidas. Es normal en versiones iniciales sin certificado comercial. La app es segura.',
    smartScreenStep1: '① Haz clic en "Más información"',
    smartScreenStep2: '② Haz clic en "Ejecutar de todas formas"',
  },
  ar: {
    hero: 'تحميل NexyFab سطح المكتب',
    heroSub: 'أداة تصميم ثلاثية الأبعاد محلية — نمذجة بدون إنترنت',
    version: 'أحدث إصدار',
    releaseDate: 'تاريخ الإصدار',
    releaseNotes: 'ملاحظات الإصدار',
    loading: 'جارٍ تحميل معلومات الإصدار...',
    noRelease: 'تعذر تحميل معلومات الإصدار.',
    winBtn: 'تحميل لـ Windows',
    macBtn: 'macOS (Apple Silicon)',
    macIntelBtn: 'macOS (Intel)',
    linuxBtn: 'Linux AppImage',
    osNote: 'يتم اكتشاف نظام التشغيل تلقائياً.',
    changelogTitle: 'سجل التغييرات',
    proTitle: 'تحتاج إلى المزيد؟',
    proSub: 'قم بالترقية إلى Pro للحصول على تحليل DFM غير محدود ومطابقة المصنعين تلقائياً.',
    proFeatures: ['تحليل DFM غير محدود', 'مطابقة المصنعين التلقائية', 'تصدير CAM', 'دردشة AI غير محدودة', 'RFQ غير محدود', 'تعاون الفريق'],
    proCtaFree: 'ابدأ مجاناً',
    proCtaPro: 'عرض خطط Pro',
    alreadyPro: 'هل لديك حساب بالفعل؟',
    openTool: 'فتح أداة 3D',
    sysReq: 'متطلبات النظام',
    sysReqWin: 'Windows 10/11 (x64)',
    sysReqMac: 'macOS 10.15 أو أحدث',
    sysReqLinux: 'Ubuntu 20.04+ / مبني على Debian',
    smartScreenTitle: 'هل تظهر تحذيرات أمان Windows؟',
    smartScreenDesc: 'قد يحظر SmartScreen التطبيقات غير المعروفة. هذا طبيعي للإصدارات المبكرة. التطبيق آمن تماماً.',
    smartScreenStep1: '① انقر على "مزيد من المعلومات"',
    smartScreenStep2: '② انقر على "تشغيل على أي حال"',
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────
interface ReleaseInfo {
  version: string;
  pub_date: string;
  notes: string;
  download_win_x64: string | null;
  download_mac_aarch64: string | null;
  download_mac_x64: string | null;
  download_linux_x64: string | null;
}

type DetectedOS = 'windows' | 'mac-arm' | 'mac-intel' | 'linux' | 'unknown';

function detectOS(): DetectedOS {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  const platform = (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) {
    // Apple Silicon 감지 (간접적 방법)
    return 'mac-arm';
  }
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

function formatDate(iso: string, lang: string): string {
  try {
    return new Date(iso).toLocaleDateString(lang === 'kr' ? 'ko-KR' : lang === 'ja' ? 'ja-JP' : lang === 'cn' ? 'zh-CN' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/** 다운로드 카운터 증가 (fire-and-forget) */
function trackDownload(platform: string, version?: string) {
  fetch('/api/releases/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, version }),
  }).catch(() => {});
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function DownloadPage() {
  const params = useParams();
  const lang = (params?.lang as LangKey) ?? 'en';
  const t = dict[lang] ?? dict.en;

  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [detectedOS, setDetectedOS] = useState<DetectedOS>('unknown');

  useEffect(() => {
    setDetectedOS(detectOS());
    fetch('/api/releases/latest')
      .then(r => r.json())
      .then((d: ReleaseInfo) => { setRelease(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const isHighlighted = (os: DetectedOS) => detectedOS === os;

  const btnBase = 'flex items-center gap-3 px-6 py-4 rounded-xl font-semibold text-sm transition-all border';
  const btnPrimary = `${btnBase} bg-blue-600 hover:bg-blue-500 text-white border-blue-500 shadow-lg shadow-blue-600/20`;
  const btnSecondary = `${btnBase} bg-white/5 hover:bg-white/10 text-gray-300 border-white/10`;
  const btnHighlight = `${btnBase} bg-blue-600 hover:bg-blue-500 text-white border-blue-500 ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900 shadow-lg shadow-blue-600/30`;

  return (
    <div className="min-h-screen bg-gray-950 text-white" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-20"
          style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, #3b82f6 0%, transparent 70%)' }}
        />
        <div className="relative max-w-4xl mx-auto px-6 py-20 text-center">
          {/* Logo */}
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
            style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)' }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h1 className="text-4xl font-bold mb-3">{t.hero}</h1>
          <p className="text-gray-400 text-lg mb-8">{t.heroSub}</p>

          {/* Version badge */}
          {loading ? (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full text-gray-400 text-sm">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
              </svg>
              {t.loading}
            </div>
          ) : release ? (
            <div className="inline-flex items-center gap-3 px-5 py-2.5 bg-white/5 border border-white/10 rounded-full text-sm">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-gray-200 font-mono font-semibold">v{release.version}</span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-400">{formatDate(release.pub_date, lang)}</span>
            </div>
          ) : (
            <p className="text-red-400 text-sm">{t.noRelease}</p>
          )}
        </div>
      </div>

      {/* Download Buttons */}
      <div className="max-w-4xl mx-auto px-6 pb-12">
        {release && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {/* Windows */}
            {release.download_win_x64 ? (
              <a
                href={release.download_win_x64}
                className={isHighlighted('windows') ? btnHighlight : btnPrimary}
                download
                onClick={() => trackDownload('win_x64', release.version)}
              >
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.801"/>
                </svg>
                <div>
                  <div>{t.winBtn}</div>
                  <div className="text-xs opacity-60 font-normal">.msi · Windows 10/11</div>
                </div>
                {isHighlighted('windows') && (
                  <span className="ml-auto text-xs bg-blue-400/20 text-blue-200 px-2 py-0.5 rounded-full">권장</span>
                )}
              </a>
            ) : (
              <div className={`${btnSecondary} opacity-40 cursor-not-allowed`}>
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.801"/>
                </svg>
                <div>
                  <div>{t.winBtn}</div>
                  <div className="text-xs opacity-60 font-normal">준비 중</div>
                </div>
              </div>
            )}

            {/* macOS Apple Silicon */}
            {release.download_mac_aarch64 ? (
              <a
                href={release.download_mac_aarch64}
                className={isHighlighted('mac-arm') ? btnHighlight : btnSecondary}
                download
                onClick={() => trackDownload('mac_aarch64', release.version)}
              >
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                <div>
                  <div>{t.macBtn}</div>
                  <div className="text-xs opacity-60 font-normal">.dmg · M1/M2/M3</div>
                </div>
              </a>
            ) : (
              <div className={`${btnSecondary} opacity-40 cursor-not-allowed`}>
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                <div>
                  <div>{t.macBtn}</div>
                  <div className="text-xs opacity-60 font-normal">준비 중</div>
                </div>
              </div>
            )}

            {/* macOS Intel */}
            {release.download_mac_x64 && (
              <a href={release.download_mac_x64} className={btnSecondary} download onClick={() => trackDownload('mac_x64', release.version)}>
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                <div>
                  <div>{t.macIntelBtn}</div>
                  <div className="text-xs opacity-60 font-normal">.dmg · Intel</div>
                </div>
              </a>
            )}

            {/* Linux */}
            {release.download_linux_x64 ? (
              <a href={release.download_linux_x64} className={btnSecondary} download onClick={() => trackDownload('linux_x64', release.version)}>
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.544-.09.138-.145.316-.116.514a.548.548 0 00.199.334c.029.105.049.217.089.316.16.409.116.527.112.614-.18.446-.278.836-.248 1.22.031.386.175.743.477 1.054.295.301.73.497 1.331.529 1.05.055 1.951-.456 2.501-.953 1.26-.946 2.22-2.068 2.859-1.723.595.327.664 1.322.576 1.979-.103.656-.381 1.425-.561 2.096l-.073.298c-.086.435.031.906.26 1.283.23.377.55.693.902.884.354.192.756.267 1.172.203a1.725 1.725 0 00.866-.409c.23-.197.425-.468.547-.768.246-.6.215-1.285-.037-2.027-.498-1.472-1.009-2.921-1.007-4.288.002-1.274.48-2.489 1.456-3.623.977-1.136 2.353-2.157 4.042-3.035a10.9 10.9 0 003.184-2.528c.902-1.172 1.471-2.505 1.658-3.979.102-.8.052-1.53-.114-2.188-.166-.657-.46-1.23-.854-1.696-.393-.466-.883-.824-1.467-1.048C14.203.155 13.411 0 12.504 0z"/>
                </svg>
                <div>
                  <div>{t.linuxBtn}</div>
                  <div className="text-xs opacity-60 font-normal">.AppImage · x64</div>
                </div>
              </a>
            ) : (
              <div className={`${btnSecondary} opacity-40 cursor-not-allowed`}>
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.544-.09.138-.145.316-.116.514a.548.548 0 00.199.334c.029.105.049.217.089.316.16.409.116.527.112.614-.18.446-.278.836-.248 1.22.031.386.175.743.477 1.054.295.301.73.497 1.331.529 1.05.055 1.951-.456 2.501-.953 1.26-.946 2.22-2.068 2.859-1.723.595.327.664 1.322.576 1.979-.103.656-.381 1.425-.561 2.096l-.073.298c-.086.435.031.906.26 1.283.23.377.55.693.902.884.354.192.756.267 1.172.203a1.725 1.725 0 00.866-.409c.23-.197.425-.468.547-.768.246-.6.215-1.285-.037-2.027-.498-1.472-1.009-2.921-1.007-4.288.002-1.274.48-2.489 1.456-3.623.977-1.136 2.353-2.157 4.042-3.035a10.9 10.9 0 003.184-2.528c.902-1.172 1.471-2.505 1.658-3.979.102-.8.052-1.53-.114-2.188-.166-.657-.46-1.23-.854-1.696-.393-.466-.883-.824-1.467-1.048C14.203.155 13.411 0 12.504 0z"/>
                </svg>
                <div>
                  <div>{t.linuxBtn}</div>
                  <div className="text-xs opacity-60 font-normal">준비 중</div>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-gray-500 text-xs mb-8">{t.osNote}</p>

        {/* Release Notes */}
        {release?.notes && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t.changelogTitle}</h3>
            <div className="text-gray-400 text-sm whitespace-pre-line leading-relaxed">
              {release.notes.replace(/^##\s+/, '').replace(/\n-\s/g, '\n• ')}
            </div>
          </div>
        )}

        {/* SmartScreen Warning Guide — Windows only */}
        <details className="mb-6 group">
          <summary className="flex items-center gap-3 cursor-pointer list-none bg-amber-500/8 border border-amber-500/20 rounded-2xl px-5 py-4 hover:bg-amber-500/12 transition-colors">
            <svg className="w-5 h-5 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
            <span className="text-sm font-semibold text-amber-300">{t.smartScreenTitle}</span>
            <svg className="w-4 h-4 text-amber-500 ml-auto transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
            </svg>
          </summary>
          <div className="mt-2 bg-amber-500/5 border border-amber-500/15 rounded-2xl px-5 py-4">
            <p className="text-sm text-gray-400 mb-4 leading-relaxed">{t.smartScreenDesc}</p>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5">
                <span className="text-xl">🛡️</span>
                <span className="text-sm font-medium text-gray-200">{t.smartScreenStep1}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-400 self-center">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                </svg>
              </div>
              <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-2.5">
                <span className="text-xl">▶️</span>
                <span className="text-sm font-medium text-blue-300">{t.smartScreenStep2}</span>
              </div>
            </div>
          </div>
        </details>

        {/* System Requirements */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-6 mb-12">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">{t.sysReq}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0 text-gray-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.801"/>
              </svg>
              {t.sysReqWin}
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0 text-gray-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              {t.sysReqMac}
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0 text-gray-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.544-.09.138-.145.316-.116.514a.548.548 0 00.199.334c.029.105.049.217.089.316.16.409.116.527.112.614-.18.446-.278.836-.248 1.22.031.386.175.743.477 1.054.295.301.73.497 1.331.529 1.05.055 1.951-.456 2.501-.953 1.26-.946 2.22-2.068 2.859-1.723.595.327.664 1.322.576 1.979-.103.656-.381 1.425-.561 2.096l-.073.298c-.086.435.031.906.26 1.283.23.377.55.693.902.884.354.192.756.267 1.172.203a1.725 1.725 0 00.866-.409c.23-.197.425-.468.547-.768.246-.6.215-1.285-.037-2.027-.498-1.472-1.009-2.921-1.007-4.288.002-1.274.48-2.489 1.456-3.623.977-1.136 2.353-2.157 4.042-3.035a10.9 10.9 0 003.184-2.528c.902-1.172 1.471-2.505 1.658-3.979.102-.8.052-1.53-.114-2.188-.166-.657-.46-1.23-.854-1.696-.393-.466-.883-.824-1.467-1.048C14.203.155 13.411 0 12.504 0z"/>
              </svg>
              {t.sysReqLinux}
            </div>
          </div>
        </div>
      </div>

      {/* Pro Upsell Section */}
      <div className="border-t border-white/8 bg-gradient-to-b from-gray-950 to-gray-900">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">

            {/* Left: Text */}
            <div>
              <span className="inline-block text-xs font-semibold text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-full px-3 py-1 mb-4">
                Pro
              </span>
              <h2 className="text-2xl font-bold mb-3">{t.proTitle}</h2>
              <p className="text-gray-400 mb-6 leading-relaxed">{t.proSub}</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href={`/${lang}/shape-generator`}
                  className="flex items-center justify-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 rounded-xl font-medium text-sm transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/>
                  </svg>
                  {t.openTool}
                </Link>
                <Link
                  href={`/${lang}/pricing`}
                  className="flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold text-sm transition-all shadow-lg shadow-blue-600/25"
                >
                  {t.proCtaPro}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
                  </svg>
                </Link>
              </div>
              <p className="text-gray-600 text-xs mt-4">
                {t.alreadyPro}{' '}
                <Link href={`/${lang}/shape-generator`} className="text-blue-500 hover:text-blue-400">
                  {t.proCtaFree}
                </Link>
              </p>
            </div>

            {/* Right: Feature List */}
            <div className="grid grid-cols-1 gap-2">
              {t.proFeatures.map((feat, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-4 py-3 bg-white/3 border border-white/8 rounded-xl text-sm text-gray-300"
                >
                  <svg className="w-4 h-4 flex-shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                  </svg>
                  {feat}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <div className="text-center py-8 text-gray-600 text-xs border-t border-white/5">
        <Link href={`/${lang}`} className="hover:text-gray-400 transition-colors">nexyfab.com</Link>
        {' · '}
        <Link href={`/${lang}/pricing`} className="hover:text-gray-400 transition-colors">{t.proCtaPro}</Link>
      </div>

    </div>
  );
}
