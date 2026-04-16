'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

const dict = {
    ko: {
        kicker: 'Nexyfab · 고객사 운영 정책',
        title: '고객사 운영 정책 (Customer Policy)',
        desc1: '본 정책은 Nexyfab 플랫폼을 이용하는 고객을 대상으로 하며,',
        desc2: '공정하고 효율적인 프로젝트 진행을 위해 마련되었습니다.',
        s1Title: '1. 프로젝트 등록 원칙',
        s1List: [
            '실제 개발 또는 제조 의도가 있는 프로젝트만 등록해야 합니다.',
            '요구사항은 사실에 기반하여 가능한 한 구체적으로 작성해야 합니다.',
            '예산, 개발 목적, 기술 범위는 합리적인 수준에서 명확하게 기재해야 합니다.',
            '허위 정보 또는 타인의 권리를 침해하는 자료를 등록해서는 안 됩니다.'
        ],
        s2Title: '2. 금지 행위',
        s2Desc: '다음 행위는 금지됩니다.',
        s2List: [
            '경쟁사 기술 탐색 또는 정보 수집을 목적으로 한 문의',
            '불완전한 정보 제출 후 반복적인 취소 또는 지연 행위',
            '현저히 비현실적인 예산 제시로 파트너의 정상적 검토를 방해하는 행위',
            '매칭된 파트너의 기술·자료·제안서를 무단 사용하거나 외부에 공유하는 행위',
            '플랫폼을 우회하여 부정한 방식으로 파트너 정보를 수집하는 행위'
        ],
        s2Foot: '위 행위가 확인될 경우, 회사는 매칭 제한 또는 서비스 이용 제한 조치를 취할 수 있습니다.',
        s3Title: '3. 파트너 매칭 정책',
        s3List: [
            '회사는 기술 적합성, 유사 레퍼런스, 공정 범위 등을 기준으로 상위 1~3개의 파트너를 추천할 수 있습니다.',
            '추천은 내부 알고리즘 분석 및 운영 검토를 거쳐 진행됩니다.',
            '고객은 파트너 제안서를 검토한 후 직접 상담 및 협의를 진행합니다.',
            '최종 계약 및 생산은 고객과 파트너 간 직접 체결됩니다.'
        ],
        s4Title: '4. NDA (비밀유지협약)',
        s4List: [
            '프로젝트 등록 시 기본적인 정보 보호 원칙이 적용됩니다.',
            '초기 매칭 단계에서는 고객이 파트너에게 전달할 정보 범위를 선택할 수 있습니다.',
            '구체적인 NDA 체결은 프로젝트 단계에 따라 별도로 진행될 수 있으며, 법적 효력은 계약 당사자 간에 귀속됩니다.'
        ],
        s5Title: '5. 프로젝트 중단 규정',
        s5List: [
            '합리적인 사유 없이 반복적으로 프로젝트를 중단하는 경우, 향후 매칭이 제한될 수 있습니다.',
            '기업 내부 보안 사유 또는 법적 사유로 인한 중단은 예외로 합니다.'
        ]
    },
    en: {
        kicker: 'Nexyfab · Customer Policy',
        title: 'Customer Policy',
        desc1: 'This policy is for customers using the Nexyfab platform,',
        desc2: 'prepared for fair and efficient project progress.',
        s1Title: '1. Project Registration Principles',
        s1List: [
            'Only projects with actual development or manufacturing intent should be registered.',
            'Requirements must be as specific as possible based on facts.',
            'Budget, purpose, and technical scope must be clearly stated at a reasonable level.',
            'False information or materials that infringe on the rights of others must not be registered.'
        ],
        s2Title: '2. Prohibited Acts',
        s2Desc: 'The following acts are prohibited:',
        s2List: [
            'Inquiries aimed at exploring competitor technology or collecting information',
            'Repeated cancellations or delays after submitting incomplete information',
            'Hindering normal partner review by presenting a significantly unrealistic budget',
            'Unauthorized use or external sharing of matched partner technology, materials, or proposals',
            'Bypassing the platform to collect partner information in an improper manner'
        ],
        s2Foot: 'If these acts are confirmed, the company may take measures such as matching restriction or service use restriction.',
        s3Title: '3. Partner Matching Policy',
        s3List: [
            'The company may recommend 1-3 partners based on technical suitability, similar references, and process scope.',
            'Recommendations are made through internal algorithm analysis and operation review.',
            'Customers proceed with direct consultation and negotiation after reviewing partner proposals.',
            'Final contracts and production are concluded directly between the customer and the partner.'
        ],
        s4Title: '4. NDA (Non-Disclosure Agreement)',
        s4List: [
            'Basic information protection principles apply upon project registration.',
            'In the initial matching stage, customers can select the scope of information to be sent to partners.',
            'Specific NDAs may be executed separately depending on the project stage, and legal effect belongs to the contracting parties.'
        ],
        s5Title: '5. Project Suspension Rules',
        s5List: [
            'Repeated project suspension without a reasonable cause may lead to future matching restrictions.',
            'Suspensions due to corporate security or legal reasons are exceptions.'
        ]
    },
    ja: {
        kicker: 'Nexyfab · 顧客社運営ポリシー',
        title: '顧客社運営ポリシー (Customer Policy)',
        desc1: '本ポリシーはNexyfabプラットフォームを利用する顧客を対象とし、',
        desc2: '公正かつ効率的なプロジェクト進行のために設けられました。',
        s1Title: '1. プロジェクト登録原則',
        s1List: [
            '実際の開発または製造の意図があるプロジェクトのみ登録する必要があります。',
            '要件は事実に即して可能な限り具体的に作成する必要があります。',
            '予算、開発目的、技術範囲は妥当な水準で明確に記載する必要があります。',
            '虚偽の情報や他人の権利を侵害する資料を登録してはなりません。'
        ],
        s2Title: '2. 禁止行為',
        s2Desc: '以下の行為は禁止されています：',
        s2List: [
            '競合他社の技術探索または情報収集を目的とした問い合わせ',
            '不完全な情報提出後の繰り返しのキャンセルまたは遅延行為',
            '著しく非現実的な予算提示によりパートナーの正常な検討を妨げる行為',
            'マッチングされたパートナーの技術・資料・提案書を無断で使用したり、外部に共有する行為',
            'プラットフォームをバイパスして不正な方法でパートナー情報を収集する行為'
        ],
        s2Foot: '上記の行為が確認された場合、会社はマッチング制限またはサービス利用制限措置を講じることがあります。',
        s3Title: '3. パートナーマッチングポリシー',
        s3List: [
            '会社は技術適合性、類似リファレンス、工程範囲などを基準に上位1〜3社のパートナーを推薦できます。',
            '推薦は内部アルゴリズム分析および運営検討を経て行われます。',
            '顧客はパートナーの提案書を検討した後、直接相談および協議を進めます。',
            '最終契約および生産は、顧客とパートナー間で直接締結されます。'
        ],
        s4Title: '4. NDA (機密保持契約)',
        s4List: [
            'プロジェクト登録時に基本的な情報保護原則が適用されます。',
            '初期マッチング段階では、顧客がパートナーに伝える情報範囲を選択できます。',
            '具体的なNDA締結はプロジェクトの段階に応じて別途行われる場合があり、法的効力は契約当事者間に帰属します。'
        ],
        s5Title: '5. プロジェクト中断規定',
        s5List: [
            '合理的な理由なく繰り返しプロジェクトを中断する場合、今後のマッチングが制限される可能性があります。',
            '企業内部のセキュリティ上の理由または法的理由による中断は例外とします。'
        ]
    },
    zh: {
        kicker: 'Nexyfab · 客户运营政策',
        title: '客户运营政策 (Customer Policy)',
        desc1: '本政策面向使用 Nexyfab 平台的客户，',
        desc2: '旨在确保公平高效地推进项目。',
        s1Title: '1. 项目注册原则',
        s1List: [
            '仅应注册具有真实开发或制造意图的项目。',
            '需求描述应基于事实且尽可能具体。',
            '预算、开发目的和技术范围应在合理水平上明确记录。',
            '严禁注册虚假信息或侵犯他人权利的材料。'
        ],
        s2Title: '2. 禁止行为',
        s2Desc: '禁止以下行为：',
        s2List: [
            '以探索竞争对手技术或收集信息为目的的咨询',
            '提交不完整信息后反复取消或拖延的行为',
            '通过提供极不现实的预算，阻碍合作伙伴正常评估的行为',
            '擅自使用或向外部共享已匹配合作伙伴的技术、资料或提案的行为',
            '绕过平台，以不正当方式收集合作伙伴信息的行为'
        ],
        s2Foot: '一经核实，公司有权采取限制匹配或限制使用服务等措施。',
        s3Title: '3. 合作伙伴匹配政策',
        s3List: [
            '公司可根据技术契合度、类似案例、工序范围等标准推荐前 1-3 家合作伙伴。',
            '推荐过程包括内部算法分析和运营审查。',
            '客户在评估合作伙伴提案后，直接进行咨询和协商。',
            '最终合同及生产由客户与合作伙伴直接签署并执行。'
        ],
        s4Title: '4. NDA (保密协议)',
        s4List: [
            '项目注册时即适用基本的信息保护原则。',
            '在初始匹配阶段，客户可以选择传达给合作伙伴的信息范围。',
            '具体的 NDA 签署可根据项目阶段另行进行，其法律效力归属于签约双方。'
        ],
        s5Title: '5. 项目中断规定',
        s5List: [
            '无正当理由反复中断项目时，可能会限制未来的匹配。',
            '因企业内部安全原因或法律原因导致的中断除外。'
        ]
    }
};

export default function CustomerPolicyPage() {
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
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {t.s1List.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s2Title}</h2>
                    <p style={{ marginBottom: '12px' }}>{t.s2Desc}</p>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                        {t.s2List.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                    <p style={{ color: '#d32f2f', fontWeight: 700, fontSize: '15px' }}>{t.s2Foot}</p>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s3Title}</h2>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {t.s3List.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s4Title}</h2>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {t.s4List.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s5Title}</h2>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {t.s5List.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>

            </section>
        </main>
    );
}

