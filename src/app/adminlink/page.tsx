'use client';

import React, { useState, useEffect } from 'react';
import { AdminSettings } from '@/lib/adminSettings';

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:4000';

export default function AdminLinkPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isAuthorized, setIsAuthorized] = useState(false);

    const [settings, setSettings] = useState<AdminSettings>({
        googleAnalyticsId: '',
        googleVerification: '',
        naverVerification: '',
        bingVerification: '',
        headScripts: '',
        bodyScripts: '',
        adminEmails: ''
    });

    const [activeTab, setActiveTab] = useState<'settings' | 'inquiries'>('settings');

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        // Check if already logged in with admin/superadmin role
        const stored = localStorage.getItem('currentUser');
        if (stored) {
            try {
                const user = JSON.parse(stored);
                if (user.role === 'admin' || user.role === 'superadmin') {
                    setIsAuthorized(true);
                }
            } catch {}
        }

        fetch('/api/admin-settings')
            .then(res => res.json())
            .then(data => {
                setSettings(data);
                setIsLoading(false);
            })
            .catch(err => {
                console.error(err);
                setIsLoading(false);
            });
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);

        try {
            const res = await fetch(`${AUTH_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Login failed');

            if (data.user.role !== 'admin' && data.user.role !== 'superadmin') {
                setMessage({ type: 'error', text: '관리자 권한이 필요합니다.' });
                return;
            }

            // Access token is now set as httpOnly cookie by the server
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            setIsAuthorized(true);
            setMessage(null);
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || '로그인에 실패했습니다.' });
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setMessage(null);

        try {
            const res = await fetch('/api/admin-settings', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(settings),
            });

            const data = await res.json();

            if (res.ok && data.success) {
                setMessage({ type: 'success', text: data.message });
            } else {
                setMessage({ type: 'error', text: data.error || '저장에 실패했습니다.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: '서버 오류가 발생했습니다.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setSettings(prev => ({ ...prev, [name]: value }));
    };

    const handleLogout = () => {
        localStorage.removeItem('currentUser');
        // httpOnly cookies cleared by server on /api/auth/logout
        setIsAuthorized(false);
    };

    if (isLoading) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', fontFamily: 'Pretendard, sans-serif' }}>
                <p>로딩 중...</p>
            </div>
        );
    }

    if (!isAuthorized) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', padding: '16px', fontFamily: 'Pretendard, sans-serif' }}>
                <div style={{ maxWidth: '400px', width: '100%', background: '#fff', padding: '32px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', border: '1px solid #f3f4f6' }}>
                    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                        <h1 style={{ fontSize: '24px', fontWeight: '900', color: '#111827', margin: '0 0 8px' }}>관리자 로그인</h1>
                        <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>Nexysys 관리자 계정으로 로그인하세요.</p>
                    </div>

                    <form style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} onSubmit={handleLogin}>
                        <input
                            type="email"
                            placeholder="이메일"
                            style={{ width: '100%', padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', outline: 'none', transition: '0.2s', fontSize: '15px', boxSizing: 'border-box' }}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoFocus
                        />
                        <input
                            type="password"
                            placeholder="비밀번호"
                            style={{ width: '100%', padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', outline: 'none', transition: '0.2s', fontSize: '15px', boxSizing: 'border-box' }}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                        {message && message.type === 'error' && (
                            <p style={{ color: '#ef4444', fontSize: '13px', fontWeight: '600', margin: 0 }}>{message.text}</p>
                        )}
                        <button
                            type="submit"
                            style={{ width: '100%', background: '#0b5cff', color: '#fff', fontWeight: '700', padding: '14px 16px', borderRadius: '12px', border: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(11,92,255,0.2)', transition: 'background 0.2s' }}
                        >
                            로그인
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: '#f9fafb', padding: '48px 16px', fontFamily: 'Pretendard, sans-serif', boxSizing: 'border-box' }}>
            <div style={{ maxWidth: '768px', margin: '0 auto', background: '#fff', borderRadius: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.04)', border: '1px solid #f3f4f6', overflow: 'hidden' }}>

                <div style={{ background: '#0b5cff', padding: '24px 32px', color: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <div>
                            <h1 style={{ fontSize: '22px', fontWeight: '900', margin: '0 0 4px' }}>Nexyfab 관리자</h1>
                            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '13px', margin: 0 }}>사이트 설정 및 문의 내역을 관리할 수 있습니다.</p>
                        </div>
                        <button
                            onClick={handleLogout}
                            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '6px 14px', borderRadius: '8px', transition: '0.2s' }}
                        >
                            로그아웃
                        </button>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => setActiveTab('settings')}
                            style={{
                                padding: '10px 20px',
                                background: activeTab === 'settings' ? '#fff' : 'transparent',
                                color: activeTab === 'settings' ? '#0b5cff' : '#fff',
                                border: 'none',
                                borderRadius: '10px 10px 0 0',
                                fontWeight: '700',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: '0.2s'
                            }}
                        >
                            환경 설정
                        </button>
                        <button
                            onClick={() => setActiveTab('inquiries')}
                            style={{
                                padding: '10px 20px',
                                background: activeTab === 'inquiries' ? '#fff' : 'transparent',
                                color: activeTab === 'inquiries' ? '#0b5cff' : '#fff',
                                border: 'none',
                                borderRadius: '10px 10px 0 0',
                                fontWeight: '700',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: '0.2s'
                            }}
                        >
                            문의 내역 확인
                        </button>
                    </div>
                </div>

                <div style={{ padding: '32px' }}>
                    {activeTab === 'settings' ? (
                        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

                            {/* Grid 2Cols */}
                            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                                <div style={{ flex: '1 1 calc(50% - 12px)', minWidth: '280px' }}>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>Google Analytics 측정 ID</label>
                                    <input
                                        type="text"
                                        name="googleAnalyticsId"
                                        value={settings.googleAnalyticsId}
                                        onChange={handleChange}
                                        placeholder="예: G-XXXXXXXXXX"
                                        style={{ width: '100%', boxSizing: 'border-box', padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '14px', fontFamily: 'monospace' }}
                                    />
                                </div>
                                <div style={{ flex: '1 1 calc(50% - 12px)', minWidth: '280px' }}>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>Google Site Verification</label>
                                    <input
                                        type="text"
                                        name="googleVerification"
                                        value={settings.googleVerification}
                                        onChange={handleChange}
                                        placeholder="예: rrqY5TvvJIAF..."
                                        style={{ width: '100%', boxSizing: 'border-box', padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '14px', fontFamily: 'monospace' }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                                <div style={{ flex: '1 1 calc(50% - 12px)', minWidth: '280px' }}>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>Naver Site Verification</label>
                                    <input
                                        type="text"
                                        name="naverVerification"
                                        value={settings.naverVerification}
                                        onChange={handleChange}
                                        placeholder="예: 31234abcde123..."
                                        style={{ width: '100%', boxSizing: 'border-box', padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '14px', fontFamily: 'monospace' }}
                                    />
                                </div>
                                <div style={{ flex: '1 1 calc(50% - 12px)', minWidth: '280px' }}>
                                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>Bing Webmaster Code</label>
                                    <input
                                        type="text"
                                        name="bingVerification"
                                        value={settings.bingVerification}
                                        onChange={handleChange}
                                        placeholder="msvalidate.01 값 입력"
                                        style={{ width: '100%', boxSizing: 'border-box', padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '14px', fontFamily: 'monospace' }}
                                    />
                                </div>
                            </div>

                            <hr style={{ border: 'none', borderTop: '1px solid #f3f4f6', margin: '0' }} />

                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <label style={{ fontSize: '14px', fontWeight: '700', color: '#374151', margin: 0 }}>Custom &lt;HEAD&gt; Scripts</label>
                                    <span style={{ fontSize: '11px', background: '#eff6ff', color: '#3b82f6', padding: '2px 8px', borderRadius: '4px', fontWeight: '600' }}>GTM 추천 영역</span>
                                </div>
                                <textarea
                                    name="headScripts"
                                    value={settings.headScripts}
                                    onChange={handleChange}
                                    rows={6}
                                    placeholder="<!-- Google Tag Manager -->&#10;<script>(function(w,d,s,l,i){w[l]=..."
                                    style={{ width: '100%', boxSizing: 'border-box', padding: '12px 16px', background: '#1f2937', color: '#4ade80', border: '1px solid #374151', borderRadius: '12px', fontSize: '13px', fontFamily: 'monospace', lineHeight: '1.5' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>Custom &lt;BODY&gt; Scripts</label>
                                <textarea
                                    name="bodyScripts"
                                    value={settings.bodyScripts}
                                    onChange={handleChange}
                                    rows={4}
                                    placeholder="<!-- Google Tag Manager (noscript) -->&#10;<noscript><iframe src=..."
                                    style={{ width: '100%', boxSizing: 'border-box', padding: '12px 16px', background: '#1f2937', color: '#4ade80', border: '1px solid #374151', borderRadius: '12px', fontSize: '13px', fontFamily: 'monospace', lineHeight: '1.5' }}
                                />
                            </div>

                            <hr style={{ border: 'none', borderTop: '1px solid #f3f4f6', margin: '0' }} />

                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <label style={{ fontSize: '14px', fontWeight: '700', color: '#374151', margin: 0 }}>문의 알림 수신 이메일</label>
                                    <span style={{ fontSize: '11px', background: '#fef3c7', color: '#d97706', padding: '2px 8px', borderRadius: '4px', fontWeight: '600' }}>실시간 알림</span>
                                </div>
                                <input
                                    type="text"
                                    name="adminEmails"
                                    value={settings.adminEmails}
                                    onChange={handleChange}
                                    placeholder="예: info@nexyfab.com, admin@nexyfab.com"
                                    style={{ width: '100%', boxSizing: 'border-box', padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '14px' }}
                                />
                            </div>

                            <hr style={{ border: 'none', borderTop: '1px solid #f3f4f6', margin: '0' }} />

                            {message && (
                                <div style={{ padding: '14px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: '700', background: message.type === 'success' ? '#f0fdf4' : '#fef2f2', color: message.type === 'success' ? '#15803d' : '#b91c1c', border: `1px solid ${message.type === 'success' ? '#bbf7d0' : '#fecaca'}` }}>
                                    {message.text}
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px' }}>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    style={{ background: '#0b5cff', color: '#fff', fontWeight: '700', padding: '14px 28px', borderRadius: '12px', border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1, boxShadow: '0 4px 12px rgba(11,92,255,0.2)' }}
                                >
                                    {isSaving ? '저장 중...' : '변경사항 저장'}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '40px 0' }}>
                            <div style={{ marginBottom: '24px' }}>
                                <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#111827', margin: '0 0 12px' }}>문의 내역 관리</h2>
                                <p style={{ color: '#6b7280', fontSize: '14px', lineHeight: '1.6', margin: '0 auto', maxWidth: '400px' }}>
                                    웹사이트를 통해 접수된 모든 문의 내용이 자동 수집됩니다.
                                </p>
                            </div>

                            <a
                                href="/adminlink/index.php"
                                target="_blank"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: '#0b5cff',
                                    color: '#fff',
                                    fontWeight: '700',
                                    padding: '16px 32px',
                                    borderRadius: '14px',
                                    textDecoration: 'none',
                                    fontSize: '16px',
                                    boxShadow: '0 10px 20px rgba(11,92,255,0.15)',
                                    transition: '0.2s'
                                }}
                            >
                                문의 내역 관리자 열기
                            </a>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
