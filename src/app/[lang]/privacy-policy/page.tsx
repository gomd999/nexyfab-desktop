'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';

const dict = {
    ko: {
        kicker: 'Nexyfab · 개인정보 처리방침',
        title: '개인정보 처리방침',
        desc1: 'Nexyfab는 이용자의 개인정보를 소중히 보호하며,',
        desc2: '관련 법령을 준수하여 안전하게 관리합니다.',
        effective: '시행일: 2026년 5월 7일',
        toc: '목차',
        tocItems: [
            '수집하는 개인정보 항목',
            '개인정보 수집 및 이용 목적',
            '개인정보 보유 및 이용기간',
            '개인정보의 제3자 제공',
            '개인정보 처리 위탁',
            '정보주체의 권리·의무',
            '개인정보의 파기 절차 및 방법',
            '개인정보 보호책임자',
            '정책 변경',
        ],
        s1Title: '1. 수집하는 개인정보 항목',
        s1Desc: '회사는 서비스 제공을 위해 다음 정보를 수집할 수 있습니다.',
        s1Sub1: '① Customer (프로젝트 의뢰인)',
        s1List1: ['이름', '연락처 (전화번호, 이메일)', '회사명', '프로젝트 요구사항, 도면, 파일', '상담 및 커뮤니케이션 기록'],
        s1Sub2: '② Partner (개발자/제조사)',
        s1List2: ['이름', '연락처', '회사명 및 사업자 정보', '보유 기술, 설비 정보, 포트폴리오', '프로젝트 수행 이력 및 관련 자료'],
        s1Sub3: '③ SaaS 구독 이용자',
        s1List3: ['이메일 주소', '이름 (선택)', '결제 정보 (카드 번호는 Stripe/Toss에 의해 직접 처리, 당사 미보유)', '구독 플랜 및 청구 이력', '서비스 이용 기록'],
        s1Sub4: '④ 자동 수집 항목',
        s1List4: ['접속 로그', 'IP 주소', '쿠키', '서비스 이용 기록', '브라우저 및 기기 정보'],
        s2Title: '2. 개인정보 수집 및 이용 목적',
        s2List: [
            '서비스 제공 및 프로젝트 접수, 요구사항 분석',
            '파트너 매칭 및 추천',
            '회원가입, 본인확인 및 계정 관리',
            '결제 처리 및 청구서 발행',
            '고객 문의 응답 및 고객 지원',
            'NDA 체결 및 협업 절차 지원',
            '서비스 개선, 통계 분석 및 내부 관리',
            '법령상 의무 이행',
        ],
        s3Title: '3. 개인정보 보유 및 이용기간',
        s3Desc: '회사는 원칙적으로 개인정보 수집 및 이용 목적이 달성된 후 지체 없이 파기합니다. 다만, 회원탈퇴 후에도 관련 법령에 따라 아래 기간 동안 보존합니다.',
        s3List: [
            '회원 탈퇴 후 계약·청구 관련 기록: 5년 (전자상거래법)',
            '소비자 불만 및 분쟁 처리 기록: 3년 (전자상거래법)',
            '접속 로그 기록: 1년 (통신비밀보호법)',
            '결제 및 재화 공급 기록: 5년 (전자상거래법)',
        ],
        s4Title: '4. 개인정보의 제3자 제공',
        s4Desc: '회사는 원칙적으로 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만, 다음의 경우에 한하여 최소한의 정보를 제공합니다.',
        s4List: [
            '고객 → 매칭된 파트너 (프로젝트 진행 목적, 이용자 사전 동의)',
            '파트너 → 해당 프로젝트 고객 (협업 목적, 이용자 사전 동의)',
            '결제 처리: Stripe Inc. / Toss Payments / Airwallex (결제 처리 목적으로만, 카드 정보는 당사 미보유)',
            '이용자의 별도 동의가 있는 경우',
            '법령에 근거가 있는 경우 (수사기관 요청 등)',
        ],
        s4Note: '회사는 이용 목적 범위를 초과하여 개인정보를 제공하지 않습니다.',
        s5Title: '5. 개인정보 처리 위탁',
        s5Desc: '회사는 원활한 서비스 제공을 위하여 다음 업체에 개인정보 처리를 위탁합니다. 위탁계약 시 개인정보가 안전하게 관리되도록 감독합니다.',
        s5Table: [
            { company: 'Stripe, Inc.', purpose: '결제 처리 및 청구 (글로벌)', location: '미국' },
            { company: 'Toss Payments', purpose: '한국 내 결제 처리', location: '대한민국' },
            { company: 'Airwallex (HK) Ltd.', purpose: '국가 기반 다중 통화 결제 처리 및 구독 관리', location: '홍콩 / 호주' },
            { company: 'Cloudflare, Inc.', purpose: '파일 스토리지(R2), CDN, DNS', location: '미국' },
            { company: 'Railway Corp.', purpose: '서비스 인프라 호스팅', location: '미국' },
        ],
        s5TableHeaders: ['수탁업체', '위탁 업무', '소재 국가'],
        s6Title: '6. 정보주체의 권리·의무',
        s6Desc: '이용자는 언제든지 다음 권리를 행사할 수 있습니다.',
        s6List: [
            '개인정보 열람 요청',
            '개인정보 정정·삭제 요청',
            '개인정보 처리 정지 요청',
            '동의 철회 (단, 필수 항목의 경우 서비스 이용이 제한될 수 있음)',
        ],
        s6Foot: '권리 행사는 privacy@nexyfab.com으로 이메일을 통해 요청하실 수 있으며, 회사는 요청일로부터 10영업일 이내에 조치합니다.',
        s7Title: '7. 개인정보의 파기 절차 및 방법',
        s7Desc: '개인정보는 보유 기간 경과 또는 처리 목적 달성 시 전자적 파일은 복구 불가능한 방법으로 영구 삭제하며, 종이 문서는 분쇄 또는 소각합니다.',
        s8Title: '8. 개인정보 보호책임자',
        s8Items: [
            { label: '성명', value: 'NexyFab 개인정보 보호팀' },
            { label: '이메일', value: 'privacy@nexyfab.com' },
            { label: '처리 기한', value: '요청일로부터 10영업일 이내' },
        ],
        s9Title: '9. 정책 변경',
        s9Desc: '본 개인정보 처리방침은 관련 법령 및 회사 정책에 따라 변경될 수 있으며, 변경 시 서비스 화면을 통해 공지합니다. 중요한 변경의 경우 이메일로 사전 통지합니다.',
    },
    en: {
        kicker: 'Nexyfab · Privacy Policy',
        title: 'Privacy Policy',
        desc1: 'Nexyfab protects user\'s personal information and',
        desc2: 'manages it safely in compliance with relevant laws.',
        effective: 'Effective Date: May 7, 2026',
        toc: 'Contents',
        tocItems: [
            'Personal Information Collected',
            'Purpose of Collection and Use',
            'Retention and Use Period',
            'Provision to Third Parties',
            'Entrustment of Processing',
            'User Rights',
            'Destruction Procedure',
            'Data Protection Officer',
            'Policy Changes',
        ],
        s1Title: '1. Personal Information Collected',
        s1Desc: 'The Company may collect the following information to provide services.',
        s1Sub1: '① Customer (Project Client)',
        s1List1: ['Name', 'Contact (Phone, Email)', 'Company Name', 'Project requirements, drawings, files', 'Consultation and communication records'],
        s1Sub2: '② Partner (Developer/Manufacturer)',
        s1List2: ['Name', 'Contact', 'Company name and business information', 'Technology, equipment info, portfolio', 'Project history and related materials'],
        s1Sub3: '③ SaaS Subscribers',
        s1List3: ['Email address', 'Name (optional)', 'Payment information (card numbers processed directly by Stripe/Toss, not stored by us)', 'Subscription plan and billing history', 'Service usage records'],
        s1Sub4: '④ Automatically Collected',
        s1List4: ['Access logs', 'IP address', 'Cookies', 'Service usage records', 'Browser and device info'],
        s2Title: '2. Purpose of Collection and Use',
        s2List: [
            'Service provision and project intake',
            'Partner matching and recommendation',
            'Account registration, identity verification',
            'Payment processing and invoice issuance',
            'Customer inquiry and support',
            'NDA procedures and collaboration support',
            'Service improvement and internal management',
            'Legal compliance',
        ],
        s3Title: '3. Retention and Use Period',
        s3Desc: 'Personal information is destroyed without delay once the purpose is achieved. The following are retained after account deletion per applicable law:',
        s3List: [
            'Contract and billing records: 5 years (E-Commerce Act)',
            'Consumer complaints and disputes: 3 years (E-Commerce Act)',
            'Access log records: 1 year (Communications Secrecy Act)',
            'Payment and supply records: 5 years (E-Commerce Act)',
        ],
        s4Title: '4. Provision to Third Parties',
        s4Desc: 'The Company does not provide personal information to third parties in principle. Exceptions:',
        s4List: [
            'Customer → Matched Partner (for project, with user consent)',
            'Partner → Relevant Customer (for collaboration, with user consent)',
            'Payment processing: Stripe Inc. / Toss Payments / Airwallex (payment purpose only; card data not retained by us)',
            'When the user separately consents',
            'When required by law (e.g. law enforcement)',
        ],
        s4Note: 'The Company does not provide personal information beyond the scope of the intended use.',
        s5Title: '5. Entrustment of Personal Information Processing',
        s5Desc: 'The Company entrusts personal information processing to the following vendors. We supervise to ensure data security per applicable law.',
        s5Table: [
            { company: 'Stripe, Inc.', purpose: 'Payment processing & billing (global)', location: 'United States' },
            { company: 'Toss Payments', purpose: 'Korea payment processing', location: 'South Korea' },
            { company: 'Airwallex (HK) Ltd.', purpose: 'Multi-currency payment processing & subscription management', location: 'Hong Kong / Australia' },
            { company: 'Cloudflare, Inc.', purpose: 'File storage (R2), CDN, DNS', location: 'United States' },
            { company: 'Railway Corp.', purpose: 'Service infrastructure hosting', location: 'United States' },
        ],
        s5TableHeaders: ['Vendor', 'Entrusted Task', 'Location'],
        s6Title: '6. User Rights',
        s6Desc: 'Users may exercise the following rights at any time:',
        s6List: [
            'Request to access personal information',
            'Request to correct or delete personal information',
            'Request to suspend processing',
            'Withdraw consent (mandatory info may limit service access)',
        ],
        s6Foot: 'To exercise rights, email privacy@nexyfab.com. The Company will act within 10 business days.',
        s7Title: '7. Destruction Procedure and Method',
        s7Desc: 'When retention periods expire or purposes are met, electronic files are deleted irrecoverably, and paper documents are shredded or incinerated.',
        s8Title: '8. Data Protection Officer',
        s8Items: [
            { label: 'Team', value: 'NexyFab Privacy Team' },
            { label: 'Email', value: 'privacy@nexyfab.com' },
            { label: 'Response time', value: 'Within 10 business days' },
        ],
        s9Title: '9. Policy Changes',
        s9Desc: 'This policy may change according to law or company policy, and notice will be provided on the service screen. For significant changes, prior email notice will be sent.',
    },
    ja: {
        kicker: 'Nexyfab · プライバシーポリシー',
        title: 'プライバシーポリシー',
        desc1: 'Nexyfabは利用者の個人情報を大切に保護し、',
        desc2: '関連法令を遵守して安全に管理します。',
        effective: '施行日：2026年1月1日',
        toc: '目次',
        tocItems: [
            '収集する個人情報の項目',
            '個人情報の収集・利用目的',
            '個人情報の保有・利用期間',
            '第三者への個人情報提供',
            '個人情報処理の委託',
            '情報主体の権利・義務',
            '個人情報の廃棄手続き・方法',
            '個人情報保護責任者',
            'ポリシーの変更',
        ],
        s1Title: '1. 収集する個人情報の項目',
        s1Desc: '会社はサービス提供のために以下の情報を収集する場合があります。',
        s1Sub1: '① Customer（プロジェクト依頼人）',
        s1List1: ['氏名', '連絡先（電話番号、メール）', '会社名', 'プロジェクト要件、図面、ファイル', '相談およびコミュニケーション記録'],
        s1Sub2: '② Partner（開発者/製造社）',
        s1List2: ['氏名', '連絡先', '会社名および事業者情報', '保有技術、設備情報、ポートフォリオ', 'プロジェクト遂行履歴および関連資料'],
        s1Sub3: '③ SaaSサブスクリプション利用者',
        s1List3: ['メールアドレス', '氏名（任意）', '決済情報（カード番号はStripe/Tossが直接処理、当社非保有）', 'サブスクリプションプランおよび請求履歴', 'サービス利用記録'],
        s1Sub4: '④ 自動収集項目',
        s1List4: ['接続ログ', 'IPアドレス', 'クッキー', 'サービス利用記録', 'ブラウザおよびデバイス情報'],
        s2Title: '2. 個人情報の収集・利用目的',
        s2List: [
            'サービス提供およびプロジェクト受付・要件分析',
            'パートナーマッチングおよび推薦',
            '会員登録、本人確認、アカウント管理',
            '決済処理および請求書発行',
            '顧客問い合わせ対応およびサポート',
            'NDA締結および連携手続きサポート',
            'サービス改善、統計分析および内部管理',
            '法令上の義務履行',
        ],
        s3Title: '3. 個人情報の保有・利用期間',
        s3Desc: '原則として個人情報の利用目的達成後は遅滞なく破棄します。ただし、退会後も関連法令に基づき以下の期間保存されます。',
        s3List: [
            '契約・請求関連記録：5年（電子商取引法）',
            '消費者苦情・紛争処理記録：3年（電子商取引法）',
            '接続ログ記録：1年（通信秘密保護法）',
            '決済・物品供給記録：5年（電子商取引法）',
        ],
        s4Title: '4. 第三者への個人情報提供',
        s4Desc: '会社は原則として個人情報を第三者に提供しません。例外は以下の通りです。',
        s4List: [
            '顧客 → マッチングされたパートナー（プロジェクト進行目的、利用者の事前同意）',
            'パートナー → 該当プロジェクト顧客（連携目的、利用者の事前同意）',
            '決済処理：Stripe Inc.（決済処理目的のみ、カード情報は当社非保有）',
            '利用者が別途同意した場合',
            '法令に根拠がある場合（捜査機関の要請など）',
        ],
        s4Note: '会社は利用目的の範囲を超えて個人情報を提供しません。',
        s5Title: '5. 個人情報処理の委託',
        s5Desc: '会社は円滑なサービス提供のため、以下の業者に個人情報処理を委託します。安全な管理のため、法令に従い監督します。',
        s5Table: [
            { company: 'Stripe, Inc.', purpose: '決済処理・請求', location: 'アメリカ合衆国' },
            { company: 'Toss Payments', purpose: '韓国内決済処理', location: '大韓民国' },
            { company: 'Cloudflare, Inc.', purpose: 'ファイルストレージ(R2)、CDN、DNS', location: 'アメリカ合衆国' },
            { company: 'Railway Corp.', purpose: 'サービスインフラホスティング', location: 'アメリカ合衆国' },
        ],
        s5TableHeaders: ['受託事業者', '委託業務', '所在国'],
        s6Title: '6. 情報主体の権利・義務',
        s6Desc: '利用者はいつでも以下の権利を行使できます。',
        s6List: [
            '個人情報の閲覧請求',
            '個人情報の訂正・削除請求',
            '個人情報処理の停止請求',
            '同意の撤回（必須項目の場合はサービス利用が制限される場合があります）',
        ],
        s6Foot: '権利行使はprivacy@nexyfab.comへメールでご請求ください。会社は請求日から10営業日以内に対応します。',
        s7Title: '7. 個人情報の廃棄手続き・方法',
        s7Desc: '保有期間経過後は、電子ファイルは復旧不可能な方法で永久削除し、紙文書は裁断または焼却します。',
        s8Title: '8. 個人情報保護責任者',
        s8Items: [
            { label: '担当部署', value: 'NexyFab プライバシーチーム' },
            { label: 'メール', value: 'privacy@nexyfab.com' },
            { label: '対応期限', value: '請求日から10営業日以内' },
        ],
        s9Title: '9. ポリシーの変更',
        s9Desc: '本方針は法令や内部ポリシーにより変更される場合があり、変更時はサービス画面を通じて告知します。重要な変更の場合は事前にメールで通知します。',
    },
    zh: {
        kicker: 'Nexyfab · 隐私政策',
        title: '隐私政策',
        desc1: 'Nexyfab 保护用户的个人信息，',
        desc2: '并遵守相关法规以进行安全管理。',
        effective: '生效日期：2026年1月1日',
        toc: '目录',
        tocItems: [
            '收集的个人信息项目',
            '个人信息收集及使用目的',
            '个人信息保留及使用期限',
            '向第三方提供个人信息',
            '个人信息处理委托',
            '信息主体的权利义务',
            '个人信息销毁程序及方法',
            '个人信息保护负责人',
            '政策变更',
        ],
        s1Title: '1. 收集的个人信息项目',
        s1Desc: '本公司可能为了提供服务而收集以下信息。',
        s1Sub1: '① Customer（项目委托人）',
        s1List1: ['姓名', '联系方式（电话、邮箱）', '公司名称', '项目需求、图纸、文件', '咨询及沟通记录'],
        s1Sub2: '② Partner（开发者/制造商）',
        s1List2: ['姓名', '联系方式', '公司名称及商业信息', '所持技术、设备信息、案例库', '项目执行历史及相关资料'],
        s1Sub3: '③ SaaS订阅用户',
        s1List3: ['电子邮件地址', '姓名（选填）', '支付信息（卡号由Stripe/Toss直接处理，本公司不保留）', '订阅计划及账单历史', '服务使用记录'],
        s1Sub4: '④ 自动收集项',
        s1List4: ['访问日志', 'IP 地址', 'Cookie', '服务使用记录', '浏览器及设备信息'],
        s2Title: '2. 个人信息收集及使用目的',
        s2List: [
            '服务提供及项目接收、需求分析',
            '合作伙伴匹配与推荐',
            '会员注册、身份验证及账户管理',
            '支付处理及发票开具',
            '客户咨询回复及支持',
            'NDA 签署及协作流程支持',
            '服务优化、统计分析及内部管理',
            '法律合规义务',
        ],
        s3Title: '3. 个人信息保留及使用期限',
        s3Desc: '原则上，个人信息在达到目的后会立即销毁。注销账户后，依据相关法规保留以下期限：',
        s3List: [
            '合同及账单相关记录：5年（电子商务法）',
            '消费者投诉及纠纷处理记录：3年（电子商务法）',
            '访问日志记录：1年（通信秘密保护法）',
            '支付及商品供应记录：5年（电子商务法）',
        ],
        s4Title: '4. 向第三方提供个人信息',
        s4Desc: '本公司原则上不向第三方提供个人信息。例外情况如下：',
        s4List: [
            '客户 → 匹配的合作伙伴（用于项目推进，经用户事先同意）',
            '合作伙伴 → 相关项目客户（用于协作，经用户事先同意）',
            '支付处理：Stripe Inc.（仅用于支付处理，本公司不保留卡号）',
            '用户另行同意时',
            '依据法律法规时（如执法机关要求）',
        ],
        s4Note: '本公司不会提供超出使用目的范围的个人信息。',
        s5Title: '5. 个人信息处理委托',
        s5Desc: '为顺利提供服务，本公司将个人信息处理委托给以下厂商，并依法签署委托合同，确保信息安全。',
        s5Table: [
            { company: 'Stripe, Inc.', purpose: '支付处理及账单', location: '美国' },
            { company: 'Toss Payments', purpose: '韩国境内支付处理', location: '韩国' },
            { company: 'Cloudflare, Inc.', purpose: '文件存储(R2)、CDN、DNS', location: '美国' },
            { company: 'Railway Corp.', purpose: '服务基础设施托管', location: '美国' },
        ],
        s5TableHeaders: ['受托公司', '委托业务', '所在国家'],
        s6Title: '6. 信息主体的权利义务',
        s6Desc: '用户可随时行使以下权利：',
        s6List: [
            '申请查阅个人信息',
            '申请更正或删除个人信息',
            '申请停止处理个人信息',
            '撤回同意（必填信息可能导致服务受限）',
        ],
        s6Foot: '如需行使权利，请发送邮件至 privacy@nexyfab.com，本公司将在申请日起10个工作日内处理。',
        s7Title: '7. 个人信息销毁程序及方法',
        s7Desc: '保留期满后，电子文件以不可恢复的方式永久删除，纸质文件通过粉碎或焚烧销毁。',
        s8Title: '8. 个人信息保护负责人',
        s8Items: [
            { label: '负责部门', value: 'NexyFab 隐私团队' },
            { label: '邮箱', value: 'privacy@nexyfab.com' },
            { label: '处理时限', value: '申请日起10个工作日内' },
        ],
        s9Title: '9. 政策变更',
        s9Desc: '本政策可能根据法规或公司政策变更，变更时将通过服务页面公布。重要变更将提前通过邮件通知。',
    },
    /**
     * ⚠ 260802: es·ar 이 langMap 에서 'en' 으로 고정돼 있었다 — 라이브 실측에서
     *   스페인어 페이지의 영어 단어 일치 80% · 아랍어 90%(아랍 문자 비율 12%)였다.
     *   **개인정보처리방침은 법적 문서**라 그 언어 사용자에게 영어로 나가면 성격이 다르다.
     */
    es: {
        kicker: 'Nexyfab · Política de privacidad',
        title: 'Política de privacidad',
        desc1: 'Nexyfab protege los datos personales de los usuarios y',
        desc2: 'los gestiona de forma segura conforme a la legislación aplicable.',
        effective: 'Fecha de entrada en vigor: 7 de mayo de 2026',
        toc: 'Contenido',
        tocItems: [
            'Datos personales recopilados',
            'Finalidad de la recopilación y el uso',
            'Plazo de conservación y uso',
            'Cesión a terceros',
            'Encargo del tratamiento',
            'Derechos del usuario',
            'Procedimiento de destrucción',
            'Responsable de protección de datos',
            'Modificaciones de la política',
        ],
        s1Title: '1. Datos personales recopilados',
        s1Desc: 'La Empresa puede recopilar la siguiente información para prestar sus servicios.',
        s1Sub1: '① Cliente (promotor del proyecto)',
        s1List1: ['Nombre', 'Contacto (teléfono, correo electrónico)', 'Nombre de la empresa', 'Requisitos del proyecto, planos y archivos', 'Registros de consultas y comunicaciones'],
        s1Sub2: '② Socio (desarrollador/fabricante)',
        s1List2: ['Nombre', 'Contacto', 'Nombre de la empresa e información comercial', 'Tecnología, información de equipamiento y portafolio', 'Historial de proyectos y materiales relacionados'],
        s1Sub3: '③ Suscriptores de SaaS',
        s1List3: ['Dirección de correo electrónico', 'Nombre (opcional)', 'Datos de pago (los números de tarjeta los procesan directamente Stripe/Toss; nosotros no los almacenamos)', 'Plan de suscripción e historial de facturación', 'Registros de uso del servicio'],
        s1Sub4: '④ Recopilados automáticamente',
        s1List4: ['Registros de acceso', 'Dirección IP', 'Cookies', 'Registros de uso del servicio', 'Información de navegador y dispositivo'],
        s2Title: '2. Finalidad de la recopilación y el uso',
        s2List: [
            'Prestación del servicio y recepción de proyectos',
            'Emparejamiento y recomendación de socios',
            'Registro de cuenta y verificación de identidad',
            'Procesamiento de pagos y emisión de facturas',
            'Consultas y soporte al cliente',
            'Trámites de NDA y apoyo a la colaboración',
            'Mejora del servicio y gestión interna',
            'Cumplimiento normativo',
        ],
        s3Title: '3. Plazo de conservación y uso',
        s3Desc: 'Los datos personales se destruyen sin demora una vez cumplida la finalidad. Tras la eliminación de la cuenta se conservan los siguientes conforme a la ley aplicable:',
        s3List: [
            'Registros de contratos y facturación: 5 años (Ley de comercio electrónico)',
            'Reclamaciones y controversias de consumidores: 3 años (Ley de comercio electrónico)',
            'Registros de acceso: 1 año (Ley de protección del secreto de las comunicaciones)',
            'Registros de pago y suministro: 5 años (Ley de comercio electrónico)',
        ],
        s4Title: '4. Cesión a terceros',
        s4Desc: 'En principio, la Empresa no cede datos personales a terceros. Excepciones:',
        s4List: [
            'Cliente → socio emparejado (para el proyecto, con el consentimiento del usuario)',
            'Socio → cliente correspondiente (para la colaboración, con el consentimiento del usuario)',
            'Procesamiento de pagos: Stripe Inc. / Toss Payments / Airwallex (solo con fines de pago; no conservamos datos de tarjeta)',
            'Cuando el usuario lo consiente por separado',
            'Cuando lo exige la ley (por ejemplo, requerimiento de las autoridades)',
        ],
        s4Note: 'La Empresa no cede datos personales más allá del alcance de la finalidad prevista.',
        s5Title: '5. Encargo del tratamiento de datos personales',
        s5Desc: 'La Empresa encarga el tratamiento de datos personales a los siguientes proveedores. Supervisamos que se garantice la seguridad de los datos conforme a la ley aplicable.',
        s5Table: [
            { company: 'Stripe, Inc.', purpose: 'Procesamiento de pagos y facturación (global)', location: 'Estados Unidos' },
            { company: 'Toss Payments', purpose: 'Procesamiento de pagos en Corea', location: 'Corea del Sur' },
            { company: 'Airwallex (HK) Ltd.', purpose: 'Pagos multidivisa y gestión de suscripciones', location: 'Hong Kong / Australia' },
            { company: 'Cloudflare, Inc.', purpose: 'Almacenamiento de archivos (R2), CDN, DNS', location: 'Estados Unidos' },
            { company: 'Railway Corp.', purpose: 'Alojamiento de la infraestructura del servicio', location: 'Estados Unidos' },
        ],
        s5TableHeaders: ['Proveedor', 'Tarea encargada', 'Ubicación'],
        s6Title: '6. Derechos del usuario',
        s6Desc: 'Los usuarios pueden ejercer en cualquier momento los siguientes derechos:',
        s6List: [
            'Solicitar el acceso a sus datos personales',
            'Solicitar la rectificación o supresión de sus datos personales',
            'Solicitar la limitación del tratamiento',
            'Retirar el consentimiento (la falta de datos obligatorios puede limitar el acceso al servicio)',
        ],
        s6Foot: 'Para ejercer estos derechos, escriba a privacy@nexyfab.com. La Empresa actuará en un plazo de 10 días hábiles.',
        s7Title: '7. Procedimiento y método de destrucción',
        s7Desc: 'Cuando vencen los plazos de conservación o se cumplen las finalidades, los archivos electrónicos se eliminan de forma irrecuperable y los documentos en papel se trituran o incineran.',
        s8Title: '8. Responsable de protección de datos',
        s8Items: [
            { label: 'Equipo', value: 'Equipo de Privacidad de NexyFab' },
            { label: 'Correo electrónico', value: 'privacy@nexyfab.com' },
            { label: 'Plazo de respuesta', value: 'En un plazo de 10 días hábiles' },
        ],
        s9Title: '9. Modificaciones de la política',
        s9Desc: 'Esta política puede cambiar conforme a la ley o a las políticas de la empresa, y se avisará en la pantalla del servicio. En caso de cambios significativos, se notificará previamente por correo electrónico.',
    },
    ar: {
        kicker: 'Nexyfab · سياسة الخصوصية',
        title: 'سياسة الخصوصية',
        desc1: 'تحمي Nexyfab البيانات الشخصية للمستخدمين',
        desc2: 'وتديرها بأمان وفقاً للقوانين المعمول بها.',
        effective: 'تاريخ السريان: ٧ مايو ٢٠٢٦',
        toc: 'المحتويات',
        tocItems: [
            'البيانات الشخصية التي يجري جمعها',
            'أغراض الجمع والاستخدام',
            'مدة الاحتفاظ والاستخدام',
            'الإفصاح للغير',
            'إسناد المعالجة',
            'حقوق المستخدم',
            'إجراءات الإتلاف',
            'مسؤول حماية البيانات',
            'تعديلات السياسة',
        ],
        s1Title: '١. البيانات الشخصية التي يجري جمعها',
        s1Desc: 'يجوز للشركة جمع المعلومات التالية لتقديم خدماتها.',
        s1Sub1: '① العميل (صاحب المشروع)',
        s1List1: ['الاسم', 'وسيلة الاتصال (الهاتف والبريد الإلكتروني)', 'اسم الشركة', 'متطلبات المشروع والرسومات والملفات', 'سجلات الاستشارات والمراسلات'],
        s1Sub2: '② الشريك (المطوّر/المصنّع)',
        s1List2: ['الاسم', 'وسيلة الاتصال', 'اسم الشركة والمعلومات التجارية', 'التقنيات ومعلومات المعدات وملف الأعمال', 'سجل المشاريع والمواد ذات الصلة'],
        s1Sub3: '③ مشتركو SaaS',
        s1List3: ['البريد الإلكتروني', 'الاسم (اختياري)', 'بيانات الدفع (تعالج Stripe/Toss أرقام البطاقات مباشرةً ولا نحتفظ بها)', 'خطة الاشتراك وسجل الفوترة', 'سجلات استخدام الخدمة'],
        s1Sub4: '④ ما يُجمع تلقائياً',
        s1List4: ['سجلات الدخول', 'عنوان IP', 'ملفات تعريف الارتباط', 'سجلات استخدام الخدمة', 'معلومات المتصفح والجهاز'],
        s2Title: '٢. أغراض الجمع والاستخدام',
        s2List: [
            'تقديم الخدمة واستقبال المشاريع',
            'مطابقة الشركاء والتوصية بهم',
            'تسجيل الحساب والتحقق من الهوية',
            'معالجة المدفوعات وإصدار الفواتير',
            'استفسارات العملاء والدعم',
            'إجراءات اتفاقية عدم الإفصاح ودعم التعاون',
            'تحسين الخدمة والإدارة الداخلية',
            'الامتثال للقوانين',
        ],
        s3Title: '٣. مدة الاحتفاظ والاستخدام',
        s3Desc: 'تُتلَف البيانات الشخصية دون تأخير بمجرد تحقق الغرض. ويُحتفظ بما يلي بعد حذف الحساب وفقاً للقوانين المعمول بها:',
        s3List: [
            'سجلات العقود والفوترة: ٥ سنوات (قانون التجارة الإلكترونية)',
            'شكاوى المستهلكين والنزاعات: ٣ سنوات (قانون التجارة الإلكترونية)',
            'سجلات الدخول: سنة واحدة (قانون حماية سرية الاتصالات)',
            'سجلات الدفع والتوريد: ٥ سنوات (قانون التجارة الإلكترونية)',
        ],
        s4Title: '٤. الإفصاح للغير',
        s4Desc: 'لا تفصح الشركة من حيث المبدأ عن البيانات الشخصية للغير. والاستثناءات هي:',
        s4List: [
            'من العميل إلى الشريك المطابَق (لأغراض المشروع، بموافقة المستخدم)',
            'من الشريك إلى العميل المعني (لأغراض التعاون، بموافقة المستخدم)',
            'معالجة المدفوعات: Stripe Inc. / Toss Payments / Airwallex (لغرض الدفع فقط؛ ولا نحتفظ ببيانات البطاقات)',
            'عند موافقة المستخدم بشكل منفصل',
            'عندما يوجب القانون ذلك (مثل طلبات جهات إنفاذ القانون)',
        ],
        s4Note: 'لا تفصح الشركة عن البيانات الشخصية خارج نطاق الغرض المقصود.',
        s5Title: '٥. إسناد معالجة البيانات الشخصية',
        s5Desc: 'تُسنِد الشركة معالجة البيانات الشخصية إلى المزوّدين التاليين، وتشرف على ضمان أمن البيانات وفقاً للقوانين المعمول بها.',
        s5Table: [
            { company: 'Stripe, Inc.', purpose: 'معالجة المدفوعات والفوترة (عالمياً)', location: 'الولايات المتحدة' },
            { company: 'Toss Payments', purpose: 'معالجة المدفوعات في كوريا', location: 'كوريا الجنوبية' },
            { company: 'Airwallex (HK) Ltd.', purpose: 'مدفوعات متعددة العملات وإدارة الاشتراكات', location: 'هونغ كونغ / أستراليا' },
            { company: 'Cloudflare, Inc.', purpose: 'تخزين الملفات (R2) وشبكة التوزيع وDNS', location: 'الولايات المتحدة' },
            { company: 'Railway Corp.', purpose: 'استضافة البنية التحتية للخدمة', location: 'الولايات المتحدة' },
        ],
        s5TableHeaders: ['المزوّد', 'المهمة المُسندة', 'الموقع'],
        s6Title: '٦. حقوق المستخدم',
        s6Desc: 'يجوز للمستخدمين ممارسة الحقوق التالية في أي وقت:',
        s6List: [
            'طلب الاطلاع على بياناتهم الشخصية',
            'طلب تصحيح بياناتهم الشخصية أو حذفها',
            'طلب وقف المعالجة',
            'سحب الموافقة (قد يؤدي نقص البيانات الإلزامية إلى تقييد الوصول إلى الخدمة)',
        ],
        s6Foot: 'لممارسة هذه الحقوق، راسلنا على privacy@nexyfab.com. وستتصرف الشركة خلال ١٠ أيام عمل.',
        s7Title: '٧. إجراءات الإتلاف وطريقته',
        s7Desc: 'عند انقضاء مدد الاحتفاظ أو تحقق الأغراض، تُحذف الملفات الإلكترونية بصورة لا يمكن استرجاعها، وتُمزَّق المستندات الورقية أو تُحرق.',
        s8Title: '٨. مسؤول حماية البيانات',
        s8Items: [
            { label: 'الفريق', value: 'فريق الخصوصية في NexyFab' },
            { label: 'البريد الإلكتروني', value: 'privacy@nexyfab.com' },
            { label: 'مدة الرد', value: 'خلال ١٠ أيام عمل' },
        ],
        s9Title: '٩. تعديلات السياسة',
        s9Desc: 'قد تتغيّر هذه السياسة وفقاً للقانون أو لسياسة الشركة، وسيُنشر إشعار على شاشة الخدمة. وفي حال التغييرات الجوهرية، سيُرسل إشعار مسبق عبر البريد الإلكتروني.',
    },
};

