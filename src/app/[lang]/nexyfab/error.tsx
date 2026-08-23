'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { loc } from '@/lib/i18n/loc';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const lang = usePathname().split('/')[1] ?? 'en';
  const L = (ko: string, en: string, ja: string, zh: string, es: string, ar: string) => loc(lang, { ko, en, ja, zh, es, ar });
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-10 max-w-md w-full text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-lg font-bold text-gray-900">{L('오류가 발생했습니다', 'Something went wrong', 'エラーが発生しました', '发生错误', 'Algo salió mal', 'حدث خطأ')}</h2>
        <p className="text-sm text-gray-500">{error.message || L('페이지를 불러오는 중 문제가 생겼습니다.', 'There was a problem loading the page.', 'ページの読み込み中に問題が発生しました。', '加载页面时出现问题。', 'Se produjo un problema al cargar la página.', 'حدثت مشكلة أثناء تحميل الصفحة。')}</p>
        <button
          onClick={reset}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
        >
          {L('다시 시도', 'Try again', '再試行', '重试', 'Reintentar', 'إعادة المحاولة')}
        </button>
      </div>
    </div>
  );
}
