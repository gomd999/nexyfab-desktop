'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

const dict = {
    ko: {
        kicker: 'Nexyfab · 파트너사 운영 정책',
        title: '파트너사 운영 정책 (Partner Policy)',
        desc1: '본 정책은 Nexyfab 플랫폼에 등록된 파트너를 대상으로 하며,',
        desc2: '신뢰 기반 협업과 공정한 매칭 환경 조성을 위해 마련되었습니다.',
        s1Title: '1. 파트너 등록 기준',
        s1List: [
            '실제 개발 경험 또는 제조 설비를 보유하고 있어야 합니다.',
            '등록하는 기술 정보, 설비 정보 및 포트폴리오는 사실에 근거해야 합니다.',
            '회사는 필요 시 대면 또는 비대면 미팅, 추가 자료 제출을 요청할 수 있습니다.',
            '허위 정보가 확인될 경우 등록이 제한되거나 취소될 수 있습니다.'
        ],
        s2Title: '2. 금지 행위',
        s2Desc: '다음 행위는 엄격히 금지됩니다.',
        s2List: [
            '허위 기술, 설비 또는 수행 능력을 등록하는 행위',
            '타인의 포트폴리오, 실적, 지식재산을 무단 도용하는 행위',
            '고객의 요구사항, 도면, 기술 자료를 무단 유출하거나 외부에 공유하는 행위',
            '매칭 후 정당한 사유 없이 연락 지연, 반복적인 미응답 또는 노쇼(No-show) 행위',
            '고객의 기술 정보를 활용하여 무단 개발, 모방 또는 독자적 사업화 시도'
        ],
        s2Foot: '위 행위가 확인될 경우 회사는 매칭 제한 또는 자격 박탈 조치를 취할 수 있습니다.',
        s3Title: '3. 프로젝트 수락 기준',
        s3List: [
            '기술 적합성, 산업 분야, 난이도, 유사 프로젝트 경험 등을 기준으로 우선 매칭이 이루어질 수 있습니다.',
            '무분별한 프로젝트 수락 또는 비현실적 조건 제시는 지양합니다.',
            '불필요한 상담 및 자원 낭비를 방지하기 위해 적합성이 현저히 낮은 매칭은 제한될 수 있습니다.'
        ],
        s4Title: '4. 협업 원칙',
        s4List: [
            '프로젝트 수락 전 고객 요구사항을 충분히 검토해야 합니다.',
            '수행이 불가능하다고 판단될 경우 즉시 회사 및 고객에게 통지해야 합니다.',
            '프로젝트 전 과정에서 기밀 유지 의무를 성실히 이행해야 합니다.',
            '고객과의 계약은 당사자 간 직접 체결되며, 회사는 계약 당사자가 아닙니다.'
        ],
        s5Title: '5. 제재 조치',
        s5Desc: '본 정책 위반 시 다음과 같은 단계적 조치가 적용될 수 있습니다.',
        s5Process: '경고 → 일시적 매칭 제한 → 파트너 자격 박탈',
        s5Foot: '다만, 기밀 정보 유출, 기술 도용 등 중대한 위반 행위의 경우 사전 경고 없이 즉시 영구 제외될 수 있습니다.'
    },
    en: {
        kicker: 'Nexyfab · Partner Policy',
        title: 'Partner Policy',
        desc1: 'This policy is for partners registered on the Nexyfab platform,',
        desc2: 'prepared for trust-based collaboration and a fair matching environment.',
        s1Title: '1. Partner Registration Criteria',
        s1List: [
            'Must possess actual development experience or manufacturing facilities.',
            'Technical information, equipment info, and portfolio must be based on facts.',
            'The company may request face-to-face or virtual meetings and additional data if necessary.',
            'If false information is confirmed, registration may be restricted or canceled.'
        ],
        s2Title: '2. Prohibited Acts',
        s2Desc: 'The following acts are strictly prohibited:',
        s2List: [
            'Registering false technology, equipment, or performance capabilities',
            'Unauthorized misappropriation of others\' portfolios, achievements, or intellectual property',
            'Unauthorized leakage or external sharing of customer requirements, drawings, or technical data',
            'Delayed contact, repeated non-response, or no-show behavior after matching without justification',
            'Attempts at unauthorized development, imitation, or independent commercialization using customer technical info'
        ],
        s2Foot: 'If these acts are confirmed, the company may take measures such as matching restriction or disqualification.',
        s3Title: '3. Project Acceptance Criteria',
        s3List: [
            'Priority matching may occur based on technical suitability, industry field, difficulty, and similar project experience.',
            'Avoid indiscriminate project acceptance or presentation of unrealistic conditions.',
            'Matching with significantly low suitability may be limited to prevent unnecessary consultation and resource waste.'
        ],
        s4Title: '4. Collaboration Principles',
        s4List: [
            'Customer requirements must be fully reviewed before project acceptance.',
            'If performance is determined to be impossible, the company and the customer must be notified immediately.',
            'Confidentiality obligations must be faithfully fulfilled throughout the project lifecycle.',
            'Contracts with customers are concluded directly between the parties; the company is not a contracting party.'
        ],
        s5Title: '5. Sanctions',
        s5Desc: 'In case of policy violation, the following sequential measures may apply:',
        s5Process: 'Warning → Temporary Matching Restriction → Partner Disqualification',
        s5Foot: 'However, in cases of major violations such as leak of confidential info or technology theft, permanent exclusion may be applied immediately without prior warning.'
    },
    ja: {
        kicker: 'Nexyfab · パートナー社運営ポリシー',
        title: 'パートナー社運営ポリシー (Partner Policy)',
        desc1: '本ポリシーはNexyfabプラットフォームに登録されたパートナーを対象とし、',
        desc2: '信頼ベースの協業と公正なマッチング環境を整えるために設けられました。',
        s1Title: '1. パートナー登録基準',
        s1List: [
            '実際の開発経験または製造設備を保有している必要があります。',
            '登録する技術情報、設備情報およびポートフォリオは事実に即している必要があります。',
            '会社は必要に応じて対面または非対面の打ち合わせ、追加資料の提出を求めることができます。',
            '虚偽の情報が確認された場合、登録が制限または取り消されることがあります。'
        ],
        s2Title: '2. 禁止行為',
        s2Desc: '以下の行為は厳格に禁止されています：',
        s2List: [
            '虚偽の技術、設備または遂行能力を登録する行為',
            '他人のポートフォリオ、実績、知的財産を無断で盗用する行為',
            '顧客の要件、図面、技術資料を無断で流出させたり、外部に共有する行為',
            'マッチング後、正当な理由なく連絡を遅延させたり、繰り返しの未回答、またはノーショー(No-show)行為',
            '顧客の技術情報を活用した無断開発、模倣、または独自事業化の試み'
        ],
        s2Foot: '上記の行為が確認された場合、会社はマッチング制限または資格剥奪措置を講じることがあります。',
        s3Title: '3. プロジェクト受諾基準',
        s3List: [
            '技術適合性、産業分野、難易度、類似プロジェクトの経験などを基準に優先マッチングが行われる場合があります。',
            '無分別なプロジェクト受諾や非現実的な条件の提示は避けてください。',
            '不必要な相談やリソースの浪費を防ぐため、適合性が著しく低いマッチングは制限される場合があります。'
        ],
        s4Title: '4. 協業原則',
        s4List: [
            'プロジェクト受諾前に顧客の要件を十分に検討する必要があります。',
            '遂行が不可能と判断された場合、直ちに会社および顧客に通知する必要があります。',
            'プロジェクトの全過程において機密保持義務を誠実に履行する必要があります。',
            '顧客との契約は当事者間で直接締結され、会社は契約の当事者ではありません。'
        ],
        s5Title: '5. 制裁措置',
        s5Desc: '本ポリシーに違反した場合、以下のような段階的な措置が適用される場合があります。',
        s5Process: '警告 → 一時的なマッチング制限 → パートナー資格剥奪',
        s5Foot: 'ただし、機密情報の流出や技術盗用などの重大な違反行為の場合、事前の警告なしに直ちに永久追放される場合があります。'
    },
    zh: {
        kicker: 'Nexyfab · 合作伙伴运营政策',
        title: '合作伙伴运营政策 (Partner Policy)',
        desc1: '本政策面向在 Nexyfab 平台注册的合作伙伴，',
        desc2: '旨在建立基于信任的合作和公平的匹配环境。',
        s1Title: '1. 合作伙伴注册标准',
        s1List: [
            '必须拥有实际开发经验或制造设备。',
            '注册的技术信息、设备信息和作品集必须真实。',
            '公司可在必要时要求进行面对面或远程会议，或提交额外资料。',
            '一经核实虚假信息，注册可能会受限或被取消。'
        ],
        s2Title: '2. 禁止行为',
        s2Desc: '严禁以下行为：',
        s2List: [
            '注册虚假的技术、设备或执行能力',
            '擅自盗用他人的作品集、业绩或知识产权',
            '擅自泄露或向外部共享客户的需求、图纸或技术资料',
            '匹配后无正当理由拖延联系、反复不回复或缺席 (No-show)',
            '利用客户技术信息进行擅自开发、模仿或尝试独立商业化'
        ],
        s2Foot: '一经核实，公司有权采取限制匹配或取消资格等措施。',
        s3Title: '3. 项目承接标准',
        s3List: [
            '可根据技术契合度、行业领域、难度和类似项目经验优先进行匹配。',
            '避免盲目承接项目或提出不切实际的条件。',
            '为防止不必要的咨询和资源浪费，契合度显著较低的匹配可能会受限。'
        ],
        s4Title: '4. 协作原则',
        s4List: [
            '在承接项目前必须充分评估客户需求。',
            '若判断无法执行，必须立即通知公司和客户。',
            '在项目全过程中必须诚实履行保密义务。',
            '与客户的合同由双方直接签署，公司不是合同当事方。'
        ],
        s5Title: '5. 制裁措施',
        s5Desc: '违反本政策时，可能会采取以下阶梯式措施：',
        s5Process: '警告 → 临时限制匹配 → 取消合作伙伴资格',
        s5Foot: '但在泄露机密信息、盗用技术等严重违规情况下，公司有权在不预先警告的情况下立即永久清退。'
    }
};

export default function PartnerPolicyPage() {
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
                    <p style={{ marginBottom: '12px' }}>{t.s5Desc}</p>
                    <p style={{ fontWeight: 800, color: '#111', fontSize: '18px', marginBottom: '12px', textAlign: 'center', backgroundColor: '#f0f4ff', padding: '10px', borderRadius: '4px' }}>{t.s5Process}</p>
                    <p style={{ color: '#d32f2f', fontWeight: 700, fontSize: '15px' }}>{t.s5Foot}</p>
                </div>

            </section>
        </main>
    );
}

