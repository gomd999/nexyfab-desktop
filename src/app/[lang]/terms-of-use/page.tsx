'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

const dict = {
    ko: {
        kicker: 'Nexyfab · 이용약관',
        title: '이용약관',
        desc1: '본 약관은 Nexyfab와 사용자 간의',
        desc2: '서비스 이용 조건 및 책임 사항을 규정합니다.',
        a1Title: '제1조 (목적)',
        a1Desc: '본 약관은 Nexyfab(이하 "회사")가 제공하는 개발·제조 매칭 플랫폼 서비스(이하 "서비스")의 이용 조건 및 절차, 회사와 사용자 간의 권리·의무 및 책임 사항을 규정함을 목적으로 합니다.',
        a2Title: '제2조 (용어의 정의)',
        a2i1: 'User(사용자): 본 서비스를 이용하는 개인 또는 법인',
        a2i2: 'Customer(고객): 프로젝트를 등록하고 매칭을 요청하는 자',
        a2i3: 'Partner(파트너): 개발·설계·제조 수행을 희망하는 개인 또는 법인',
        a2i4: 'Matching(매칭): 회사가 고객의 요구사항을 분석하여 적합 파트너를 추천하는 행위',
        a2i5: 'Content(콘텐츠): 사용자가 업로드한 문서, 도면, 이미지, 파일, 텍스트 등 일체의 정보',
        a3Title: '제3조 (서비스의 성격)',
        a3i1: '회사는 데이터 기반 분석을 통해 파트너를 추천하는 플랫폼 서비스를 제공합니다.',
        a3i2: '회사는 프로젝트 수행의 당사자가 아니며, 실제 계약·견적·생산·납품은 고객과 파트너 간에 직접 체결·진행됩니다.',
        a3i3: '회사는 매칭 결과에 대해 특정 품질, 납기, 성과를 보증하지 않습니다.',
        a4Title: '제4조 (서비스 단계 및 범위)',
        a4i1: '프로젝트 접수 및 요구사항 분석',
        a4i2: '데이터 기반 파트너 추천',
        a4i3: 'NDA 체결 절차 지원',
        a4i4: '매칭 이후 커뮤니케이션 지원',
        a4Note: '※ 회사는 설계 확정, BOM 확정, 주문 대행, 결제 대행, 생산 관리의 주체가 아닙니다.',
        a5Title: '제5조 (지적재산권)',
        a5i1: '프로젝트 관련 지적재산권은 별도 계약이 없는 한 고객과 파트너 간 계약에 따릅니다.',
        a5i2: '회사는 사용자가 업로드한 콘텐츠의 소유권을 주장하지 않습니다.',
        a6Title: '제6조 (책임의 제한)',
        a6i1: '회사는 매칭 과정에서 합리적인 주의를 다하나, 파트너의 계약 불이행, 생산 지연, 품질 분쟁, 제3자와의 법적 분쟁 등에 대해서는 책임을 지지 않습니다.',
        a6i2: '회사는 Nexyfab 플랫폼을 통해 진행되는 프로젝트에 한하여, 별도 협의된 범위 내에서 품질 검수(Quality Check)를 지원할 수 있습니다.',
        a6i3: '전항의 품질 검수는 사전 정의된 기준에 따른 확인 및 지원 절차를 의미하며, 특정 품질, 성과, 하자 없음에 대한 법적 보증을 의미하지 않습니다.',
        a6i4: '플랫폼을 통하지 않고 고객과 파트너 간 직접 체결·진행된 계약, 발주, 생산, 대금 지급 등에 대해서는 회사는 어떠한 책임도 부담하지 않습니다.',
        a7Title: '제7조 (분쟁 해결)',
        a7i1: '본 약관은 대한민국 법률을 따릅니다.',
        a7i2: '본 서비스와 관련하여 발생한 분쟁에 대해서는 서울중앙지방법원을 전속 관할 법원으로 합니다.',
        a8Title: '제8조 (수수료 및 위약금 정책)',
        a8s1Title: '1. 매칭 솔루션 (Matching Solution)',
        a8s1b1: '매칭 솔루션 기본 수수료: 전체 프로젝트 금액의 4~7% (최소 50만 원, VAT 별도)',
        a8s1b2: 'No-Risk 정책: 적합한 파트너를 찾지 못할 경우 결제 금액 전액 환불',
        a8s1b3: '설계/양산 착수 전 계약 취소 시: 수수료의 50% 청구',
        a8s1Desc: '계약 체결 시 기본 수수료(4~7%, 최소 50만 원, VAT 별도)를 정산하며, Step 1 매칭 신청금은 수수료에서 100% 공제됩니다. 계약 체결 이후 전담 오퍼레이터가 설계 착수부터 납품 완료까지 일정 관리, 품질 확인, 이슈 대응 등을 지원합니다.',
        a8s1TableTitle: '프로젝트 누적 금액별 수수료율 (VAT 별도)',
        a8s1Penalty: '[위약금 및 환불 규정] 계약 후 설계 착수 전: 수수료의 50% 청구 / 설계 착수 후: 최종 수수료 전액 발생 / 양산 계약 후 양산 착수 전: 수수료의 50% 청구 / 양산 착수 후: 환불 불가',
        a8s2Title: '2. 토탈 솔루션 (Total Solution)',
        a8s2b1: '토탈 솔루션 기본 수수료: 전체 프로젝트 금액의 15% (VAT 별도)',
        a8s2Desc: '설계, 파트너 소싱, 양산 및 납품까지의 전 과정을 Nexyfab가 전담하여 관리하는 턴키(Turn-key) 방식의 솔루션입니다.',
        a8s2Penalty: '[위약금 및 환불 규정] 계약 후부터 설계 작업 전: 기존 예산의 2.5% 위약금 / 설계 작업 시작 후: 설계비와 기존 예산 기준 수수료의 5% 위약금 / 양산 전(사전 작업 착수 전): 설계비와 기존 예산 기준 수수료의 7.5% 위약금 / 양산 시작 후: 환불 불가',
        a9Title: '제9조 (SaaS 구독 서비스)',
        a9Desc: 'NexyFab 플랫폼은 월정액 및 연간 구독 형태의 SaaS(Software as a Service) 서비스를 제공합니다. 구독 플랜(Free, Pro, Enterprise)에 따라 제공 기능 및 사용 한도가 다릅니다.',
        a9i1: '구독 요금은 구독 시작일 또는 갱신일에 선결제됩니다.',
        a9i2: '결제는 Airwallex(글로벌) 또는 Toss Payments(한국) 를 통해 처리됩니다.',
        a9i3: '연간 구독은 월간 요금 대비 20% 할인이 적용됩니다.',
        a9i4: '구독은 마이 계정 > 청구 메뉴에서 언제든지 취소할 수 있으며, 취소 시 현재 결제 주기 종료 후 서비스가 무료 플랜으로 전환됩니다.',
        a9i5: '구독 결제일로부터 7일 이내에 서비스를 이용하지 않은 경우, 이메일(support@nexyfab.com)을 통해 전액 환불을 요청할 수 있습니다. 이후에는 환불이 제공되지 않습니다.',
        a9i6: '회사는 30일 사전 통보 후 구독 요금을 변경할 수 있습니다. 기존 구독자에게는 다음 갱신 시부터 변경 요금이 적용됩니다.',
    },
    en: {
        kicker: 'Nexyfab · Terms of Use',
        title: 'Terms of Use',
        desc1: 'These terms regulate the conditions of use and',
        desc2: 'responsibilities between Nexyfab and Users.',
        a1Title: 'Article 1 (Purpose)',
        a1Desc: 'These terms aim to define the conditions and procedures for using the development and manufacturing matching platform service (the "Service") provided by Nexyfab ("the Company"), and the rights, duties, and responsibilities between the Company and the User.',
        a2Title: 'Article 2 (Definitions)',
        a2i1: 'User: Individuals or entities using the Service',
        a2i2: 'Customer: One who registers a project and requests matching',
        a2i3: 'Partner: Individuals or entities wishing to perform development, design, and manufacturing',
        a2i4: 'Matching: The act of the Company analyzing the Customer\'s requirements and recommending suitable partners',
        a2i5: 'Content: All information including documents, drawings, images, files, and text uploaded by the User',
        a3Title: 'Article 3 (Nature of the Service)',
        a3i1: 'The Company provides a platform service that recommends partners through data-driven analysis.',
        a3i2: 'The Company is not a party to the project execution; actual contracts, quotes, production, and delivery are conducted directly between the Customer and the Partner.',
        a3i3: 'The Company does not guarantee specific quality, delivery dates, or performance regarding matching results.',
        a4Title: 'Article 4 (Service Stages and Scope)',
        a4i1: 'Project reception and requirements analysis',
        a4i2: 'Data-driven partner recommendation',
        a4i3: 'Support for NDA procedures',
        a4i4: 'Communication support after matching',
        a4Note: '* The Company is not the entity responsible for design finalization, BOM finalization, order agency, payment agency, or production management.',
        a5Title: 'Article 5 (Intellectual Property Rights)',
        a5i1: 'IP rights related to the project follow the contract between the Customer and the Partner unless otherwise specified.',
        a5i2: 'The Company does not claim ownership of content uploaded by users.',
        a6Title: 'Article 6 (Limitation of Liability)',
        a6i1: 'The Company is not liable for Partner\'s breach of contract, production delays, quality disputes, or legal disputes with third parties.',
        a6i2: 'For projects conducted through the Nexyfab platform, the Company may support Quality Checks within a separately agreed scope.',
        a6i3: 'Such Quality Checks refer to verification and support procedures based on predefined criteria and do not constitute a legal guarantee of specific quality, performance, or absence of defects.',
        a6i4: 'The Company assumes no responsibility for contracts, orders, production, or payments made directly between Customers and Partners outside the platform.',
        a7Title: 'Article 7 (Dispute Resolution)',
        a7i1: 'These terms are governed by the laws of the Republic of Korea.',
        a7i2: 'Any disputes related to the Service shall be subject to the exclusive jurisdiction of the court having jurisdiction over the Company\'s location.',
        a8Title: 'Article 8 (Fee and Penalty Policy)',
        a8s1Title: '1. Matching Solution',
        a8s1b1: 'Base matching fee: 4~7% of total project amount (min. ₩500,000 / 400 USD, excl. VAT)',
        a8s1b2: 'No-Risk Policy: Full refund if no suitable partner is found',
        a8s1b3: 'Cancellation before design/production start: 50% of commission charged',
        a8s1Desc: 'At contract signing, the base fee (4~7%, min. ₩500,000 / 400 USD, excl. VAT) is settled, with the Step 1 application fee fully credited. After contract signing, a dedicated operator supports scheduling, quality checks, and issue resolution from design kickoff through delivery.',
        a8s1TableTitle: 'Fee Rate by Cumulative Project Amount (excl. VAT)',
        a8s1Penalty: '[Penalty & Refund Policy] After contract, before design start: 50% of commission charged / After design starts: Full commission applies / After production contract, before production start: 50% of commission charged / After production starts: Non-refundable',
        a8s2Title: '2. Total Solution',
        a8s2b1: 'Total Solution base fee: 15% of total project amount (excl. VAT)',
        a8s2Desc: 'A turnkey solution where Nexyfab manages the entire process from design, partner sourcing, mass production to delivery.',
        a8s2Penalty: '[Penalty & Refund Policy] After contract, before design: 2.5% penalty of estimated budget / After design starts: Design fee + 5% penalty / Before mass production (before pre-work): Design fee + 7.5% penalty / After mass production starts: Non-refundable',
        a9Title: 'Article 9 (SaaS Subscription Service)',
        a9Desc: 'The NexyFab platform provides Software as a Service (SaaS) on a monthly and annual subscription basis. Features and usage limits vary by subscription plan (Free, Pro, Enterprise).',
        a9i1: 'Subscription fees are charged in advance on the subscription start date or renewal date.',
        a9i2: 'Payments are processed through Airwallex (global) or Toss Payments (Korea).',
        a9i3: 'Annual subscriptions receive a 20% discount compared to the monthly rate.',
        a9i4: 'Subscriptions can be cancelled at any time via My Account > Billing. Upon cancellation, service continues until the end of the current billing period, then reverts to the Free plan.',
        a9i5: 'If the service has not been used within 7 days of the subscription payment date, a full refund may be requested via email (support@nexyfab.com). Refunds are not available thereafter.',
        a9i6: 'The Company may change subscription pricing with 30 days prior notice. For existing subscribers, the new pricing applies from the next renewal date.',
    },
    ja: {
        kicker: 'Nexyfab · 利用規約',
        title: '利用規約',
        desc1: '本規約は、Nexyfabとユーザー間の',
        desc2: 'サービスの利用条件および責任事項を規定します。',
        a1Title: '第1条（目的）',
        a1Desc: '本規約は、Nexyfab（以下「会社」）が提供する開発・製造マッチングプラットフォームサービス（以下「サービス」）の利用条件および手続き、会社とユーザー間の権利・義務および責任事項を規定することを目的とします。',
        a2Title: '第2조 (用語の定義)',
        a2i1: 'User（ユーザー）：本サービスを利用する個人または法人',
        a2i2: 'Customer（顧客）：プロジェクトを登録し、マッチングを依頼する者',
        a2i3: 'Partner（パートナー）：開発・設計・製造の遂行を希望する個人または法人',
        a2i4: 'Matching（マッチング）：会社が顧客の要件を分析し、最適なパートナーを推薦する行為',
        a2i5: 'Content（コンテンツ）：ユーザーがアップロードした文書、図面、画像、ファイル、テキストなどの一切の情報',
        a3Title: '第3条（サービスの性質）',
        a3i1: '会社はデータに基づいた分析を通じてパートナーを推薦するプラットフォームサービスを提供します。',
        a3i2: '会社はプロジェクト遂行の当사者ではなく、実際の契約・見積・生産・納品は顧客とパートナー間で直接締結・進行されます。',
        a3i3: '会社はマッチング結果について、特定の品質、納期、成果を保証しません。',
        a4Title: '第4条（サービス段階および範囲）',
        a4i1: 'プロジェクトの受付および要件分析',
        a4i2: 'データに基づいたパートナー推薦',
        a4i3: 'NDA締結手続きのサポート',
        a4i4: 'マッチング後のコミュニケーションサポート',
        a4Note: '※ 会社は設計確定、BOM確定、注文代行、決済代行、生産管理の主体ではありません。',
        a5Title: '第5条（知的財産権）',
        a5i1: 'プロジェクト関連の知的財産権は、別途契約がない限り、顧客とパートナー間の契約に従います。',
        a5i2: '会社はユーザーがアップロードしたコンテンツの所有権を主張しません。',
        a6Title: '第6条（責任の制限）',
        a6i1: '会社はマッチング過程で合理的な注意を払いますが、パートナーの契約不履行、生産遅延、品質紛争、第三者との法的紛争などについては責任を負いません。',
        a6i2: '会社はNexyfabプラットフォームを通じて進行されるプロジェクトに限り、別途協議された範囲内で品質検収（Quality Check）をサポートすることができます。',
        a6i3: '前項の品質検収は、事前に定義された基準に基づく確認およびサポート手続きを意味し、特定の品質、成果、瑕疵がないことに対する法的保証を意味するものではありません。',
        a6i4: 'プラットフォームを通さずに顧客とパートナー間で直接締結・進行された契約、発注, 生産、代金支払などについて、会社は一切の責任を負いません。',
        a7Title: '第7条（紛争解決）',
        a7i1: '本規約は大韓民国の法律に従います。',
        a7i2: '本サービスに関連して発生した紛争については、会社の所在地を管轄する裁判所を専属的合意管轄裁判所とします。',
        a8Title: '第8条（料金および違約金ポリシー）',
        a8s1Title: '1. マッチングソリューション',
        a8s1b1: '基本手数料：プロジェクト総額の4~7%（最低50万ウォン／60,000 JPY、税別）',
        a8s1b2: 'No-Riskポリシー：適切なパートナーが見つからない場合、全額返金',
        a8s1b3: '作業着手前のキャンセル：手数料の50%を請求',
        a8s1Desc: '契約締結時に基本手数料（4~7%、最低50万ウォン、税別）を精算し、Step 1マッチング申請金は手数料から100%控除されます。契約締結後、専任オペレーターが設計着手から納品完了までスケジュール管理、品質確認、問題対応などをサポートいたします。',
        a8s1TableTitle: 'プロジェクト累積金額別手数料率（税別）',
        a8s1Penalty: '[違約金・返金規定] 契約後・設計着手前：手数料の50%を請求 / 設計着手後：最終手数料全額発生 / 量産契約後・量産着手前：手数料の50%を請求 / 量産着手後：返金不可',
        a8s2Title: '2. トータルソリューション',
        a8s2b1: 'トータルソリューション基本手数料：プロジェクト総額の15%（税別）',
        a8s2Desc: '設計からパートナーソーシング、量産、納品までの全プロセスをNexyfabが専任管理するターンキー方式のソリューションです。',
        a8s2Penalty: '[違約金・返金規定] 契約後・設計前：既存予算の2.5%違約金 / 設計作業開始後：設計費＋既存予算基準手数料の5%違約金 / 量産前（事前作業着手前）：設計費＋既存予算基準手数料の7.5%違約金 / 量産開始後：返金不可',
        a9Title: '第9条（SaaSサブスクリプションサービス）',
        a9Desc: 'NexyFabプラットフォームは、月額および年間サブスクリプション形式のSaaS（Software as a Service）を提供します。サブスクリプションプラン（Free、Pro、Enterprise）により、提供機能と利用制限が異なります。',
        a9i1: 'サブスクリプション料金は、開始日または更新日に前払いで請求されます。',
        a9i2: '支払いはAirwallex（グローバル）またはToss Payments（韓国）を通じて処理されます。',
        a9i3: '年間サブスクリプションには、月額料金と比較して20%の割引が適用されます。',
        a9i4: 'サブスクリプションはマイアカウント＞請求メニューからいつでも解約できます。解約後は現在の請求期間終了後、無料プランに移行します。',
        a9i5: 'サブスクリプション決済日から7日以内にサービスを利用していない場合、メール（support@nexyfab.com）にて全額返金を申請できます。それ以降は返金対応いたしかねます。',
        a9i6: '会社は30日前に事前通知した上でサブスクリプション料金を変更することができます。既存の契約者には次回更新時から変更後の料金が適用されます。',
    },
    zh: {
        kicker: 'Nexyfab · 服务条款',
        title: '服务条款',
        desc1: '本条款规定了 Nexyfab 与用户之间的',
        desc2: '服务使用条件及责任事项。',
        a1Title: '第一条 (目的)',
        a1Desc: '本条款旨在规定由 Nexyfab（以下简称”公司”）提供的开发与制造匹配平台服务（以下简称”服务”）的使用条件和程序，以及公司与用户之间的权利、义务和责任事项。',
        a2Title: '第二条 (术语定义)',
        a2i1: 'User (用户)：使用本服务的个人或实体',
        a2i2: 'Customer (客户)：注册项目并请求匹配的人',
        a2i3: 'Partner (合作伙伴)：希望执行开发、设计和制造的个人或实体',
        a2i4: 'Matching (匹配)：公司分析客户需求并推荐合适合作伙伴的行为',
        a2i5: 'Content (内容)：用户上传的文档、图纸、图像、文件、文本等所有信息',
        a3Title: '第三条 (服务性质)',
        a3i1: '公司提供通过数据驱动分析推荐合作伙伴的平台服务。',
        a3i2: '公司不是项目执行的当事人；实际的合同、报价、生产和交付由客户与合作伙伴直接签署和进行。',
        a3i3: '公司不保证匹配结果的特定质量、交货期或成果。',
        a4Title: '第四条 (服务阶段及范围)',
        a4i1: '项目接收及需求分析',
        a4i2: '基于数据的合作伙伴推荐',
        a4i3: 'NDA 签署流程支持',
        a4i4: '匹配后的沟通支持',
        a4Note: '※ 公司不是设计确认、BOM 确认、订单代办、支付代办、生产管理的主体。',
        a5Title: '第五条 (知识产权)',
        a5i1: '除非另有协议，与项目相关的知识产权遵循客户与合作伙伴之间的合同。',
        a5i2: '公司不主张用户上传内容的所有权。',
        a6Title: '第六条 (责任限制)',
        a6i1: '公司在匹配过程中会尽到合理的注意义务，但对于合作伙伴的违约、生产延迟、质量纠纷、与第三方的法律纠纷等不承担责任。',
        a6i2: '仅限通过 Nexyfab 平台进行的项目，公司可以在另行协商的范围内提供质量检查 (Quality Check) 支持。',
        a6i3: '前项所述的质量检查是指根据预定义标准进行的确认和支持程序，并不意味着对特定质量、成果或无缺陷的法律保证。',
        a6i4: '对于未通过平台而在客户与合作伙伴之间直接签署和进行的合同、订单、生产、付款等，公司不承担任何责任。',
        a7Title: '第七条 (争议解决)',
        a7i1: '本条款受大韩民国法律管辖。',
        a7i2: '与本服务相关的任何争议，应以公司所在地管辖法院为专属管辖法院。',
        a8Title: '第八条 (费用及违约金政策)',
        a8s1Title: '1. 匹配解决方案 (Matching Solution)',
        a8s1b1: '匹配基础佣金：项目总额的4~7%（最低50万韩元／3,000 CNY，不含税）',
        a8s1b2: 'No-Risk政策：未能找到合适合作伙伴时，全额退款',
        a8s1b3: '设计/量产启动前取消合同：收取佣金的50%',
        a8s1Desc: '签约时结算基础佣金（4~7%，最低50万韩元，不含税），Step 1匹配申请费100%抵扣。合同签署后，专属运营人员将从设计启动到交付完成全程协助进度管理、质量确认及问题协调。',
        a8s1TableTitle: '按项目累计金额的佣金率（不含税）',
        a8s1Penalty: '[违约金及退款规定] 合同后至设计启动前：收取佣金的50% / 设计启动后：最终佣金全额发生 / 量产合同后至量产启动前：收取佣金的50% / 量产启动后：不可退款',
        a8s2Title: '2. 全套解决方案 (Total Solution)',
        a8s2b1: '全套解决方案基础佣金：项目总额的15%（不含税）',
        a8s2Desc: '由 Nexyfab 全程专属管理从设计、合作伙伴采购、量产到交付的交钥匙（Turn-key）方式解决方案。',
        a8s2Penalty: '[违约金及退款规定] 合同后至设计前：既有预算的2.5%违约金 / 设计工作开始后：设计费＋既有预算基准佣金的5%违约金 / 量产前（事前作业着手前）：设计费＋既有预算基准佣金的7.5%违约金 / 量产开始后：不可退款',
        a9Title: '第九条（SaaS订阅服务）',
        a9Desc: 'NexyFab平台以月度和年度订阅形式提供SaaS（软件即服务）。订阅计划（Free、Pro、Enterprise）的功能和使用限制各不相同。',
        a9i1: '订阅费用于订阅开始日或续订日预先收取。',
        a9i2: '付款通过Airwallex（全球）或Toss Payments（韩国）处理。',
        a9i3: '年度订阅相较月度费率享有20%折扣。',
        a9i4: '订阅可随时通过"我的账户 > 账单"取消。取消后，服务将在当前计费周期结束后转换为免费计划。',
        a9i5: '若订阅付款日起7天内未使用服务，可通过电子邮件（support@nexyfab.com）申请全额退款。此后将不提供退款。',
        a9i6: '公司可在提前30天通知后变更订阅价格。对于现有订阅用户，新价格将从下次续订时起适用。',
    }
};