type LangKey = keyof typeof dict;

const LANGUAGE_LABELS: Record<LangKey, string> = {
    ko: '한국어',
    en: 'English',
    ja: '日本語',
    zh: '中文',
    es: 'Español',
    ar: 'العربية',
};

export default function PrivacyPolicyPage() {
    const pathname = usePathname();
    const langCode = pathname.split('/')[1] || 'en';
    const langMap: Record<string, LangKey> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'zh', es: 'es', ar: 'ar' };
    const activeLang: LangKey = langMap[langCode] ?? 'en';
    const [lang, setLang] = useState<LangKey>(activeLang);
    const t = dict[lang];

    const sections = [
        t.s1Title, t.s2Title, t.s3Title, t.s4Title,
        t.s5Title, t.s6Title, t.s7Title, t.s8Title, t.s9Title,
    ];

    return (
        <main style={{ minHeight: '100vh', backgroundColor: '#fff', paddingBottom: '80px' }}>
            {/* Hero */}
            <section style={{ textAlign: 'center', padding: '100px 20px 60px', backgroundColor: '#f8f9fb', marginBottom: '40px' }}>
                <p style={{ fontSize: '14px', letterSpacing: '0.15em', color: '#0056ff', marginBottom: '16px', fontWeight: 800 }}>{t.kicker}</p>
                <h1 style={{ fontSize: '42px', fontWeight: 900, marginBottom: '20px', color: '#111' }}>{t.title}</h1>
                <p style={{ color: '#555', fontSize: '16px', maxWidth: '700px', margin: '0 auto 20px', lineHeight: 1.6 }}>
                    {t.desc1}<br />{t.desc2}
                </p>
                <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>{t.effective}</p>
                {/* Language toggle */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {(['ko', 'en', 'ja', 'zh', 'es', 'ar'] as LangKey[]).map(l => (
                        <button
                            key={l}
                            onClick={() => setLang(l)}
                            style={{
                                padding: '6px 16px',
                                borderRadius: '20px',
                                border: '1px solid',
                                borderColor: lang === l ? '#0056ff' : '#ddd',
                                backgroundColor: lang === l ? '#0056ff' : '#fff',
                                color: lang === l ? '#fff' : '#555',
                                cursor: 'pointer',
                                fontSize: '13px',
                                fontWeight: lang === l ? 700 : 400,
                            }}
                        >
                            {LANGUAGE_LABELS[l]}
                        </button>
                    ))}
                </div>
            </section>

            <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 20px', display: 'flex', gap: '40px', alignItems: 'flex-start' }}>
                {/* Sidebar TOC — hidden on mobile */}
                <aside style={{
                    width: '220px',
                    flexShrink: 0,
                    position: 'sticky',
                    top: '100px',
                    display: 'none',
                }} className="privacy-toc">
                    <p style={{ fontSize: '13px', fontWeight: 800, color: '#111', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t.toc}</p>
                    <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {sections.map((title, i) => (
                            <a
                                key={i}
                                href={`#section-${i + 1}`}
                                style={{ fontSize: '13px', color: '#555', textDecoration: 'none', lineHeight: 1.4, padding: '2px 0' }}
                                onMouseEnter={e => (e.currentTarget.style.color = '#0056ff')}
                                onMouseLeave={e => (e.currentTarget.style.color = '#555')}
                            >
                                {title}
                            </a>
                        ))}
                    </nav>
                </aside>

                {/* Main content */}
                <section style={{ flex: 1, lineHeight: 1.8, color: '#333', fontSize: '16px', display: 'flex', flexDirection: 'column', gap: '48px' }}>

                    <div id="section-1">
                        <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s1Title}</h2>
                        <p style={{ marginBottom: '12px' }}>{t.s1Desc}</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {([
                                [t.s1Sub1, t.s1List1],
                                [t.s1Sub2, t.s1List2],
                                [t.s1Sub3, t.s1List3],
                                [t.s1Sub4, t.s1List4],
                            ] as [string, string[]][]).map(([sub, list], idx) => (
                                <div key={idx}>
                                    <p style={{ fontWeight: 700, color: '#111', marginBottom: '6px' }}>{sub}</p>
                                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                                        {list.map((item, i) => <li key={i}>{item}</li>)}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div id="section-2">
                        <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s2Title}</h2>
                        <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                            {t.s2List.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                    </div>

                    <div id="section-3">
                        <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s3Title}</h2>
                        <p style={{ marginBottom: '12px' }}>{t.s3Desc}</p>
                        <ul style={{ paddingLeft: '20px', listStyleType: 'disc' }}>
                            {t.s3List.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                    </div>

                    <div id="section-4">
                        <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s4Title}</h2>
                        <p style={{ marginBottom: '12px' }}>{t.s4Desc}</p>
                        <ul style={{ paddingLeft: '20px', listStyleType: 'disc', marginBottom: '12px' }}>
                            {t.s4List.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                        <p style={{ color: '#666', fontSize: '15px' }}>{t.s4Note}</p>
                    </div>

                    <div id="section-5">
                        <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s5Title}</h2>
                        <p style={{ marginBottom: '16px' }}>{t.s5Desc}</p>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8f9fb' }}>
                                        {t.s5TableHeaders.map((h, i) => (
                                            <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, color: '#111', borderBottom: '2px solid #e5e7eb' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {t.s5Table.map((row, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                                            <td style={{ padding: '10px 16px', fontWeight: 600 }}>{row.company}</td>
                                            <td style={{ padding: '10px 16px', color: '#444' }}>{row.purpose}</td>
                                            <td style={{ padding: '10px 16px', color: '#666' }}>{row.location}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div id="section-6">
                        <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s6Title}</h2>
                        <p style={{ marginBottom: '12px' }}>{t.s6Desc}</p>
                        <ul style={{ paddingLeft: '20px', listStyleType: 'disc', marginBottom: '16px' }}>
                            {t.s6List.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                        <p style={{ color: '#555', fontSize: '15px', borderLeft: '3px solid #0056ff', paddingLeft: '16px' }}>{t.s6Foot}</p>
                    </div>

                    <div id="section-7">
                        <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s7Title}</h2>
                        <p>{t.s7Desc}</p>
                    </div>

                    <div id="section-8">
                        <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s8Title}</h2>
                        <div style={{ backgroundColor: '#f8f9fb', borderRadius: '8px', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {t.s8Items.map((item, i) => (
                                <div key={i} style={{ display: 'flex', gap: '16px', fontSize: '15px' }}>
                                    <span style={{ fontWeight: 700, color: '#111', minWidth: '90px' }}>{item.label}</span>
                                    <span style={{ color: '#444' }}>{item.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div id="section-9">
                        <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '16px', color: '#111' }}>{t.s9Title}</h2>
                        <p>{t.s9Desc}</p>
                    </div>

                </section>
            </div>

            {/* Inline style for sidebar visibility on desktop */}
            <style>{`
                @media (min-width: 1024px) {
                    .privacy-toc { display: block !important; }
                }
            `}</style>
        </main>
    );
}
