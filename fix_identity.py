import os
import re

page_tsx_path = r'c:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\src\app\[lang]\company-introduction\page.tsx'
with open(page_tsx_path, 'r', encoding='utf-8') as f:
    page_content = f.read()

# Fix JSX dangerous inner html for sec1P3
page_content = page_content.replace('<p>{t.sec1P3}</p>', '<p dangerouslySetInnerHTML={{ __html: t.sec1P3 }} />')

# Update Ko
page_content = re.sub(
    r"ceoLabel:\s*'우리의 서비스'.*?sec1P4:.*?결해 나갑니다\.',",
    """ceoLabel: '기업 정체성',\n        ceoQuote: '“주식회사 Nexysys가 설계하고, 제조 플랫폼 Nexyfab이 현실로 만듭니다.”',\n        ceoName: 'Nexysys & Nexyfab',\n        sec1P2: '<b>Nexysys</b>는 산업 데이터와 AI 기술을 기반으로 복잡한 제조업의 의사결정을 혁신하는 기술 <b>기업(Company)</b>입니다.',\n        sec1P3: '<b>Nexyfab</b>은 Nexysys의 비전을 담아 탄생한 글로벌 제조 매칭 <b>브랜드(Brand)</b>로, 파편화된 프로세스를 하나로 연결하는 핵심 플랫폼입니다.',\n        sec1P4: '우리는 강력한 기술력(Nexysys)과 검증된 B2B 플랫폼(Nexyfab)을 결합하여 글로벌 산업 생태계의 구조적인 문제를 해결해 나갑니다.',""",
    page_content,
    flags=re.DOTALL
)

# Update En
page_content = re.sub(
    r"ceoLabel:\s*'Our Services'.*?sec1P4:.*?ecosystem\.',",
    """ceoLabel: 'Corporate Identity',\n        ceoQuote: '“Designed by Nexysys the company, realized by Nexyfab the platform.”',\n        ceoName: 'Nexysys & Nexyfab',\n        sec1P2: '<b>Nexysys</b> is a technology <b>company</b> that innovates decision-making in the complex manufacturing industry using industrial data and AI.',\n        sec1P3: '<b>Nexyfab</b> is the global manufacturing matching <b>brand</b> born from Nexysys\'s vision, acting as an end-to-end platform connecting fragmented processes.',\n        sec1P4: 'By combining our solid technological foundation (Nexysys) with our proven B2B platform (Nexyfab), we resolve structural pain points throughout the global industrial ecosystem.',""",
    page_content,
    flags=re.DOTALL
)

# Update Ja
page_content = re.sub(
    r"ceoLabel:\s*'私たちのサービス'.*?sec1P4:.*?決します\。',",
    """ceoLabel: '企業アイデンティティ',\n        ceoQuote: '「株式会社Nexysysが設計し、プラットフォームNexyfabが実現します。」',\n        ceoName: 'Nexysys & Nexyfab',\n        sec1P2: '<b>Nexysys</b>は、産業データとAI技術を活用して複雑な製造業の意思決定を革新するテクノロジー<b>企業(Company)</b>です。',\n        sec1P3: '<b>Nexyfab</b>は、Nexysysのビジョンを体現して生まれたグローバル製造マッチング<b>ブランド(Brand)</b>であり、断片化したプロセスを一つに繋ぐプラットフォームの役割を果たします。',\n        sec1P4: '確かな技術力(Nexysys)と検証されたプラットフォーム(Nexyfab)を組み合わせることで、グローバル産業エコシステム全体の構造的な課題を解決しています。',""",
    page_content,
    flags=re.DOTALL
)

# Update Zh
page_content = re.sub(
    r"ceoLabel:\s*'我们的服务'.*?sec1P4:.*?痛点\。',",
    """ceoLabel: '企业身份',\n        ceoQuote: '“由 Nexysys 公司设计，由 Nexyfab 平台实现。”',\n        ceoName: 'Nexysys & Nexyfab',\n        sec1P2: '<b>Nexysys</b> 是一家利用工业数据和人工智能创新复杂制造业决策的科技<b>公司(Company)</b>。',\n        sec1P3: '<b>Nexyfab</b> 是承载 Nexysys 愿景而生的全球制造匹配<b>品牌(Brand)</b>，作为连接碎片化流程的端到端(End-to-End)平台。',\n        sec1P4: '通过将我们坚实的技术基础(Nexysys)与久经验证的B2B平台(Nexyfab)相结合，我们正在解决整个全球工业生态系统的结构性痛点。',""",
    page_content,
    flags=re.DOTALL
)

# Update Flow diagram JSX directly
old_diagram_code = """                                <p>Sovereign Intelligence<br/>산업 데이터 & AI 지능형 의사결정 체계 구축</p>
                            </div>
                        </div>
                        <div className="ci-eco-arrow">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="#0b5cff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                        <div className="ci-eco-node ci-eco-indigo">
                            <div className="ci-eco-glow"></div>
                            <div className="ci-eco-node-content">
                                <h4>Nexyfab</h4>
                                <p>End-to-End Orchestration<br/>검증된 제조사 매칭 및 프로젝트 전주기 관리</p>"""

new_diagram_code = """                                <p><strong style={{color:'#0056ff'}}>The Company</strong><br/>제조업의 의사결정을 혁신하는 기술 회사</p>
                            </div>
                        </div>
                        <div className="ci-eco-arrow">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="#0b5cff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                        <div className="ci-eco-node ci-eco-indigo">
                            <div className="ci-eco-glow"></div>
                            <div className="ci-eco-node-content">
                                <h4>Nexyfab</h4>
                                <p><strong style={{color:'#4f46e5'}}>The Brand (Platform)</strong><br/>기획부터 양산까지 연결하는 B2B 플랫폼</p>"""

page_content = page_content.replace(old_diagram_code, new_diagram_code)

with open(page_tsx_path, 'w', encoding='utf-8') as f:
    f.write(page_content)

print("DONE")
