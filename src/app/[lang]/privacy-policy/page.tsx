'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

const dict = {
    ko: {
        kicker: 'Nexyfab · 개인정보 처리방침',
        title: '개인정보 처리방침',
        desc1: 'Nexyfab는 이용자의 개인정보를 소중히 보호하며,',
        desc2: '관련 법령을 준수하여 안전하게 관리합니다.',
        s1Title: '1. 수집하는 개인정보 항목',
        s1Desc: '회사는 서비스 제공을 위해 다음 정보를 수집할 수 있습니다.',
        s1Sub1: '① Customer(프로젝트 의뢰인)',
        s1List1: ['이름', '연락처(전화번호, 이메일)', '회사명', '프로젝트 요구사항, 도면, 파일', '상담 및 커뮤니케이션 기록'],
        s1Sub2: '② Partner(개발자/제조사)',
        s1List2: ['이름', '연락처', '회사명 및 사업자 정보', '보유 기술, 설비 정보, 포트폴리오', '프로젝트 수행 이력 및 관련 자료'],
        s1Sub3: '③ 자동 수집 항목',
        s1List3: ['접속 로그', 'IP 주소', '쿠키', '서비스 이용 기록'],
        s2Title: '2. 개인정보 수집 및 이용 목적',
        s2List: ['프로젝트 접수 및 요구사항 분석', '파트너 매칭 및 추천', '문의 응답 및 본인 확인', 'NDA 체결 및 협업 절차 지원', '서비스 개선, 통계 분석 및 내부 관리'],
        s3Title: '3. 보유 및 이용 기간',
        s3Desc: '회사는 원칙적으로 개인정보 수집 및 이용 목적이 달성된 후 지체 없이 파기합니다. 단, 관련 법령에 따라 다음 정보는 일정 기간 보존할 수 있습니다.',
        s3List: ['계약 및 거래 관련 기록: 5년', '소비자 불만 및 분쟁 처리 기록: 3년', '접속 로그 기록: 1년'],
        s4Title: '4. 개인정보의 제3자 제공',
        s4Desc: '회사는 다음의 경우에 한하여 최소한의 개인정보를 제공합니다.',
        s4List: ['고객 → 매칭된 파트너 (프로젝트 진행 목적)', '파트너 → 해당 프로젝트 고객 (협업 목적)', '이용자의 동의가 있는 경우', '법령에 근거가 있는 경우'],
        s4Note: '회사는 이용 목적 범위를 초과하여 개인정보를 제공하지 않습니다.',
        s5Title: '5. 개인정보 처리 위탁',
        s5Desc: '회사는 원활한 서비스 제공을 위하여 일부 업무를 외부 업체에 위탁할 수 있으며, 이 경우 관련 법령에 따라 위탁계약을 체결하고 개인정보가 안전하게 관리되도록 감독합니다.',
        s6Title: '6. 이용자의 권리 및 행사 방법',
        s6Desc: '이용자는 언제든지 개인정보 열람, 정정·삭제, 처리 정지 요구 등의 권리를 행사할 수 있습니다. 권리 행사는 회사에 서면, 이메일 등을 통해 요청할 수 있으며, 회사는 지체 없이 조치합니다.',
        s7Title: '7. 개인정보의 파기 절차 및 방법',
        s7Desc: '개인정보는 보유 기간 경과 또는 처리 목적 달성 시 전자적 파일은 복구 불가능한 방법으로 삭제하며, 종이 문서는 분쇄 또는 소각합니다.',
        s8Title: '8. 정책 변경',
        s8Desc: '본 개인정보 처리방침은 관련 법령 및 회사 정책에 따라 변경될 수 있으며, 변경 시 서비스 화면을 통해 공지합니다.'
    },
    en: {
        kicker: 'Nexyfab · Privacy Policy',
        title: 'Privacy Policy',
        desc1: 'Nexyfab protects user\'s personal information and',
        desc2: 'manages it safely in compliance with relevant laws.',
        s1Title: '1. Collected Personal Information Items',
        s1Desc: 'The Company may collect the following information to provide services.',
        s1Sub1: '① Customer (Project Client)',
        s1List1: ['Name', 'Contact (Phone, Email)', 'Company Name', 'Project requirements, drawings, files', 'Consultation and communication records'],
        s1Sub2: '② Partner (Developer/Manufacturer)',
        s1List2: ['Name', 'Contact', 'Company name and business information', 'Possessed technology, equipment info, portfolio', 'Project history and related materials'],
        s1Sub3: '③ Automatically Collected Items',
        s1List3: ['Access logs', 'IP address', 'Cookies', 'Service usage records'],
        s2Title: '2. Purpose of Collection and Use',
        s2List: ['Project reception and requirements analysis', 'Partner matching and recommendation', 'Inquiry response and identification', 'Support for NDA procedures and collaboration', 'Service improvement, statistical analysis, and internal management'],
        s3Title: '3. Retention and Use Period',
        s3Desc: 'In principle, personal information is destroyed without delay once the purpose is achieved. However, the following are retained per law:',
        s3List: ['Records on contracts and transactions: 5 years', 'Records on consumer complaints and disputes: 3 years', 'Access log records: 1 year'],
        s4Title: '4. Provision to Third Parties',
        s4Desc: 'The Company provides minimum personal information only in the following cases:',
        s4List: ['Customer → Matched Partner (for project progress)', 'Partner → Relevant Project Customer (for collaboration)', 'When the user consents', 'When there is a legal basis'],
        s4Note: 'The Company does not provide personal information beyond the scope of the intended use.',
        s5Title: '5. Entrustment of Personal Information Processing',
        s5Desc: 'The Company may entrust some tasks to third-party vendors for smooth service. In such cases, we sign entrustment contracts and supervise to ensure security.',
        s6Title: '6. User Rights and How to Exercise Them',
        s6Desc: 'Users can exercise rights such as reading, correcting/deleting, or suspending processing of their info. These can be requested via writing/email, and the Company will act without delay.',
        s7Title: '7. Destruction Procedure and Method',
        s7Desc: 'When retention periods expire or purposes are met, electronic files are deleted irrecoverably, and paper documents are shredded or incinerated.',
        s8Title: '8. Policy Changes',
        s8Desc: 'This policy may change according to law or company policy, and notice will be provided on the service screen upon change.'
    },
    ja: {
        kicker: 'Nexyfab · プライバシーポリシー',
        title: 'プライバシーポリシー',
        desc1: 'Nexyfabは利用者の個人情報を大切に保護し、',
        desc2: '関連法令を遵守して安全に管理します。',
        s1Title: '1. 収集する個人情報の項目',
        s1Desc: '会社はサービス提供のために以下の情報を収集する場合があります。',
        s1Sub1: '① Customer（プロジェクト依頼人）',
        s1List1: ['氏名', '連絡先（電話番号、メール）', '会社名', 'プロジェクト要件、図面、ファイル', '相談およびコミュニケーション記録'],
        s1Sub2: '② Partner（開発者/製造社）',
        s1List2: ['氏名', '連絡先', '会社名および事業者情報', '保有技術、設備情報、ポートフォリオ', 'プロジェクト遂行履歴および関連資料'],
        s1Sub3: '③ 自動収集項目',
        s1List3: ['接続ログ', 'IPアドレス', 'クッキー', 'サービス利用記録'],
        s2Title: '2. 個人情報の収集および利用目的',
        s2List: ['プロジェクト受付および要件分析', 'パートナーマッチングおよび推薦', '問い合わせ対応および本人確認', 'NDA締結および連携手続きサポート', 'サービス改善、統計分析および内部管理'],
        s3Title: '3. 保有および利用期間',
        s3Desc: '原則として個人情報の利用目的達成後は遅滞なく破棄します。ただし、法令に基づき以下は一定期間保存されます。',
        s3List: ['契約および取引関連記録：5年', '消費者苦情および紛争処理記録：3年', '接続ログ記録：1年'],
        s4Title: '4. 個人情報の第三者提供',
        s4Desc: '会社は以下の場合に限り、最小限の個人情報を提供します。',
        s4List: ['顧客 → マッチングされたパートナー（プロジェクト進行目的）', 'パートナー → 該当プロジェクト顧客（連携目的）', '利用者の同意がある場合', '法令に根拠がある場合'],
        s4Note: '会社は利用目的の範囲を超えて個人情報を提供しません。',
        s5Title: '5. 個人情報の処理委託',
        s5Desc: '会社は円滑なサービス提供のため一部業務を外部業者に委託する場合があり、その際は法令に従い安全に管理されるよう監督します。',
        s6Title: '6. 利用者の権利および行使方法',
        s6Desc: '利用者はいつでも閲覧、訂正・削除、処理停止要求などの権利を行使できます。書面やメールで請求でき、会社は遅滞なく対応します。',
        s7Title: '7. 個人情報の破棄手続きおよび方法',
        s7Desc: '保有期間経過後は、電子ファイルは復旧不可能な方法で削除し、紙文書は裁断または焼却します。',
        s8Title: '8. ポリシーの変更',
        s8Desc: '本方針は法令や内部ポリシーにより変更される場合があり、変更時はサービス画面を通じて告知します。'
    },
    zh: {
        kicker: 'Nexyfab · 隐私政策',
        title: '隐私政策',
        desc1: 'Nexyfab 保护用户的个人信息，',
        desc2: '并遵守相关法规以进行安全管理。',
        s1Title: '1. 收集的个人信息项',
        s1Desc: '本公司可能为了提供服务而收集以下信息。',
        s1Sub1: '① Customer（项目委托人）',
        s1List1: ['姓名', '联系方式（电话、邮箱）', '公司名称', '项目需求、图纸、文件', '咨询及沟通记录'],
        s1Sub2: '② Partner（开发者/制造商）',
        s1List2: ['姓名', '联系方式', '公司名称及商业信息', '所持技术、设备信息、案例库', '项目执行历史及相关资料'],
        s1Sub3: '③ 自动收集项',
        s1List3: ['访问日志', 'IP 地址', 'Cookie', '服务使用记录'],
        s2Title: '2. 个人信息收集及使用目的',
        s2List: ['项目接收及需求分析', '合作伙伴匹配与推荐', '咨询回复及身份验证', 'NDA 签署及协作流程支持', '服务优化、统计分析及内部管理'],
        s3Title: '3. 保留及使用期限',
        s3Desc: '原则上，个人信息在达到目的后会立即销毁。但根据法规，以下信息将保留一定期限：',
        s3List: ['合同及交易记录：5年', '消费者投诉及纠纷处理记录：3年', '访问日志记录：1年'],
        s4Title: '4. 向第三方提供个人信息',
        s4Desc: '本公司仅在以下情况下提供最低限度的个人信息：',
        s4List: ['客户 → 匹配的合作伙伴（用于项目推进）', '合作伙伴 → 相关项目客户（用于协作）', '经用户同意时', '依据法律法规时'],
        s4Note: '本公司不会提供超出使用目的范围的个人信息。',
        s5Title: '5. 个人信息处理委托',
        s5Desc: '为了顺利提供服务，本公司可将部分业务委托给外部公司，并依法签署合同进行监督，确保信息安全。',
        s6Title: '6. 用户权利及行使方式',
        s6Desc: '用户可随时行使查阅、更正、删除或停止处理其信息的权利。可通过书面、邮件等方式申请，本公司将立即处理。',
        s7Title: '7. 个人信息销毁程序及方法',
        s7Desc: '保留期满后，电子文件以不可恢复的方式删除，纸质文件通过粉碎或焚烧销毁。',
        s8Title: '8. 政策变更',
        s8Desc: '本政策可能根据法规或公司政策变更，变更时将通过服务页面公布。'
    }
};

