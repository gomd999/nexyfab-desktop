import re
import os

page_tsx_path = r'c:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\src\app\[lang]\company-introduction\page.tsx'
with open(page_tsx_path, 'r', encoding='utf-8') as f:
    page_content = f.read()

# Update Ko
page_content = re.sub(
    r"sec1P2:\s*'<b>Nexysys</b>는 독자적인 산업 데이터.*?환경을 만들어 갑니다\.',",
    """sec1P2: '<b>Nexysys</b>는 치열한 <b>산업 현장(Industrial Field)</b>에서 직접 마주한 폐쇄적인 정보망과 비효율적 관행을 뼈저리게 느끼며 출발한 <b>AI 연구 집단(AI Research Group)</b>입니다.',\n        sec1P3: '현장에서 목격한 파편화된 제조 생태계의 구조적 문제를 데이터와 AI 기술로 근본부터 해결하고자, 우리는 B2B 제조 매칭 특화 브랜드인 <b>Nexyfab</b> 플랫폼을 구축했습니다.',\n        sec1P4: 'Nexysys의 심층적인 AI 연구 성과와 현장에 밀착된 Nexyfab 매칭 솔루션을 결합하여, 탁월한 아이디어가 현실로 가장 빠르고 완벽하게 구현되는 제조 환경을 만들어 갑니다.',""",
    page_content,
    flags=re.DOTALL
)

# Update En
page_content = re.sub(
    r"sec1P2:\s*'<b>Nexysys</b> is an <b>AI research group</b> dedicated to innovating.*?than ever\.',",
    """sec1P2: '<b>Nexysys</b> is an <b>AI research group</b> born from experiencing firsthand the closed information networks and inefficient practices on the frontline of the <b>industrial field</b>.',\n        sec1P3: 'Driven by the structural problems of the fragmented manufacturing ecosystem we witnessed on-site, we developed the <b>Nexyfab</b> B2B manufacturing platform brand to solve them fundamentally through data and AI.',\n        sec1P4: 'By combining Nexysys\'s deep AI research achievements with Nexyfab\'s field-oriented matching solutions, we create a premier manufacturing environment where brilliant ideas are swiftly and perfectly realized.',""",
    page_content,
    flags=re.DOTALL
)

# Update Ja
page_content = re.sub(
    r"sec1P2:\s*'<b>Nexysys</b>は、独自の産業データ.*?構築します。',",
    """sec1P2: '<b>Nexysys</b>は、熾烈な<b>産業現場（Industrial Field）</b>で直接目の当たりにした閉鎖的な情報網と非効率な慣行を痛感して発足した<b>AI研究集団（AI Research Group）</b>です。',\n        sec1P3: '現場で目撃した断片化された製造エコシステムの構造的問題を、データとAI技術で根本から解決するため、私たちはB2B製造プラットフォームブランド<b>Nexyfab</b>を構築しました。',\n        sec1P4: 'Nexysysの深層的なAI研究成果と、現場に密着したNexyfabのマッチングソリューションを組み合わせることで、卓越したアイデアが最も迅速かつ完璧に実現される製造環境を構築します。',""",
    page_content,
    flags=re.DOTALL
)

# Update Zh
page_content = re.sub(
    r"sec1P2:\s*'<b>Nexysys</b> 是一家致力于通过독.*?成为现实。',",
    """sec1P2: '<b>Nexysys</b> 是一个 <b>AI 研究团队 (AI Research Group)</b>，诞生于我们在激烈的<b>工业现场</b>亲身体验到的封闭信息网络和低效实践。',\n        sec1P3: '为了从根本上通过数据和人工智能解决我们在现场目睹的碎片化制造生态系统的结构性问题，我们推出了 B2B 制造平台品牌 <b>Nexyfab</b>。',\n        sec1P4: '通过将 Nexysys 的深度 AI 研究成果与 Nexyfab 面向现场的匹配解决方案相结合，我们正在创造一个先进的制造环境，让卓越的想法能够最快、最完美地成为现实。',""",
    page_content,
    flags=re.DOTALL
)

# Zh regex might have failed due to previous substitutions. Let's do a more robust one if needed.
# I will just write back the whole content and see if regex matched.
with open(page_tsx_path, 'w', encoding='utf-8') as f:
    f.write(page_content)

print("DONE")
