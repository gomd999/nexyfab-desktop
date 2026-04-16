'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

const dict = {
    ko: {
        kicker: 'Nexyfab · 보안 정책 (NDA)',
        title: '보안 정책 (NDA)',
        desc1: 'Nexyfab는 고객과 파트너의 프로젝트 정보를 보호하기 위해',
        desc2: '최소 공개 · 접근 제한 · 기밀 유지 원칙을 적용합니다.',
        intro: '본 정책은 서비스를 이용하는 모든 고객 및 파트너에게 적용됩니다.',
        s1Title: '1. 기밀 정보의 정의',
        s1Desc1: '회사는 다음 정보를 “기밀 정보”로 정의합니다.',
        s1List1: [
            '제품 설계, 2D/3D 도면, 구조 데이터',
            '회로/전기/PCB 설계 데이터',
            '개발 목적, 요구사항, 기술 사양',
            '시제품 이미지 및 개발 과정 데이터',
            '회사명, 담당자 등 기업 정보',
            '제조 공정, 자동화 라인 레이아웃',
            '가격, 견적, 제안서 내용',
            '협업 중 생성된 문서 및 커뮤니케이션',
            '상담, 통화, 채팅, 업로드된 파일을 통해 공유된 정보'
        ],
        s1Desc2: '다만, 다음 정보는 기밀 정보에 해당하지 않습니다.',
        s1List2: [
            '이미 공개된 정보',
            '수령 이전에 합법적으로 보유하고 있던 정보',
            '법령에 따라 공개가 요구되는 정보'
        ],
        s2Title: '2. NDA 적용 및 보호 원칙',
        s2Sub1: '① 기본 원칙',
        s2List1: [
            '프로젝트 정보는 내부 검토 범위 내에서만 접근됩니다.',
            '매칭 과정에서는 목적 수행에 필요한 최소한의 정보만 공유됩니다.',
            '초기 매칭 단계에서는 고객 및 파트너 정보가 제한적으로 공개될 수 있습니다.'
        ],
        s2Sub2: '② 고객 정보 보호',
        s2List2: [
            '고객의 프로젝트 정보는 회사 내부 운영 인원 중 필요 인원에 한해 접근됩니다.',
            '매칭 과정에서 파트너에게 전달되는 정보는 프로젝트 수행 판단에 필요한 범위로 제한됩니다.',
            '별도 합의가 없는 한, 고객의 회사명 및 상세 정보는 초기 단계에서 익명화될 수 있습니다.'
        ],
        s2Sub3: '③ 파트너 정보 보호',
        s2List3: [
            '파트너의 보유 기술, 설비 정보 및 내부 역량 데이터는 매칭 목적 범위 내에서만 활용됩니다.',
            '매칭이 성립된 경우에 한하여 관련 프로젝트 고객에게 필요한 정보가 제공될 수 있습니다.'
        ],
        s3Title: '3. NDA 체결 지원',
        s3Desc: '회사는 프로젝트 진행 단계에서 고객과 파트너 간 NDA 체결 절차를 지원할 수 있습니다. 단, NDA의 구체적 효력 및 법적 책임은 계약 당사자 간에 귀속됩니다.',
        s4Title: '4. 정보 보호 범위 및 책임 제한',
        s4List: [
            '회사는 합리적인 보안 조치를 통해 기밀 정보를 보호합니다.',
            '회사는 통제 범위를 벗어난 제3자의 행위, 이용자 본인의 과실 또는 계약 당사자 간 직접 교환된 정보에 대해서는 책임을 지지 않습니다.',
            '플랫폼을 통하지 않고 직접 공유된 정보에 대해서는 본 보안 정책이 적용되지 않습니다.'
        ],
        s5Title: '5. 정책 변경',
        s5Desc: '본 보안 정책은 관련 법령 또는 회사 정책에 따라 변경될 수 있으며, 변경 시 서비스 화면을 통해 공지합니다.'
    },
    en: {
        kicker: 'Nexyfab · Security Policy (NDA)',
        title: 'Security Policy (NDA)',
        desc1: 'Nexyfab applies the principles of minimum disclosure,',
        desc2: 'access restriction, and confidentiality to protect project information.',
        intro: 'This policy applies to all customers and partners using the service.',
        s1Title: '1. Definition of Confidential Information',
        s1Desc1: 'The Company defines the following as "Confidential Information":',
        s1List1: [
            'Product design, 2D/3D drawings, structural data',
            'Circuit/electrical/PCB design data',
            'Development purpose, requirements, technical specs',
            'Prototype images and development process data',
            'Corporate info such as company name, contact person, etc.',
            'Manufacturing process, automation line layout',
            'Price, quotation, proposal content',
            'Documents and communications generated during collaboration',
            'Information shared via consultation, call, chat, or uploaded files'
        ],
        s1Desc2: 'However, the following information is not considered confidential:',
        s1List2: [
            'Information already made public',
            'Information lawfully possessed prior to receipt',
            'Information required to be disclosed by law'
        ],
        s2Title: '2. NDA Application and Protection Principles',
        s2Sub1: '① Basic Principles',
        s2List1: [
            'Project information is accessed only within the scope of internal review.',
            'Only the minimum information necessary for the purpose is shared during matching.',
            'Customer and partner info may be partially disclosed during initial matching.'
        ],
        s2Sub2: '② Customer Information Protection',
        s2List2: [
            'Access to customer project info is restricted to necessary internal personnel.',
            'Info passed to partners during matching is limited to what is needed for evaluation.',
            'Unless agreed otherwise, company names and details may be anonymized in early stages.'
        ],
        s2Sub3: '③ Partner Information Protection',
        s2List3: [
            'Partner\'s technology, facility info, and internal capacity data are used only for matching.',
            'Information may be provided to relevant project customers once a match is established.'
        ],
        s3Title: '3. NDA Execution Support',
        s3Desc: 'The Company may support NDA execution procedures between customers and partners. However, the specific effect and legal liability of the NDA belong to the contracting parties.',
        s4Title: '4. Scope of Information Protection and Limitation of Liability',
        s4List: [
            'The Company protects confidential information through reasonable security measures.',
            'The Company is not liable for acts of third parties beyond its control, user negligence, or info exchanged directly between parties.',
            'This policy does not apply to information shared directly outside the platform.'
        ],
        s5Title: '5. Policy Changes',
        s5Desc: 'This security policy may change according to law or company policy; notice will be provided on the service screen upon change.'
    },
    ja: {
        kicker: 'Nexyfab · セキュリティポリシー (NDA)',
        title: 'セキュリティポリシー (NDA)',
        desc1: 'Nexyfabは顧客とパートナーのプロジェクト情報を保護するため',
        desc2: '最小公開・アクセス制限・機密保持の原則を適用します。',
        intro: '本ポリシーは、サービスを利用するすべての顧客およびパートナーに適用されます。',
        s1Title: '1. 機密情報の定義',
        s1Desc1: '以下の情報を「機密情報」と定義します。',
        s1List1: [
            '製品設計、2D/3D図面、構造データ',
            '回路/電気/PCB設計データ',
            '開発目的、要件、技術仕様',
            '試作品画像および開発過程データ',
            '会社名、担当者などの企業情報',
            '製造工程、自動化ラインのレイアウト',
            '価格、見積り、提案書',
            '協業中に作成された文書および連絡',
            '相談、通話、チャット、アップロードファイルを通じて共有された情報'
        ],
        s1Desc2: 'ただし、以下の情報は機密情報に該当しません。',
        s1List2: [
            '既に公開されている情報',
            '受領前に合法的に保有していた情報',
            '法令に基づき公開が求められる情報'
        ],
        s2Title: '2. NDA適用および保護原則',
        s2Sub1: '① 基本原則',
        s2List1: [
            'プロジェクト情報は内部検討の範囲内でのみアクセスされます。',
            'マッチング過程では目的遂行に必要な最小限の情報のみが共有されます。',
            '初期マッチング段階では、顧客およびパートナー情報が制限的に公開される場合があります。'
        ],
        s2Sub2: '② 顧客情報の保護',
        s2List2: [
            '顧客の情報は、社内の必要最小限の運営スタッフのみがアクセスします。',
            'パートナーに提供される情報は、遂行判断に必要な範囲に制限されます。',
            '別途合意がない限り、社名などは初期段階で匿名化される場合があります。'
        ],
        s2Sub3: '③ パートナー情報の保護',
        s2List3: [
            'パートナーの技術や設備データは、マッチング目的の範囲内でのみ活用されます。',
            'マッチング成立時に限り、該当プロジェクトの顧客に必要な情報が提供されます。'
        ],
        s3Title: '3. NDA締結サポート',
        s3Desc: '会社は顧客とパートナー間のNDA締結手続きをサポートできます。ただし、NDAの法的効力および責任は契約当事者間に帰属します。',
        s4Title: '4. 情報保護の範囲および責任の制限',
        s4List: [
            '会社は合理的なセキュリティ措置を通じて機密情報を保護します。',
            '会社の統制範囲外の第三者の行為、利用者自身の過失、当事者間で直接交換された情報については責任を負いません。',
            'プラットフォームを通さず直接共有された情報には、本ポリシーは適用されません。'
        ],
        s5Title: '5. ポリシーの変更',
        s5Desc: '本方針は法令や社内ポリシーにより変更される場合があり、変更時はサービス画面を通じて告知します。'
    },
    zh: {
        kicker: 'Nexyfab · 安全政策 (NDA)',
        title: '安全政策 (NDA)',
        desc1: 'Nexyfab 为保护客户与合作伙伴的项目信息，',
        desc2: '采取最少公开、限制访问、保密的原则。',
        intro: '本政策适用于所有使用本服务的客户和合作伙伴。',
        s1Title: '1. 机密信息定义',
        s1Desc1: '公司将以下信息定义为“机密信息”：',
        s1List1: [
            '产品设计，2D/3D 图纸，结构数据',
            '电路/电气/PCB 设计数据',
            '开发目的，需求，技术规格',
            '原型图片及开发过程数据',
            '企业名称、联系人等企业信息',
            '制造流程，自动化生产线布局',
            '价格，报价，提案内容',
            '合作期间产生的文件及沟通记录',
            '通过咨询、通话、聊天、上传文件共享的信息'
        ],
        s1Desc2: '但以下信息不属于机密信息：',
        s1List2: [
            '已公开的信息',
            '接收前已合法持有的信息',
            '依法必须公开的信息'
        ],
        s2Title: '2. NDA 适用范围及保护原则',
        s2Sub1: '① 基本原则',
        s2List1: [
            '项目信息仅在内部评估范围内访问。',
            '匹配过程中仅分享目的所需的最低限度信息。',
            '在初期匹配阶段，客户及合作伙伴信息可能有限地公开。'
        ],
        s2Sub2: '② 客户信息保护',
        s2List2: [
            '客户项目信息仅限必要的内部运营人员访问。',
            '匹配时提供给合作伙伴的信息仅限于评估所需的范围。',
            '除非另有约定，公司名称等详细资料可能在初期阶段匿名。'
        ],
        s2Sub3: '③ 合作伙伴信息保护',
        s2List3: [
            '合作伙伴的技术、设备及内部数据仅用于匹配目的。',
            '仅在匹配成功时，才向相关项目客户提供必要的信息。'
        ],
        s3Title: '3. 支持签署 NDA',
        s3Desc: '公司可在项目推进阶段支持客户与合作伙伴签署 NDA。但 NDA 的具体效力和法律责任由签约双方承担。',
        s4Title: '4. 信息保护范围及责任限制',
        s4List: [
            '公司采取合理的安全措施保护机密信息。',
            '对于超出控制范围的第三方行为、用户自身过失或当事人直接交换的信息，公司不承担责任。',
            '对于未通过平台直接共享的信息，本政策不适用。',
        ],
        s5Title: '5. 政策变更',
        s5Desc: '本政策可能根据法律法规或公司政策变更，变更时将通过服务页面公布。'
    }
};

export default function SecurityPolicyPage() {
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

                <p style={{ fontWeight: 700, textAlign: 'center' }}>{t.intro}</p>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s1Title}</h2>
                    <p style={{ marginBottom: '12px' }}>{t.s1Desc1}</p>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', marginBottom: '20px' }}>
                        {t.s1List1.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                    <p style={{ marginBottom: '12px' }}>{t.s1Desc2}</p>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                        {t.s1List2.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s2Title}</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div>
                            <p style={{ fontWeight: 700, color: '#111', marginBottom: '6px' }}>{t.s2Sub1}</p>
                            <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                                {t.s2List1.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                        </div>
                        <div>
                            <p style={{ fontWeight: 700, color: '#111', marginBottom: '6px' }}>{t.s2Sub2}</p>
                            <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                                {t.s2List2.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                        </div>
                        <div>
                            <p style={{ fontWeight: 700, color: '#111', marginBottom: '6px' }}>{t.s2Sub3}</p>
                            <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                                {t.s2List3.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                        </div>
                    </div>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s3Title}</h2>
                    <p>{t.s3Desc}</p>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s4Title}</h2>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                        {t.s4List.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s5Title}</h2>
                    <p>{t.s5Desc}</p>
                </div>

            </section>
        </main>
    );
}