export default function PrivacyPolicyPage() {
    const pathname = usePathname();
    const langCode = pathname.split('/')[1] || 'en';
    const lang = ['en', 'kr', 'ja', 'cn'].includes(langCode) ? langCode : 'en';

    const langMap: Record<string, string> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'zh', es: 'en', ar: 'en' };
    const t = dict[langMap[lang] as keyof typeof dict];

    return (
        <main style={{ minHeight: '100vh', backgroundColor: '#fff', paddingBottom: '80px' }}>
            <section style={{ textAlign: 'center', padding: '100px 20px 60px', backgroundColor: '#f8f9fb', marginBottom: '40px' }}>
                <p style={{ fontSize: '14px', letterSpacing: '0.15em', color: '#0056ff', marginBottom: '16px', fontWeight: 800 }}>{t.kicker}</p>
                <h1 style={{ fontSize: '42px', fontWeight: 900, marginBottom: '20px', color: '#111' }}>{t.title}</h1>
                <p style={{ color: '#555', fontSize: '16px', maxWidth: '700px', margin: '0 auto', lineHeight: 1.6 }}>
                    {t.desc1}<br />{t.desc2}
                </p>
            </section>

            <section style={{ maxWidth: '800px', margin: '0 auto', padding: '0 20px', lineHeight: 1.8, color: '#333', fontSize: '16px', display: 'flex', flexDirection: 'column', gap: '40px' }}>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s1Title}</h2>
                    <p style={{ marginBottom: '12px' }}>{t.s1Desc}</p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div>
                            <p style={{ fontWeight: 700, color: '#111', marginBottom: '6px' }}>{t.s1Sub1}</p>
                            <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                                {t.s1List1.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                        </div>
                        <div>
                            <p style={{ fontWeight: 700, color: '#111', marginBottom: '6px' }}>{t.s1Sub2}</p>
                            <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                                {t.s1List2.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                        </div>
                        <div>
                            <p style={{ fontWeight: 700, color: '#111', marginBottom: '6px' }}>{t.s1Sub3}</p>
                            <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                                {t.s1List3.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                        </div>
                    </div>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s2Title}</h2>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                        {t.s2List.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s3Title}</h2>
                    <p style={{ marginBottom: '12px' }}>{t.s3Desc}</p>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                        {t.s3List.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s4Title}</h2>
                    <p style={{ marginBottom: '12px' }}>{t.s4Desc}</p>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', marginBottom: '12px' }}>
                        {t.s4List.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                    <p style={{ color: '#666', fontSize: '15px' }}>{t.s4Note}</p>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s5Title}</h2>
                    <p>{t.s5Desc}</p>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s6Title}</h2>
                    <p>{t.s6Desc}</p>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s7Title}</h2>
                    <p>{t.s7Desc}</p>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s8Title}</h2>
                    <p>{(t as any).s8Desc}</p>
                </div>

            </section>
        </main>
    );
}
