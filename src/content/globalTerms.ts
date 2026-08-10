export const GLOBAL_TERMS_VERSION = 'GTS-1.0-2026-08-09';
export const GLOBAL_TERMS_EFFECTIVE_DATE = '2026-08-09';

export type GlobalTermsLocale = 'en' | 'ko';

export interface GlobalTermsSection {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  note?: string;
}

export interface GlobalTermsDocument {
  kicker: string;
  title: string;
  description: string;
  versionLabel: string;
  effectiveLabel: string;
  summaryTitle: string;
  summary: string[];
  sections: GlobalTermsSection[];
}

const en: GlobalTermsDocument = {
  kicker: 'NexyFab · Global Terms of Service',
  title: 'Global Terms of Service',
  description: 'These Terms govern NexyFab AI-assisted design, browser CAD, collaboration, file processing, and manufacturing-related platform services worldwide.',
  versionLabel: 'Version',
  effectiveLabel: 'Effective date',
  summaryTitle: 'Plain-language summary',
  summary: [
    'You retain ownership of your inputs. NexyFab receives only the limited rights needed to operate the Service.',
    'Private customer content is not used to train general-purpose AI models by default. Separate, explicit opt-in or a written enterprise agreement is required.',
    'AI and CAD results carry an explicit verification status. Technical or expert review is limited to the recorded scope, version, and evidence; it is not legal clearance.',
    'You must have authority to upload and use files, and you must validate outputs for the intended manufacturing, construction, safety, or regulated use.',
    'Mandatory consumer and data-protection rights in your country are not waived by these Terms.',
  ],
  sections: [
    {
      id: 'agreement',
      title: '1. Agreement and contract structure',
      paragraphs: [
        'These Terms form an agreement between you and Nexysys Lab Co., Ltd., doing business as NexyFab ("NexyFab," "we," "us," or "our"). By creating an account, accepting an invitation, accessing the Service, or using the Service after being shown these Terms, you agree to them.',
        'The Privacy Policy, Security Policy, applicable order form, plan description, enterprise agreement, and any product-specific addendum are incorporated by reference. A signed order form or enterprise agreement controls if it expressly conflicts with these Terms. Mandatory law always controls where it cannot be varied by contract.',
      ],
    },
    {
      id: 'eligibility',
      title: '2. Eligibility, authority, and accounts',
      bullets: [
        'You must be at least 18 years old or the age of legal majority where you live. The Service is not directed to children.',
        'If you use the Service for an organization, you represent that you have authority to bind that organization. "You" then includes the organization.',
        'Account and Closed Beta invitations are personal to the authorized recipient unless NexyFab approves a transfer. Keep credentials confidential and promptly report suspected compromise.',
        'You are responsible for activity under your account, except to the extent caused by NexyFab or a security failure for which applicable law makes NexyFab responsible.',
      ],
    },
    {
      id: 'service',
      title: '3. The Service',
      paragraphs: [
        'NexyFab may provide AI-assisted concept and product generation, manual browser-based modeling, precision CAD workflows, engineering calculations, file conversion and export, collaboration, project review, partner matching, and related tools. Available features depend on plan, region, release stage, and technical capability.',
        'NexyFab is a software and platform provider. Unless a separate written agreement says otherwise, NexyFab is not your architect, professional engineer, surveyor, general contractor, manufacturer, certification body, patent attorney, or legal adviser, and is not a party to a transaction between a customer and an independent partner.',
      ],
    },
    {
      id: 'beta',
      title: '4. Beta, preview, and evaluation features',
      paragraphs: [
        'Features identified as Closed Beta, beta, preview, experimental, or evaluation may be incomplete, change materially, or be discontinued. We will use reasonable care to preserve account access and customer content, but beta features may have separate limits and no service-level commitment unless agreed in writing.',
        'We do not retroactively replace, transfer, delete, or repurpose existing Closed Beta credentials or customer works merely because these Terms or a feature version changes. Any material migration will be communicated and performed under the applicable data policy and agreement.',
      ],
    },
    {
      id: 'content',
      title: '5. Your content, confidential designs, and permissions',
      paragraphs: [
        '"Input" means files, CAD models, drawings, prompts, specifications, images, data, comments, and other material you submit. You retain your ownership of Input. You grant NexyFab a non-exclusive, worldwide, limited license to host, copy, process, transmit, render, back up, secure, and display Input only as needed to provide, maintain, protect, and improve the Service for you and your authorized collaborators.',
        'Private Input is not used to train or fine-tune a general-purpose or shared AI model by default. Training use requires a separate explicit opt-in or written enterprise agreement that identifies the data and purpose. Service telemetry may be used in de-identified or aggregated form where permitted by the Privacy Policy and applicable law.',
        'You represent that you own the Input or have all permissions needed to upload, process, share, and use it. This includes permissions arising from copyright, trade secret, confidentiality, employment, customer, data-protection, export-control, and contractual obligations. Owning copyright alone may not be sufficient.',
        'You control collaborator access. Confidentiality obligations in a signed NDA or enterprise agreement supplement this section. We may retain limited backups, security logs, or records after deletion where reasonably necessary for recovery, fraud prevention, legal compliance, or dispute evidence, subject to the Privacy Policy and retention schedule.',
      ],
    },
    {
      id: 'outputs',
      title: '6. Outputs and NexyFab intellectual property',
      paragraphs: [
        '"Output" means a design, model, drawing, calculation, code, report, or other result generated for you by the Service. As between you and NexyFab, and subject to applicable law and third-party rights, you own your Output. To the extent NexyFab has rights in an Output created specifically for you, NexyFab assigns those rights to you upon generation or full payment, as applicable.',
        'Because AI systems may produce similar results for different users, Output may not be unique and rights may not arise in every jurisdiction. NexyFab does not provide a patentability, freedom-to-operate, trademark, copyright, design-right, or other legal clearance opinion.',
        'NexyFab and its licensors retain all rights in the Service, software, user interface, algorithms, generic templates, reference catalogs, standards mappings, documentation, brands, and pre-existing materials. No right in those items is transferred merely because they appear in an Output. Where an export includes open-source or third-party material, the applicable notice or license continues to apply.',
      ],
    },
    {
      id: 'ai-cad',
      title: '7. AI, CAD accuracy, validation states, and expert review',
      paragraphs: [
        'AI-assisted results may contain omissions, incorrect geometry, dimensions, materials, tolerances, calculations, citations, code, or assumptions. NexyFab may run automated checks, exact-kernel operations, simulations, standards checks, or human review, but each check has a defined scope and limitation.',
        'The status shown in the Service controls: for example, AI Generated, Validation Pending, Automatically Validated, Expert Review Required, Expert Reviewed, or Released. An expert-review status applies only to the identified file or immutable revision, hash, review scope, assumptions, and date. A later edit, conversion, changed input, or different use may require revalidation.',
        'Expert technical review is not legal review and does not determine ownership, non-infringement, patent freedom to operate, licensing, permitting, or regulatory approval. NexyFab does not label every result as a mere concept draft; however, no result should be treated as production-ready beyond the verification status and evidence actually shown.',
      ],
    },
    {
      id: 'real-world-use',
      title: '8. Manufacturing, construction, safety, and regulated use',
      bullets: [
        'Before fabrication, machining, procurement, construction, installation, certification, or other real-world use, you must perform validation appropriate to the intended use, materials, loads, environment, tolerances, local code, and reasonably foreseeable failure modes.',
        'Where law requires a licensed architect, engineer, surveyor, safety professional, authority, or certification body, you must obtain that review or approval. A NexyFab workflow status does not replace a legally required signature or approval unless expressly stated in a separate written agreement by an authorized qualified professional.',
        'Do not rely on the Service as the sole control for life-safety, medical, nuclear, aviation flight-critical, autonomous vehicle safety, critical infrastructure, weapons, or similarly high-risk use unless NexyFab has expressly accepted that use in a signed agreement with appropriate controls.',
        'You remain responsible for reviewing generated BOMs, supplier data, material properties, tolerances, instructions, and exported files before committing money or physical resources.',
      ],
    },
    {
      id: 'acceptable-use',
      title: '9. Acceptable use',
      bullets: [
        'Do not use the Service or submit content unlawfully, fraudulently, deceptively, or in violation of another person’s intellectual-property, privacy, publicity, confidentiality, contractual, or other rights.',
        'Do not upload malware, bypass access controls, probe or disrupt the Service without authorization, scrape restricted data, overload infrastructure, or access another user’s project or credentials.',
        'Do not use Output to misrepresent certification, expert approval, provenance, test results, affiliation, or compliance status.',
        'Do not develop prohibited weapons, evade sanctions or export controls, facilitate serious harm, or use the Service in a manner prohibited by an applicable product policy or written notice.',
        'Reverse engineering is prohibited only to the extent permitted by applicable law; this restriction does not limit rights that cannot legally be waived or rights granted by an open-source license.',
      ],
    },
    {
      id: 'third-party',
      title: '10. Third-party services, standards, and compatibility',
      paragraphs: [
        'The Service may interoperate with cloud, AI, payment, identity, file-format, manufacturing, and other third-party services. Their terms may apply to your direct use of those services. NexyFab is not responsible for a third party’s independent acts, but this does not limit NexyFab’s responsibility for its own vendor selection, instructions, security, or legal obligations.',
        'References to SOLIDWORKS, Autodesk, AutoCAD, DWG, STEP, IFC, or other third-party products, marks, or formats describe compatibility or source formats only unless expressly stated. They do not imply sponsorship, certification, or affiliation. Standards, material data, and supplier catalogs must be checked against the authoritative edition and intended jurisdiction.',
      ],
    },
    {
      id: 'notices',
      title: '11. Intellectual-property and illegal-content notices',
      paragraphs: [
        'Rights holders and other affected persons may report allegedly infringing or illegal content to nexyfab@nexysys.com. A notice should identify the work or right, the specific material and location, the reporting person’s contact details and authority, the legal basis, and a good-faith statement that the information is accurate. We may request supporting information.',
        'We may restrict access to identified material while reviewing a sufficiently precise notice, notify the affected user where lawful, preserve relevant evidence, and remove or restore material based on the available information. Users may submit a reasoned counter-notice or appeal to the same address. We act proportionately and do not promise that automated detection will identify every infringement.',
        'We may suspend repeat or serious infringers in appropriate circumstances. United States DMCA safe-harbor status requires separate statutory steps, including a registered designated agent; this general reporting process does not represent that those steps have been completed.',
      ],
    },
    {
      id: 'privacy-security',
      title: '12. Privacy, data processing, and security',
      paragraphs: [
        'The Privacy Policy explains the categories and purposes of personal-data processing, legal bases where applicable, recipients, international transfers, retention, cookies, and user rights. The Security Policy describes operational safeguards. An enterprise customer that needs controller-processor terms may request a Data Processing Addendum.',
        'No system is perfectly secure. You must use appropriate account controls, avoid placing unnecessary personal data in CAD files or prompts, and promptly report suspected loss or unauthorized access. We will handle confirmed incidents and legally required notifications under applicable law and our incident process.',
      ],
    },
    {
      id: 'feedback',
      title: '13. Feedback',
      paragraphs: [
        'If you voluntarily provide product feedback, you grant NexyFab a perpetual, worldwide, royalty-free right to use it to improve and operate the Service without identifying you or disclosing your confidential content. This does not grant NexyFab training rights over private Input or transfer ownership of your designs.',
      ],
    },
    {
      id: 'paid-services',
      title: '14. Paid services, renewals, taxes, and refunds',
      paragraphs: [
        'Pricing, usage limits, billing cycle, currency, taxes, renewal, cancellation, refund terms, and any manufacturing or expert-review fee will be disclosed before purchase and may also appear in an order form or regional addendum. You will not be charged merely by uploading a file or viewing an estimate.',
        'Where a subscription renews automatically, the checkout flow will disclose the renewal terms and provide a cancellation method. Mandatory cooling-off, cancellation, refund, conformity, and consumer-guarantee rights in your country remain available. A tailored physical product, completed service, or immediately supplied digital service may have different withdrawal rules only where applicable law permits and required consent has been obtained.',
      ],
    },
    {
      id: 'changes-availability',
      title: '15. Service changes and availability',
      paragraphs: [
        'We may improve, add, replace, or retire features. We will provide reasonable advance notice of a material reduction to a paid core feature where practicable, except for urgent security, legal, third-party, or reliability reasons. Any service-level commitment exists only in a written plan or agreement.',
        'We may perform maintenance and use rate limits, queues, regional routing, or safety gates. We do not promise uninterrupted availability, but we remain responsible for obligations that cannot be excluded by law or that we expressly accept in writing.',
      ],
    },
    {
      id: 'suspension-termination',
      title: '16. Suspension, termination, and data export',
      paragraphs: [
        'You may stop using the Service and close your account subject to active orders, legal retention, and payment obligations. We may restrict or suspend access for a material breach, security risk, illegal use, non-payment, or risk to other users or the Service. Where appropriate, we will give notice, reasons, and an opportunity to cure or appeal.',
        'After termination, we will provide a reasonable opportunity to export customer content when technically and legally feasible, unless access is prohibited or immediate restriction is necessary. Deletion and backup expiration follow the Privacy Policy, enterprise agreement, and applicable law. Sections intended by their nature to survive will survive, including ownership, payment, disclaimers, liability, and dispute terms.',
      ],
    },
    {
      id: 'warranties',
      title: '17. Warranties and disclaimers',
      paragraphs: [
        'To the maximum extent permitted by law, the Service and unverified Output are provided on an "as available" basis. NexyFab does not make warranties not expressly stated in these Terms or a signed agreement, including implied warranties of merchantability, fitness for a particular purpose, title, non-infringement, or that every error or harmful use will be detected.',
        'These disclaimers do not exclude an express written warranty, a mandatory statutory guarantee, liability for fraud or fraudulent misrepresentation, or another right or remedy that applicable law does not allow the parties to waive.',
      ],
    },
    {
      id: 'liability',
      title: '18. Limitation of liability',
      paragraphs: [
        'Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited, including liability that applicable law imposes for willful misconduct, gross negligence, fraud, or death or personal injury caused by negligence.',
        'For business users, to the maximum extent permitted by law, neither party is liable for indirect, incidental, special, exemplary, or consequential damages, or lost profits, revenue, goodwill, or data, that were not reasonably foreseeable. NexyFab’s aggregate liability arising from the Service is limited to the greater of USD 100 or the amount paid by you for the affected Service during the 12 months before the event giving rise to the claim. This cap does not apply where prohibited by law or where a signed agreement states a different cap.',
        'For consumers, liability and remedies are governed by applicable mandatory consumer law. No business-only exclusion or cap in this section reduces those rights.',
      ],
    },
    {
      id: 'indemnity',
      title: '19. Business-user indemnity',
      paragraphs: [
        'If you use the Service on behalf of a business, you will defend and indemnify NexyFab against a third-party claim to the extent caused by your unlawful Input, your material breach of Sections 5, 8, or 9, or your use of Output contrary to a displayed restriction. NexyFab must promptly notify you, reasonably cooperate at your expense, and allow you to control the defense, except that you may not settle a claim in a way that admits fault by or imposes obligations on NexyFab without consent. This section does not apply to consumers acting outside a trade or profession.',
      ],
    },
    {
      id: 'trade-controls',
      title: '20. Trade controls and restricted regions',
      paragraphs: [
        'You must comply with applicable sanctions, export, import, and trade-control laws. You may not use the Service for a prohibited end user, end use, or destination, or upload controlled technical data without required authorization. NexyFab may block a transaction or access where reasonably necessary for compliance and may request information to perform screening.',
      ],
    },
    {
      id: 'law-disputes',
      title: '21. Governing law, disputes, and regional rights',
      paragraphs: [
        'Before filing a claim, the parties should send a written description to nexyfab@nexysys.com and try in good faith to resolve the dispute for 30 days. Urgent injunctive relief and claims that cannot lawfully be subject to this process are excluded.',
        'These Terms are governed by the laws of the Republic of Korea, without regard to conflict-of-law rules. For business users, the courts with jurisdiction over Nexysys Lab Co., Ltd.’s registered office have exclusive jurisdiction unless a signed agreement says otherwise. Consumers may bring claims in any court available under mandatory local law, and this clause does not deprive a consumer of mandatory protection in the country of habitual residence.',
        'For EU/EEA and UK users, mandatory privacy, digital-service, digital-content, withdrawal, conformity, notice-and-action, and consumer-remedy rights apply where the relevant law covers the Service. For users elsewhere, equivalent non-waivable local rights also remain in effect. If a regional addendum is published for your location, that addendum supplements these Terms and controls only for the stated subject and region.',
      ],
    },
    {
      id: 'term-changes',
      title: '22. Changes to these Terms',
      paragraphs: [
        'We may update these Terms for new features, security, legal requirements, or business changes. We will publish the new version and effective date. For a material change that reduces rights or adds material obligations, we will provide reasonable advance notice and request renewed acceptance where required by law or appropriate to the change.',
        'Changes do not transfer ownership of existing content or retroactively erase rights already earned. If you do not agree to a material change, you may stop using the affected Service and exercise any cancellation or export right available under your plan and applicable law.',
      ],
    },
    {
      id: 'language-contact',
      title: '23. Language, company details, and contact',
      paragraphs: [
        'The English version is the global master version. For users located in the Republic of Korea, the Korean version controls to the extent required by mandatory Korean law. Other translations are provided for convenience unless a regional addendum says otherwise. Any ambiguity is resolved consistently with applicable mandatory law.',
        'Provider: Nexysys Lab Co., Ltd. (NexyFab) · Business registration no. 606-87-03602 · 20 Dasansunhwan-ro, Namyangju-si, Gyeonggi-do, Republic of Korea · General, legal, privacy, security, and content notices: nexyfab@nexysys.com.',
      ],
    },
  ],
};

