'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

// ─── i18n ────────────────────────────────────────────────────────────────────
type LangKey = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

interface Dict {
  hero: string;
  heroSub: string;
  heroCta: string;
  heroFree: string;
  loading: string;
  noRelease: string;
  comingSoon: string;
  comingSoonSub: string;
  waitlistPlaceholder: string;
  waitlistBtn: string;
  waitlistThanks: string;
  platformsTitle: string;
  winName: string; winFile: string; winSize: string;
  macArmName: string; macArmFile: string; macArmSize: string;
  macIntelName: string; macIntelFile: string; macIntelSize: string;
  linuxName: string; linuxFile: string; linuxSize: string;
  downloadBtn: string; comingSoonBadge: string; recommended: string;
  sysReqTitle: string;
  sysReqWinTitle: string; sysReqWinDesc: string;
  sysReqMacTitle: string; sysReqMacDesc: string;
  sysReqLinuxTitle: string; sysReqLinuxDesc: string;
  featuresTitle: string;
  feat1Title: string; feat1Desc: string;
  feat2Title: string; feat2Desc: string;
  feat3Title: string; feat3Desc: string;
  webVersionText: string; webVersionCta: string;
  smartScreenTitle: string; smartScreenDesc: string;
  smartScreenStep1: string; smartScreenStep2: string;
  osNote: string;
}

