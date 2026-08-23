'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { toIsoLang, toRouteLang } from '@/lib/i18n/normalize';

const dict = {
    ko: {
        desc: '설계부터 제조까지 하나로 잇는 AI 제조 플랫폼 — 3D 설계·구조 검증·제조사 연결',
        term1: '이용약관',
        term2: '개인정보 처리방침',
        term3: '보안 정책(NDA)',
        term4: '고객사 운영 정책',
        term5: '파트너사 운영 정책',
        term6: '환불 안내',
        contactLabel: '고객 문의',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: '대표: 김연제',
        bizNo: '사업자등록번호 606-87-03602',
        telesalesNo: '통신판매업 신고번호',
        telesalesBrokerNo: '통신판매중개업 신고번호',
        address: '사업장 소재지: 경기도 남양주시 다산순환로 20, 다산현대프리미어캠퍼스',
        /** /kr 푸터에만 표시 */
        nexysysLegalLink: '통합 사업자·법적 고지 (Nexysys 포털)',
        note: '프로젝트 정보는 내부 검토용으로만 관리되며, 외부로 공개되지 않습니다.'
    },
    en: {
        desc: 'The AI manufacturing platform from design to production — 3D design, engineering verification, and manufacturer matching',
        term1: 'Terms of Use',
        term2: 'Privacy Policy',
        term3: 'Security Policy (NDA)',
        term4: 'Customer Operation Policy',
        term5: 'Partner Operation Policy',
        term6: 'Refund Policy',
        contactLabel: 'Contact',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: 'CEO: Kim Yeon Je',
        bizNo: 'Business Reg. No.: 606-87-03602',
        telesalesNo: 'Mail Order Sales Reg. No.',
        telesalesBrokerNo: 'Mail Order Brokerage Reg. No.',
        address: '20, Dasansunhwan-ro, Namyangju-si, Gyeonggi-do, Republic of Korea',
        nexysysLegalLink: '',
        note: 'Project information is managed only for internal review purposes and is not disclosed externally.'
    },
    ja: {
        desc: '設計から製造までをつなぐAI製造プラットフォーム — 3D設計・構造検証・製造パートナー接続',
        term1: '利用規約',
        term2: 'プライバシーポリシー',
        term3: 'セキュリティポリシー(NDA)',
        term4: '顧客運営ポリシー',
        term5: 'パートナー運営ポリシー',
        term6: '返金について',
        contactLabel: 'お問い合わせ',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: '代表: キム・ヨンジェ',
        bizNo: '事業者登録番号: 606-87-03602',
        telesalesNo: '通信販売業 届出番号',
        telesalesBrokerNo: '通信販売仲介業 届出番号',
        address: '大韓民国 京畿道 南楊州市 多山循環路 20',
        nexysysLegalLink: '',
        note: 'プロジェクト情報は内部検討用としてのみ管理され、外部には公開されません。'
    },
    cn: {
        desc: '从设计到制造一站式的AI制造平台 — 3D设计·结构验证·制造商对接',
        term1: '服务条款',
        term2: '隐私政策',
        term3: '安全政策(NDA)',
        term4: '客户运营政策',
        term5: '合作伙伴运营政策',
        term6: '退款说明',
        contactLabel: '客服邮箱',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: '代表: 金延制',
        bizNo: '营业执照号: 606-87-03602',
        telesalesNo: '通信销售业 申报号',
        telesalesBrokerNo: '通信销售中介业 申报号',
        address: '大韩民国 京畿道 南杨州市 多山循环路 20',
        nexysysLegalLink: '',
        note: '项目信息仅用于内部审核，不会向外部公开。'
    },
    es: {
        desc: 'La plataforma de fabricación con IA, del diseño a la producción — diseño 3D, verificación de ingeniería y conexión con fabricantes',
        term1: 'Términos de Uso',
        term2: 'Política de Privacidad',
        term3: 'Política de Seguridad (NDA)',
        term4: 'Política de Operación del Cliente',
        term5: 'Política de Operación del Socio',
        term6: 'Política de Reembolsos',
        contactLabel: 'Contacto',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: 'CEO: Kim Yeon Je',
        bizNo: 'Reg. No.: 606-87-03602',
        telesalesNo: 'Reg. de Venta a Distancia',
        telesalesBrokerNo: 'Reg. de Intermediación de Venta a Distancia',
        address: '20, Dasansunhwan-ro, Namyangju-si, Gyeonggi-do, República de Corea',
        nexysysLegalLink: '',
        note: 'La información del proyecto se gestiona solo para revisión interna y no se divulga externamente.'
    },
    ar: {
        desc: 'منصة التصنيع بالذكاء الاصطناعي من التصميم إلى الإنتاج — تصميم ثلاثي الأبعاد وتحقق هندسي وربط بالمصنّعين',
        term1: 'شروط الاستخدام',
        term2: 'سياسة الخصوصية',
        term3: 'سياسة الأمان (NDA)',
        term4: 'سياسة تشغيل العملاء',
        term5: 'سياسة تشغيل الشركاء',
        term6: 'سياسة الاسترداد',
        contactLabel: 'تواصل',
        company: 'Nexysys Lab Co., Ltd.',
        ceo: 'الرئيس التنفيذي: كيم يون جيه',
        bizNo: 'رقم السجل التجاري: 606-87-03602',
        telesalesNo: 'رقم تسجيل البيع عن بُعد',
        telesalesBrokerNo: 'رقم تسجيل وساطة البيع عن بُعد',
        address: '20، داسان سونهوان-رو، نامينجو-سي، كيونغي-دو، جمهورية كوريا',
        nexysysLegalLink: '',
        note: 'يتم إدارة معلومات المشروع لأغراض المراجعة الداخلية فقط ولا يتم الإفصاح عنها خارجياً.'
    }
};