export default function TermsOfUsePage() {
    const pathname = usePathname();
    const langCode = pathname.split('/')[1] || 'en';
    const lang = ['en', 'kr', 'ja', 'cn'].includes(langCode) ? langCode : 'en';

    const langMap: Record<string, keyof typeof dict> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'zh', es: 'en', ar: 'en' };
    const t: (typeof dict)['ko'] = dict[langMap[lang] ?? 'en'];

    return (
        <main style={{ minHeight: '100vh', backgroundColor: '#fff', paddingBottom: '80px' }}>
            <section style={{ textAlign: 'center', padding: '100px 20px 60px', backgroundColor: '#f8f9fb', marginBottom: '40px' }}>
                <p style={{ fontSize: '14px', letterSpacing: '0.15em', color: '#0056ff', marginBottom: '16px', fontWeight: 800 }}>{t.kicker}</p>
                <h1 style={{ fontSize: '42px', fontWeight: 900, marginBottom: '20px', color: '#111' }}>{t.title}</h1>
                <p style={{ color: '#555', fontSize: '16px', maxWidth: '700px', margin: '0 auto', lineHeight: 1.6 }}>
                    {t.desc1}<br />{t.desc2}
                </p>
            </section>

            <section style={{ maxWidth: '800px', margin: '0 auto', padding: '0 20px', lineHeight: 1.8, color: '#333', fontSize: '16px', display: 'flex', flexDirection: 'column', gap: '32px' }}>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{t.a1Title}</h2>
                    <p>{t.a1Desc}</p>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{t.a2Title}</h2>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li>{t.a2i1}</li>
                        <li>{t.a2i2}</li>
                        <li>{t.a2i3}</li>
                        <li>{t.a2i4}</li>
                        <li>{t.a2i5}</li>
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{t.a3Title}</h2>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li>{t.a3i1}</li>
                        <li>{t.a3i2}</li>
                        <li>{t.a3i3}</li>
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{t.a4Title}</h2>
                    <p style={{ marginBottom: '10px' }}>{lang === 'kr' ? '회사는 다음의 서비스를 제공합니다:' : (lang === 'en' ? 'The Company provides the following services:' : (lang === 'ja' ? '会社は以下のサービスを提供します：' : '公司提供以下服务：'))}</p>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                        <li>{t.a4i1}</li>
                        <li>{t.a4i2}</li>
                        <li>{t.a4i3}</li>
                        <li>{t.a4i4}</li>
                    </ul>
                    <p style={{ color: '#666', fontSize: '15px' }}>{t.a4Note}</p>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{t.a5Title}</h2>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li>{t.a5i1}</li>
                        <li>{t.a5i2}</li>
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{t.a6Title}</h2>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li>{t.a6i1}</li>
                        <li>{t.a6i2}</li>
                        <li>{t.a6i3}</li>
                        <li>{t.a6i4}</li>
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{t.a7Title}</h2>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li>{t.a7i1}</li>
                        <li>{t.a7i2}</li>
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{t.a9Title}</h2>
                    <p style={{ marginBottom: '10px' }}>{t.a9Desc}</p>
                    <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li>{t.a9i1}</li>
                        <li>{t.a9i2}</li>
                        <li>{t.a9i3}</li>
                        <li>{t.a9i4}</li>
                        <li>{t.a9i5}</li>
                        <li>{t.a9i6}</li>
                    </ul>
                </div>

                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '12px', color: '#111' }}>{t.a8Title}</h2>

                    <div style={{ marginBottom: '20px' }}>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '10px', color: '#222' }}>{t.a8s1Title}</h3>
                        <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                            <li>{t.a8s1b1}</li>
                            <li>{t.a8s1b2}</li>
                            <li>{t.a8s1b3}</li>
                        </ul>
                        <p style={{ marginBottom: '8px' }}>{t.a8s1Desc}</p>
                        <p style={{ fontWeight: 700, marginBottom: '4px' }}>{t.a8s1TableTitle}</p>
                        <p style={{ color: '#555', fontSize: '15px' }}>{t.a8s1Penalty}</p>
                    </div>

                    <div>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '10px', color: '#222' }}>{t.a8s2Title}</h3>
                        <ul style={{ paddingLeft: '20px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                            <li>{t.a8s2b1}</li>
                        </ul>
                        <p style={{ marginBottom: '8px' }}>{t.a8s2Desc}</p>
                        <p style={{ color: '#555', fontSize: '15px' }}>{t.a8s2Penalty}</p>
                    </div>
                </div>

            </section>
        </main>
    );
}

