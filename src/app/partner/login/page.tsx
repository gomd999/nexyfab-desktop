'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PartnerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // 이미 세션이 있으면 대시보드로
    const session = localStorage.getItem('partnerSession');
    if (session) {
      fetch(`/api/partner/auth?session=${session}`)
        .then(r => r.json())
        .then(d => { if (d.valid) router.replace('/partner/dashboard'); })
        .catch(() => {});
    }
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/partner/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), token: token.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
        return;
      }

      localStorage.setItem('partnerSession', data.sessionToken);
      localStorage.setItem('partnerInfo', JSON.stringify(data.partner));
      router.push('/partner/dashboard');
    } catch {
      setError('서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* 로고 */}
        <div className="text-center mb-8">
          <a href="/" className="inline-block">
            <span className="text-2xl font-black text-gray-900">NexyFab</span>
          </a>
          <h1 className="text-xl font-bold text-gray-800 mt-3">파트너 포털</h1>
          <p className="text-sm text-gray-500 mt-1">파트너 전용 관리 포털입니다</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                이메일 주소
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="partner@example.com"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                액세스 코드 (6자리)
              </label>
              <input
                type="text"
                value={token}
                onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                placeholder="123456"
                maxLength={6}
                inputMode="numeric"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition font-mono tracking-widest text-center text-lg"
              />
            </div>

            {error && (
              <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl font-semibold">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || email.length < 3 || token.length !== 6}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition disabled:opacity-50 text-sm"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-400">
            코드가 없으신가요?{' '}
            <span className="text-gray-600">담당자에게 문의하세요.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
