'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { isTauriApp, getRecentFiles, getDesktopVersion, openUrlInBrowser } from '@/lib/tauri';

const dict = {
  ko: { file: '파일', newFile: '새 파일', open: '열기...', recent: '최근 파일', save: '저장', saveAs: '다른 이름으로 저장...', unsaved: '(미저장)', saveBtn: '저장',
        thirdPartyNotices: '오픈소스·제3자 고지',
        replayWelcome: '환영 투어 다시 보기',
        upgradePro: 'Pro로 업그레이드', upgradeDesc: 'DFM 분석 무제한, AI 제조사 매칭, CAM 내보내기, 팀 협업 등 고급 기능을 사용하세요.', viewPricing: '요금제 보기 →',
        planInUse: '플랜 사용 중', allFeatures: '모든 기능을 자유롭게 사용할 수 있습니다.', openDashboard: '대시보드 열기' },
  en: { file: 'File', newFile: 'New File', open: 'Open...', recent: 'Recent Files', save: 'Save', saveAs: 'Save As...', unsaved: '(unsaved)', saveBtn: 'Save',
        thirdPartyNotices: 'Third-party & open-source notices',
        replayWelcome: 'Show welcome tour again',
        upgradePro: 'Upgrade to Pro', upgradeDesc: 'Unlock unlimited DFM analysis, AI supplier matching, CAM export, team collaboration and more.', viewPricing: 'View Pricing →',
        planInUse: 'plan active', allFeatures: 'You have full access to all features.', openDashboard: 'Open Dashboard' },
  ja: { file: 'ファイル', newFile: '新規ファイル', open: '開く...', recent: '最近のファイル', save: '保存', saveAs: '名前を付けて保存...', unsaved: '(未保存)', saveBtn: '保存',
        thirdPartyNotices: 'オープンソース・サードパーティ表示',
        replayWelcome: 'ウェルカムツアーを再表示',
        upgradePro: 'Proにアップグレード', upgradeDesc: 'DFM分析無制限、AIメーカーマッチング、CAMエクスポート、チーム協業など高度な機能を使用できます。', viewPricing: '料金を見る →',
        planInUse: 'プラン使用中', allFeatures: 'すべての機能を自由に利用できます。', openDashboard: 'ダッシュボードを開く' },
  zh: { file: '文件', newFile: '新建', open: '打开...', recent: '最近文件', save: '保存', saveAs: '另存为...', unsaved: '(未保存)', saveBtn: '保存',
        thirdPartyNotices: '开源与第三方声明',
        replayWelcome: '再次显示欢迎引导',
        upgradePro: '升级到 Pro', upgradeDesc: '解锁无限 DFM 分析、AI 制造商匹配、CAM 导出、团队协作等高级功能。', viewPricing: '查看价格 →',
        planInUse: '套餐使用中', allFeatures: '您可以自由使用所有功能。', openDashboard: '打开仪表板' },
  es: { file: 'Archivo', newFile: 'Nuevo Archivo', open: 'Abrir...', recent: 'Archivos Recientes', save: 'Guardar', saveAs: 'Guardar Como...', unsaved: '(sin guardar)', saveBtn: 'Guardar',
        thirdPartyNotices: 'Avisos de código abierto y terceros',
        replayWelcome: 'Ver tour de bienvenida de nuevo',
        upgradePro: 'Actualizar a Pro', upgradeDesc: 'Desbloquea análisis DFM ilimitado, emparejamiento con IA, exportación CAM, colaboración y más.', viewPricing: 'Ver Precios →',
        planInUse: 'plan activo', allFeatures: 'Tienes acceso completo a todas las funciones.', openDashboard: 'Abrir Panel' },
  ar: { file: 'ملف', newFile: 'ملف جديد', open: 'فتح...', recent: 'الملفات الأخيرة', save: 'حفظ', saveAs: 'حفظ باسم...', unsaved: '(غير محفوظ)', saveBtn: 'حفظ',
        thirdPartyNotices: 'إشعارات الطرف الثالث والمصدر المفتوح',
        replayWelcome: 'إظهار جولة الترحيب مرة أخرى',
        upgradePro: 'الترقية إلى Pro', upgradeDesc: 'افتح تحليل DFM غير محدود، ومطابقة الموردين بالذكاء الاصطناعي، وتصدير CAM، والتعاون الجماعي.', viewPricing: 'عرض الأسعار →',
        planInUse: 'الخطة نشطة', allFeatures: 'لديك وصول كامل لجميع الميزات.', openDashboard: 'فتح لوحة التحكم' },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

type UserPlan = 'free' | 'pro' | 'team' | 'enterprise';

interface Props {
  projectName: string;
  isDirty: boolean;
  currentPath: string | null;
  plan?: UserPlan | null;
  lang?: string;
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenRecent: (path: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  /** Desktop: File → replay first-run welcome wizard */
  onReplayWelcome?: () => void;
}

const PLAN_BADGE: Record<UserPlan, { label: string; cls: string }> = {
  free:       { label: 'Free',       cls: 'bg-gray-700 text-gray-300' },
  pro:        { label: 'Pro',        cls: 'bg-blue-600 text-white' },
  team:       { label: 'Team',       cls: 'bg-purple-600 text-white' },
  enterprise: { label: 'Enterprise', cls: 'bg-amber-600 text-white' },
};

export default function DesktopTitleBar({
  projectName,
  isDirty,
  currentPath,
  plan = 'free',
  lang = 'kr',
  onNewFile,
  onOpenFile,
  onOpenRecent,
  onSave,
  onSaveAs,
  onReplayWelcome,
}: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const t = dict[langMap[seg] ?? 'en'];

  const [show, setShow] = useState(false);
  const [version, setVersion] = useState('');
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showUpgradeTip, setShowUpgradeTip] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const upgradeTipRef = useRef<HTMLDivElement>(null);

  const effectivePlan: UserPlan = (plan as UserPlan) ?? 'free';
  const badge = PLAN_BADGE[effectivePlan] ?? PLAN_BADGE.free;
  const isFree = effectivePlan === 'free';

  useEffect(() => {
    setShow(isTauriApp());
    if (isTauriApp()) {
      getDesktopVersion().then(setVersion).catch(() => {});
      getRecentFiles().then(setRecentFiles).catch(() => {});
    }
  }, []);

  // 메뉴 닫기 (외부 클릭)
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // 업그레이드 툴팁 닫기 (외부 클릭)
  useEffect(() => {
    if (!showUpgradeTip) return;
    const handler = (e: MouseEvent) => {
      if (upgradeTipRef.current && !upgradeTipRef.current.contains(e.target as Node)) {
        setShowUpgradeTip(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUpgradeTip]);

  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexyfab.com').replace(/\/$/, '');

  const handleUpgradeClick = useCallback(() => {
    void openUrlInBrowser(`https://nexyfab.com/${lang}/pricing`);
    setShowUpgradeTip(false);
  }, [lang]);

  const handleThirdPartyNotices = useCallback(() => {
    setMenuOpen(false);
    void openUrlInBrowser(`${siteBase}/${seg}/third-party-notices/`);
  }, [seg, siteBase]);

  const handleOpenRecent = useCallback((path: string) => {
    setMenuOpen(false);
    onOpenRecent(path);
  }, [onOpenRecent]);

  const refreshRecent = useCallback(() => {
    getRecentFiles().then(setRecentFiles).catch(() => {});
  }, []);

  if (!show) return null;

  const fileName = currentPath
    ? currentPath.split(/[\\/]/).pop() ?? projectName
    : `${projectName}.nfab`;

  const shortPath = (p: string) => {
    const parts = p.split(/[\\/]/);
    return parts.length > 3 ? `.../${parts.slice(-2).join('/')}` : p;
  };

  return (
    <div
      className="flex items-center h-9 bg-gray-900 border-b border-gray-700 select-none px-2 gap-2 z-50"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 앱 로고 */}
      <span className="text-blue-400 font-bold text-sm tracking-wide shrink-0">
        NexyFab
      </span>
      {version && (
        <span className="text-gray-600 text-xs shrink-0">v{version}</span>
      )}

      {/* 구분선 */}
      <span className="text-gray-700 shrink-0">|</span>

      {/* 파일 메뉴 버튼 */}
      <div
        className="relative"
        ref={menuRef}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => { setMenuOpen(v => !v); refreshRecent(); }}
          className="px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-700 rounded transition-colors"
        >
          {t.file}
        </button>

        {menuOpen && (
          <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-xl z-50 min-w-44 py-1 text-sm">
            <MenuItem label={t.newFile} shortcut="Ctrl+N" onClick={() => { setMenuOpen(false); onNewFile(); }} />
            <MenuItem label={t.open} shortcut="Ctrl+O" onClick={() => { setMenuOpen(false); onOpenFile(); }} />

            {recentFiles.length > 0 && (
              <>
                <div className="border-t border-gray-700 my-1" />
                <div className="px-3 py-0.5 text-gray-500 text-xs">{t.recent}</div>
                {recentFiles.slice(0, 8).map((p) => (
                  <button
                    key={p}
                    onClick={() => handleOpenRecent(p)}
                    className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-gray-700 truncate"
                    title={p}
                  >
                    {shortPath(p)}
                  </button>
                ))}
              </>
            )}

            <div className="border-t border-gray-700 my-1" />
            <MenuItem
              label={t.save}
              shortcut="Ctrl+S"
              onClick={() => { setMenuOpen(false); onSave(); }}
            />
            <MenuItem
              label={t.saveAs}
              shortcut="Ctrl+Shift+S"
              onClick={() => { setMenuOpen(false); onSaveAs(); }}
            />
            {typeof onReplayWelcome === 'function' && (
              <>
                <div className="border-t border-gray-700 my-1" />
                <MenuItem
                  label={t.replayWelcome}
                  onClick={() => { setMenuOpen(false); onReplayWelcome(); }}
                />
              </>
            )}
            <div className="border-t border-gray-700 my-1" />
            <MenuItem label={t.thirdPartyNotices} onClick={handleThirdPartyNotices} />
          </div>
        )}
      </div>

      {/* 현재 파일명 + 더티 표시 */}
      <div
        className="flex items-center gap-1 flex-1 min-w-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-gray-300 text-xs truncate">
          {isDirty && <span className="text-amber-400 mr-1">●</span>}
          {fileName}
        </span>
        {!currentPath && (
          <span className="text-gray-600 text-xs shrink-0">{t.unsaved}</span>
        )}
      </div>

      {/* 저장 버튼 (더티일 때만 강조) */}
      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={onSave}
          title="Ctrl+S"
          className={`px-2 py-0.5 text-xs rounded transition-colors ${
            isDirty
              ? 'text-amber-300 hover:bg-amber-900/40'
              : 'text-gray-600 hover:bg-gray-700'
          }`}
        >
          {t.saveBtn}
        </button>
      </div>

      {/* 플랜 뱃지 */}
      <div
        className="relative ml-1"
        ref={upgradeTipRef}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setShowUpgradeTip(v => !v)}
          className={`px-2 py-0.5 text-xs rounded font-semibold transition-opacity hover:opacity-80 ${badge.cls}`}
        >
          {badge.label}
        </button>

        {showUpgradeTip && (
          <div className="absolute right-0 top-full mt-2 w-64 bg-gray-800 border border-gray-600 rounded-xl shadow-2xl z-50 p-4">
            {isFree ? (
              <>
                <p className="text-white text-sm font-semibold mb-1">{t.upgradePro}</p>
                <p className="text-gray-400 text-xs mb-3 leading-relaxed">
                  {t.upgradeDesc}
                </p>
                <button
                  onClick={handleUpgradeClick}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  {t.viewPricing}
                </button>
              </>
            ) : (
              <>
                <p className="text-white text-sm font-semibold mb-1">{badge.label} {t.planInUse}</p>
                <p className="text-gray-400 text-xs leading-relaxed">{t.allFeatures}</p>
                <button
                  onClick={() => void openUrlInBrowser(`https://nexyfab.com/${lang}/nexyfab/dashboard`)}
                  className="mt-3 w-full py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors"
                >
                  {t.openDashboard}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-gray-700 flex items-center justify-between gap-4"
    >
      <span>{label}</span>
      {shortcut && <span className="text-gray-500 text-xs shrink-0">{shortcut}</span>}
    </button>
  );
}
