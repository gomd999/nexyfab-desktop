'use client';

import { loc } from '@/lib/i18n/loc';

/**
 * ComingSoonPanel — placeholder panel for Phase 8/9 AI features
 * whose backend routes are scaffolded as stubs. Renders a simple card
 * with the feature name, planned release, and a "Notify me" CTA.
 *
 * Usage:
 *   <ComingSoonPanel
 *     icon="⚖️"
 *     title="견적 비교/협상 어시스턴트"
 *     subtitle="Phase 8-1"
 *     description="여러 공급사 견적을 비교하고 협상 이메일 초안을 자동 작성합니다."
 *     onClose={() => setOpen(false)}
 *   />
 */

interface Props {
  icon: string;
  title: string;
  subtitle?: string;
  description: string;
  plannedRelease?: string;
  onClose?: () => void;
  onNotify?: () => void;
  lang?: string;
}

export default function ComingSoonPanel({
  icon,
  title,
  subtitle,
  description,
  plannedRelease,
  onClose,
  onNotify,
  lang = 'en',
}: Props) {
  const L = (ko: string, en: string, ja = en, zh = en, es = en, ar = en) => loc(lang, { ko, en, ja, zh, es, ar });
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 text-white px-6 py-10 text-center">
          <div className="text-6xl mb-3">{icon}</div>
          <h2 className="text-xl font-black">{title}</h2>
          {subtitle && <p className="text-xs text-gray-400 mt-1 uppercase tracking-wider">{subtitle}</p>}
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
            <p className="text-xs font-bold text-amber-700 uppercase">🚧 {L('출시 예정', 'Coming Soon', '近日公開', '即将推出', 'Próximamente', 'قريبًا')}</p>
            {plannedRelease && (
              <p className="text-sm text-amber-900 font-semibold mt-1">{plannedRelease} {L('예정', 'planned', '予定', '计划', 'previsto', 'مقرر')}</p>
            )}
          </div>

          <p className="text-sm text-gray-600 leading-relaxed text-center">{description}</p>

          <div className="flex gap-2 pt-2">
            {onNotify && (
              <button
                onClick={onNotify}
                className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
              >
                🔔 {L('출시 알림 받기', 'Notify me when it launches', 'リリース通知を受け取る', '获取发布通知', 'Avisarme del lanzamiento', 'أبلغني عند الإطلاق')}
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="px-5 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                {L('닫기', 'Close', '閉じる', '关闭', 'Cerrar', 'إغلاق')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
