import requests
import json

api_key = "sk-98bc23abe14c4735b04b7f3e886e6d98"

with open(r"c:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\src\app\[lang]\company-introduction\page.tsx", 'r', encoding='utf-8') as f:
    page_content = f.read()

prompt = f"""
다음은 Nexyfab의 회사소개 페이지 React (Next.js) 소스 코드입니다. 최근 CEO 소개를 제거하고 'Nexysys & Nexyfab Ecosystem' 이라는 서비스 생태계 소개로 개편했습니다.
이 소스코드를 보고, 프로덕트 디자이너이자 B2B SaaS 전문가의 관점에서 UI/UX 레이아웃 부족한 점, 카피라이팅 개선점, 혹은 구조적 제안사항을 3~5가지 정도 한국어로 요약해 주세요.

```tsx
{page_content}
```
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
            {"role": "system", "content": "당신은 뛰어난 웹 프로덕트 디자이너이자 B2B 전문가입니다."},
            {"role": "user", "content": prompt}
        ]
    }
)

if response.status_code == 200:
    with open("deepseek_out.md", "w", encoding="utf-8") as f:
        f.write(response.json()['choices'][0]['message']['content'])
else:
    print("Error:", response.text)
