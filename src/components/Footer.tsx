'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

const dict = {
    ko: {
        desc: 'AI 기반 개발 및 자동화 설비 프로젝트 파트너 매칭 플랫폼',
        term1: '이용약관',
        term2: '개인정보 처리방침',
        term3: '보안 정책(NDA)',
        term4: '고객사 운영 정책',
        term5: '파트너사 운영 정책',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: '대표: 김연제',
        bizNo: '사업자등록번호: 606-87-03602',
        address: '대한민국 경기도 남양주시 다산순환로 20',
        note: '프로젝트 정보는 내부 검토용으로만 관리되며, 외부로 공개되지 않습니다.'
    },
    en: {
        desc: 'AI-based Development & Automation Project Partner Matching Platform',
        term1: 'Terms of Use',
        term2: 'Privacy Policy',
        term3: 'Security Policy (NDA)',
        term4: 'Customer Operation Policy',
        term5: 'Partner Operation Policy',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: 'CEO: Kim Yeon Je',
        bizNo: 'Business Reg. No.: 606-87-03602',
        address: '20, Dasansunhwan-ro, Namyangju-si, Gyeonggi-do, Republic of Korea',
        note: 'Project information is managed only for internal review purposes and is not disclosed externally.'
    },
    ja: {
        desc: 'AIベースの開発および自動化設備プロジェクトパートナーマッチングプラットフォーム',
        term1: '利用規約',
        term2: 'プライバシーポリシー',
        term3: 'セキュリティポリシー(NDA)',
        term4: '顧客運営ポリシー',
        term5: 'パートナー運営ポリシー',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: '代表: キム・ヨンジェ',
        bizNo: '事業者登録番号: 606-87-03602',
        address: '大韓民国 京畿道 南楊州市 多山循環路 20',
        note: 'プロジェクト情報は内部検討用としてのみ管理され、外部には公開されません。'
    },
    cn: {
        desc: '基于AI的开发与自动化设备项目合作伙伴匹配平台',
        term1: '服务条款',
        term2: '隐私政策',
        term3: '安全政策(NDA)',
        term4: '客户运营政策',
        term5: '合作伙伴运营政策',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: '代表: 金延制',
        bizNo: '营业执照号: 606-87-03602',
        address: '大韩民国 京畿道 南杨州市 多山循环路 20',
        note: '项目信息仅用于内部审核，不会向外部公开。'
    },
    es: {
        desc: 'Plataforma de emparejamiento de socios para proyectos de desarrollo y automatización basados en IA',
        term1: 'Términos de Uso',
        term2: 'Política de Privacidad',
        term3: 'Política de Seguridad (NDA)',
        term4: 'Política de Operación del Cliente',
        term5: 'Política de Operación del Socio',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: 'CEO: Kim Yeon Je',
        bizNo: 'Reg. No.: 606-87-03602',
        address: '20, Dasansunhwan-ro, Namyangju-si, Gyeonggi-do, República de Corea',
        note: 'La información del proyecto se gestiona solo para revisión interna y no se divulga externamente.'
    },
    ar: {
        desc: 'منصة مطابقة شركاء المشاريع للتطوير والأتمتة المدعومة بالذكاء الاصطناعي',
        term1: 'شروط الاستخدام',
        term2: 'سياسة الخصوصية',
        term3: 'سياسة الأمان (NDA)',
        term4: 'سياسة تشغيل العملاء',
        term5: 'سياسة تشغيل الشركاء',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: 'الرئيس التنفيذي: كيم يون جيه',
        bizNo: 'رقم السجل التجاري: 606-87-03602',
        address: '20، داسان سونهوان-رو، نامينجو-سي، كيونغي-دو، جمهورية كوريا',
        note: 'يتم إدارة معلومات المشروع لأغراض المراجعة الداخلية فقط ولا يتم الإفصاح عنها خارجياً.'
    }
};

export default function Footer() {
    const pathname = usePathname();
    const parts = pathname?.split('/').filter(Boolean) || [];

    if (pathname?.includes('/shape-generator')) return null;

    // adminlink 폴더 내부에 있을 경우, 메인 사이트 링크가 깨지지 않도록 처리
    const isAdmin = parts[0] === 'adminlink';
    const langCode = isAdmin ? 'kr' : (parts[0] || 'en');
    const lang = ['en', 'kr', 'ja', 'cn', 'es', 'ar'].includes(langCode) ? langCode : 'en';


    const langMap: Record<string, string> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };
    const t = dict[langMap[lang] as keyof typeof dict];

    return (
        <footer id="Nexyfab-footer" className="hat-footer reveal" style={{ width: '100%', marginLeft: 0, marginRight: 0, boxSizing: 'border-box' }}>
            <div className="hat-footer-inner">
                <div className="hat-footer-brand">
                    <div style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
                        <span style={{ color: '#111827' }}>Nexy</span><span style={{ color: '#0b5cff' }}>Fab</span>
                    </div>
                    <div className="hat-footer-desc">{t.desc}</div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px', justifyContent: 'center' }}>
                        <a href={process.env.NEXT_PUBLIC_NEXYSYS_URL || 'https://nexysys.com'} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#6b7280', textDecoration: 'none' }}>Nexysys</a>
                        <a href={process.env.NEXT_PUBLIC_NEXYFLOW_URL || 'https://nexyflow.com'} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#6b7280', textDecoration: 'none' }}>NexyFlow</a>
                        <a href={process.env.NEXT_PUBLIC_NEXYWISE_URL || 'https://nexywise.com'} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#6b7280', textDecoration: 'none' }}>NexyWise</a>
                    </div>
                </div>

                <nav className="hat-footer-nav" aria-label="Footer policy navigation">
                    <a href={`/${lang}/terms-of-use/`}>{t.term1}</a>
                    <a href={`/${lang}/privacy-policy/`}>{t.term2}</a>
                    <a href={`/${lang}/security-policy/`}>{t.term3}</a>
                    <a href={`/${lang}/customer-policy/`}>{t.term4}</a>
                    <a href={`/${lang}/partner-policy/`}>{t.term5}</a>
                </nav>

                <div className="hat-footer-legal" style={{ fontSize: '12px', color: '#9ca3af', lineHeight: 1.8, marginTop: '16px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, color: '#6b7280' }}>{t.company}</div>
                    <div>{t.ceo} | {t.bizNo}</div>
                    <div>{t.address}</div>
                </div>

                <div className="hat-footer-bottom">
                    <div className="hat-footer-copy">© 2026 Nexysys Lab Co., Ltd. All rights reserved.</div>
                    <div className="hat-footer-note">
                        {t.note}
                    </div>
                </div>
            </div>
        </footer>
    );
}
