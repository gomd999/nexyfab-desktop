# Agent · MCP · CLI capability inventory and HOLD backlog — 2026-08-23

이 문서는 API 파일 수를 제품 지원 범위로 오인하지 않기 위한 공개 표면 기준선이다. 라우트가 존재한다는 사실만으로 Agent, MCP 또는 CLI 지원을 주장하지 않는다.

## 재현된 현재 표면

| 표면 | 실제 수 | 판정 기준 |
|---|---:|---|
| CAD v1 route files | 83 | `src/app/api/cad/v1/**/route.ts` |
| CAD v1 advertised operations | 42 | `GET /api/cad/v1/capabilities` |
| CAD v1 advertised CLI commands | 34 | capability의 non-null `cli`와 `CAD_V1_CLI_COMMANDS` exact match |
| repository local MCP tools | 90 | `scripts/drawing-to-3d/mcp-server.mjs`의 실제 `tools` export |
| downloadable remote MCP tools | 15 | `public/downloads/nexyfab-mcp.mjs`를 실행한 실제 `tools/list` |
| installer sidecar tools | 8 | installer-core policy 및 실제 sidecar surface |
| robot route files | 25 | `src/app/api/cad/v1/robot/**/route.ts` |
| advertised robot operations | 1 | `robot generate` / `generate_robot_6axis`만 공개 |

다운로드형 원격 MCP의 정확한 15개 이름은 다음과 같다.

`design_assembly`, `compose_part`, `edit_part`, `face_drag`, `part_op`, `domain_design`, `analyze_fea`, `reconstruct_verify`, `reconstruct_fleet`, `code_check`, `verify_domain`, `interior_check`, `landscape_check`, `bridge_check`, `load_path`.

저장소 로컬 MCP의 90개와 다운로드형 15개는 서로 다른 제품 표면이다. 로컬 전용과 원격 전용 도구도 있으므로 한쪽 이름을 다른 쪽에서 지원한다고 안내하지 않는다.

## HOLD인 미노출 CAD v1 라우트 40개

아래 라우트는 구현이 없다는 뜻이 아니다. Agent/MCP/CLI 상용 공개에 필요한 독립 계약이 아직 완결되지 않았으므로 capability에 허위 추가하지 않는다는 뜻이다.

- 건축·일조·서비스 오프닝 8개: `architecture/daylight/{package,results,run,status,verify}`, `architecture/interior/edit`, `architecture/service-openings/sync`, `architecture/verify`
- 조립 릴리스 1개: `assembly/release/verify`
- 상용 영수증 2개: `generation/commercial-receipts`, `generation/commercial-receipts/requests`
- IFC deep roundtrip 1개: `ifc/deep-roundtrip`
- 인테리어 2개: `interior/layout/edit`, `interior/verify`
- MEP 1개: `mep/route`
- 공간 CAD 1개: `spatial/command`
- 로봇 24개: cable life, catalog admit/housing-fit/select, compliance, dynamics, engineering analyze/coverage, integration apply/post-verify/prepare/review, life, motion coverage, physical, precision, release audit/final-review/verified-audit/work-packet, requirements, reverify, safety electrical, thermal

`/api/cad/v1/capabilities` 자체는 discovery 라우트이므로 위 40개 HOLD 계산에서 제외한다.

## 공개 전 완료 조건

각 HOLD 라우트는 다음을 모두 만족한 뒤에만 capability, MCP 또는 CLI에 추가한다.

1. 입력 스키마가 exact-key, bounded string/array/object/depth/bytes 정책을 갖고 서버 라우트와 동일하다.
2. 인증, 조직·프로젝트 권한, read/apply/export scope와 side-effect 분류가 명시된다.
3. Agent/MCP notification은 실행되지 않고, 요청은 직렬화되며 오류·응답은 민감정보를 반사하지 않는다.
4. CLI는 실제 명령, exit code, timeout, 입력·응답 byte cap, path/symlink containment를 검증한다.
5. API·MCP·CLI normalized response parity 테스트가 같은 fixture와 실패 조건을 통과한다.
6. 공개 개발자 문서와 실제 downloadable/built `tools/list`가 exact match한다.
7. 제조·현장·전문가·상용 release 증거가 없는 기능은 `HOLD`/`NOT_RUN`을 보존하며 PASS 또는 release-ready로 승격하지 않는다.

회귀 검사는 `scripts/drawing-to-3d/capability-surface-manifest.test.ts`가 담당한다. 현재 route 목록이 바뀌면 테스트가 실패하며, 새 라우트를 공개할지 HOLD에 둘지 명시적으로 결정해야 한다.
