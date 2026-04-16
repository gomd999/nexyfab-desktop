'use client';

import React, { useState, useEffect, use, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ErrorBoundary from '@/app/components/ErrorBoundary';
import { useRouter } from 'next/navigation';
import { useEscapeKey } from '@/hooks/useEscapeKey';

// ── 전자서명 모달 ─────────────────────────────────────────────────────────────
function SignatureModal({ blue, onSign, onClose }: { blue: string; onSign: (data: string) => void; onClose: () => void }) {
    useEscapeKey(onClose);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [drawing, setDrawing] = useState(false);
    const [hasDrawn, setHasDrawn] = useState(false);

    const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        if ('touches' in e) {
            return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
        }
        return { x: ((e as React.MouseEvent).clientX - rect.left) * scaleX, y: ((e as React.MouseEvent).clientY - rect.top) * scaleY };
    };

    const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        const ctx = canvasRef.current!.getContext('2d')!;
        const pos = getPos(e);
        ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
        setDrawing(true); setHasDrawn(true);
    };
    const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        if (!drawing) return;
        const ctx = canvasRef.current!.getContext('2d')!;
        const pos = getPos(e);
        ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#111827';
        ctx.lineTo(pos.x, pos.y); ctx.stroke();
    };
    const endDraw = () => setDrawing(false);
    const clear = () => {
        const c = canvasRef.current!;
        c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
        setHasDrawn(false);
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={onClose}>
            <div style={{ background: '#fff', borderRadius: '20px', padding: '28px', width: '480px', maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <h2 style={{ fontFamily: "'Pretendard',sans-serif", fontSize: '18px', fontWeight: 900, color: '#111827', margin: 0 }}>✍️ 전자서명</h2>
                    <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '22px', cursor: 'pointer', color: '#9ca3af', lineHeight: 1 }}>✕</button>
                </div>
                <p style={{ fontFamily: "'Pretendard',sans-serif", fontSize: '12px', color: '#9ca3af', marginBottom: '14px' }}>아래 영역에 서명해주세요. 계약 동의에 법적 효력을 갖습니다.</p>
                <div style={{ border: '2px solid #e5e7eb', borderRadius: '12px', background: '#fafafa', overflow: 'hidden', marginBottom: '16px' }}>
                    <canvas ref={canvasRef} width={440} height={160}
                        style={{ display: 'block', cursor: 'crosshair', touchAction: 'none', width: '100%', height: '160px' }}
                        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                        onTouchStart={e => { e.preventDefault(); startDraw(e); }}
                        onTouchMove={e => { e.preventDefault(); draw(e); }}
                        onTouchEnd={endDraw} />
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button onClick={clear} style={{ padding: '10px 18px', borderRadius: '10px', border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: "'Pretendard',sans-serif" }}>지우기</button>
                    <button onClick={() => onSign(canvasRef.current!.toDataURL('image/png'))} disabled={!hasDrawn}
                        style={{ padding: '10px 24px', borderRadius: '10px', border: 'none', background: hasDrawn ? blue : '#e5e7eb', color: hasDrawn ? '#fff' : '#9ca3af', fontWeight: 800, fontSize: '13px', cursor: hasDrawn ? 'pointer' : 'default', fontFamily: "'Pretendard',sans-serif" }}>
                        서명 완료
                    </button>
                </div>
            </div>
        </div>
    );
}
import {
    type ProjectStatus,
} from '@/lib/mockData';

function inquiryToProject(inq: any) {
    const statusMap: Record<string, ProjectStatus> = {
        pending: 'submitted',
        contacted: 'matching',
        rfp_sent: 'rfp_sent',
        quotes_received: 'quotes_received',
        confirmed: 'confirmed',
        contracted: 'contracted',
        closed: 'contracted',
    };
    return {
        id: inq.id,
        name: inq.projectName,
        category: inq.category || inq.shapeId || '제조 부품',
        status: (statusMap[inq.status] || 'submitted') as ProjectStatus,
        submittedAt: inq.createdAt?.slice(0, 10) || inq.date?.slice(0, 10) || '',
        updatedAt: inq.updatedAt?.slice(0, 10) || inq.date?.slice(0, 10) || '',
        factories: inq.factoriesCount || 0,
        quotesReceived: inq.quotesCount || 0,
        estimatedAmount: inq.estimatedAmount || undefined,
        plan: (inq.plan || 'standard') as 'standard' | 'premium',
    };
}

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:4000';
const blue = '#0b5cff';

interface NexysysUser {
    sub: string; email: string; name: string; role: string;
    services: string[]; avatar: string; language: string; title?: string;
}

// ── Status helpers ───────────────────────────────────────────────────────────
const STATUS_STEPS: ProjectStatus[] = ['submitted', 'matching', 'rfp_sent', 'quotes_received', 'confirmed', 'contracted'];
const STATUS_LABEL: Record<ProjectStatus, string> = {
    submitted: '접수 완료', matching: '공장 매칭 중', rfp_sent: 'RFP 발송 완료',
    quotes_received: '견적 수신 완료', confirmed: '최종 확정', contracted: '계약 완료',
};
const STATUS_COLOR: Record<ProjectStatus, string> = {
    submitted: '#6b7280', matching: '#f59e0b', rfp_sent: '#3b82f6',
    quotes_received: '#8b5cf6', confirmed: '#10b981', contracted: '#059669',
};

function StatusBadge({ status }: { status: ProjectStatus }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: STATUS_COLOR[status] + '18', color: STATUS_COLOR[status], borderRadius: '20px', padding: '3px 12px', fontSize: '12px', fontWeight: 700 }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: STATUS_COLOR[status], display: 'inline-block' }} />
            {STATUS_LABEL[status]}
        </span>
    );
}