const ko: GlobalTermsDocument = {
  kicker: 'NexyFab · 글로벌 서비스 이용약관',
  title: '글로벌 서비스 이용약관',
  description: '본 약관은 전 세계에서 제공되는 NexyFab의 AI 설계, 브라우저 CAD, 협업, 파일 처리 및 제조 연계 플랫폼 서비스에 적용됩니다.',
  versionLabel: '버전',
  effectiveLabel: '시행일',
  summaryTitle: '핵심 요약',
  summary: [
    '입력 자료의 소유권은 사용자에게 유지되며, NexyFab은 서비스 제공에 필요한 제한적 이용권만 받습니다.',
    '비공개 고객 자료는 기본적으로 공용 AI 모델 학습에 사용하지 않습니다. 별도의 명시적 동의나 서면 기업계약이 필요합니다.',
    'AI·CAD 결과에는 검증 상태가 표시됩니다. 기술·전문가 검토는 기록된 버전, 범위와 증거에만 적용되며 법률 검토가 아닙니다.',
    '사용자는 파일을 업로드할 권한을 보유해야 하며 제조·시공·안전·규제 용도에 맞는 검증을 해야 합니다.',
    '사용자 국가의 강행 소비자보호 및 개인정보 권리는 본 약관으로 배제되지 않습니다.',
  ],
  sections: [
    {
      id: 'agreement',
      title: '1. 동의 및 계약 구조',
      paragraphs: [
        '본 약관은 NexyFab이라는 상호로 서비스를 제공하는 주식회사 넥시시스랩(이하 "NexyFab", "회사")과 사용자 사이의 계약입니다. 사용자가 계정을 만들거나 초대를 수락하고, 본 약관을 제시받은 후 서비스에 접속 또는 이용하면 본 약관에 동의한 것으로 봅니다.',
        '개인정보 처리방침, 보안 정책, 주문서, 요금제 설명, 기업계약 및 제품별 특약은 본 약관의 일부를 구성합니다. 서명된 주문서나 기업계약이 본 약관과 명시적으로 충돌하면 해당 문서가 우선하고, 계약으로 배제할 수 없는 강행법규는 항상 우선합니다.',
      ],
    },
    {
      id: 'eligibility',
      title: '2. 이용 자격, 권한 및 계정',
      bullets: [
        '사용자는 만 18세 이상이거나 거주지의 법정 성년이어야 합니다. 본 서비스는 아동을 대상으로 하지 않습니다.',
        '조직을 대신하여 이용하는 경우 해당 조직을 구속할 권한이 있음을 확인하며, 이때 "사용자"에는 해당 조직도 포함됩니다.',
        '계정과 Closed Beta 초대는 회사가 이전을 승인하지 않는 한 승인된 수령인만 사용할 수 있습니다. 인증정보를 안전하게 관리하고 침해 의심 시 즉시 알려야 합니다.',
        '사용자는 계정 활동에 책임을 지되, 회사의 행위나 법률상 회사가 책임져야 하는 보안 실패로 발생한 부분은 제외합니다.',
      ],
    },
    {
      id: 'service',
      title: '3. 서비스의 범위와 성격',
      paragraphs: [
        'NexyFab은 AI 기반 개념·제품 생성, 브라우저 수동 모델링, 정밀 CAD 워크플로, 공학 계산, 파일 변환·내보내기, 협업, 프로젝트 검토, 파트너 매칭 등을 제공할 수 있습니다. 기능은 요금제, 지역, 출시 단계 및 기술적 제공 가능성에 따라 달라집니다.',
        'NexyFab은 소프트웨어 및 플랫폼 제공자입니다. 별도 서면계약이 없는 한 회사는 사용자의 건축사, 전문 엔지니어, 측량사, 시공사, 제조사, 인증기관, 변리사 또는 법률자문사가 아니며, 고객과 독립 파트너 사이 거래의 당사자도 아닙니다.',
      ],
    },
    {
      id: 'beta',
      title: '4. 베타·프리뷰·평가 기능',
      paragraphs: [
        'Closed Beta, 베타, 프리뷰, 실험 또는 평가용으로 표시된 기능은 미완성일 수 있고 크게 변경되거나 종료될 수 있습니다. 회사는 계정 접근과 고객 자료를 보존하기 위해 합리적인 주의를 다하지만, 서면 합의가 없으면 베타 기능에는 별도 한도와 서비스 수준 보장이 적용될 수 있습니다.',
        '약관이나 기능 버전이 변경되었다는 이유만으로 기존 Closed Beta 인증정보 또는 고객 저작물을 소급하여 교체·이전·삭제하거나 다른 목적으로 전환하지 않습니다. 중대한 마이그레이션은 적용되는 데이터 정책과 계약에 따라 알리고 수행합니다.',
      ],
    },
    {
      id: 'content',
      title: '5. 사용자 자료, 비공개 설계 및 권한',
      paragraphs: [
        '"입력 자료"란 사용자가 제출한 파일, CAD 모델, 도면, 프롬프트, 사양, 이미지, 데이터, 의견 및 기타 자료를 말합니다. 입력 자료의 소유권은 사용자에게 유지됩니다. 사용자는 자신과 승인된 협업자에게 서비스를 제공·유지·보호·개선하는 데 필요한 범위에서만 회사가 입력 자료를 호스팅, 복제, 처리, 전송, 렌더링, 백업, 보호 및 표시할 수 있는 비독점적·전세계적·제한적 이용권을 부여합니다.',
        '비공개 입력 자료는 기본적으로 범용 또는 공용 AI 모델의 학습·미세조정에 사용하지 않습니다. 학습 목적 사용에는 대상 자료와 목적을 특정한 별도의 명시적 옵트인 또는 서면 기업계약이 필요합니다. 서비스 원격측정 정보는 개인정보 처리방침과 관련 법률이 허용하는 경우 비식별 또는 집계 형태로 사용할 수 있습니다.',
        '사용자는 입력 자료를 업로드·처리·공유·이용하는 데 필요한 소유권 또는 모든 권한이 있음을 확인합니다. 여기에는 저작권뿐 아니라 영업비밀, 비밀유지, 고용, 고객계약, 개인정보, 수출통제 및 기타 계약상 권한이 포함됩니다. 저작권을 보유했다는 사실만으로 충분하지 않을 수 있습니다.',
        '협업자 접근권한은 사용자가 관리합니다. 체결된 NDA 또는 기업계약의 비밀유지 의무는 본 조항에 추가로 적용됩니다. 회사는 개인정보 처리방침과 보존기준에 따라 복구, 사기 방지, 법적 의무 또는 분쟁 증거에 합리적으로 필요한 제한적 백업·보안 로그·기록을 삭제 후에도 보유할 수 있습니다.',
      ],
    },
    {
      id: 'outputs',
      title: '6. 결과물 및 NexyFab의 지식재산',
      paragraphs: [
        '"결과물"은 서비스가 사용자를 위해 생성한 설계, 모델, 도면, 계산, 코드, 보고서 등을 말합니다. 관련 법률과 제3자 권리를 전제로 회사와 사용자 사이에서는 사용자가 결과물을 소유합니다. 회사가 사용자를 위해 특별히 생성된 결과물에 권리를 보유하게 되는 범위에서는 생성 시점 또는 해당되는 경우 대금 완납 시 그 권리를 사용자에게 양도합니다.',
        'AI는 서로 다른 사용자에게 유사한 결과를 만들 수 있으므로 결과물이 독창적이지 않을 수 있고, 일부 국가에서는 권리가 성립하지 않을 수 있습니다. 회사는 특허성, 실시자유, 상표, 저작권, 디자인권 또는 기타 법적 권리의 침해 여부를 판단하거나 보증하지 않습니다.',
        '서비스, 소프트웨어, UI, 알고리즘, 범용 템플릿, 참조 카탈로그, 표준 매핑, 문서, 상표 및 기존 자료의 권리는 회사와 라이선스 제공자에게 유지됩니다. 이러한 요소가 결과물에 나타났다는 이유만으로 권리가 이전되지 않습니다. 내보낸 파일에 오픈소스나 제3자 자료가 포함되면 해당 고지와 라이선스가 계속 적용됩니다.',
      ],
    },
    {
      id: 'ai-cad',
      title: '7. AI·CAD 정확도, 검증 상태 및 전문가 검토',
      paragraphs: [
        'AI 기반 결과에는 형상, 치수, 재료, 공차, 계산, 인용, 코드 또는 가정의 누락과 오류가 있을 수 있습니다. 회사는 자동 검사, 정밀 커널 연산, 시뮬레이션, 표준 검사 또는 사람의 검토를 제공할 수 있지만 각 검사는 정해진 범위와 한계를 가집니다.',
        '서비스에 표시된 상태가 기준이 됩니다. 예: AI 생성, 검증 대기, 자동 검증 완료, 전문가 검토 필요, 전문가 검토 완료, 릴리스 완료. 전문가 검토 상태는 식별된 파일 또는 변경 불가능한 리비전·해시·검토 범위·가정·검토일에만 적용됩니다. 이후 편집, 변환, 입력 변경 또는 다른 용도 적용 시 재검증이 필요할 수 있습니다.',
        '전문가 기술 검토는 법률 검토가 아니며 소유권, 비침해, 특허 실시자유, 라이선스, 인허가 또는 규제 승인을 판단하지 않습니다. 회사는 모든 결과물을 단순 초안으로만 취급하지 않지만, 화면에 실제 표시된 검증 상태와 증거를 넘어 생산 준비가 완료된 것으로 간주해서는 안 됩니다.',
      ],
    },
    {
      id: 'real-world-use',
      title: '8. 제조·시공·안전·규제 용도',
      bullets: [
        '제작, 가공, 구매, 시공, 설치, 인증 등 현실 적용 전에는 목적, 재료, 하중, 환경, 공차, 현지 기준 및 합리적으로 예상되는 고장 형태에 맞는 검증을 수행해야 합니다.',
        '법률상 건축사, 기술사·전문 엔지니어, 측량사, 안전전문가, 관할기관 또는 인증기관의 검토·승인이 필요하면 이를 별도로 받아야 합니다. 권한 있는 자격자가 별도 서면계약으로 명시하지 않는 한 NexyFab 상태 표시는 법정 서명이나 승인을 대체하지 않습니다.',
        '회사가 적절한 통제와 함께 서명된 계약으로 명시적으로 수락하지 않은 경우 생명안전, 의료, 원자력, 항공 비행필수, 자율주행 안전, 중요 기반시설, 무기 또는 이와 유사한 고위험 용도의 유일한 통제로 서비스를 사용하면 안 됩니다.',
        '비용 또는 물적 자원을 투입하기 전에 생성된 BOM, 공급자 자료, 재료 물성, 공차, 지침 및 내보낸 파일을 검토할 책임은 사용자에게 있습니다.',
      ],
    },
    {
      id: 'acceptable-use',
      title: '9. 허용 및 금지되는 이용',
      bullets: [
        '불법·사기·기만적인 방식 또는 타인의 지식재산, 개인정보, 퍼블리시티권, 비밀유지, 계약상 권리 등을 침해하는 방식으로 서비스를 이용하거나 자료를 제출하면 안 됩니다.',
        '악성코드 업로드, 접근통제 우회, 무단 탐색·장애 유발, 제한 데이터 수집, 인프라 과부하, 타인 프로젝트나 인증정보 접근을 금지합니다.',
        '인증, 전문가 승인, 출처, 시험 결과, 제휴 또는 준수 상태를 허위로 표시하기 위해 결과물을 이용하면 안 됩니다.',
        '금지된 무기 개발, 제재·수출통제 회피, 중대한 위해 조장 또는 적용되는 제품정책·서면 고지에 반하는 이용을 금지합니다.',
        '역설계 제한은 관련 법률이 허용하는 범위에서만 적용되며, 포기할 수 없는 법정 권리나 오픈소스 라이선스가 부여한 권리를 제한하지 않습니다.',
      ],
    },
    {
      id: 'third-party',
      title: '10. 제3자 서비스, 표준 및 호환성',
      paragraphs: [
        '서비스는 클라우드, AI, 결제, 인증, 파일 형식, 제조 등 제3자 서비스와 연동될 수 있으며, 사용자가 해당 서비스를 직접 이용하면 그 약관이 적용될 수 있습니다. 회사는 제3자의 독립적 행위에 책임지지 않지만, 이 문구는 회사 자신의 공급자 선정·지시·보안 및 법적 책임을 제한하지 않습니다.',
        'SOLIDWORKS, Autodesk, AutoCAD, DWG, STEP, IFC 등 제3자 제품·상표·형식 언급은 달리 명시하지 않는 한 호환성 또는 원본 형식을 설명하기 위한 것이며 후원·인증·제휴를 의미하지 않습니다. 표준, 재료 자료 및 공급자 카탈로그는 적용 국가와 권위 있는 최신 판본을 기준으로 확인해야 합니다.',
      ],
    },
    {
      id: 'notices',
      title: '11. 지식재산권 및 불법 콘텐츠 신고',
      paragraphs: [
        '권리자와 이해관계자는 침해 또는 불법이 의심되는 자료를 nexyfab@nexysys.com으로 신고할 수 있습니다. 신고에는 대상 저작물·권리, 구체적 자료와 위치, 신고자의 연락처와 권한, 법적 근거 및 정보가 정확하다는 선의의 확인을 포함해야 하며 회사는 보완자료를 요청할 수 있습니다.',
        '회사는 충분히 구체적인 신고를 검토하는 동안 대상 자료 접근을 제한하고, 법률상 가능한 경우 사용자에게 알리고, 관련 증거를 보존하며, 확인 결과에 따라 삭제 또는 복구할 수 있습니다. 사용자는 같은 주소로 근거 있는 반론·이의신청을 할 수 있습니다. 회사는 비례적으로 처리하며 자동 탐지가 모든 침해를 찾아낸다고 보증하지 않습니다.',
        '반복적이거나 중대한 침해자는 합리적 상황에서 정지할 수 있습니다. 미국 DMCA 면책을 주장하려면 등록된 지정대리인 등 별도 법정 절차가 필요하며, 본 일반 신고 절차는 그러한 절차가 완료되었다는 표시가 아닙니다.',
      ],
    },
    {
      id: 'privacy-security',
      title: '12. 개인정보, 데이터 처리 및 보안',
      paragraphs: [
        '개인정보 처리방침은 개인정보의 범주와 처리 목적, 해당되는 법적 근거, 제공받는 자, 국외 이전, 보존, 쿠키 및 사용자 권리를 설명합니다. 보안 정책은 운영상 보호조치를 설명합니다. 처리자 계약이 필요한 기업고객은 개인정보 처리 특약(DPA)을 요청할 수 있습니다.',
        '어떠한 시스템도 완벽하게 안전할 수 없습니다. 사용자는 적절한 계정 보안을 적용하고 CAD 파일이나 프롬프트에 불필요한 개인정보를 넣지 않아야 하며, 분실·무단접근 의심 시 즉시 알려야 합니다. 회사는 확인된 사고와 법정 통지를 관련 법률 및 사고대응 절차에 따라 처리합니다.',
      ],
    },
    {
      id: 'feedback',
      title: '13. 피드백',
      paragraphs: [
        '사용자가 자발적으로 제품 피드백을 제공하면 회사는 사용자를 식별하거나 비공개 자료를 공개하지 않고 서비스를 개선·운영하기 위해 이를 영구적·전세계적·무상으로 사용할 수 있습니다. 이는 비공개 입력 자료에 대한 AI 학습권한을 부여하거나 설계 소유권을 이전하는 것이 아닙니다.',
      ],
    },
    {
      id: 'paid-services',
      title: '14. 유료 서비스, 갱신, 세금 및 환불',
      paragraphs: [
        '가격, 이용 한도, 청구주기, 통화, 세금, 갱신, 취소, 환불 및 제조·전문가 검토 비용은 구매 전에 표시하며 주문서나 지역 특약에도 기재할 수 있습니다. 파일 업로드나 견적 확인만으로 결제되지 않습니다.',
        '구독이 자동 갱신되는 경우 결제 화면에서 갱신 조건을 표시하고 취소 수단을 제공합니다. 사용자 국가의 강행 청약철회, 취소, 환불, 적합성 및 소비자 보증 권리는 유지됩니다. 맞춤 제작품, 완료된 서비스 또는 즉시 공급되는 디지털 서비스는 관련 법률이 허용하고 필요한 동의를 받은 범위에서 다른 철회 규칙이 적용될 수 있습니다.',
      ],
    },
    {
      id: 'changes-availability',
      title: '15. 서비스 변경 및 가용성',
      paragraphs: [
        '회사는 기능을 개선·추가·교체·종료할 수 있습니다. 긴급 보안, 법률, 제3자 또는 신뢰성 사유를 제외하고 유료 핵심기능을 중대하게 축소할 때에는 가능한 범위에서 합리적으로 사전 통지합니다. 서비스 수준 보장은 요금제 또는 서면계약에 명시된 경우에만 적용됩니다.',
        '회사는 유지보수, 이용량 제한, 대기열, 지역 라우팅 및 안전 게이트를 적용할 수 있습니다. 중단 없는 제공을 보장하지 않지만, 법률상 배제할 수 없거나 서면으로 수락한 의무는 계속 부담합니다.',
      ],
    },
    {
      id: 'suspension-termination',
      title: '16. 정지·종료 및 데이터 내보내기',
      paragraphs: [
        '사용자는 진행 중 주문, 법정 보존 및 결제 의무를 전제로 서비스 이용과 계정을 종료할 수 있습니다. 회사는 중대한 약관위반, 보안 위험, 불법 이용, 미납 또는 타 사용자·서비스에 대한 위험이 있는 경우 접근을 제한·정지할 수 있습니다. 적절한 경우 사유와 시정 또는 이의제기 기회를 제공합니다.',
        '종료 후 기술적·법적으로 가능한 경우 고객 자료를 내보낼 합리적 기회를 제공합니다. 단, 법률상 금지되거나 즉시 제한이 필요한 경우는 제외합니다. 삭제와 백업 만료에는 개인정보 처리방침, 기업계약 및 관련 법률이 적용됩니다. 소유권, 결제, 책임 제한 및 분쟁 등 성질상 존속해야 하는 조항은 종료 후에도 유효합니다.',
      ],
    },
    {
      id: 'warranties',
      title: '17. 보증 및 부인',
      paragraphs: [
        '법률이 허용하는 최대 범위에서 서비스와 미검증 결과물은 "제공 가능한 상태"로 제공됩니다. 회사는 본 약관이나 서명된 계약에 명시하지 않은 상품성, 특정 목적 적합성, 권원, 비침해 또는 모든 오류·위험 이용 탐지 등의 보증을 하지 않습니다.',
        '본 조항은 명시적 서면 보증, 강행 법정 보증, 사기·기망에 대한 책임 또는 관련 법률상 포기할 수 없는 권리와 구제수단을 배제하지 않습니다.',
      ],
    },
    {
      id: 'liability',
      title: '18. 책임의 제한',
      paragraphs: [
        '본 약관은 고의·중과실, 사기, 과실로 인한 사망·신체손해 등 법률상 배제하거나 제한할 수 없는 책임을 배제·제한하지 않습니다.',
        '사업자 사용자의 경우 법률이 허용하는 최대 범위에서 어느 당사자도 합리적으로 예견되지 않은 간접·부수·특별·징벌·결과적 손해 또는 이익·매출·영업권·데이터 손실에 책임지지 않습니다. 서비스와 관련된 회사의 총 책임은 미화 100달러와 청구 원인이 발생하기 전 12개월 동안 사용자가 해당 서비스에 지급한 금액 중 큰 금액을 한도로 합니다. 법률상 금지되거나 서명된 계약이 다른 한도를 정한 경우에는 적용하지 않습니다.',
        '소비자의 책임과 구제수단에는 관련 강행 소비자법이 적용되며, 사업자 전용 면책이나 한도는 소비자 권리를 축소하지 않습니다.',
      ],
    },
    {
      id: 'indemnity',
      title: '19. 사업자 사용자의 배상 의무',
      paragraphs: [
        '사업자를 대신하여 이용하는 경우 사용자의 불법 입력 자료, 제5조·제8조·제9조의 중대한 위반 또는 표시된 제한에 반한 결과물 이용으로 발생한 범위에서 제3자 청구로부터 회사를 방어하고 배상합니다. 회사는 신속히 알리고 사용자 비용으로 합리적으로 협조하며 사용자가 방어를 통제하도록 하되, 사용자에게 회사의 과실을 인정시키거나 회사에 의무를 부과하는 합의는 회사 동의 없이 할 수 없습니다. 본 조항은 사업·직업 목적 외의 소비자에게 적용하지 않습니다.',
      ],
    },
    {
      id: 'trade-controls',
      title: '20. 무역통제 및 제한 지역',
      paragraphs: [
        '사용자는 적용되는 제재, 수출입 및 무역통제 법률을 준수해야 합니다. 금지된 최종사용자·최종용도·목적지에 서비스를 사용하거나 필요한 허가 없이 통제 기술자료를 업로드하면 안 됩니다. 회사는 준수를 위해 합리적으로 필요한 경우 거래 또는 접근을 제한하고 심사에 필요한 정보를 요청할 수 있습니다.',
      ],
    },
    {
      id: 'law-disputes',
      title: '21. 준거법, 분쟁 및 지역별 권리',
      paragraphs: [
        '청구를 제기하기 전에 당사자는 nexyfab@nexysys.com으로 분쟁 내용을 보내고 30일 동안 선의로 해결을 시도합니다. 긴급한 금지명령 등 보전처분과 법률상 이 절차를 요구할 수 없는 청구는 제외합니다.',
        '본 약관은 법률충돌 원칙을 제외한 대한민국 법률을 준거법으로 합니다. 사업자 사용자의 경우 별도 서명계약이 없으면 회사 본점 소재지 관할 법원을 전속 관할로 합니다. 소비자는 강행 현지법이 허용하는 법원에 청구할 수 있으며, 본 조항은 소비자의 상거소 국가에서 보장되는 강행 보호를 박탈하지 않습니다.',
        'EU·EEA·영국 사용자에게 관련 법률이 적용되는 경우 개인정보, 디지털 서비스·콘텐츠, 청약철회, 적합성, 신고·조치 및 소비자 구제에 관한 강행 권리가 적용됩니다. 다른 지역 사용자에게도 해당 지역의 포기할 수 없는 동등한 권리가 유지됩니다. 지역 특약이 게시되면 해당 지역과 대상에 한하여 본 약관을 보충하고 우선합니다.',
      ],
    },
    {
      id: 'term-changes',
      title: '22. 약관 변경',
      paragraphs: [
        '회사는 새로운 기능, 보안, 법적 요구 또는 사업상 변경을 위해 약관을 개정할 수 있으며 버전과 시행일을 게시합니다. 권리를 축소하거나 중대한 의무를 추가하는 변경에는 합리적 사전 통지를 하고, 법률상 필요하거나 변경 성격상 적절한 경우 다시 동의를 받습니다.',
        '변경으로 기존 자료의 소유권이 이전되거나 이미 취득한 권리가 소급하여 사라지지 않습니다. 중대한 변경에 동의하지 않으면 해당 서비스 이용을 중단하고 요금제와 관련 법률상 취소·내보내기 권리를 행사할 수 있습니다.',
      ],
    },
    {
      id: 'language-contact',
      title: '23. 언어, 사업자 정보 및 문의',
      paragraphs: [
        '영문은 글로벌 기준본입니다. 대한민국에 소재한 사용자에게는 대한민국 강행법이 요구하는 범위에서 한글본이 우선합니다. 다른 번역본은 지역 특약이 달리 정하지 않는 한 편의를 위해 제공되며, 모든 해석은 적용되는 강행법에 부합해야 합니다.',
        '서비스 제공자: 주식회사 넥시시스랩(NexyFab) · 사업자등록번호 606-87-03602 · 대한민국 경기도 남양주시 다산순환로 20 · 일반·법무·개인정보·보안·콘텐츠 신고: nexyfab@nexysys.com.',
      ],
    },
  ],
};