const dict: Record<LangKey, Dict> = {
  kr: {
    hero: 'NexyFab 데스크탑',
    heroSub: '브라우저 없이 로컬에서 3D 설계 · DFM 분석 · RFQ 전송',
    heroCta: '무료 다운로드',
    heroFree: '무료 다운로드',
    loading: '릴리즈 정보 로딩 중...',
    noRelease: '릴리즈 정보를 불러오지 못했습니다.',
    comingSoon: '출시 준비 중',
    comingSoonSub: '데스크탑 앱이 곧 출시됩니다. 이메일을 등록하면 출시 즉시 알려드립니다.',
    waitlistPlaceholder: '이메일 주소 입력',
    waitlistBtn: '알림 받기',
    waitlistThanks: '등록되었습니다! 출시 시 알려드리겠습니다.',
    platformsTitle: '플랫폼 선택',
    winName: 'Windows', winFile: '.msi', winSize: '45 MB',
    macArmName: 'macOS Apple Silicon', macArmFile: '.dmg', macArmSize: '38 MB',
    macIntelName: 'macOS Intel', macIntelFile: '.dmg', macIntelSize: '40 MB',
    linuxName: 'Linux', linuxFile: '.AppImage', linuxSize: '52 MB',
    downloadBtn: '다운로드',
    comingSoonBadge: '준비 중',
    recommended: '권장',
    sysReqTitle: '시스템 요구사항',
    sysReqWinTitle: 'Windows',
    sysReqWinDesc: 'Windows 10/11 64-bit · RAM 8GB 이상 · GPU DirectX 12',
    sysReqMacTitle: 'macOS',
    sysReqMacDesc: 'macOS 11.0 이상 · M1 또는 Intel · RAM 8GB 이상',
    sysReqLinuxTitle: 'Linux',
    sysReqLinuxDesc: 'Ubuntu 20.04 이상 · AppImage 지원 배포판',
    featuresTitle: '왜 데스크탑 앱인가요?',
    feat1Title: '오프라인 작업',
    feat1Desc: '인터넷 없이도 3D 모델링과 DFM 분석을 완전하게 이용하세요.',
    feat2Title: '빠른 렌더링',
    feat2Desc: 'GPU 직접 접근으로 브라우저보다 최대 10배 빠른 렌더링 성능.',
    feat3Title: '자동 업데이트',
    feat3Desc: '백그라운드에서 자동으로 최신 버전을 다운로드하고 설치합니다.',
    webVersionText: '설치 없이 바로 시작하시겠어요?',
    webVersionCta: '웹 버전으로 바로 시작하기 →',
    smartScreenTitle: 'Windows 보안 경고가 표시되나요?',
    smartScreenDesc: 'Microsoft SmartScreen이 인식되지 않은 앱을 차단할 수 있습니다. 초기 릴리즈라 발생하는 현상이며, 앱은 안전합니다.',
    smartScreenStep1: '① "추가 정보" 클릭',
    smartScreenStep2: '② "실행" 클릭',
    osNote: '현재 운영체제가 자동 감지되었습니다.',
  },
  en: {
    hero: 'NexyFab Desktop',
    heroSub: 'Local 3D design · DFM analysis · RFQ submission — no browser required',
    heroCta: 'Download Free',
    heroFree: 'Free Download',
    loading: 'Loading release info...',
    noRelease: 'Failed to load release information.',
    comingSoon: 'Coming Soon',
    comingSoonSub: 'The desktop app is on its way. Register your email to be notified at launch.',
    waitlistPlaceholder: 'Enter your email',
    waitlistBtn: 'Notify Me',
    waitlistThanks: "You're on the list! We'll notify you at launch.",
    platformsTitle: 'Choose Your Platform',
    winName: 'Windows', winFile: '.msi', winSize: '45 MB',
    macArmName: 'macOS Apple Silicon', macArmFile: '.dmg', macArmSize: '38 MB',
    macIntelName: 'macOS Intel', macIntelFile: '.dmg', macIntelSize: '40 MB',
    linuxName: 'Linux', linuxFile: '.AppImage', linuxSize: '52 MB',
    downloadBtn: 'Download',
    comingSoonBadge: 'Soon',
    recommended: 'Recommended',
    sysReqTitle: 'System Requirements',
    sysReqWinTitle: 'Windows',
    sysReqWinDesc: 'Windows 10/11 64-bit · 8 GB RAM · DirectX 12 GPU',
    sysReqMacTitle: 'macOS',
    sysReqMacDesc: 'macOS 11.0+ · M1 or Intel · 8 GB RAM',
    sysReqLinuxTitle: 'Linux',
    sysReqLinuxDesc: 'Ubuntu 20.04+ · AppImage-compatible distro',
    featuresTitle: 'Why a desktop app?',
    feat1Title: 'Offline Work',
    feat1Desc: 'Full 3D modeling and DFM analysis without an internet connection.',
    feat2Title: 'Fast Rendering',
    feat2Desc: 'Direct GPU access delivers up to 10× faster rendering than the browser.',
    feat3Title: 'Auto Updates',
    feat3Desc: 'New versions download and install silently in the background.',
    webVersionText: 'Want to try without installing?',
    webVersionCta: 'Launch the web version instead →',
    smartScreenTitle: 'Seeing a Windows security warning?',
    smartScreenDesc: 'SmartScreen may block unrecognized apps. Expected for early releases without a commercial certificate — the app is safe.',
    smartScreenStep1: '① Click "More info"',
    smartScreenStep2: '② Click "Run anyway"',
    osNote: 'Your OS was auto-detected.',
  },
  ja: {
    hero: 'NexyFab デスクトップ',
    heroSub: 'ブラウザ不要のローカル3D設計・DFM分析・RFQ送信',
    heroCta: '無料ダウンロード',
    heroFree: '無料ダウンロード',
    loading: 'リリース情報を読み込み中...',
    noRelease: 'リリース情報を取得できませんでした。',
    comingSoon: 'まもなく公開',
    comingSoonSub: 'デスクトップアプリが間もなく公開されます。メールを登録してお知らせを受け取りましょう。',
    waitlistPlaceholder: 'メールアドレスを入力',
    waitlistBtn: '通知を受け取る',
    waitlistThanks: '登録されました！公開時にお知らせします。',
    platformsTitle: 'プラットフォームを選択',
    winName: 'Windows', winFile: '.msi', winSize: '45 MB',
    macArmName: 'macOS Apple Silicon', macArmFile: '.dmg', macArmSize: '38 MB',
    macIntelName: 'macOS Intel', macIntelFile: '.dmg', macIntelSize: '40 MB',
    linuxName: 'Linux', linuxFile: '.AppImage', linuxSize: '52 MB',
    downloadBtn: 'ダウンロード',
    comingSoonBadge: '準備中',
    recommended: 'おすすめ',
    sysReqTitle: 'システム要件',
    sysReqWinTitle: 'Windows',
    sysReqWinDesc: 'Windows 10/11 64-bit · RAM 8GB以上 · GPU DirectX 12',
    sysReqMacTitle: 'macOS',
    sysReqMacDesc: 'macOS 11.0以降 · M1またはIntel · RAM 8GB以上',
    sysReqLinuxTitle: 'Linux',
    sysReqLinuxDesc: 'Ubuntu 20.04以降 · AppImage対応ディストリビューション',
    featuresTitle: 'なぜデスクトップアプリ？',
    feat1Title: 'オフライン作業',
    feat1Desc: 'インターネット不要で3DモデリングとDFM分析が可能。',
    feat2Title: '高速レンダリング',
    feat2Desc: 'GPU直接アクセスによりブラウザ比最大10倍の速度。',
    feat3Title: '自動アップデート',
    feat3Desc: 'バックグラウンドで最新バージョンを自動取得・インストール。',
    webVersionText: 'インストールなしで試しますか？',
    webVersionCta: 'Webバージョンで今すぐ始める →',
    smartScreenTitle: 'Windowsのセキュリティ警告が表示されますか？',
    smartScreenDesc: 'SmartScreenが未認識アプリをブロックすることがあります。初期リリースのため証明書未取得ですが、アプリは安全です。',
    smartScreenStep1: '①「詳細情報」をクリック',
    smartScreenStep2: '②「実行」をクリック',
    osNote: '現在のOSが自動検出されました。',
  },
  cn: {
    hero: 'NexyFab 桌面版',
    heroSub: '无需浏览器，本地3D设计·DFM分析·RFQ发送',
    heroCta: '免费下载',
    heroFree: '免费下载',
    loading: '加载发行信息...',
    noRelease: '无法加载发行信息。',
    comingSoon: '即将推出',
    comingSoonSub: '桌面应用即将发布。注册邮箱，第一时间获取通知。',
    waitlistPlaceholder: '输入邮箱地址',
    waitlistBtn: '通知我',
    waitlistThanks: '已注册！发布时我们会通知您。',
    platformsTitle: '选择平台',
    winName: 'Windows', winFile: '.msi', winSize: '45 MB',
    macArmName: 'macOS Apple Silicon', macArmFile: '.dmg', macArmSize: '38 MB',
    macIntelName: 'macOS Intel', macIntelFile: '.dmg', macIntelSize: '40 MB',
    linuxName: 'Linux', linuxFile: '.AppImage', linuxSize: '52 MB',
    downloadBtn: '下载',
    comingSoonBadge: '即将推出',
    recommended: '推荐',
    sysReqTitle: '系统要求',
    sysReqWinTitle: 'Windows',
    sysReqWinDesc: 'Windows 10/11 64位 · 内存8GB以上 · GPU DirectX 12',
    sysReqMacTitle: 'macOS',
    sysReqMacDesc: 'macOS 11.0以上 · M1或Intel · 内存8GB以上',
    sysReqLinuxTitle: 'Linux',
    sysReqLinuxDesc: 'Ubuntu 20.04以上 · 支持AppImage的发行版',
    featuresTitle: '为什么选择桌面应用？',
    feat1Title: '离线工作',
    feat1Desc: '无需网络，完整使用3D建模与DFM分析功能。',
    feat2Title: '极速渲染',
    feat2Desc: '直接GPU访问，渲染速度最高比浏览器快10倍。',
    feat3Title: '自动更新',
    feat3Desc: '后台静默下载并安装最新版本。',
    webVersionText: '想先试试不安装的方式？',
    webVersionCta: '立即打开网页版 →',
    smartScreenTitle: '出现 Windows 安全警告？',
    smartScreenDesc: 'SmartScreen 可能会阻止未识别的应用。这是初期版本未申请证书的正常现象，应用本身是安全的。',
    smartScreenStep1: '① 点击"更多信息"',
    smartScreenStep2: '② 点击"仍要运行"',
    osNote: '已自动检测到您的操作系统。',
  },
  es: {
    hero: 'NexyFab Desktop',
    heroSub: 'Diseño 3D local · Análisis DFM · Envío de RFQ — sin navegador',
    heroCta: 'Descargar gratis',
    heroFree: 'Descarga gratuita',
    loading: 'Cargando información...',
    noRelease: 'No se pudo cargar la información de la versión.',
    comingSoon: 'Próximamente',
    comingSoonSub: 'La aplicación de escritorio está en camino. Regístrate para recibir una notificación al lanzamiento.',
    waitlistPlaceholder: 'Introduce tu email',
    waitlistBtn: 'Notifícame',
    waitlistThanks: '¡Registrado! Te avisaremos en el lanzamiento.',
    platformsTitle: 'Elige tu plataforma',
    winName: 'Windows', winFile: '.msi', winSize: '45 MB',
    macArmName: 'macOS Apple Silicon', macArmFile: '.dmg', macArmSize: '38 MB',
    macIntelName: 'macOS Intel', macIntelFile: '.dmg', macIntelSize: '40 MB',
    linuxName: 'Linux', linuxFile: '.AppImage', linuxSize: '52 MB',
    downloadBtn: 'Descargar',
    comingSoonBadge: 'Pronto',
    recommended: 'Recomendado',
    sysReqTitle: 'Requisitos del sistema',
    sysReqWinTitle: 'Windows',
    sysReqWinDesc: 'Windows 10/11 64-bit · 8 GB RAM · GPU DirectX 12',
    sysReqMacTitle: 'macOS',
    sysReqMacDesc: 'macOS 11.0+ · M1 o Intel · 8 GB RAM',
    sysReqLinuxTitle: 'Linux',
    sysReqLinuxDesc: 'Ubuntu 20.04+ · distribución compatible con AppImage',
    featuresTitle: '¿Por qué una app de escritorio?',
    feat1Title: 'Trabajo sin conexión',
    feat1Desc: 'Modelado 3D y análisis DFM completos sin internet.',
    feat2Title: 'Renderizado rápido',
    feat2Desc: 'Acceso directo a la GPU para hasta 10× más velocidad que el navegador.',
    feat3Title: 'Actualizaciones automáticas',
    feat3Desc: 'Las nuevas versiones se descargan e instalan en segundo plano.',
    webVersionText: '¿Quieres probar sin instalar?',
    webVersionCta: 'Abrir versión web →',
    smartScreenTitle: '¿Ves una advertencia de seguridad de Windows?',
    smartScreenDesc: 'SmartScreen puede bloquear apps no reconocidas. Normal en versiones iniciales sin certificado. La app es segura.',
    smartScreenStep1: '① Haz clic en "Más información"',
    smartScreenStep2: '② Haz clic en "Ejecutar de todas formas"',
    osNote: 'Tu sistema operativo fue detectado automáticamente.',
  },
  ar: {
    hero: 'NexyFab سطح المكتب',
    heroSub: 'تصميم ثلاثي الأبعاد محلي · تحليل DFM · إرسال RFQ — بدون متصفح',
    heroCta: 'تحميل مجاني',
    heroFree: 'تحميل مجاني',
    loading: 'جارٍ تحميل معلومات الإصدار...',
    noRelease: 'تعذر تحميل معلومات الإصدار.',
    comingSoon: 'قريباً',
    comingSoonSub: 'تطبيق سطح المكتب قادم قريباً. سجّل بريدك الإلكتروني لتلقي إشعار عند الإطلاق.',
    waitlistPlaceholder: 'أدخل بريدك الإلكتروني',
    waitlistBtn: 'أخبرني',
    waitlistThanks: 'تم التسجيل! سنخبرك عند الإطلاق.',
    platformsTitle: 'اختر منصتك',
    winName: 'Windows', winFile: '.msi', winSize: '45 MB',
    macArmName: 'macOS Apple Silicon', macArmFile: '.dmg', macArmSize: '38 MB',
    macIntelName: 'macOS Intel', macIntelFile: '.dmg', macIntelSize: '40 MB',
    linuxName: 'Linux', linuxFile: '.AppImage', linuxSize: '52 MB',
    downloadBtn: 'تحميل',
    comingSoonBadge: 'قريباً',
    recommended: 'موصى به',
    sysReqTitle: 'متطلبات النظام',
    sysReqWinTitle: 'Windows',
    sysReqWinDesc: 'Windows 10/11 64-bit · ذاكرة 8 جيجا · GPU DirectX 12',
    sysReqMacTitle: 'macOS',
    sysReqMacDesc: 'macOS 11.0+ · M1 أو Intel · ذاكرة 8 جيجا',
    sysReqLinuxTitle: 'Linux',
    sysReqLinuxDesc: 'Ubuntu 20.04+ · توزيعة تدعم AppImage',
    featuresTitle: 'لماذا تطبيق سطح المكتب؟',
    feat1Title: 'العمل بدون إنترنت',
    feat1Desc: 'نمذجة 3D كاملة وتحليل DFM دون الحاجة إلى اتصال بالإنترنت.',
    feat2Title: 'عرض سريع',
    feat2Desc: 'وصول مباشر للـ GPU يمنحك سرعة تصل إلى 10× أسرع من المتصفح.',
    feat3Title: 'تحديثات تلقائية',
    feat3Desc: 'يتم تنزيل الإصدارات الجديدة وتثبيتها تلقائياً في الخلفية.',
    webVersionText: 'تريد المحاولة بدون تثبيت؟',
    webVersionCta: 'افتح النسخة الويب مباشرة →',
    smartScreenTitle: 'هل تظهر تحذيرات أمان Windows؟',
    smartScreenDesc: 'قد يحظر SmartScreen التطبيقات غير المعروفة. هذا طبيعي للإصدارات المبكرة. التطبيق آمن.',
    smartScreenStep1: '① انقر على "مزيد من المعلومات"',
    smartScreenStep2: '② انقر على "تشغيل على أي حال"',
    osNote: 'تم اكتشاف نظام التشغيل تلقائياً.',
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
function detectOS(): DetectedOS {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform: string };
  }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? '';

  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';

  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) {
    // Heuristic: Apple Silicon Macs report a touch screen via ontouchend
    // and run an arm64 kernel, but UA alone can't confirm it.
    // We check for the "Mac" + "AppleWebKit" combo; real arm64 detection
    // requires a canvas/WASM trick unavailable at page load.
    // Best we can do: return mac-arm for modern macOS (Safari 17+ / Chrome 122+)
    // where navigator.userAgentData.platform === 'macOS' and no CPU hint.
    // For legacy Intel, ua contains "Intel Mac OS X".
    if (/Intel Mac OS X/i.test(ua)) return 'mac-intel';
    return 'mac-arm';
  }

  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

