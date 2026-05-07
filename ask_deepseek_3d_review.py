"""
NexyFab 3D 툴 전체 리뷰 — DeepSeek에 의견 요청
- 디렉토리 구조 + 핵심 파일 시그니처 + 최근 16개 개선 작업 요약을 컨텍스트로 전달
- DeepSeek가 시니어 CAD/3D 툴 PM 관점에서 추가 개선 제안을 제공
"""
import os
import requests
import json
from pathlib import Path

API_KEY = "sk-98bc23abe14c4735b04b7f3e886e6d98"
BASE = Path(r"C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\src\app\[lang]\shape-generator")

# ── 1. 디렉토리 트리 (3 depth) ─────────────────────────────────────────────
def build_tree(root: Path, max_depth: int = 3, depth: int = 0) -> str:
    lines = []
    if depth > max_depth:
        return ""
    try:
        entries = sorted(root.iterdir(), key=lambda p: (p.is_file(), p.name))
    except Exception:
        return ""
    for p in entries:
        if p.name in ('__tests__', 'node_modules', '.next'):
            continue
        prefix = "  " * depth
        if p.is_dir():
            lines.append(f"{prefix}{p.name}/")
            lines.append(build_tree(p, max_depth, depth + 1))
        else:
            if p.suffix in ('.tsx', '.ts'):
                lines.append(f"{prefix}{p.name}")
    return "\n".join([l for l in lines if l])

tree = build_tree(BASE)

# ── 2. 핵심 파일 라인 수 통계 ────────────────────────────────────────────
def count(p: Path) -> int:
    try:
        return sum(1 for _ in open(p, 'r', encoding='utf-8'))
    except Exception:
        return 0

key_files = {
    'page.tsx': BASE / 'page.tsx',
    'ShapePreview.tsx': BASE / 'ShapePreview.tsx',
    'SketchCanvas.tsx': BASE / 'sketch' / 'SketchCanvas.tsx',
    'CommandToolbar.tsx': BASE / 'CommandToolbar.tsx',
    'panels/RightPanel.tsx': BASE / 'panels' / 'RightPanel.tsx',
    'panels/LeftPanel.tsx': BASE / 'panels' / 'LeftPanel.tsx',
    'analysis/DFMPanel.tsx': BASE / 'analysis' / 'DFMPanel.tsx',
    'analysis/FEAPanel.tsx': BASE / 'analysis' / 'FEAPanel.tsx',
    'analysis/simpleFEA.ts': BASE / 'analysis' / 'simpleFEA.ts',
    'analysis/dfmAnalysis.ts': BASE / 'analysis' / 'dfmAnalysis.ts',
    'features/index.ts': BASE / 'features' / 'index.ts',
    'shapes/index.ts': BASE / 'shapes' / 'index.ts',
    'workers/feaWorker.ts': BASE / 'workers' / 'feaWorker.ts',
}
file_sizes = "\n".join(f"  {name}: {count(p):,} lines" for name, p in key_files.items())

# ── 3. 최근 작업 요약 (이번 세션 16개) ────────────────────────────────────
recent_work = """
최근 한 세션에 진행한 16개 UX/UI 개선:
1. ⌨️ 단축키 도움말 모달 (?, Shift+F1 컨텍스트 헬프)
2. 🔍 ⌘K 커맨드 팔레트 힌트 버튼 (툴바)
3. 🛠 DFM 자동 수정 버튼 (이슈 → setParam 직접 적용)
4. ⏳ 비동기 작업 진행 표시 (DFM/FEA/CSG/Pipeline 통합 progress pill)
5. 📱 분석 패널 모바일 풀스크린 리플로우 (768px 미만)
6. 👆 모바일 숫자 입력 −/+ 스테퍼 버튼 (36×36px)
7. 🎚 바텀시트 드래그 제스처 (속도 기반 스냅)
8. 🚀 파라미터 슬라이더 드래그 중 LOD (edgeGeometry 제거)
9. 🌅 HDR 환경 프리셋 카테고리화 (Studio/Outdoor/Industrial)
10. 🪞 메탈릭 실시간 프리뷰 스와치 (radial-gradient)
11. 💎 인라인 업셀 툴팁 + 🔒 PRO 배지 (DFM/AI/IPShare)
12. 🔒 Export 포맷 잠금 UI (STEP/GLTF/DXF/Rhino/Grasshopper)
13. ⚠️ Worker 에러 바운더리 (try/catch + toast)
14. ✅ 스케치 프로파일 검증 (열림/끝점 갭 사전 차단)
15. 📐 측정 중 치수 인라인 입력 (line/circle/rect/polygon)
16. 🧲 FEA 제약 3D 인터랙티브 마커 (앵커/화살표 + 클릭)
"""