const FOOTER_NAV_LABEL: Record<string, string> = {
    kr: '푸터 정책 탐색', en: 'Footer policy navigation', ja: 'フッターのポリシー ナビゲーション',
    cn: '页脚政策导航', es: 'Navegación de políticas del pie', ar: 'تنقل سياسات التذييل',
};
const FOOTER_RIGHTS: Record<string, string> = {
    kr: '© 2026 Nexysys Lab Co., Ltd. 모든 권리 보유.', en: '© 2026 Nexysys Lab Co., Ltd. All rights reserved.',
    ja: '© 2026 Nexysys Lab Co., Ltd. 無断転載を禁じます。', cn: '© 2026 Nexysys Lab Co., Ltd. 版权所有。',
    es: '© 2026 Nexysys Lab Co., Ltd. Todos los derechos reservados.', ar: '© 2026 Nexysys Lab Co., Ltd. جميع الحقوق محفوظة.',
};

export default function Footer() {
    const pathname = usePathname();
    const parts = pathname?.split('/').filter(Boolean) || [];

    // Suppress footer on the 3D modeler and the NexyFab hub — both are
    // app-style surfaces where a marketing footer would steal vertical
    // real estate from the canvas / project gallery.
    if (pathname?.includes('/shape-generator')) return null;
    if (pathname?.includes('/studio')) return null;
    if (pathname?.includes('/nexyfab/hub')) return null;
    if (pathname?.includes('/nexyfab/dashboard')) return null;

    // adminlink 폴더 내부에 있을 경우, 메인 사이트 링크가 깨지지 않도록 처리
    const isAdmin = parts[0] === 'adminlink';
    const lang = isAdmin ? 'kr' : toRouteLang(parts[0]);
    // Footer's historical catalog uses `cn` for Simplified Chinese while the
    // shared helper uses ISO `zh`; keep the catalog stable at this boundary.
    const dictKey = lang === 'cn' ? 'cn' : toIsoLang(lang);
    const t = dict[dictKey as keyof typeof dict];

    const nexysysBase = (process.env.NEXT_PUBLIC_NEXYSYS_URL || 'https://nexysys.com').replace(/\/$/, '');
    const nexysysLegalHref = process.env.NEXT_PUBLIC_NEXYSYS_LEGAL_URL || `${nexysysBase}/kr/`;
    const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'nexyfab@nexysys.com';

    // 통신판매업 (이미 신고) + 통신판매중개업 (M4에 신고 후 채움). 빈 값
    // 환경변수면 footer에서 라인 자체를 노출하지 않음 — Phase-1 지연 등록
    // 패턴 (memory: nexyfab-gtm 참조).
    const telesalesRegNo = process.env.NEXT_PUBLIC_TELESALES_REG_NO || '';
    const telesalesBrokerRegNo = process.env.NEXT_PUBLIC_TELESALES_BROKER_REG_NO || '';

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

                <nav className="hat-footer-nav" aria-label={FOOTER_NAV_LABEL[lang]}>
                    <a href={`/${lang}/terms-of-use/`}>{t.term1}</a>
                    <a href={`/${lang}/privacy-policy/`}>{t.term2}</a>
                    <a href={`/${lang}/security-policy/`}>{t.term3}</a>
                    <a href={`/${lang}/customer-policy/`}>{t.term4}</a>
                    <a href={`/${lang}/partner-policy/`}>{t.term5}</a>
                    <a href={`/${lang}/refund-policy/`}>{t.term6}</a>
                </nav>

                <div className="hat-footer-legal" style={{ fontSize: '12px', color: '#4b5563', lineHeight: 1.8, marginTop: '16px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, color: '#6b7280' }}>{t.company}</div>
                    <div>{t.ceo} | {t.bizNo}</div>
                    {(telesalesRegNo || telesalesBrokerRegNo) && (
                        <div>
                            {telesalesRegNo && (
                                <span>{t.telesalesNo}: {telesalesRegNo}</span>
                            )}
                            {telesalesRegNo && telesalesBrokerRegNo && <span> | </span>}
                            {telesalesBrokerRegNo && (
                                <span>{t.telesalesBrokerNo}: {telesalesBrokerRegNo}</span>
                            )}
                        </div>
                    )}
                    <div>{t.address}</div>
                    <div style={{ marginTop: '6px' }}>
                        <span style={{ color: '#4b5563' }}>{t.contactLabel}: </span>
                        <a href={`mailto:${supportEmail}`} style={{ color: '#0b5cff', fontWeight: 600, textDecoration: 'none' }}>{supportEmail}</a>
                    </div>
                </div>

                {lang === 'kr' && t.nexysysLegalLink ? (
                    <div style={{ marginTop: '12px', textAlign: 'center' }}>
                        <a
                            href={nexysysLegalHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: '12px', color: '#0b5cff', fontWeight: 600, textDecoration: 'none' }}
                        >
                            {t.nexysysLegalLink}
                        </a>
                    </div>
                ) : null}

                <div className="hat-footer-bottom">
                    <div className="hat-footer-copy">{FOOTER_RIGHTS[lang]}</div>
                    <div className="hat-footer-note">
                        {t.note}
                    </div>
                </div>
            </div>
        </footer>
    );
}
