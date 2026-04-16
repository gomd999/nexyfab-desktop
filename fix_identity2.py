import re
import os

page_tsx_path = r'c:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\src\app\[lang]\company-introduction\page.tsx'
with open(page_tsx_path, 'r', encoding='utf-8') as f:
    page_content = f.read()

# Update Ko
page_content = re.sub(
    r"ceoLabel:\s*'기업 정체성'.*?sec1P4:.*?해결해 나갑니다\.',",
    """ceoLabel: '기업 정체성',\n        ceoQuote: '“제조업의 미래를 설계하는 솔루션 혁신 기업, 주식회사 넥시시스(Nexysys)입니다.”',\n        ceoName: 'About Nexysys',\n        sec1P2: '<b>Nexysys</b>는 산업 데이터와 선도적인 AI 기술을 기반으로 복잡한 제조업의 의사결정을 혁신하는 기술 기업입니다.',\n        sec1P3: '우리는 파편화된 글로벌 제조 생태계의 구조적 문제를 해결하기 위해, B2B 제조 매칭 특화 브랜드인 <b>Nexyfab</b> 플랫폼을 독자적으로 구축하여 서비스하고 있습니다.',\n        sec1P4: 'Nexysys의 강력한 인프라 알고리즘과 Nexyfab의 매칭 솔루션을 통해, 세상을 바꿀 아이디어가 가장 빠르고 완벽하게 현실이 되는 쾌진격의 제조 환경을 만들어 갑니다.',""",
    page_content,
    flags=re.DOTALL
)

# Update En
page_content = re.sub(
    r"ceoLabel:\s*'Corporate Identity'.*?sec1P4:.*?ecosystem\.',",
    """ceoLabel: 'Corporate Identity',\n        ceoQuote: '“Nexysys, the innovative tech company designing the future of manufacturing.”',\n        ceoName: 'About Nexysys',\n        sec1P2: '<b>Nexysys</b> is a technology company that innovates decision-making in the complex manufacturing industry using industrial data and advanced AI.',\n        sec1P3: 'To solve the structural pain points of the fragmented global manufacturing ecosystem, we have independently built and operated the <b>Nexyfab</b> platform, a B2B manufacturing matching brand.',\n        sec1P4: 'Through Nexysys\'s powerful infrastructure algorithms and Nexyfab\'s matching solutions, we are creating a manufacturing environment where world-changing ideas become reality faster and more perfectly than ever.',""",
    page_content,
    flags=re.DOTALL
)

# Update Ja
page_content = re.sub(
    r"ceoLabel:\s*'企業アイデンティティ'.*?sec1P4:.*?解決しています\。',",
    """ceoLabel: '企業アイデンティティ',\n        ceoQuote: '「製造業の未来を設計する革新的なテクノロジー企業、株式会社Nexysysです。」',\n        ceoName: 'About Nexysys',\n        sec1P2: '<b>Nexysys</b>は、産業データと最先端のAI技術を活用して、複雑な製造業の意思決定を革新するテクノロジー企業です。',\n        sec1P3: '断片化したグローバル製造エコシステムの構造的課題を解決するため、我々はB2B製造マッチング特化ブランドである<b>Nexyfab</b>プラットフォームを独自に構築し、サービスを提供しています。',\n        sec1P4: 'Nexysysの強力なインフラアルゴリズムとNexyfabのマッチングソリューションにより、世界を変えるアイデアが最も迅速かつ完璧に現実となる製造環境を構築します。',""",
    page_content,
    flags=re.DOTALL
)

# Update Zh
page_content = re.sub(
    r"ceoLabel:\s*'企业身份'.*?sec1P4:.*?痛点\。',",
    """ceoLabel: '企业身份',\n        ceoQuote: '“Nexysys：设计制造业未来的创新科技企业。”',\n        ceoName: 'About Nexysys',\n        sec1P2: '<b>Nexysys</b> 是一家以工业数据和先进的AI技术为基础，致力于创新复杂制造业决策的科技企业。',\n        sec1P3: '为了解决碎片化的全球制造生态系统的结构性痛点，我们独立构建并运营了 B2B 制造匹配专有品牌 <b>Nexyfab</b> 平台。',\n        sec1P4: '通过 Nexysys 强大的基础设施算法和 Nexyfab 的匹配解决方案，我们正在创造一个先进的制造环境，让改变世界的想法能够最快、最完美地成为现实。',""",
    page_content,
    flags=re.DOTALL
)

with open(page_tsx_path, 'w', encoding='utf-8') as f:
    f.write(page_content)

print("DONE")