function trackDownload(platform: string, version?: string) {
  fetch('/api/releases/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, version }),
  }).catch(() => {});
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// OS icons as inline SVGs
const WinIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.801"/>
  </svg>
);

const AppleIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
  </svg>
);

const LinuxIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.544-.09.138-.145.316-.116.514a.548.548 0 00.199.334c.029.105.049.217.089.316.16.409.116.527.112.614-.18.446-.278.836-.248 1.22.031.386.175.743.477 1.054.295.301.73.497 1.331.529 1.05.055 1.951-.456 2.501-.953 1.26-.946 2.22-2.068 2.859-1.723.595.327.664 1.322.576 1.979-.103.656-.381 1.425-.561 2.096l-.073.298c-.086.435.031.906.26 1.283.23.377.55.693.902.884.354.192.756.267 1.172.203a1.725 1.725 0 00.866-.409c.23-.197.425-.468.547-.768.246-.6.215-1.285-.037-2.027-.498-1.472-1.009-2.921-1.007-4.288.002-1.274.48-2.489 1.456-3.623.977-1.136 2.353-2.157 4.042-3.035a10.9 10.9 0 003.184-2.528c.902-1.172 1.471-2.505 1.658-3.979.102-.8.052-1.53-.114-2.188-.166-.657-.46-1.23-.854-1.696-.393-.466-.883-.824-1.467-1.048C14.203.155 13.411 0 12.504 0z"/>
  </svg>
);