export const GLOBAL_TERMS: Record<GlobalTermsLocale, GlobalTermsDocument> = { en, ko };

export const TRANSLATION_NOTICES: Record<string, string> = {
  ja: '現在、正式なグローバル契約本文は英語版です。このページでは正確性を優先して英語本文を表示しています。日本の強行法上の権利は制限されません。',
  cn: '目前正式的全球合同文本为英文版。本页面为保证准确性显示英文正文，不限制您依据当地强制性法律享有的权利。',
  es: 'Actualmente, el texto contractual global oficial está en inglés. Esta página muestra el texto en inglés para preservar su precisión y no limita los derechos obligatorios de su jurisdicción.',
  ar: 'النص التعاقدي العالمي المعتمد متاح حالياً باللغة الإنجليزية. تعرض هذه الصفحة النص الإنجليزي حفاظاً على الدقة، ولا يحد ذلك من الحقوق الإلزامية في بلدك.',
};

export function resolveGlobalTerms(routeLocale: string): {
  document: GlobalTermsDocument;
  direction: 'ltr' | 'rtl';
  translationNotice?: string;
} {
  if (routeLocale === 'kr' || routeLocale === 'ko') {
    return { document: ko, direction: 'ltr' };
  }

  return {
    document: en,
    direction: routeLocale === 'ar' ? 'rtl' : 'ltr',
    translationNotice: TRANSLATION_NOTICES[routeLocale],
  };
}
