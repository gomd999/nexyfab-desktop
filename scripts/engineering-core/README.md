# NexyFab Engineering Core — 분야별 계산기 + AI 연동 (Wave 1.5)

`docs/strategy/domain-expansion-plan.md` §7(분야 모듈)·§8(AI-네이티브 인터페이스)의 실행 골격.
**LLM=계획, 결정론=계산**: AI는 이 도구를 호출만 하고, 수치는 전부 코드가 낸다.

## 구성

- `calculators/` — 분야별 결정론 계산기 (intent 게이트: 입력검증→계산→판정→조항인용)
  - `retaining_wall_stability` (토목 P2) — 옹벽 전도·활동·지지력, 근거 코퍼스 EM 1110-2-2502/GEC11 ✅
  - `column_buckling` (가설·랙 P1) — AISC E3/KDS 14 31 동형식 휨좌굴
  - `simple_beam` (P1/P3 공용) — 휨·전단·처짐 (LTB 미포함 게이트 명시)
  - `bolt_connection` (P1/P3 공용) — 지압형 전단·지압, 근거 SBDH Vol.14 ✅
- `standards/` — **튜닝 레이어**: φ·안전율·Fnv·처짐한계 전부 JSON — 코드 수정 없이 계수 조정/기준 추가
  - `aisc360.json` (파라미터 확정) / `kds.json` (**draft** — KDS 원문 확보 후 조항 대조 필요, 결과에 `standardDraft:true` 자동 표기)
- `test/golden.test.mjs` — 골든벤치 12케이스 (손계산 독립검증). 실행: `npm test`
- `mcp-server.mjs` — **MCP 서버**: 계산기 4종 + `eng_rag_search`(코퍼스 검색) + `eng_list_standards`
- 의존성 0 (RAG 검색만 `../knowledge-crawler`의 인덱스·임베딩 재사용)

## Claude 연동 (지금 바로)

```sh
claude mcp add nexyfab-eng -- node "C:/Users/gomd9/Downloads/nexysys_1/nexyfab.com/new/scripts/engineering-core/mcp-server.mjs"
```

이후 Claude가 자연어 요구("높이 4m 옹벽, 뒤채움 φ30° 안정 검토해줘")를 받으면 →
`eng_rag_search`로 기준 조항 찾고 → `retaining_wall_stability` 호출 → 수치·판정·조항 인용이 있는 검토서 작성.
Claude Desktop은 `claude_desktop_config.json`의 `mcpServers`에 같은 command로 등록.

## 다른 AI 서비스 연동 (Wave 2 — API key 발급)

MCP는 로컬/개발용. 상용은 동일 레지스트리를 Cloudflare Worker로 노출:
1. `POST /v1/calc/{id}` + `GET /v1/rag/search` — 요청/응답 스키마는 MCP tool과 동일
2. API key 발급: D1 `api_keys`(키 해시·org·플랜·rate limit) — NexyFab 계정과 연결
3. OpenAI function-calling / LangChain tool 스펙 JSON 자동생성 (inputSchema 그대로 재사용)
4. 과금: 계산기 호출량 + RAG 쿼리량 (Workers AI neuron 원가 연동)

## 정직성 게이트 (필수 준수)

- 모든 결과에 `"구조 검토 참고자료(비법정)"` 라벨 — 법정 계산서는 기술사 날인 영역
- 계산기 `status: draft` — **§7.0 공개 게이트(공인 예제 골든벤치 ≥10/계산기) 충족 전까지 상용 미노출**
- 범위 밖 입력은 게이트가 throw (세장비>200, 기하 모순, 하중 0 등) — 조용한 외삽 금지
- 미포함 한계상태는 `notes`에 명시 (LTB, 비틀림좌굴, 블록전단, 수동토압 등)

## 재실행

```sh
cd scripts/engineering-core
npm test                                # 골든벤치 12케이스
node mcp-server.mjs                     # MCP 서버 (stdio)
```

## 분야 확장 절차 (§7.0 4게이트)

1. `calculators/<new>.mjs` 작성 (inputSchema+run+refs) → `registry.mjs` import 1줄
2. `standards/*.json`에 필요한 계수 추가 (튜닝 가능해야 함)
3. `test/golden.test.mjs`에 공인 예제 케이스 추가
4. 코퍼스 태그 추가 수집 (`../knowledge-crawler/sources.json`)
→ MCP/API에는 자동 노출 (레지스트리 순회)