// ─── Platform config ─────────────────────────────────────────────────────────
interface PlatformConfig {
  id: DetectedOS;
  getLabel: (t: Dict) => string;
  getFile: (t: Dict) => string;
  getSize: (t: Dict) => string;
  getUrl: (r: ReleaseInfo) => string | null;
  trackKey: string;
  Icon: React.FC<{ className?: string }>;
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: 'windows',
    getLabel: (t) => t.winName,
    getFile: (t) => t.winFile,
    getSize: (t) => t.winSize,
    getUrl: (r) => r.download_win_x64,
    trackKey: 'win_x64',
    Icon: WinIcon,
  },
  {
    id: 'mac-arm',
    getLabel: (t) => t.macArmName,
    getFile: (t) => t.macArmFile,
    getSize: (t) => t.macArmSize,
    getUrl: (r) => r.download_mac_aarch64,
    trackKey: 'mac_aarch64',
    Icon: AppleIcon,
  },
  {
    id: 'mac-intel',
    getLabel: (t) => t.macIntelName,
    getFile: (t) => t.macIntelFile,
    getSize: (t) => t.macIntelSize,
    getUrl: (r) => r.download_mac_x64,
    trackKey: 'mac_x64',
    Icon: AppleIcon,
  },
  {
    id: 'linux',
    getLabel: (t) => t.linuxName,
    getFile: (t) => t.linuxFile,
    getSize: (t) => t.linuxSize,
    getUrl: (r) => r.download_linux_x64,
    trackKey: 'linux_x64',
    Icon: LinuxIcon,
  },
];

