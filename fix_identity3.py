import re
import os

page_tsx_path = r'c:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\src\app\[lang]\company-introduction\page.tsx'
with open(page_tsx_path, 'r', encoding='utf-8') as f:
    page_content = f.read()

# Update Ko
page_content = re.sub(
    r"ceoQuote:\s*'“제조업의 미래를 설계하는 솔루션 혁신 기업[^']*”',\s*ceoName:\s*'About Nexysys',\s*sec1P2:\s*'<b>Nexysys</b>는[^']*기업입니다\.',",
    """ceoQuote: '“제조업의 미래를 설계하는 산업 AI 연구 집단, 주식회사 넥시시스(Nexysys)입니다.”',\n        ceoName: 'About Nexysys',\n        sec1P2: '<b>Nexysys</b>는 독자적인 산업 데이터와 심층적인 AI 모델 연구를 바탕으로 복잡한 제조업의 난제와 의사결정을 혁신해 나가는 <b>AI 연구 집단(AI Research Group)</b>입니다.',""",
    page_content,
    flags=re.DOTALL
)

# Update En
page_content = re.sub(
    r"ceoQuote:\s*'“Nexysys, the innovative tech company designing[^']*”',\s*ceoName:\s*'About Nexysys',\s*sec1P2:\s*'<b>Nexysys</b> is a technology company[^']*AI\.',",
    """ceoQuote: '“Nexysys, the industrial AI research group designing the future of manufacturing.”',\n        ceoName: 'About Nexysys',\n        sec1P2: '<b>Nexysys</b> is an <b>AI research group</b> dedicated to innovating complex manufacturing decision-making through proprietary industrial data and deep AI research.',""",
    page_content,
    flags=re.DOTALL
)

# Update Ja
page_content = re.sub(
    r"ceoQuote:\s*'「製造業の未来を設計する革新的なテクノロジー企業[^']*」',\s*ceoName:\s*'About Nexysys',\s*sec1P2:\s*'<b>Nexysys</b>は[^']*企業です。',",
    """ceoQuote: '「製造業の未来を設計する産業AI研究集団、株式会社Nexysysです。」',\n        ceoName: 'About Nexysys',\n        sec1P2: '<b>Nexysys</b>は、独自の産業データと深層的なAIモデル研究を基盤とし、複雑な製造業の難題と意思決定を革新していく<b>AI研究集団（AI Research Group）</b>です。',""",
    page_content,
    flags=re.DOTALL
)

# Update Zh
page_content = re.sub(
    r"ceoQuote:\s*'“Nexysys：设计制造业未来的创新科技企业。”',\s*ceoName:\s*'About Nexysys',\s*sec1P2:\s*'<b>Nexysys</b> 是一家[^']*企业。',",
    """ceoQuote: '“Nexysys：设计制造业未来的工业AI研究团队。”',\n        ceoName: 'About Nexysys',\n        sec1P2: '<b>Nexysys</b> 是一家致力于通过独有的工业数据和深度 AI 模型研究，创新复杂制造业难题和决策的 <b>AI 研究团队 (AI Research Group)</b>。',""",
    page_content,
    flags=re.DOTALL
)

# Update the diagram box text (from "The Company / 제조업의 의사결정을 혁신하는 기술 회사" to "AI Research Group / ...")
page_content = page_content.replace(
    "<strong style={{color:'#0056ff'}}>The Company</strong><br/>제조업의 의사결정을 혁신하는 기술 회사",
    "<strong style={{color:'#0056ff'}}>AI Research Group</strong><br/>제조업 난제를 해결하는 산업 AI 연구 조직"
)

with open(page_tsx_path, 'w', encoding='utf-8') as f:
    f.write(page_content)

print("DONE")