# ── 4. 주요 기능 도메인 요약 ──────────────────────────────────────────────
domain_summary = """
NexyFab 3D 툴 핵심 도메인:
- 파라메트릭 셰이프: 100+ 프리미티브 (구멍, 플랜지, 풀리, 기어, 캠 등)
- 스케치 모드: 2D 드로잉 → 압출/회전/스윕/로프트
- 피처 트리: Boolean, Fillet, Chamfer, Shell, Pattern, Mirror, Mold tools
- CAD I/O: STEP/STL/IGES/BREP 임포트, OCCT 통합
- 분석: DFM (제조성), FEA (응력), Print Analysis (3D프린팅), 모달, 열, 토폴로지 최적화
- 협업: Y.js 실시간, Pin Comments, IP Share Link
- 견적/RFQ: 자동 견적, 공급사 매칭, BOM, Quick Quote
- 어셈블리: Mate, Interference, Exploded View, Motion Study
- 어노테이션: GD&T, 치수, AutoDrawing, Smart Dimension
- 렌더링: PBR, HDR 환경, Photorealistic 모드
- 협력 채널: 고객 포털, 파트너 게시판, STEP/이미지/PDF 미리보기
- 플랜: Free / Pro / Team / Enterprise (기능 게이팅)
- 데스크톱: Tauri v2 데스크톱 앱 0.1.0
"""

prompt = f"""당신은 SolidWorks, Fusion 360, Onshape, Shapr3D 같은 메이저 CAD 툴을 다년간 사용해본 시니어 프로덕트 매니저이자 3D 툴 UX 전문가입니다.

저는 NexyFab이라는 웹 기반 SaaS CAD/3D 툴을 만들고 있고, 방금 한 세션에서 16개의 UX 개선을 마쳤습니다.

## 프로젝트 구조 (shape-generator/)

```
{tree}
```

## 핵심 파일 라인 수
{file_sizes}

## 도메인 요약
{domain_summary}

## 방금 마친 16개 개선
{recent_work}

---

위 내용을 바탕으로, **시니어 CAD 툴 PM의 관점**에서 다음을 한국어로 답변해 주세요:

1. **현재 가장 우선순위가 높은 추가 개선 10가지** — 단순 UI 폴리시가 아니라 실제 사용자가 일하면서 막히는 지점을 해결하는 것
2. **Fusion 360 / SolidWorks 사용자가 NexyFab을 처음 써봤을 때 "이게 없어서 못 쓰겠다"고 할 만한 5가지** — 핵심 기능 갭
3. **page.tsx가 5,965줄**입니다. SketchCanvas.tsx도 2,682줄입니다. **리팩터링 우선순위와 분리 전략** — 어떤 순서로 어떤 모듈로 분리할지 구체적으로
4. **무료 플랜 사용자가 Pro로 전환되게 만드는 핵심 후크** 3가지 — UX 트리거 관점
5. **모바일/태블릿 사용성에서 데스크톱 CAD 대비 가장 부족한 부분** 3가지 — 이미 #5/#6/#7로 일부 보완했지만 여전히 부족한 것

각 항목은 **구체적이고 실행 가능한** 제안이어야 합니다. "더 좋게 만들어라" 같은 추상적 답변은 피하세요. 가능하면 어떤 파일/컴포넌트를 어떻게 손대야 하는지 명시해 주세요.
"""

print(f"[INFO] Sending prompt: {len(prompt):,} chars")

response = requests.post(
    "https://api.deepseek.com/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": "당신은 CAD/3D 툴 분야의 시니어 프로덕트 매니저이자 UX 전문가입니다. SolidWorks, Fusion 360, Onshape, Shapr3D, Rhino, Blender 등을 깊이 다뤄봤고, 웹 기반 SaaS CAD 트렌드를 잘 알고 있습니다. 답변은 항상 구체적이고 실행 가능한 제안으로 합니다."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 8000,
    },
    timeout=180,
)

if response.status_code == 200:
    content = response.json()['choices'][0]['message']['content']
    out_path = Path(r"C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new\deepseek_3d_review.md")
    out_path.write_text(content, encoding='utf-8')
    print(f"\n[OK] Saved to: {out_path}\n")
    print("=" * 80)
    print(content)
else:
    print("[ERROR]", response.status_code, response.text)
