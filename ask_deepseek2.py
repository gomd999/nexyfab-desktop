import requests
import json

api_key = "sk-98bc23abe14c4735b04b7f3e886e6d98"

prompt = """
현재 웹사이트의 '회사소개' 섹션에 3x3 형태의 Bento Grid 레이아웃을 만들었습니다.
- 카드 1 (2x2 크기, 좌측 상단): VISION (개발 장벽을 낮춘다)
- 카드 2 (1x1 크기, 우측 상단): MISSION (AI와 데이터 기반 의사결정)
- 카드 3 (1x1 크기, 우측 중단): VALUE (연결보다 판단을 먼저 함)
- 카드 4 (2x1 크기, 좌측 하단): PROMISE (무리한 매칭은 지양)
- 카드 5 (1x1 크기, 우측 하단): 현재 공백 또는 신뢰성 지표 영역

질문:
우측 하단의 이 1x1 크기 5번째 카드 영역에 어떤 콘텐츠(텍스트 카피, 아이콘 구성, 지표 등)와 어떤 시각적 스타일(예: 솔리드 컬러 배경, 애니메이션 등)을 넣어야 전체적인 B2B SaaS 느낌의 Bento Grid가 가장 아름답고 신뢰감 있게 완성될까요?
전문가 관점에서 3가지 이내로 팩트 위주의 제안과 개선점을 한국어로 요약해 주세요.
"""

response = requests.post(
    "https://api.deepseek.com/chat/completions",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    },
    json={
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": "당신은 웹 벤토 그리드(Bento Grid) 레이아웃 전문가이자 B2B 포지셔닝 전문가입니다."},
            {"role": "user", "content": prompt}
        ]
    }
)

if response.status_code == 200:
    with open("deepseek_out2.md", "w", encoding="utf-8") as f:
        f.write(response.json()['choices'][0]['message']['content'])
else:
    print("Error:", response.text)
