'use client';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-10 max-w-md w-full text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-lg font-bold text-white">오류가 발생했습니다</h2>
        <p className="text-sm text-gray-400">{error.message || '페이지를 불러오는 중 문제가 생겼습니다.'}</p>
        <button
          onClick={reset}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