// ─── Waitlist form ────────────────────────────────────────────────────────────
function WaitlistForm({ t }: { t: Dict }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    // Fire-and-forget; backend endpoint can be wired later
    fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), product: 'nexyfab-desktop' }),
    }).catch(() => {});
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <p className="text-green-400 text-sm font-medium mt-4">{t.waitlistThanks}</p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t.waitlistPlaceholder}
        className="flex-1 px-4 py-3 bg-white/5 border border-white/15 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
      />
      <button
        type="submit"
        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap"
      >
        {t.waitlistBtn}
      </button>
    </form>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DownloadClient() {
  const params = useParams();
  const lang = (params?.lang as LangKey) ?? 'en';
  const t = dict[lang] ?? dict.en;

  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [detectedOS] = useState<DetectedOS>(() => detectOS());

  useEffect(() => {
    fetch('/api/releases/latest')
      .then((r) => r.json())
      .then((d: ReleaseInfo) => {
        setRelease(d);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  // Determine if any download URL exists (real release vs Coming Soon)
  const hasAnyDownload = release
    ? !!(
        release.download_win_x64 ||
        release.download_mac_aarch64 ||
        release.download_mac_x64 ||
        release.download_linux_x64
      )
    : false;

  // Find the primary platform config matching detected OS
  const primaryPlatform =
    PLATFORMS.find((p) => p.id === detectedOS) ?? PLATFORMS[0];
  const primaryUrl = release ? primaryPlatform.getUrl(release) : null;

  return (
    <div className="min-h-screen text-white" style={{ background: '#0d1117', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Glow */}
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{ background: 'radial-gradient(ellipse 80% 55% at 50% -5%, #2563eb 0%, transparent 68%)' }}
          aria-hidden="true"
        />

        <div className="relative max-w-3xl mx-auto px-6 pt-20 pb-14 text-center">
          {/* App icon */}
          <div
            className="inline-flex items-center justify-center w-18 h-18 rounded-2xl mb-6 shadow-lg shadow-blue-700/30"
            style={{
              width: '4.5rem',
              height: '4.5rem',
              background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold mb-3 tracking-tight">{t.hero}</h1>
          <p className="text-gray-400 text-lg mb-8 leading-relaxed">{t.heroSub}</p>

          {/* Primary CTA */}
          {loading ? (
            <div className="inline-flex items-center gap-2 px-5 py-3 bg-white/5 rounded-full text-gray-400 text-sm">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
              </svg>
              {t.loading}
            </div>
          ) : !hasAnyDownload ? (
            /* Coming Soon hero CTA */
            <div>
              <div className="inline-flex items-center gap-2 px-5 py-2 bg-amber-500/10 border border-amber-500/25 rounded-full text-amber-400 text-sm font-semibold mb-4">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" aria-hidden="true"/>
                {t.comingSoon}
              </div>
              <p className="text-gray-400 text-base mb-2">{t.comingSoonSub}</p>
              <WaitlistForm t={t} />
            </div>
          ) : primaryUrl ? (
            /* Primary download CTA */
            <div>
              <a
                href={primaryUrl}
                download
                onClick={() => trackDownload(primaryPlatform.trackKey, release?.version)}
                className="inline-flex items-center gap-3 px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold text-base rounded-2xl transition-all shadow-lg shadow-blue-600/30 hover:shadow-blue-500/40 hover:-translate-y-0.5 active:translate-y-0"
              >
                <primaryPlatform.Icon className="w-5 h-5 flex-shrink-0"/>
                {t.heroCta} — {primaryPlatform.getLabel(t)}
              </a>
              {release && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" aria-hidden="true"/>
                  <span className="font-mono text-gray-300">v{release.version}</span>
                  <span>·</span>
                  <span>{t.heroFree}</span>
                  <span>·</span>
                  <span className="text-gray-600 text-xs">{t.osNote}</span>
                </div>
              )}
            </div>
          ) : (
            /* Release exists but detected platform has no URL */
            <div className="inline-flex items-center gap-2 px-5 py-2 bg-white/5 border border-white/10 rounded-full text-gray-400 text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" aria-hidden="true"/>
              {release && <><span className="font-mono text-gray-300">v{release.version}</span><span>·</span></>}
              <span>{t.heroFree}</span>
            </div>
          )}
        </div>
      </section>

      {/* ── Platform grid ─────────────────────────────────────────────────────── */}
      {(hasAnyDownload || (!loading && !hasAnyDownload)) && (
        <section className="max-w-4xl mx-auto px-6 pb-12">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 text-center mb-6">
            {t.platformsTitle}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLATFORMS.map((p) => {
              const url = release ? p.getUrl(release) : null;
              const isDetected = p.id === detectedOS;

              return (
                <div
                  key={p.id}
                  className={[
                    'relative flex flex-col items-center gap-3 p-5 rounded-2xl border transition-all',
                    isDetected
                      ? 'bg-blue-600/10 border-blue-500/40 ring-1 ring-blue-500/30'
                      : 'bg-white/3 border-white/8 hover:bg-white/6 hover:border-white/15',
                  ].join(' ')}
                >
                  {isDetected && (
                    <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full">
                      {t.recommended}
                    </span>
                  )}

                  <p.Icon className={['w-8 h-8', isDetected ? 'text-blue-400' : 'text-gray-400'].join(' ')} />

                  <div className="text-center">
                    <p className={['text-sm font-semibold', isDetected ? 'text-white' : 'text-gray-200'].join(' ')}>
                      {p.getLabel(t)}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {p.getFile(t)} · {p.getSize(t)}
                    </p>
                  </div>

                  {url ? (
                    <a
                      href={url}
                      download
                      onClick={() => trackDownload(p.trackKey, release?.version)}
                      className={[
                        'w-full text-center text-xs font-semibold py-2 px-4 rounded-xl transition-all',
                        isDetected
                          ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/25'
                          : 'bg-white/8 hover:bg-white/15 text-gray-300 border border-white/10',
                      ].join(' ')}
                    >
                      {t.downloadBtn}
                    </a>
                  ) : (
                    <span className="w-full text-center text-xs font-medium py-2 px-4 rounded-xl bg-white/3 text-gray-600 border border-white/5 cursor-not-allowed">
                      {t.comingSoonBadge}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── System Requirements ───────────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-12">
        <div className="bg-white/3 border border-white/8 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 mb-5">{t.sysReqTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {/* Windows */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-gray-300">
                <WinIcon className="w-4 h-4 flex-shrink-0 text-blue-400" />
                <span className="text-sm font-semibold">{t.sysReqWinTitle}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{t.sysReqWinDesc}</p>
            </div>
            {/* macOS */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-gray-300">
                <AppleIcon className="w-4 h-4 flex-shrink-0 text-gray-400" />
                <span className="text-sm font-semibold">{t.sysReqMacTitle}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{t.sysReqMacDesc}</p>
            </div>
            {/* Linux */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-gray-300">
                <LinuxIcon className="w-4 h-4 flex-shrink-0 text-yellow-500" />
                <span className="text-sm font-semibold">{t.sysReqLinuxTitle}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{t.sysReqLinuxDesc}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SmartScreen warning ───────────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-12">
        <details className="group">
          <summary className="flex items-center gap-3 cursor-pointer list-none bg-amber-500/8 border border-amber-500/20 rounded-2xl px-5 py-4 hover:bg-amber-500/12 transition-colors">
            <svg className="w-5 h-5 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
            <span className="text-sm font-semibold text-amber-300">{t.smartScreenTitle}</span>
            <svg className="w-4 h-4 text-amber-500 ml-auto transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
            </svg>
          </summary>
          <div className="mt-2 bg-amber-500/5 border border-amber-500/15 rounded-2xl px-5 py-4">
            <p className="text-sm text-gray-400 mb-4 leading-relaxed">{t.smartScreenDesc}</p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5">
                <span aria-hidden="true">🛡️</span>
                <span className="text-sm font-medium text-gray-200">{t.smartScreenStep1}</span>
              </div>
              <svg className="w-4 h-4 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
              <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-2.5">
                <span aria-hidden="true">▶️</span>
                <span className="text-sm font-medium text-blue-300">{t.smartScreenStep2}</span>
              </div>
            </div>
          </div>
        </details>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section className="border-t border-white/6 bg-white/[0.02]">
        <div className="max-w-4xl mx-auto px-6 py-14">
          <h2 className="text-center text-xl font-bold mb-8">{t.featuresTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {/* Offline */}
            <div className="bg-white rounded-2xl p-6 text-gray-900 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728M9 10a3 3 0 116 0 3 3 0 01-6 0z"/>
                  <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <h3 className="font-bold text-base mb-2">{t.feat1Title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{t.feat1Desc}</p>
            </div>
            {/* Fast rendering */}
            <div className="bg-white rounded-2xl p-6 text-gray-900 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-purple-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
              </div>
              <h3 className="font-bold text-base mb-2">{t.feat2Title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{t.feat2Desc}</p>
            </div>
            {/* Auto update */}
            <div className="bg-white rounded-2xl p-6 text-gray-900 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </div>
              <h3 className="font-bold text-base mb-2">{t.feat3Title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{t.feat3Desc}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Web version link ──────────────────────────────────────────────────── */}
      <section className="text-center py-12 border-t border-white/6">
        <p className="text-gray-500 text-sm mb-3">{t.webVersionText}</p>
        <Link
          prefetch
          href={`/${lang}/shape-generator`}
          className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 font-semibold text-sm transition-colors"
        >
          {t.webVersionCta}
        </Link>
      </section>

    </div>
  );
}