function PlanBadge({ plan }: { plan: 'standard' | 'premium' }) {
    return (
        <span style={{ display: 'inline-block', background: plan === 'premium' ? blue + '18' : '#f3f4f6', color: plan === 'premium' ? blue : '#6b7280', borderRadius: '8px', padding: '2px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}>
            {plan === 'premium' ? '⭐ Premium' : 'Standard'}
        </span>
    );
}

function StarRating({ rating }: { rating: number }) {
    return (
        <span style={{ color: '#f59e0b', fontSize: '13px', fontWeight: 700 }}>
            {'★'.repeat(Math.floor(rating))}{'☆'.repeat(5 - Math.floor(rating))} {rating.toFixed(1)}
        </span>
    );
}

// ── Project Detail Page ──────────────────────────────────────────────────────
type ProjectTab = 'overview' | 'files' | 'quotes' | 'messages';

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const [user, setUser] = useState<NexysysUser | null>(null);
    const [tab, setTab] = useState<ProjectTab>('overview');
    const [qty, setQty] = useState(1000);
    const [project, setProject] = useState<ReturnType<typeof inquiryToProject> | null>(null);
    const [quotes, setQuotes] = useState<any[]>([]);
    const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
    const [msgCount, setMsgCount] = useState(0);
    const [linkedContract, setLinkedContract] = useState<{ progressPercent?: number; id?: string; status?: string; factoryName?: string } | null>(null);
    const [showSignature, setShowSignature] = useState(false);
    const [signedAt, setSignedAt] = useState<string | null>(null);
    const [reviewRating, setReviewRating] = useState(5);
    const [reviewText, setReviewText] = useState('');
    const [reviewSubmitted, setReviewSubmitted] = useState(false);
    const [reviewLoading, setReviewLoading] = useState(false);

    const addToast = (type: 'success' | 'error', msg: string) => {
        setToastMsg({ type, msg });
        setTimeout(() => setToastMsg(null), 4000);
    };

    const handleSign = useCallback(async (signatureData: string) => {
        setShowSignature(false);
        try {
            await fetch(`/api/inquiries/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ signedAt: new Date().toISOString(), signatureData }),
            });
            setSignedAt(new Date().toLocaleString('ko-KR'));
            addToast('success', '전자서명이 완료되었습니다. 계약이 최종 확정되었습니다.');
        } catch {
            addToast('error', '서명 저장 중 오류가 발생했습니다.');
        }
    }, [id]);

    useEffect(() => {
        const stored = localStorage.getItem('currentUser');
        if (stored) {
            try {
                setUser(JSON.parse(stored));
            } catch { router.push('/login'); }
        } else {
            router.push('/login');
        }
    }, [router]);

    useEffect(() => {
        fetch(`/api/messages?contractId=${id}`)
            .then(r => r.ok ? r.json() : { messages: [] })
            .then(d => setMsgCount((d.messages || []).length))
            .catch(() => {});
    }, [id]);

    // 계약 연동 및 서명 상태 조회
    useEffect(() => {
        if (!user) return;
        fetch(`/api/contracts?customerEmail=${encodeURIComponent(user.email)}`)
            .then(r => r.ok ? r.json() : { contracts: [] })
            .then(d => {
                const linked = (d.contracts || []).find((c: any) => c.customerEmail === user.email);
                if (linked) setLinkedContract(linked);
            })
            .catch(() => {});
    }, [user]);

    useEffect(() => {
        fetch(`/api/inquiries/${id}`)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data?.inquiry) {
                    setProject(inquiryToProject(data.inquiry));
                    setQuotes(data.quotes || []);
                }
            })
            .catch(() => {});
    }, [id]);

    const handleSelectQuote = async (quoteId: string, factoryName: string, amount: number) => {
        try {
            // 1. Accept the quote
            await fetch('/api/quotes', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: quoteId, status: 'accepted' }),
            });
            // 2. Create contract
            const res = await fetch('/api/contracts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectName: project?.name,
                    factoryName,
                    contractAmount: amount,
                    plan: project?.plan || 'standard',
                    quoteId,
                    customerEmail: user?.email,
                }),
            });
            const contractData = await res.json();
            // 3. Update inquiry status to 'contracted'
            await fetch(`/api/inquiries/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'contracted', contractId: contractData.contract?.id }),
            });
            if (contractData.contract) setLinkedContract(contractData.contract);
            addToast('success', `계약이 생성되었습니다! 파트너사와 메시지를 시작해보세요.`);
            setProject(prev => prev ? { ...prev, status: 'contracted' as ProjectStatus } : prev);
            setTimeout(() => setTab('messages'), 1800);
        } catch {
            addToast('error', '계약 생성 중 오류가 발생했습니다.');
        }
    };

    if (!user) return null;
    if (!project) return (
        <div style={{ fontFamily: "'Pretendard', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280' }}>
            프로젝트를 찾을 수 없습니다. <Link href="/dashboard" style={{ marginLeft: '8px', color: blue }}>대시보드로 돌아가기</Link>
        </div>
    );

    const s = {
        page: { fontFamily: "'Pretendard', sans-serif", background: '#f8fafc', minHeight: '100vh', display: 'flex', flexDirection: 'column' as const },
        topbar: { background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '60px', flexShrink: 0 },
        body: { display: 'flex', flex: 1, overflow: 'hidden' },
        sidebar: { width: '200px', background: '#fff', borderRight: '1px solid #f0f0f0', padding: '24px 14px', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, gap: '4px' },
        sideBtn: (active: boolean) => ({ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '12px', cursor: 'pointer', background: active ? blue + '12' : 'transparent', color: active ? blue : '#374151', fontWeight: active ? 800 : 500, fontSize: '14px', border: 'none', width: '100%', textAlign: 'left' as const, transition: '0.15s' }),
        main: { flex: 1, padding: '32px', overflowY: 'auto' as const },
        card: { background: '#fff', borderRadius: '20px', padding: '28px', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', border: '1px solid #f0f0f0' },
        h2: { fontSize: '18px', fontWeight: 900, color: '#111827', margin: '0 0 20px', letterSpacing: '-0.02em' },
        table: { width: '100%', borderCollapse: 'collapse' as const },
        th: { padding: '10px 16px', fontSize: '12px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '2px solid #f0f0f0', textAlign: 'left' as const, background: '#fafafa' },
        td: { padding: '14px 16px', fontSize: '13px', color: '#374151', borderBottom: '1px solid #f9fafb', verticalAlign: 'middle' as const },
    };

    // ── Overview Tab ──────────────────────────────────────────────────────────
    const OverviewTab = () => {
        const stepIdx = STATUS_STEPS.indexOf(project.status);
        return (
            <div>
                {/* Project Header */}
                <div style={{ ...s.card, marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
                        <div>
                            <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 8px' }}>{project.name}</h1>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <StatusBadge status={project.status} />
                                <PlanBadge plan={project.plan} />
                                <span style={{ fontSize: '13px', color: '#9ca3af' }}>{project.category}</span>
                            </div>
                        </div>
                        {project.status === 'quotes_received' && (
                            <button onClick={() => setTab('quotes')} style={{ padding: '10px 22px', borderRadius: '12px', background: blue, color: '#fff', fontWeight: 800, fontSize: '13px', border: 'none', cursor: 'pointer' }}>
                                📊 견적 비교 →
                            </button>
                        )}
                    </div>

                    {/* Progress Bar */}
                    <div style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#9ca3af', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>진행 단계</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                            {STATUS_STEPS.map((step, i) => {
                                const done = i <= stepIdx;
                                return (
                                    <React.Fragment key={step}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flex: i < STATUS_STEPS.length - 1 ? 'none' : 'none' }}>
                                            <div title={STATUS_LABEL[step]} style={{ width: '14px', height: '14px', borderRadius: '50%', background: done ? STATUS_COLOR[project.status] : '#e5e7eb', flexShrink: 0, transition: '0.2s', border: i === stepIdx ? `2px solid ${STATUS_COLOR[project.status]}` : 'none' }} />
                                            <span style={{ fontSize: '10px', color: done ? STATUS_COLOR[project.status] : '#9ca3af', fontWeight: done ? 700 : 400, whiteSpace: 'nowrap', maxWidth: '70px', textAlign: 'center', lineHeight: 1.2 }}>{STATUS_LABEL[step]}</span>
                                        </div>
                                        {i < STATUS_STEPS.length - 1 && <div style={{ flex: 1, height: '2px', background: i < stepIdx ? STATUS_COLOR[project.status] : '#e5e7eb', marginBottom: '18px' }} />}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Detail Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                    {[
                        { label: '카테고리', value: project.category, icon: '🏷️' },
                        { label: '플랜', value: project.plan === 'premium' ? '⭐ Premium' : 'Standard', icon: '📋' },
                        { label: '접수일', value: project.submittedAt, icon: '📅' },
                        { label: '최종 업데이트', value: project.updatedAt, icon: '🔄' },
                        { label: '매칭 공장', value: project.factories ? `${project.factories}개` : '분석 중', icon: '🏭' },
                        { label: '수신 견적', value: project.quotesReceived ? `${project.quotesReceived}개` : '대기 중', icon: '💬' },
                    ].map((item, i) => (
                        <div key={i} style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)', border: '1px solid #f0f0f0' }}>
                            <div style={{ fontSize: '18px', marginBottom: '6px' }}>{item.icon}</div>
                            <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.label}</div>
                            <div style={{ fontSize: '14px', fontWeight: 800, color: '#111827' }}>{item.value}</div>
                        </div>
                    ))}
                </div>

                {/* 진행률 Progress Bar */}
                {linkedContract?.progressPercent !== undefined && (
                    <div style={{ ...s.card, marginBottom: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>🏭 제조 진행률</div>
                            <span style={{ fontSize: '18px', fontWeight: 900, color: '#10b981' }}>{linkedContract.progressPercent}%</span>
                        </div>
                        <div style={{ height: '10px', background: '#f3f4f6', borderRadius: '99px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${linkedContract.progressPercent}%`, background: 'linear-gradient(90deg, #10b981, #34d399)', borderRadius: '99px', transition: 'width 0.6s ease' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: '#9ca3af' }}>
                            <span>시작</span><span>완료</span>
                        </div>
                    </div>
                )}

                {/* 전자서명 */}
                {project.status === 'contracted' && (
                    <div style={{ ...s.card, marginBottom: '20px', background: signedAt ? '#f0fdf4' : '#fefce8', border: `1px solid ${signedAt ? '#bbf7d0' : '#fde68a'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                            <div>
                                <div style={{ fontSize: '14px', fontWeight: 800, color: signedAt ? '#15803d' : '#92400e' }}>
                                    {signedAt ? '✅ 전자서명 완료' : '✍️ 전자서명 대기 중'}
                                </div>
                                <div style={{ fontSize: '12px', color: signedAt ? '#16a34a' : '#a16207', marginTop: '2px' }}>
                                    {signedAt ? `서명일: ${signedAt}` : '계약서에 서명하여 제조를 공식 시작하세요'}
                                </div>
                            </div>
                            {!signedAt && (
                                <button onClick={() => setShowSignature(true)}
                                    style={{ padding: '10px 22px', borderRadius: '12px', background: '#f59e0b', color: '#fff', fontWeight: 800, fontSize: '13px', border: 'none', cursor: 'pointer' }}>
                                    ✍️ 서명하기
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* 파트너 평점 리뷰 */}
                {linkedContract?.status === 'completed' && !reviewSubmitted && (
                    <div style={{ ...s.card, marginBottom: '20px', background: '#faf5ff', border: '1px solid #e9d5ff' }}>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: '#6d28d9', marginBottom: '12px' }}>⭐ 파트너 평점을 남겨주세요</div>
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                            {[1,2,3,4,5].map(star => (
                                <button key={star} onClick={() => setReviewRating(star)}
                                    style={{ fontSize: '24px', background: 'none', border: 'none', cursor: 'pointer', color: star <= reviewRating ? '#f59e0b' : '#d1d5db', lineHeight: 1 }}>
                                    ★
                                </button>
                            ))}
                            <span style={{ fontSize: '13px', color: '#6b7280', alignSelf: 'center', marginLeft: '4px', fontWeight: 700 }}>{reviewRating}.0</span>
                        </div>
                        <textarea value={reviewText} onChange={e => setReviewText(e.target.value)}
                            placeholder="제조 품질, 납기, 소통 등에 대한 의견을 남겨주세요..."
                            rows={3}
                            style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1.5px solid #e5e7eb', fontSize: '13px', resize: 'none', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                        <button disabled={reviewLoading} onClick={async () => {
                            setReviewLoading(true);
                            try {
                                await fetch('/api/reviews', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        contractId: linkedContract.id,
                                        partnerId: linkedContract.factoryName,
                                        rating: reviewRating,
                                        comment: reviewText,
                                        customerEmail: user?.email,
                                    }),
                                });
                                setReviewSubmitted(true);
                                addToast('success', '리뷰가 제출되었습니다. 감사합니다!');
                            } catch { addToast('error', '리뷰 제출 중 오류가 발생했습니다.'); }
                            finally { setReviewLoading(false); }
                        }}
                            style={{ marginTop: '10px', padding: '10px 24px', borderRadius: '12px', background: '#7c3aed', color: '#fff', fontWeight: 800, fontSize: '13px', border: 'none', cursor: reviewLoading ? 'default' : 'pointer', opacity: reviewLoading ? 0.7 : 1 }}>
                            {reviewLoading ? '제출 중...' : '리뷰 제출'}
                        </button>
                    </div>
                )}
                {linkedContract?.status === 'completed' && reviewSubmitted && (
                    <div style={{ ...s.card, marginBottom: '20px', background: '#f0fdf4', border: '1px solid #bbf7d0', textAlign: 'center', padding: '20px' }}>
                        <div style={{ fontSize: '24px', marginBottom: '6px' }}>✅</div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#15803d' }}>리뷰가 제출되었습니다. 감사합니다!</div>
                    </div>
                )}

                {/* Quick Actions */}
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
                    <button onClick={() => setTab('files')} style={{ padding: '10px 20px', borderRadius: '12px', background: '#f3f4f6', color: '#374151', fontWeight: 700, fontSize: '13px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        📁 파일 업로드
                    </button>
                    <button onClick={() => setTab('messages')} style={{ padding: '10px 20px', borderRadius: '12px', background: '#f3f4f6', color: '#374151', fontWeight: 700, fontSize: '13px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        💬 담당자 메시지
                    </button>
                    {project.status === 'quotes_received' && (
                        <button onClick={() => setTab('quotes')} style={{ padding: '10px 20px', borderRadius: '12px', background: blue, color: '#fff', fontWeight: 700, fontSize: '13px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            📊 견적 비교 분석
                        </button>
                    )}
                </div>

                {/* ⑨ Status Timeline */}
                <div style={{ ...s.card }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#9ca3af', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>진행 타임라인</div>
                    <div>
                        {[
                            { label: '접수 완료', date: project.submittedAt, done: true, icon: '✅' },
                            { label: '공장 매칭 중', date: STATUS_STEPS.indexOf(project.status) >= 1 ? project.updatedAt : null, done: STATUS_STEPS.indexOf(project.status) >= 1, icon: '🤖' },
                            { label: 'RFP 발송 완료', date: STATUS_STEPS.indexOf(project.status) >= 2 ? project.updatedAt : null, done: STATUS_STEPS.indexOf(project.status) >= 2, icon: '📤' },
                            { label: '견적 수신', date: STATUS_STEPS.indexOf(project.status) >= 3 ? project.updatedAt : null, done: STATUS_STEPS.indexOf(project.status) >= 3, icon: '📊' },
                            { label: '계약 완료', date: project.status === 'contracted' ? project.updatedAt : null, done: project.status === 'contracted' || project.status === 'confirmed', icon: '🤝' },
                        ].map((event, i) => (
                            <div key={i} style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '2px' }}>
                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: event.done ? '#ecfdf5' : '#f3f4f6', border: `2px solid ${event.done ? '#10b981' : '#e5e7eb'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', flexShrink: 0 }}>
                                        {event.done ? event.icon : null}
                                    </div>
                                    {i < 4 && <div style={{ width: '2px', height: '28px', background: STATUS_STEPS.indexOf(project.status) > i ? '#10b981' : '#e5e7eb', margin: '2px 0' }} />}
                                </div>
                                <div style={{ paddingBottom: i < 4 ? '12px' : '0', paddingTop: '4px' }}>
                                    <div style={{ fontSize: '13px', fontWeight: event.done ? 700 : 400, color: event.done ? '#111827' : '#9ca3af' }}>{event.label}</div>
                                    {event.date && <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>{event.date}</div>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    // ── Files Tab ─────────────────────────────────────────────────────────────
    const FilesTab = () => {
        const [uploading, setUploading] = React.useState(false);
        const [dragOver, setDragOver] = React.useState(false);
        const [files, setFiles] = React.useState<{ name: string; size: string; type: string; date: string }[]>([]);
        const inputRef = React.useRef<HTMLInputElement>(null);

        const handleFiles = async (fileList: FileList | null) => {
            if (!fileList || fileList.length === 0) return;
            setUploading(true);
            for (const file of Array.from(fileList)) {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('projectId', project.id);
                try {
                    const res = await fetch('/api/quick-quote/upload', { method: 'POST', body: formData });
                    if (res.ok) {
                        const sizeKB = file.size / 1024;
                        const sizeStr = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB.toFixed(0)} KB`;
                        const ext = file.name.split('.').pop()?.toUpperCase() || 'FILE';
                        setFiles(prev => [...prev, { name: file.name, size: sizeStr, type: ext, date: new Date().toLocaleDateString('ko-KR') }]);
                    }
                } catch { /* ignore */ }
            }
            setUploading(false);
        };

        const ALLOWED = ['.step', '.stp', '.stl', '.obj', '.iges', '.igs', '.dxf', '.pdf', '.jpg', '.png'];

        return (
            <div>
                <div style={{ marginBottom: '24px' }}>
                    <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 4px' }}>📁 파일 업로드</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <StatusBadge status={project.status} />
                        <span style={{ fontSize: '14px', color: '#6b7280' }}>{project.name}</span>
                    </div>
                </div>

                {/* Drop zone */}
                <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                    onClick={() => inputRef.current?.click()}
                    style={{ border: `2px dashed ${dragOver ? blue : '#d1d5db'}`, borderRadius: '20px', padding: '40px 32px', textAlign: 'center', cursor: 'pointer', background: dragOver ? blue + '06' : '#fafafa', transition: '0.2s', marginBottom: '20px' }}
                >
                    <div style={{ fontSize: '36px', marginBottom: '10px' }}>📂</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: '#374151', marginBottom: '4px' }}>파일을 드래그하거나 클릭해서 업로드</div>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>STEP, STP, STL, OBJ, IGES, DXF, PDF, JPG, PNG · 최대 50MB</div>
                    {uploading && <div style={{ marginTop: '12px', fontSize: '13px', color: blue, fontWeight: 700 }}>⏳ 업로드 중...</div>}
                    <input ref={inputRef} type="file" multiple accept={ALLOWED.join(',')} style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
                </div>

                {/* Uploaded files list */}
                {files.length > 0 && (
                    <div style={{ ...s.card, padding: 0, marginBottom: '20px' }}>
                        <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0f0f0', fontWeight: 800, fontSize: '14px', color: '#111827' }}>
                            업로드된 파일 ({files.length}개)
                        </div>
                        {files.map((f, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '14px 24px', borderBottom: i < files.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: blue + '12', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                                    {['STEP', 'STP', 'STL', 'OBJ', 'IGES', 'IGS'].includes(f.type) ? '🔩' : f.type === 'PDF' ? '📄' : '🖼️'}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 700, fontSize: '13px', color: '#111827' }}>{f.name}</div>
                                    <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>{f.type} · {f.size} · {f.date}</div>
                                </div>
                                <span style={{ background: '#d1fae5', color: '#059669', borderRadius: '20px', padding: '3px 10px', fontSize: '11px', fontWeight: 700 }}>✓ 완료</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Guide */}
                <div style={{ ...s.card, background: blue + '06', border: `1px solid ${blue}20` }}>
                    <div style={{ fontWeight: 800, color: blue, fontSize: '14px', marginBottom: '10px' }}>📌 업로드 가이드</div>
                    {[
                        'STEP(.step, .stp) 파일을 권장합니다 — 가장 정확한 견적이 가능합니다.',
                        '여러 파트가 있는 경우 어셈블리 파일 또는 각 파트를 모두 업로드해주세요.',
                        '파일 업로드 후 담당자가 24시간 내 검토 후 연락드립니다.',
                        '도면(PDF/DXF)이 있으면 함께 올려주시면 더 정확한 견적이 가능합니다.',
                    ].map((tip, i) => (
                        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', fontSize: '13px', color: '#374151' }}>
                            <span style={{ color: blue, flexShrink: 0 }}>•</span>{tip}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    // ── Quotes Tab ────────────────────────────────────────────────────────────
    const CERT_STYLE: Record<string, React.CSSProperties> = {
        'NexyFab Certified': { background: '#eff6ff', color: blue, border: `1px solid ${blue}30` },
        'ISO 9001': { background: '#f0fdf4', color: '#16a34a', border: '1px solid #16a34a30' },
        'NDA': { background: '#faf5ff', color: '#7c3aed', border: '1px solid #7c3aed30' },
    };

    const ScoreBar = ({ label, value, color }: { label: string; value: number; color: string }) => (
        <div style={{ marginBottom: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: '11px', fontWeight: 800, color }}>{value}</span>
            </div>
            <div style={{ height: '5px', background: '#f3f4f6', borderRadius: '99px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: '99px', transition: '0.4s' }} />
            </div>
        </div>
    );

    const QuotesTab = () => {
        const sortedQuotes = [...quotes].sort((a, b) => (b.status === 'accepted' ? 1 : 0) - (a.status === 'accepted' ? 1 : 0));

        if (quotes.length === 0) {
            return (
                <div style={{ textAlign: 'center', paddingTop: '60px', color: '#9ca3af' }}>
                    <div style={{ fontSize: '36px', marginBottom: '12px' }}>📬</div>
                    <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '6px' }}>아직 수신된 견적이 없습니다</div>
                    <div style={{ fontSize: '13px' }}>파트너가 견적을 제출하면 여기서 비교할 수 있습니다</div>
                </div>
            );
        }

        const unitPrices = quotes.map((q: any) => q.estimatedAmount || 0).filter(Boolean);
        const leadTimes = quotes.map((q: any) => q.leadTimeDays || 0).filter(Boolean);

        return (
        <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 4px' }}>📊 견적 비교 분석</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <StatusBadge status={project.status} />
                        <span style={{ fontSize: '13px', color: '#6b7280' }}>{project.name}</span>
                    </div>
                </div>
            </div>

            {/* Summary Badges */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                {[
                    { label: '수신 견적', value: `${quotes.length}개`, color: '#8b5cf6', icon: '📬' },
                    { label: '최저 견적', value: unitPrices.length ? `₩${Math.min(...unitPrices).toLocaleString()}` : '-', color: '#059669', icon: '💰' },
                    { label: '최단 납기', value: leadTimes.length ? `${Math.min(...leadTimes)}일` : '-', color: blue, icon: '⚡' },
                ].map((b, i) => (
                    <div key={i} style={{ background: '#fff', borderRadius: '14px', padding: '14px 18px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', border: `1px solid ${b.color}18`, display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '20px' }}>{b.icon}</span>
                        <div>
                            <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{b.label}</div>
                            <div style={{ fontSize: '15px', fontWeight: 900, color: b.color }}>{b.value}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Visual Bar Chart comparison */}
            {quotes.length >= 2 && unitPrices.length >= 2 && (
                <div style={{ ...s.card, marginBottom: '20px' }}>
                    <h2 style={{ ...s.h2, margin: '0 0 16px', fontSize: '15px' }}>📊 견적가 시각 비교</h2>
                    {(() => {
                        const maxPrice = Math.max(...unitPrices);
                        const sorted = [...quotes].filter((q: any) => q.estimatedAmount).sort((a: any, b: any) => a.estimatedAmount - b.estimatedAmount);
                        return sorted.map((q: any, i: number) => {
                            const pct = Math.round((q.estimatedAmount / maxPrice) * 100);
                            const isBest = i === 0;
                            return (
                                <div key={q.id || i} style={{ marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                        <span style={{ fontSize: '12px', fontWeight: 700, color: isBest ? '#059669' : '#374151', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            {isBest && <span style={{ background: '#d1fae5', color: '#059669', borderRadius: '20px', padding: '1px 7px', fontSize: '10px', fontWeight: 800 }}>최저</span>}
                                            {q.factoryName || '공장 미정'}
                                        </span>
                                        <span style={{ fontSize: '13px', fontWeight: 900, color: isBest ? '#059669' : '#374151' }}>
                                            ₩{q.estimatedAmount.toLocaleString()}
                                        </span>
                                    </div>
                                    <div style={{ height: '10px', background: '#f3f4f6', borderRadius: '99px', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: '99px', background: isBest ? '#10b981' : i === sorted.length - 1 ? '#ef4444' : '#6366f1', transition: '0.6s cubic-bezier(0.4,0,0.2,1)' }} />
                                    </div>
                                    {q.leadTimeDays && <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '3px', textAlign: 'right' }}>납기 {q.leadTimeDays}일</div>}
                                </div>
                            );
                        });
                    })()}
                </div>
            )}

            {/* Cost Calculator */}
            {unitPrices.length > 0 && (
            <div style={{ ...s.card, marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                    <h2 style={{ ...s.h2, margin: 0, fontSize: '15px' }}>💡 수량별 예상 비용 계산기</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 600 }}>발주 수량</span>
                        <input type="number" value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value)))}
                            style={{ width: '100px', padding: '8px 12px', borderRadius: '10px', border: '1.5px solid #e5e7eb', fontSize: '14px', fontWeight: 700, textAlign: 'right', outline: 'none' }} />
                        <span style={{ fontSize: '13px', color: '#6b7280' }}>개</span>
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={s.table}>
                        <thead><tr>{['공장', '견적가', '총 비용(추정)', '납기', '상태'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                        <tbody>
                            {[...quotes].sort((a, b) => (a.estimatedAmount || 0) - (b.estimatedAmount || 0)).map((q: any, i: number) => {
                                const total = (q.estimatedAmount || 0) * qty;
                                return (
                                    <tr key={i} style={{ background: q.status === 'accepted' ? '#eff6ff' : '' }}>
                                        <td style={{ ...s.td, fontWeight: 700, color: q.status === 'accepted' ? blue : '#111827' }}>{q.status === 'accepted' && <span style={{ marginRight: '5px' }}>✓</span>}{q.factoryName || '공장 미정'}</td>
                                        <td style={{ ...s.td, fontWeight: 700 }}>₩{(q.estimatedAmount || 0).toLocaleString()}</td>
                                        <td style={{ ...s.td, fontWeight: 900, color: i === 0 ? '#10b981' : '#111827', fontSize: '14px' }}>₩{total.toLocaleString()}</td>
                                        <td style={{ ...s.td, color: (q.leadTimeDays || 0) <= 21 ? '#10b981' : '#374151' }}>{q.leadTimeDays ? `${q.leadTimeDays}일` : '-'}</td>
                                        <td style={s.td}><span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: q.status === 'accepted' ? '#d1fae5' : '#f3f4f6', color: q.status === 'accepted' ? '#059669' : '#6b7280' }}>{q.status === 'accepted' ? '채택' : q.status === 'rejected' ? '거절' : q.status === 'expired' ? '만료' : '검토 중'}</span></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            )}

            {/* Quote Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {sortedQuotes.map((q: any, i: number) => (
                    <div key={i} style={{ background: '#fff', borderRadius: '18px', border: q.status === 'accepted' ? `2px solid ${blue}` : '1px solid #f0f0f0', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', padding: '22px 24px', position: 'relative' }}>
                        {q.status === 'accepted' && <div style={{ position: 'absolute', top: '16px', right: '20px', background: blue, color: '#fff', fontSize: '11px', fontWeight: 800, padding: '4px 12px', borderRadius: '20px' }}>✓ 채택됨</div>}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
                            <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: q.status === 'accepted' ? blue + '12' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>🏭</div>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '15px', fontWeight: 800, color: '#111827' }}>{q.factoryName || '공장 미정'}</span>
                                    {q.partnerEmail && <span style={{ fontSize: '12px', color: '#6b7280' }}>{q.partnerEmail}</span>}
                                </div>
                                {q.details && (
                                    <div style={{ fontSize: '12px', color: '#374151', lineHeight: 1.6 }}>{q.details}</div>
                                )}
                            </div>
                        </div>
                        {/* 파트너 신뢰 배지 */}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                            {q.partnerEmail && <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '20px', background: '#eff6ff', color: blue }}>✓ NexyFab 인증</span>}
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '20px', background: '#f0fdf4', color: '#15803d' }}>★ 4.{(Math.floor(Math.random() * 3) + 7)} / 5.0</span>
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '20px', background: '#f5f3ff', color: '#6d28d9' }}>응답 24h 이내</span>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
                            {q.estimatedAmount && <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '10px 16px', textAlign: 'center' }}><div style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 700, marginBottom: '3px', textTransform: 'uppercase' }}>견적가</div><div style={{ fontSize: '16px', fontWeight: 900, color: '#111827' }}>₩{q.estimatedAmount.toLocaleString()}</div></div>}
                            {q.leadTimeDays && <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '10px 16px', textAlign: 'center' }}><div style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 700, marginBottom: '3px', textTransform: 'uppercase' }}>납기</div><div style={{ fontSize: '16px', fontWeight: 900, color: '#111827' }}>{q.leadTimeDays}일</div></div>}
                            {q.validUntil && (() => {
                                const today = new Date(); today.setHours(0,0,0,0);
                                const exp = new Date(q.validUntil); exp.setHours(0,0,0,0);
                                const diff = Math.round((exp.getTime() - today.getTime()) / 86400000);
                                return (
                                    <div style={{ background: diff <= 3 ? '#fef2f2' : '#f8fafc', borderRadius: '10px', padding: '10px 16px', textAlign: 'center' }}>
                                        <div style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 700, marginBottom: '3px', textTransform: 'uppercase' }}>유효기간</div>
                                        <div style={{ fontSize: '14px', fontWeight: 700, color: diff <= 3 ? '#ef4444' : '#374151' }}>{q.validUntil}</div>
                                        <div style={{ fontSize: '11px', fontWeight: 700, color: diff <= 0 ? '#ef4444' : diff <= 3 ? '#f97316' : '#9ca3af', marginTop: '2px' }}>
                                            {diff <= 0 ? '⚠️ 만료됨' : diff <= 3 ? `⏰ ${diff}일 후 만료` : `D-${diff}`}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                            {q.status === 'accepted' ? (
                                <span style={{ padding: '8px 22px', borderRadius: '10px', background: '#d1fae5', color: '#059669', fontWeight: 700, fontSize: '13px' }}>✓ 채택됨</span>
                            ) : q.status === 'pending' && project.status !== 'contracted' ? (
                                <button
                                    onClick={() => handleSelectQuote(q.id, q.factoryName || '공장', q.estimatedAmount || 0)}
                                    style={{ padding: '8px 22px', borderRadius: '10px', background: blue, color: '#fff', fontWeight: 700, fontSize: '13px', border: 'none', cursor: 'pointer' }}>
                                    이 공장 선택 →
                                </button>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>
        </div>
        );
    };

    // ── Messages Tab ──────────────────────────────────────────────────────────
    const MessagesTab = () => {
        const [messages, setMessages] = React.useState<{ id: string; sender: string; senderType: string; text: string; createdAt: string }[]>([]);
        const [newMsg, setNewMsg] = React.useState('');
        const [sending, setSending] = React.useState(false);
        const [attachUploading, setAttachUploading] = React.useState(false);
        const fileInputRef = React.useRef<HTMLInputElement>(null);
        const bottomRef = React.useRef<HTMLDivElement>(null);

        const fetchMessages = React.useCallback(() => {
            fetch(`/api/messages?contractId=${project.id}`)
                .then(r => r.ok ? r.json() : { messages: [] })
                .then(d => setMessages(d.messages || []))
                .catch(() => {});
        }, []);

        React.useEffect(() => {
            fetchMessages();
            const timer = setInterval(fetchMessages, 10_000);
            return () => clearInterval(timer);
        }, [fetchMessages]);

        React.useEffect(() => {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, [messages]);

        const sendMessage = async () => {
            const text = newMsg.trim();
            if (!text || sending) return;
            setSending(true);
            // 낙관적 UI: 즉시 화면에 추가
            const tempId = `TEMP-${Date.now()}`;
            const tempMsg = { id: tempId, sender: user!.name, senderType: 'customer', text, createdAt: new Date().toISOString() };
            setMessages(prev => [...prev, tempMsg]);
            setNewMsg('');
            try {
                const res = await fetch('/api/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contractId: project.id, sender: user!.name, senderType: 'customer', text }),
                });
                if (res.ok) {
                    const d = await res.json();
                    // 임시 메시지를 서버 응답으로 교체
                    setMessages(prev => prev.map(m => m.id === tempId ? d.message : m));
                } else {
                    // 실패 시 임시 메시지 제거
                    setMessages(prev => prev.filter(m => m.id !== tempId));
                    setNewMsg(text);
                }
            } catch {
                setMessages(prev => prev.filter(m => m.id !== tempId));
                setNewMsg(text);
            }
            setSending(false);
        };

        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>
                <div style={{ marginBottom: '20px', flexShrink: 0 }}>
                    <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 4px' }}>💬 메시지</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <StatusBadge status={project.status} />
                        <span style={{ fontSize: '14px', color: '#6b7280' }}>{project.name}</span>
                    </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc', borderRadius: '16px', padding: '20px', marginBottom: '16px', border: '1px solid #f0f0f0' }}>
                    {messages.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#9ca3af', paddingTop: '60px' }}>
                            <div style={{ fontSize: '36px', marginBottom: '12px' }}>💬</div>
                            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '6px' }}>아직 메시지가 없습니다</div>
                            <div style={{ fontSize: '13px' }}>담당자에게 첫 메시지를 보내보세요</div>
                        </div>
                    ) : messages.map((m, i) => {
                        const isMe = m.senderType === 'customer';
                        const isFile = m.text?.startsWith('📎 파일:');
                        const fileUrl = isFile ? m.text.replace('📎 파일:', '').trim() : null;
                        const fileName = fileUrl ? decodeURIComponent(fileUrl.split('/').pop() || '파일') : null;
                        return (
                            <div key={i} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', marginBottom: '12px' }}>
                                {!isMe && <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', marginRight: '8px', flexShrink: 0 }}>🏭</div>}
                                <div style={{ maxWidth: '65%' }}>
                                    <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px', textAlign: isMe ? 'right' : 'left' }}>
                                        {isMe ? '나' : 'NexyFab 담당자'} · {new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                    <div style={{ background: isMe ? blue : '#fff', color: isMe ? '#fff' : '#374151', borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px', padding: '10px 16px', fontSize: '14px', lineHeight: 1.5, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', border: isMe ? 'none' : '1px solid #f0f0f0' }}>
                                        {isFile && fileUrl ? (
                                            <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                                                style={{ color: isMe ? '#dbeafe' : blue, display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', fontWeight: 600 }}>
                                                <span>📎</span><span style={{ textDecoration: 'underline' }}>{fileName}</span>
                                            </a>
                                        ) : m.text}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={bottomRef} />
                </div>
                <div style={{ display: 'flex', gap: '10px', flexShrink: 0, alignItems: 'center' }}>
                    <input ref={fileInputRef} type="file" style={{ display: 'none' }}
                        onChange={async e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setAttachUploading(true);
                            try {
                                const fd = new FormData(); fd.append('file', file);
                                const res = await fetch('/api/quick-quote/upload', { method: 'POST', body: fd });
                                const data = await res.json();
                                if (data.url) {
                                    await fetch('/api/messages', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ contractId: project.id, sender: user!.name, senderType: 'customer', text: `📎 파일:${data.url}` }),
                                    });
                                    fetchMessages();
                                }
                            } catch { /* silent */ } finally { setAttachUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
                        }} />
                    <button onClick={() => fileInputRef.current?.click()} disabled={attachUploading}
                        title="파일 첨부"
                        style={{ padding: '12px', borderRadius: '14px', background: '#f3f4f6', border: '1px solid #e5e7eb', fontSize: '18px', cursor: 'pointer', flexShrink: 0, opacity: attachUploading ? 0.5 : 1 }}>
                        {attachUploading ? '⏳' : '📎'}
                    </button>
                    <input value={newMsg} onChange={e => setNewMsg(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                        placeholder="메시지를 입력하세요... (Enter로 전송)"
                        style={{ flex: 1, padding: '12px 18px', borderRadius: '14px', border: '1px solid #e5e7eb', fontSize: '14px', outline: 'none', fontFamily: 'inherit' }} />
                    <button onClick={sendMessage} disabled={sending || !newMsg.trim()}
                        style={{ padding: '12px 24px', borderRadius: '14px', background: newMsg.trim() ? blue : '#e5e7eb', color: newMsg.trim() ? '#fff' : '#9ca3af', fontWeight: 800, fontSize: '14px', border: 'none', cursor: newMsg.trim() ? 'pointer' : 'default', transition: '0.15s' }}>
                        {sending ? '전송 중...' : '전송 ↑'}
                    </button>
                </div>
            </div>
        );
    };

    // ── Sidebar items ─────────────────────────────────────────────────────────
    const navItems: { id: ProjectTab; label: string; icon: string; badge?: number }[] = [
        { id: 'overview', label: '프로젝트 개요', icon: '📋' },
        { id: 'files', label: '파일 업로드', icon: '📁' },
        { id: 'quotes', label: '견적 비교', icon: '💰', badge: quotes.length > 0 ? quotes.length : undefined },
        { id: 'messages', label: '메시지', icon: '💬', badge: msgCount > 0 ? msgCount : undefined },
    ];

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={s.page}>
            {/* 전자서명 모달 */}
            {showSignature && <SignatureModal blue={blue} onSign={handleSign} onClose={() => setShowSignature(false)} />}

            {/* Toast */}
            {toastMsg && (
                <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999, background: toastMsg.type === 'success' ? '#059669' : '#dc2626', color: '#fff', borderRadius: '14px', padding: '14px 22px', fontWeight: 700, fontSize: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', maxWidth: '340px' }}>
                    {toastMsg.msg}
                </div>
            )}
            {/* Top Bar */}
            <div style={s.topbar}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#6b7280', textDecoration: 'none', fontWeight: 600, padding: '6px 12px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff' }}>
                        ← 대시보드
                    </Link>
                    <span style={{ color: '#e5e7eb' }}>|</span>
                    <Link href="/kr" style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '-0.03em', textDecoration: 'none' }}>
                        <span style={{ color: '#111827' }}>Nexy</span><span style={{ color: blue }}>Fab</span>
                    </Link>
                    <span style={{ fontSize: '13px', color: '#9ca3af', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <PlanBadge plan={project.plan} />
                    <Image src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`} alt="" width={32} height={32} style={{ borderRadius: '50%', border: '2px solid #e5e7eb' }} />
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#374151' }}>{user.name}</span>
                </div>
            </div>

            {/* ⑤ Quotes CTA Banner */}
            {project.status === 'quotes_received' && quotes.length > 0 && tab !== 'quotes' && (
                <div style={{ background: 'linear-gradient(90deg, #f5f3ff, #ede9fe)', borderBottom: '1px solid #ddd6fe', padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '20px' }}>🎉</span>
                        <span style={{ fontWeight: 700, color: '#5b21b6', fontSize: '14px' }}>
                            {quotes.length}개의 제조 견적이 도착했습니다! 지금 비교해보세요.
                        </span>
                    </div>
                    <button onClick={() => setTab('quotes')} style={{ padding: '8px 20px', borderRadius: '10px', background: '#7c3aed', color: '#fff', fontWeight: 800, fontSize: '13px', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                        견적 비교 →
                    </button>
                </div>
            )}

            <div style={s.body}>
                {/* Sidebar */}
                <div style={s.sidebar}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0 14px', marginBottom: '8px' }}>프로젝트</div>
                    {navItems.map(item => (
                        <button key={item.id} onClick={() => setTab(item.id)} style={s.sideBtn(tab === item.id)}>
                            <span style={{ fontSize: '16px' }}>{item.icon}</span>
                            <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                            {item.badge !== undefined && (
                                <span style={{ background: '#ef4444', color: '#fff', borderRadius: '99px', fontSize: '10px', fontWeight: 800, padding: '1px 6px', minWidth: '18px', textAlign: 'center', lineHeight: '16px' }}>
                                    {item.badge}
                                </span>
                            )}
                        </button>
                    ))}
                    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #f0f0f0' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#9ca3af', padding: '0 14px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>상태</div>
                        <div style={{ padding: '10px 14px' }}>
                            <StatusBadge status={project.status} />
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={s.main}>
                    <ErrorBoundary>
                        {tab === 'overview' && <OverviewTab />}
                        {tab === 'files' && <FilesTab />}
                        {tab === 'quotes' && <QuotesTab />}
                        {tab === 'messages' && <MessagesTab />}
                    </ErrorBoundary>
                </div>
            </div>
        </div>
    );
}
