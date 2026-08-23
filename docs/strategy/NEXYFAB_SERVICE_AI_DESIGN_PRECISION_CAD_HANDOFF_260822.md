# NexyFab 서비스·AI 설계·정밀 CAD 통합 현황 및 다음 세션 인계서

- 기준 시각: 2026-08-22 13:10 KST
- 작업 저장소: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new`
- 현재 브랜치/HEAD: `release/2026-08-10` / `3d6ba1ec461169d9d331b939e432483c3953b752`
- 문서 목적: 새 Codex 세션이 서비스 평가부터 기계설계·복합기계·건축·토목·조경·인테리어의 AI 설계와 정밀 CAD 구현을 바로 이어가기 위한 단일 기준선
- 이 문서는 소스 구현·테스트·운영 관찰을 요약한 인계 문서다. 외부 전문가 승인, 법규 적합성 인증, 실제 제작 적합성 인증을 대신하지 않는다.

## 0-A. 2026-08-22 연속 실행 업데이트

이 절은 아래 최초 인계 시점보다 최신이며, 상충하는 이전 수치는 이 절을 우선한다.

- 작업트리 체크포인트를 `%LOCALAPPDATA%\Temp\nexyfab-workspace-checkpoint-2026-08-21T18-07-19-867Z`에 보존했다. reset·checkout·대량 삭제는 하지 않았다.
- `commercial-release-baseline-current.json`을 현재 작업트리로 재생성한다. 상태·manifest 집계 변경 경로·`releaseCommitAllowed`와 deployable 파일 수/hash의 authoritative 값은 해당 JSON만을 기준으로 하며, production 배포 필드는 의도적으로 `null`로 유지한다. 이 문서 자체가 hash 입력이므로 변동하는 숫자와 hash를 여기에는 복제하지 않는다.
- 6언어 공식 i18n 회귀는 7개 파일 40/40 통과했다. 더 넓은 `i18n` 검색 회귀에서 단위·식별자에 일본어/중국어 count suffix가 붙는 공통 catalog localizer 결함 2건을 추가 발견해 수정했고, 확장 기준선은 30개 파일 224/224로 증가해 모두 통과했다.
- 기계·건축·인테리어·토목·조경 정확도 게이트는 각각 49/49, 99/99, 84/84, 85/85, 72/72로 합계 389/389 통과했다.
- 건축·인테리어 회귀는 실제 OCCT STEP 생성과 analytic cylinder slab service-opening subtraction을 포함해 39개 파일 244/244 통과했고, TypeScript(8 GB heap)와 변경 파일 ESLint도 오류 0으로 통과했다. 직전 전체 `src` ESLint의 기존 경고는 240건이었다. production build도 정적 페이지 292/292, shared 723.5/795.7 KB, worst first-paint 1759.8/1851.5 KB, 157개 측정 route로 통과했다. 동적 dependency 경고 1건과 local `REDIS_URL` 미설정 경고는 남지만 budget 실패는 아니다.
- OpenAI provider에는 strict JSON Schema 응답 형식을 연결했고, 서버가 authoritative project/proposal envelope를 다시 바인딩하며 결정론적 검증 실패 시 한 번만 제한적으로 교정 재시도한다.
- 스테이징 전체 수명주기에서 발견된 두 실제 결함을 수정했다: interior exact receipt 해시 검증의 `vendorShapeFidelity` 누락, 숫자로 시작할 수 있는 실제 UUID actor ID의 승인 바인딩 거절.
- Railway staging `candidate-20260822-006` 배포 `49971020-f1ab-4d5f-b13d-96b2420b5849`가 `SUCCESS`이고, live build ID·Postgres·Redis readiness가 모두 정상이다.
- 스테이징 일회성 Pro 계정에서 AI proposal → 명시 승인 concept commit → 실제 OCCT exact → quantity/drawing/IFC bundle → readback → 새 세션 reconnect → project/account cleanup 전체 E2E가 통과했다. credentials와 transient project는 남지 않았다.
- production은 변경하지 않았다. production 변수는 값 노출 없이 read-only 점검했으며 DB·Redis·object storage·AI provider·approval/session/JWT/admin/cron/Server Actions는 존재하지만 generation evidence signing secret, reCAPTCHA allowed hosts, native CAD external worker, commercial mode는 미충족이다.
- Railway production/staging 환경 격리는 실제 read-only audit 30/30으로 통과했고 secret 값은 출력하지 않았다.
- Wave 1 내부 계약은 reference/regression/holdout의 모든 평가 분할 hash 중복을 차단하고 malformed reviewer 입력을 예외 없이 fail-closed로 처리한다. 실제 license와 독립 reviewer approval은 계속 `HOLD`다.
- Wave 2 내부 폐루프는 concept edit 뒤 stale이 된 최신 model source만 동일 ID·현재 revision·geometry hash로 재바인딩해 quantity/drawing/IFC bundle을 재생성한다. 이전 stale history는 되살리지 않고 locked dependency는 계속 차단한다. stable selection/reconnect 입력은 malformed payload를 `INVALID_SELECTION`으로 fail-closed 처리하며, reconnect history는 edit·undo·redo 의미를 재실행해 재해시된 위조 snapshot도 거절한다.
- Live Inspector는 승인된 Apply 응답이 client-safe 문서/evidence/좌표/artifact graph 검증, 정확한 revision `+1`, 변경된 content hash, 같은 artifact graph revision, 기존 산출물 stale 조건을 모두 만족해야만 saved/event 상태로 전환한다.
- project-scoped architecture/interior undo/redo API와 compact 영속 history store를 추가했다. editor 권한·origin·명시 승인·revision/content-hash CAS를 강제하고 workspace CAS와 ledger append를 한 DB transaction으로 묶는다. ledger는 snapshot을 중복하지 않고 revision/hash 참조만 최대 1,000건 보존하며, 현재 head가 ledger와 갈라지면 undo/redo를 닫는다. Live Inspector도 서버 `canUndo/canRedo`, 승인 challenge/retry, Apply 뒤 이력 재결속, reconnect refresh, viewer 차단을 6언어로 연결했고 UI 집중 회귀 8/8을 통과했다. 실제 인증 브라우저에서 `apply → undo → reconnect → redo`를 실행하는 E2E는 아직 `NOT_RUN/HOLD`다.
- exact-clash 장시간 Job은 project/creator/idempotency key와 요청 hash에 영속 결속하고 프로젝트당 활성 작업 2개를 DB transaction으로 제한한다. editor만 queue/cancel할 수 있고, durable cooperative cancel은 stale worker 완료 저장을 차단한다. UI는 authoritative `{active, limit}`와 취소를 표시하며 이를 결제 quota나 외부 프로세스 강제 종료로 주장하지 않는다. 실제 worker 운영·재시도 비용·production quota 검증은 `NOT_RUN/HOLD`다.
- Wave 3/4 내부 범위에는 승인형 civil/landscape atomic executor와 stable-ID 의미 편집이 확대됐다. civil은 survey control, point, surface/TIN 정의, alignment, profile, cross-section, corridor, catchment, drainage node/link, structure를, landscape는 terrain modifier, plant, planting zone, hardscape, soil volume, irrigation node/pipe/zone, drainage path, maintenance zone을 plan → challenge → approval → execute → verify → receipt로 수정한다. no-op·위조 승인·stale CAS·중복 ID·참조/geometry 오류를 차단하고 shared revision artifact를 stale 처리한다. 실제 TIN rebuild/grading/hydraulic solver와 외부 roundtrip은 계속 `TARGET/HOLD`다.
- 토목·조경 output truth 계약은 format/MIME, workspace revision/hash, artifact bytes hash, parser source/output hash, 허용된 verifier evidence hash를 결속한다. 실제 exporter와 parser를 직접 호출하는 LandXML execution probe가 exact Line/Curve/Spiral 개수와 모든 hash 결속을 통과했고, 기존 parser 3/3·exporter self-test 5/5도 통과했다. claim은 항상 `releaseReady: false`이며 외부 Civil 3D/OpenRoads·CRS/terrain/corridor 왕복은 `HOLD`다.
- 토목 횡단은 alignment line/arc/spiral과 cross-section station/point를 동일 revision/hash에 결속한 결정론적 내부 JSON artifact와 strict parser/verifier를 추가했다. 실제 exporter/parser/verifier bytes를 재해시하는 probe만 `PARTIAL/VERIFIED`이며 DXF/PDF/native·현장 좌표 비교는 `HOLD/NOT_RUN`이다.
- 조경 관개 일정은 실제 exporter→독립 parser probe로 stable node/pipe/zone ID와 8개 row/object, revision/content/artifact/source hash를 결속했다. 이는 내부 JSON schedule만 `PARTIAL/VERIFIED`이며 hydraulic·field evidence는 `NOT_RUN`, external interoperability는 `HOLD`, `releaseReady: false`다.
- 조경 식재 일정도 실제 exporter→독립 parser probe로 plant/planting-zone/soil stable ID, 4개 row/object, species·설치 높이·성숙 수관·근권·간격·수량과 모든 source/output hash를 결속했다. 실제 plant catalog provenance·native/external 왕복·현장 증거는 `HOLD/NOT_RUN`, `releaseReady: false`다.
- 인테리어 RCP는 ceiling/opening/ceiling-system/light를 동일 workspace·문서 hash에 결속하는 결정론적 구조화 artifact와 독립 parser/verifier를 추가했다. 상층 절대 표고, host, 공간 경계, stable ID, stale model input 변조를 fail-closed로 검증하지만 native DWG/DXF/PDF·외부 parser·현장 검토는 `HOLD`다.
- 건축 입면과 exact-plane 수직 단면은 line/arc 벽, 개구부 host 구간, slab/ceiling 교차, 상층 절대 표고를 동일 workspace·문서/model-input hash에 결속한 구조화 내부 artifact와 strict parser/verifier를 추가했다. 곡선 극점, directed arc cut, stale opening position/interval/높이를 fail-closed로 검증하지만 native DWG/DXF/PDF·외부 CAD·architect/field review는 `HOLD/NOT_RUN`이다.
- 건축 grid는 stable ID로 이름·축·시작점·끝점을 승인형 atomic transaction에서 수정하고, stair는 생성/수정 시 from/to storey와 절대 Z endpoint, 폭·디딤판·챌면 수, 좌표 프레임 parent 재결속을 검증한다. concept-only shaft와 elevator도 생성/수정, 상승 storey 순서, host space, 비자기교차 shaft footprint, shaft/served-storey 범위, 좌표 프레임 재결속을 catalog·executor·browser gateway·server approval route와 revision/hash CAS에 연결했다. wall/slab host를 가진 round service opening도 source route/sleeve, 중심·단위축, 직경·깊이·firestop annulus, 선택적 structural approval ID를 stable-ID 생성/수정·CAS·승인 route로 연결했다. 수직 slab과 수평·사선 wall opening은 sampled circle이 아니라 실제 OCCT arbitrary-axis analytic cylinder를 midpoint 보정 후 host B-rep에서 subtract하고, 폐쇄 솔리드 `MANIFOLD_SOLID_BREP`, 최종 host STEP hash와 전체 opening binding을 receipt·artifact store에 결속한다. elevator sizing/code compliance, shaft/elevator exact solid, native drawing/IFC/quantity와 실제 구조 승인 권위는 계속 `HOLD/TARGET`이다.
- 인테리어 finish와 millwork는 stable ID, space/host, surface/material, 위치·크기·clearance를 승인형 생성/수정 route에 연결했고 no-op·잘못된 host·위조 승인·stale CAS를 원자적으로 거절한다. 이는 의미 편집 계약이며 실제 제품 catalog·가격·시공/현장·exact geometry 자격은 `HOLD/NOT_RUN`이다.
- 건축 door/circulation 내부 verifier는 architecture document/revision/content hash, stable route/space/door ID, 다중 문의 정확한 순서·카디널리티, door-space/storey/host 결속, caller-supplied door·accessible-route 치수, 연결 공간 안의 sampled swing/clearance envelope와 연속 path를 검사한다. line-wall과 directed arc-wall route가 실제 `[offset, offset + width]` door aperture를 strict side-to-side로 통과하는지 검증하며 away/missing/ambiguous crossing을 거절한다. 선택적 interior/명시 obstacle은 source revision/hash에 결속하고 회전 clearance envelope의 공간 포함, route OBB 및 swing 충돌을 fail-closed로 검사한다. 빈·malformed·stale route와 sample/path budget 우회도 차단하지만 권위 법규, native CAD/BIM, 실제 현장 및 release 판정은 포함하지 않는다.
- 토목 profile PVI는 기존 id-less 문서 호환성을 유지하면서, ID를 가진 profile에서는 모든 PVI가 stable ID를 가져야 하며 전체 profile edit가 ID 집합을 제거·교체하지 못하게 했다. `edit_profile_point`는 profile 소유권, station strict order/range, elevation, 승인·CAS·artifact stale을 검증한다. stable-ID vertical curve도 profile/PVI 소유권, 양수 길이와 station 범위, overlap·PVI 중복 소유를 검증하는 생성/수정 계약에 연결했다. alignment별 stable-ID superelevation region은 시작/끝 station, 좌·우 경사율, 범위·비중첩·소유권과 alignment segment station 연속성을 생성/수정·CAS에서 검사한다. optional stable-ID corridor target도 surface/alignment/offset/elevation 역할, corridor station 범위, surface allowlist, 상호배타 필드와 역할별 overlap을 승인형 생성/수정에 연결했다. 별도 종곡선 evaluator는 인접 stable PVI 접선으로 대칭 포물선의 PVC/PVT 표고, station별 표고·경사, crest/sag, K값을 결정론적으로 계산하고 caller-supplied 설계속도/K/최대경사 기준을 `pass/fail/not_run`으로 분리한다. 이는 법규표를 내장하거나 권위 판정을 주장하지 않으며 native profile/corridor editor, 실제 corridor/grading 적용, 편경사 계산, 외부 solver/roundtrip과 survey/field 증거는 `HOLD`다.
- 건축·인테리어 manual 요구사항은 office/apartment/cafe 3개 시나리오의 6개 atomic row로 보강했다. 각 row는 stable lineage와 manual source SHA-256을 가지지만 실제 workspace revision/hash, license/provenance/reviewer receipt는 `null/HOLD`, `scoreEligible: false`로 고정하며 validator와 3개 회귀가 이를 fail-closed로 검사한다.
- 인테리어 finish schedule과 FF&E schedule은 실제 exporter→독립 parser probe로 workspace/document revision, space·finish/furniture·row stable ID, host surface, 위치·치수·회전·clearance를 source/output/verifier hash에 결속한다. 내부 JSON schedule만 `PARTIAL/VERIFIED`이며 실제 catalog·가격·BOQ·native/external 왕복은 `HOLD`, 현장 검토는 `NOT_RUN`이다.
- 토목 종단은 alignment/profile의 line·arc·spiral과 PVI station을 결속한 내부 JSON artifact를, earthwork는 기존/계획 surface point와 sampled grid·cell·cut/fill/net 수량을 결속한 내부 JSON artifact를 추가했다. 실제 exporter/parser/calculator source와 출력 bytes를 재해시하지만 earthwork replay는 같은 checked-in calculator를 사용하므로 독립 수치 검증이 아니다. 둘 다 `PARTIAL/VERIFIED`, `releaseReady: false`이며 CRS/datum·survey/TIN/grading/corridor·native/external·현장/계약 수량은 `HOLD/NOT_RUN`이다.
- 기계 30기능 영수증 검증기는 첫 10개 실행 대상에 동일 campaign 시각·비어 있지 않은 검증 증거를 요구하고, 아직 동결된 20개는 `NOT_RUN`·영수증 0개만 허용한다. 알 수 없는/중복/non-object 행과 증거 없는 거짓 `PASS`는 거절하며 실제 영수증 수는 계속 0/30이다.
- 기계 product scope assessment는 저장소 상대 증거 경로의 real path를 다시 확인해 외부 symlink/junction을 통한 source/evidence 주입을 거절한다. 현재 실제 assessment는 `private_beta_evidence_pending`이며 외부 영수증은 추가되지 않았다.
- 기계 direct-design package는 STEP·drawing·BOM 검증 영수증을 exact artifact hash, design/requirements revision, verifier evidence hash에 결속하고 역할별 서로 다른 신뢰 Ed25519 키로 서명해야 한다. 임의 verifier 문자열, 자체 주장 PASS, 역할 재사용, 미래 시각, releaseEligible 위조는 거절한다. 실제 verifier private key·외부 제작/검사는 추가하지 않았고 actual package/feature receipt는 계속 0/30이다.
- 시공 domain은 concrete/rebar/formwork/schedule object와 revision/source payload를 SHA-256 provenance로 결속하고 재가격·중복/빈 object ID 변조를 거절한다. 명시적 workspace revision/content hash와 legacy-derived 식별자를 `bindingMode: workspace_explicit | legacy_derived`로 구분해 hash에 포함하며, 어느 쌍이든 반쪽 입력은 거절한다. workspace-explicit 두 revision의 객체 role/source hash로 added/removed/changed/unchanged와 quantity/schedule change-impact를 결정론적으로 재도출하며, lineage·증가 revision·binding hash·행/집계 변조를 fail-closed 검사한다. fixture 결과와 change-impact는 실제 비용·procurement·현장·계약 증거를 `NOT_RUN`/`NOT_APPLICABLE`로 명시하고 항상 `releaseEligible: false`다.
- 상업 승급은 계속 `BLOCK/HOLD`다. local preflight 12 blocker, 기계 실제 feature receipt 0/30, STEP C4 독립 왕복 증거 부재가 확인됐다. 라이선스 685개, kernel identity, CAD API controls 81/81은 통과했다.

## 0-B. 2026-08-22 정밀 계약 교정 및 최종 검증

- Luna 구현 → Sol adversarial review → Luna 교정을 반복해 시공, ECAD/MCAD, 배수, 도로 corridor, 기초/지반, 조경 관개/식재, millwork, HVAC, cable tray/conduit, robot cell, CNC, 건축 stair/opening/roof/vertical transport 계약을 보강했다.
- 내부 JSON parser 성공과 독립 parser attestation을 분리했다. `internalParserVerified`는 내부 canonical parser만 의미하고, 독립 서명·도구 버전 증거가 없으면 `parserVerified: false`, `releaseReady: false`, `HOLD`다.
- artifact/receipt는 실제 bytes 재파싱, canonical payload/content/artifact SHA-256, workspace revision/content hash, stable ID·소유권, 계산 기준과 verifier evidence를 다시 결속한다. 호출자 제공 `status: passed`만으로 receipt를 만들 수 없게 했다.
- 배수 Manning/HGL/freeboard/cover, 도로 arc/station/XY 연속성, 기초 bearing/spacing/cover, 관개 valve→emitter 경로·손실·표고·공급수두·최소압력을 verifier가 재계산한다. simulator, authority, field evidence, native roundtrip은 계속 `HOLD`다.
- HVAC/cable은 실제 centerline 기반 보수적 AABB, route/segment/port/support 소유권과 endpoint gap을 검사한다. exact arc가 없는 cable interior bend는 근사 반경으로 통과시키지 않고 `bend_geometry_not_verified`로 거절한다.
- robot은 등록된 bounded serial chain, terminal tool attachment, parent rotation과 fixture clearance에 더해, 주입된 swept-geometry checker가 모든 인접 motion frame 구간을 확인했는지와 continuous collision-free 여부를 명시적으로 분리한다. checker가 없으면 `continuousCollisionVerified: false`로 유지하고 잘못된 sample period는 빈 경로 성공 대신 fail-closed한다. motion coverage는 governed path hash, 전체 frame/segment bytes와 swept evidence artifact hash의 combination/aggregate SHA-256 binding을 재계산하고, 업로드된 각 evidence bytes를 서버가 다시 SHA-256으로 검증한다. 최종 verified-systems audit도 이 binding, `sweptEvidenceArtifactsVerified: true`, `continuousCollisionCoverageComplete: true`를 직접 요구해 endpoint/frame-only·binding 없는 receipt·바이트 누락/불일치를 거절한다. 실제 독립 exact B-rep backend 산출 evidence, 일반 3D dynamics/OEM/safety/현장 검증은 `HOLD`다. CNC는 drill tool/depth/removed volume과 swept cutter/holder collision을, millwork는 part/joint/machining 전체 extent를 검사한다.
- 건축 exact receipt는 identity frame만 지원하고 shape kind/ID/source hash/bbox/expected volume을 요청에서 재계산한다. flat roof opening/drain boolean은 실제 OCCT로 확인했지만 sloped roof와 scupper penetration은 근사 생성하지 않고 명시적으로 unsupported 처리한다. 공용 adapter의 독립 STEP 재수입은 아직 없어 외부 roundtrip은 `HOLD`다.
- 최종 집중 통합 회귀는 15개 파일 80/80 통과했고 실제 OCCT STEP 생성 경로를 포함한다. `npm run typecheck`와 대상 ESLint도 오류 0으로 통과했다.
- 마지막 변경까지 포함한 `npm run build`는 exit 0으로 통과했다. 정적 페이지는 292/292, shared chunk는 723.5/795.7 KB, worst first-paint는 1759.8/1851.5 KB, 측정 App Router entry는 157개다. `scripts/drawing-to-3d/verify.mjs`의 동적 dependency 경고 1건과 local `REDIS_URL` 미설정 경고는 남아 있으며, production 배포 전 `REDIS_URL`을 반드시 확인해야 한다.
- 공식 i18n은 7개 파일 40/40, 확장 i18n은 30개 파일 224/224, 분야 정확도는 기계 49 + 건축 99 + 인테리어 84 + 토목 85 + 조경 72 = 389/389, 공통 정확도/후보 게이트는 67/67 통과했다.
- 독립 review kit 6개는 구조적으로 유효하지만 모두 `releaseEligible: false`다. platform은 100 case·서명 0/200, 각 분야 kit는 20 case·서명 0/40이다. validator 기본 모드는 release eligibility를 판정해 현재 exit 1이며, 구조만 검사하려면 `--structural-only`를 명시해야 한다.
- commercialization gate는 단순 `{ok:true}` 영수증을 신뢰하지 않고 review-kit 실제 path/hash/validator 결과, 7일 운영 receipt의 v3 schema·168시간·sample/window·production build binding, expert receipt의 channel·서로 다른 reviewer·hash binding을 검사한다. 현재 dirty RC, production identity, 실제 holdout/서명/운영 증거가 없어 private beta와 GA는 모두 `BLOCK`이다.
- `deploy:railway:verified`는 실제 `railway up` 전에 `commercial:release-gate`와 `commercialization:gate`를 모두 통과해야 한다. 전자는 95% domain campaign과 서로 다른 신뢰 reviewer의 이중 서명 evidence를 검사하며, 현재 증거가 없으므로 배포 경로는 fail-closed다.
- 건축 exact receipt의 STEP 문자열/SHA와 생성 시 OCCT bbox·체적 검사는 내부 self-consistency 증거다. 공용 adapter에 STEP 재수입 인터페이스가 없어 네 계약 모두 `independent_step_reimport_not_run`을 명시하며 독립 STEP 검증으로 주장하지 않는다.
- 이 문서의 현재 상대경로 링크는 48/48 유효하다.
- 이번 연속 실행에서는 production 배포를 하지 않았다.

최신 증거:

- [스테이징 전체 수명주기 영수증](../evidence/staging/architecture-interior-lifecycle-candidate-20260822-006.json)
- [스테이징 배포 바인딩 영수증](../evidence/staging/architecture-interior-deployment-candidate-20260822-006.json)
- [production 설정 presence audit](../evidence/release/production-configuration-presence-audit-260822.json)
- [Railway 환경 격리 audit](../evidence/release/railway-environment-isolation-260822.json)
- [현재 release baseline](../evidence/release/commercial-release-baseline-current.json)

## 0. 새 세션에서 가장 먼저 읽을 결론

NexyFab은 현재 **운영 배포된 브라우저 서비스이자, 여러 CAD 도메인의 큰 구현 후보가 들어 있는 개발 스냅샷**이다. 그러나 전체 상업 출시나 전 분야 완성형 CAD로 판정할 상태는 아니다.

현재 가장 정확한 표현은 다음과 같다.

1. production liveness와 Railway 배포 상태는 정상이다.
2. 기계 CAD는 가장 많은 직접 편집·정확 형상·조립·도면·제조 기능을 가지고 있지만, 상업 자격 증거는 아직 부족하다.
3. 건축·인테리어는 AI 제안 → 명시적 승인/저장 → exact OCCT 승급 → 수량·도면·IFC 산출 흐름이 구현됐고 로컬 핵심 회귀가 통과한다.
4. 건축·인테리어의 실제 외부 소스 골든 캠페인, IFC 외부 왕복, 가격, 법규, 전문가 release는 아직 완료되지 않았다.
5. 토목·조경·시공은 의미 모델, 계산·검증 모듈과 일부 생성기가 있으나 완성형 직접 편집 CAD와 정밀 산출 폐루프는 부족하다.
6. 6개 언어 라우팅과 현재 자동 i18n 감사 40/40은 통과했지만 사이트 전체 육안·RTL·이메일/PDF/export 검증은 남아 있다.
7. 작업트리가 매우 크고 dirty 상태이므로 다음 기능 추가 전에 변경 기준선과 소유권을 고정해야 한다.

## 1. 판정 용어

| 상태 | 의미 |
|---|---|
| `PASS` | 현재 대상과 환경에서 실제 실행해 통과한 증거가 있음 |
| `PARTIAL` | 핵심 계약 또는 일부 흐름은 구현됐지만 전체 폐루프·범위가 부족함 |
| `HOLD` | 구현은 있어도 외부·운영·전문가·제작 증거가 부족해 승급할 수 없음 |
| `NOT_RUN` | 이번 기준에서 실제 환경 또는 실제 입력으로 실행하지 않음 |
| `BLOCK` | 조건을 충족하지 않으면 성공이나 release로 승격하지 않도록 차단됨 |
| `TARGET` | 프로필·UI·계획에는 있으나 실제 지원으로 주장하면 안 되는 목표 계약 |

“테스트가 있다”, “타입이 있다”, “버튼이 있다”, “파일을 생성했다”는 사실만으로 `PASS` 또는 제조·시공 release가 되지 않는다.

## 2. 저장소와 배포 기준선

### 2.1 Git 상태

2026-08-22 점검 당시의 `1,325`는 **파일 수가 아니라 Git status 항목 수**다. Git의 짧은 상태 출력에서는 미추적 디렉터리가 하위 파일을 펼치지 않고 하나의 항목으로 접힐 수 있다.

원래 문서 작성 직전 snapshot:

- 수정: 788개
- 삭제: 2개
- 미추적 Git status 항목: 535개(미추적 디렉터리 하위 항목은 축약될 수 있음)
- 합계: 1,325개 Git status 항목

이 인계 문서를 추가한 뒤 현재 snapshot:

- 수정: 788개
- 삭제: 2개
- 미추적 Git status 항목: 536개
- 합계: 1,326개 Git status 항목
- 미추적 leaf 파일: 1,661개
- dirty leaf 경로 합계(수정·삭제·미추적 leaf): 2,451개

따라서 `1,325` 또는 `1,326`을 실제 dirty 파일 수로 해석하면 안 된다. Wave 0에서 status-entry snapshot과 leaf 파일 목록을 함께 보존해 재현 가능한 RC 기준선을 만든다.

현재 `commercial-release-baseline-current.json`은 2026-08-22 재생성본이다. 상태·manifest 집계·release 허용 여부의 authoritative 값은 JSON을 직접 확인하며, production 배포 identity 필드는 staging 증거와 혼동하지 않도록 `null`로 유지한다.

이번 연속 실행 직후 별도 Git 재점검은 축약 status 1,411개, 수정 806개, 삭제 2개, 미추적 leaf 1,743개, dirty leaf 합계 2,551개다. 아래 최초 1,325/1,326 수치는 당시 스냅샷 설명으로만 유지하며 현재 수치로 해석하지 않는다.

현재 production 배포는 성공했지만 이 거대한 작업 스냅샷은 HEAD 하나로 재현되지 않는다. 따라서 다음 세션의 첫 작업은 기능 추가보다 다음을 우선한다.

1. 사용자 소유 변경과 이번 개발 변경을 분리한다.
2. 임시 파일, 생성 산출물, 증거, 실제 배포 파일을 분류한다.
3. 현재 성공 배포와 로컬 소스의 해시·마이그레이션·환경 구성을 묶은 후보 기준선을 만든다.
4. 전체를 임의로 reset, checkout, 삭제하지 않는다.

### 2.2 Railway와 production

Railway에서 확인한 `nexyfab.com` 서비스:

| 환경 | 최신 배포 | 상태 | 생성 시각(UTC) |
|---|---|---|---|
| staging | `49971020-f1ab-4d5f-b13d-96b2420b5849` (`candidate-20260822-006`) | `SUCCESS`, live/ready 정상 | 2026-08-21T21:42:58.476Z |
| production | `cf509f59-dfc8-49cb-8e19-09ddcf3cd5e8` | `SUCCESS`, 실행 중 | 2026-08-21T16:44:14.937Z |

운영 관찰:

- `https://nexyfab.com/api/health/live/`: HTTP 200
- `/en/shape-generator/`, `/ar/shape-generator/`, `/kr/shape-generator/`, `/cn/shape-generator/`: 최종 HTTP 200이지만 현재 공개 비인증 접근은 각 언어 랜딩의 `#nf-chat`으로 이동한다.
- 따라서 “CAD 화면이 production에서 인증 사용자에게 완전 동작한다”는 판정은 이번 점검에서 `NOT_RUN`이다.
- 다음 배포 전에는 실제 Pro 계정으로 로그인해 AI 제안, 저장, exact 승급, artifact 생성, 재접속 복구를 브라우저 E2E로 확인해야 한다.

### 2.3 최근 architecture/interior 배포 내용

최근 배포 후보에는 다음이 포함된다.

- migration ID `2026082201`
- 브라우저 AI 설계 제안과 승인 전 비영속 candidate
- 명시적 승인 후 project revision 저장
- 개념 수정 transaction
- Node OCCT 기반 exact geometry 승급과 STEP evidence
- private artifact 저장소와 compact reference
- 수량, 도면, IFC artifact transaction
- 건축·인테리어 precision CAD agent tool catalog/browser gateway
- 6개 언어용 건축·인테리어 UI copy

## 3. 현재 서비스 평가

| 영역 | 현재 판정 | 확인 내용 | 남은 핵심 |
|---|---|---|---|
| production liveness | `PASS` | health 200, Railway production 최신 배포 `SUCCESS` | 장애·복구·부하·7일 운영 영수증 |
| 공개 사이트 | `PARTIAL` | 6개 canonical 언어 경로와 랜딩 응답 | 전 페이지 semantic i18n 완료, 접근성·모바일 전체 회귀 |
| 인증·Pro CAD | `PASS`(staging) / `NOT_RUN`(production) | staging 일회성 Pro 계정 전체 수명주기와 cleanup 통과 | production Pro 사용자 E2E |
| AI provider | `PARTIAL` | OpenAI 우선 provider와 로컬 fallback 구조, candidate/approval 흐름 | 운영 과금·quota·timeout·provider 장애·Claude adapter 실제 E2E |
| exact CAD | `PASS`(로컬+staging 범위) | 실제 OCCT manifold STEP과 staging exact promotion 통과 | 전 기능 exact 폐루프, 외부 독립 왕복, 대형 모델 안정성 |
| artifact persistence | `PASS`(staging 범위) / `PARTIAL`(release) | staging private exact artifact와 quantity/drawing/IFC bundle 저장·조회·재연결·삭제 통과 | production E2E, 장애 복구, 외부 roundtrip |
| 다국어 | `PASS`(자동 40/40) / `PARTIAL`(전체 제품) | `kr`, `en`, `ja`, `cn`, `es`, `ar`; `ko→kr`, `zh→cn` canonical redirect | 사이트 전체 육안/RTL·이메일/PDF/export 검증 |
| 상업 출시 | `BLOCK/HOLD` | fail-closed gate와 내부 회귀 | dirty RC, 기계 자격, 실제 holdout, 제조·전문가·운영 증거 |

## 4. 제품 원칙: AI 설계와 정밀 CAD를 분리하되 연결한다

### 4.1 AI 설계

AI 설계는 사용자의 자연어·이미지·도면·요구사항을 받아 설계안을 만드는 영역이다.

필수 흐름:

```text
authoritative brief/input
  → AI proposal/candidate
  → candidate preview + assumptions + NOT_RUN 표시
  → 사용자 승인
  → immutable project revision commit
  → 직접 수정 또는 AI refinement
  → 검증·산출은 현재 revision에만 바인딩
```

원칙:

- 제안 단계는 원본 프로젝트를 변경하지 않는다.
- 사용자 lock과 직접 입력값이 후속 AI 수정에 우선한다.
- AI가 값·재료·법규·카탈로그·시험 근거를 추측해 release evidence를 만들지 않는다.
- 실패 항목만 bounded repair하고 전체 설계를 임의 축약하지 않는다.
- AI 생성 완료와 exact CAD 완료, release 완료는 별도 상태다.

### 4.2 정밀 CAD

정밀 CAD는 AI 또는 사용자가 내부 CAD 도구를 agentic하게 호출해 정확 형상과 제조·시공 산출물을 만드는 영역이다.

필수 흐름:

```text
committed semantic revision
  → capability/tool planning
  → 승인 challenge
  → exact kernel command
  → B-Rep/topology/unit/relationship verification
  → STEP/IFC/DXF/PDF/schedule/BOM artifacts
  → artifact graph + hash + revision receipt
  → independent/release gates
```

원칙:

- 웹 브라우저만으로 기본 사용자 흐름이 가능해야 한다.
- 설치형 앱은 선택적 가속·오프라인·로컬 native CAD bridge이며 필수 조건이 아니다.
- GPT·Claude 등은 브라우저에 비밀키를 두지 않고 서버 provider adapter 또는 project-scoped connector로 연결한다.
- MCP/CLI/API도 같은 도구 계약을 사용할 수 있지만, 호출 표면이 다르다는 이유로 검증을 우회하지 않는다.
- mesh/preview와 exact B-Rep을 구분한다.
- proprietary native 형식은 실제 변환기·라이선스·왕복 증거 전에는 지원으로 표시하지 않는다.

## 5. 공통 구현 현황

### 5.1 구현된 공통 기반

- 5개 설계 프로필: `mechanical`, `building`, `civil`, `landscape`, `interior`
- 공통 evidence 축: requirements, unit/coordinate, semantic object, geometry, relationship, provenance, revision, output consistency
- unified project/revision 및 artifact graph
- AI candidate와 explicit commit 계약
- transaction, approval, receipt, hash 바인딩
- manual edit protection과 사용자 lock
- 프로젝트 저장소와 private artifact 계약
- browser precision CAD agent gateway/tool catalog
- MCP/CLI/API 표면과 CAD v1 capability 계약
- OCCT/Replicad/OpenSCAD/STEP/IFC 관련 여러 실행 경로
- 실패를 `NOT_RUN`, `BLOCKED`, `ERROR`로 유지하는 fail-closed release 정책

### 5.2 아직 공통으로 남은 것

1. 모든 분야의 stable object selection과 동일한 Inspector UX
2. `선택 → 수정 → preview → apply → undo → redo → 재접속 복구` 공통 E2E
3. 분야별 tool registry와 실제 executor 완전 정렬
4. exact-clash에는 영속 job/idempotency/동시 실행 cap/cooperative cancel/UI와 5회 상한·allowlist·30/120/300/900초 backoff의 fail-closed 재시도가 들어갔으나, 전 분야 공통 비용·상업 quota·실제 worker 운영은 미완료
5. artifact dependency가 바뀔 때 stale propagation과 재생성 UX
6. production 인증 계정의 browser-only 종단간 검증
7. 분야별 독립 holdout, 외부 전문가, 실제 제작·시공 영수증

## 6. 분야별 AI 설계·정밀 CAD 현황

### 6.1 기계·제품 설계

현재 위치: 모든 분야 중 가장 앞서 있으나 상업 자격은 `HOLD`.

AI 설계 구현:

- 자연어 brief, 요구사항·인터페이스 분석
- 제품 분해, 부품 inventory, requirement-to-part 추적
- 부품/피처 프로그램 생성과 bounded refinement
- 수동 치수·파라미터 lock 보존
- 복합제품 실행 계획과 전문가 handoff
- gearbox, fastener, enclosure, machine skid, robot 등 family/scenario 기반 흐름

정밀 CAD 구현:

- sketch/constraint, extrude, revolve, cut, hole, thread 등 feature 계열
- exact/preview 엔진 선택, OCCT/Replicad 연계
- surface, sheet metal, weldment, mold, routing, tolerance/GD&T 관련 모듈
- assembly occurrence, mate/joint, DOF, collision, motion
- drawing, BOM, STEP/DXF/PDF/manufacturing package
- DFM, tolerance stack, 여러 해석·FEA 모듈과 evidence gate

현재 증거:

- 내부 회귀: `PASS`
- artifact/revision consistency: `PASS`
- 기계 private beta: `false`
- self-service: `false`
- manufacturing release: `false`

남은 상업 자격:

1. 핵심 30기능 exact closed-loop
2. private beta 직접 설계 패키지 10개
3. 전체 직접 설계 패키지 30개
4. 기계 의도 캠페인 150건
5. 표준 STEP 적합성
6. blind product challenge 20건
7. 실제 제작 영수증 3건

권위 파일: [mechanical-product-scope-assessment.json](../evidence/cad-independent/mechanical-product-scope-assessment.json)

### 6.2 조립·로봇·복합기계

현재 위치: 제한된 family closed beta 후보, 광범위 self-service와 제조 보증은 불가.

구현:

- 독립 part/occurrence, hierarchy, transform
- mate/joint graph, 6-DOF, motion/collision
- 물리 네트워크, 배관·배선·센서 연결성
- 로봇 6축 구조, 탐색/협조 motion evidence
- 승인된 부분만 수정하는 bounded repair
- expert precision workspace와 AI-managed precision handoff

현재 6축 로봇 내부 예시는 `concept_only`다. 25개 editable part, 60 mate, 6 허용 DOF, 테스트된 motion frame은 있으나 motor/reducer/bearing/brake/encoder/harness/tool connector 22개 카탈로그 항목과 제조·STEP 왕복·전문가 승인이 남았다.

다음 작업:

1. 실제 COTS 카탈로그와 housing/interface 치수 바인딩
2. swept checker 호출 계약은 구현됐으나 exact B-rep/fixture backend에 연결한 전체 동작 범위 연속 충돌·clearance 재검증
3. cable/hose routing과 service loop
4. load/duty/thermal/bearing life 결과를 동일 revision에 결속
5. exact assembly STEP 왕복과 독립 검토

권위 파일: [complex-product-scope-assessment.json](../evidence/cad-independent/complex-product-scope-assessment.json)

### 6.3 판금·용접·금형·배관·ECAD 보조 트랙

현재 위치: 기계 프로필 아래 다수 모듈이 있으나 각각 독립 상용 제품군으로 자격화되지는 않았다.

- 판금: bend/unfold/flat pattern/DXF 계약과 테스트가 존재. 다양한 bend rule, relief, refold 왕복 자격 필요.
- 용접: member/miter/cut list/welding symbol/검증 모듈 존재. 실제 WPS·용접부 피로·제작 영수증 필요.
- 금형: mold/plastic-flow UI·계산 모듈 존재. cavity/core, shrinkage, cooling, ejector, 실제 CAM/금형 검증 필요.
- 배관/HVAC: routing, fitting, physical network, interference 모듈 존재. spec/catalog, slope, support, spool/isometric, pressure-test evidence 필요.
- ECAD/배선: 포트·케이블·전기 네트워크와 일부 UI 존재. 회로 정본, harness topology, connector pinout, electrical rule check, MCAD/ECAD 왕복이 부족하다.

이 트랙은 “기능 파일이 존재한다”와 “제품군이 release 가능하다”를 분리해서 관리한다.

### 6.4 건축 CAD

현재 위치: concept-to-exact의 중요한 기반이 구현됐지만 실제 프로젝트 자격은 `HOLD`.

AI 설계 구현:

- 자연어 brief와 constraint에서 건축·인테리어 candidate 생성
- 공간 plan SVG preview
- candidate는 승인 전 비영속
- 승인 후 architecture/interior workspace revision으로 commit
- 개념 수정과 project revision 갱신

정밀 CAD 구현:

- project/site/building/storey/object 좌표 프레임
- space, wall, slab, ceiling, opening 중심의 의미 문서
- approval-bound exact transaction
- 실제 Node OCCT analytic/exact geometry와 STEP evidence
- exact artifact private 저장과 compact reference
- quantity, drawing, IFC artifact graph
- browser precision workflow panel과 상태 표시
- AI가 내부 architecture/interior tool catalog를 호출하는 agent gateway

현재 로컬 검증:

- 명령: `npx vitest run architectureInterior --reporter=dot`
- 결과: 39 files / 244 tests `PASS`
- 실제 OCCT STEP 쓰기와 arc wall analytic adapter 포함
- concept edit 뒤 stale model source를 재바인딩하고 quantity/drawing/IFC bundle을 같은 revision/hash로 재생성하는 회귀 포함
- malformed selection/reconnect fail-closed와 edit·undo·redo 의미 재실행을 통한 history 위조 방지 회귀 포함
- Live Inspector 승인 응답의 revision/hash/artifact stale 검증과 authoritative client transport validator 거절 회귀 포함
- 영속 apply/undo/redo ledger, workspace CAS와 history append 원자성, reconnect/redo invalidation, head divergence 차단 회귀 포함
- Live Inspector의 서버 history 조회·승인형 undo/redo·Apply 뒤 재결속·reconnect refresh·viewer 차단과 6언어 UI 회귀 포함
- 구조화 interior RCP의 storey/space/ceiling/opening/system/light host·hash·stable-ID 독립 검증 포함
- 구조화 architecture elevation/section의 line/arc·opening interval·교차 geometry·상층 절대 표고·strict parser/verifier 포함
- stable-ID grid 편집, storey/절대 Z/좌표 프레임에 결속된 stair 생성·수정, concept-only shaft/elevator 생성·수정 transaction 포함

미완료:

1. 벽·공간·개구부의 stable selection, 승인형 Apply와 서버 영속 undo/redo/reconnect UI는 구현됐으나 모든 직접 편집 도구 및 실제 인증 브라우저 E2E는 미완료
2. 내부 구조화 입면·단면은 구현됐으나 평면·입면·단면·상세의 native 산출과 실제 연관 재생성은 미완료
3. stair와 concept-only shaft/elevator 생성·수정은 구현됐으나 elevator sizing·법규, shaft/elevator exact solid·slab opening 및 native 연관 도면 재생성은 미완료
4. service opening의 승인형 의미 편집과 수직 slab 및 수평·사선 wall arbitrary-axis analytic-cylinder exact subtraction·artifact persistence는 구현됐으나 envelope와 실제 MEP route/sleeve·구조 승인·fire/accessibility 권위 입력 기반 검증은 미완료
5. 실제 IFC/DWG reference와 독립 왕복
6. RVT native 직접 지원 주장 금지; 승인된 변환/검토 경로 필요
7. 실제 법규 schedule과 licensed architect release

핵심 파일:

- [architectureInteriorAiDesignProposal.ts](../../src/lib/ai/architectureInteriorAiDesignProposal.ts)
- [architectureInteriorWorkspace.ts](../../src/lib/ai/architectureInteriorWorkspace.ts)
- [architectureInteriorExactTransaction.ts](../../src/lib/ai/architectureInteriorExactTransaction.ts)
- [architectureInteriorExactGeometry.ts](../../src/lib/ai/architectureInteriorExactGeometry.ts)
- [architectureInteriorHistoryStore.ts](../../src/lib/ai/architectureInteriorHistoryStore.ts)
- [architecture-interior-history route.ts](../../src/app/api/nexyfab/projects/[id]/architecture-interior-history/route.ts)
- [ArchitectureInteriorLiveInspector.tsx](../../src/app/[lang]/shape-generator/_shell/spatial/ArchitectureInteriorLiveInspector.tsx)
- [architectureInteriorRcpArtifact.ts](../../src/lib/ai/architectureInteriorRcpArtifact.ts)
- [architectureInteriorElevationArtifact.ts](../../src/lib/ai/architectureInteriorElevationArtifact.ts)
- [architectureInteriorSectionArtifact.ts](../../src/lib/ai/architectureInteriorSectionArtifact.ts)
- [architectureDoorCirculationVerifier.ts](../../src/lib/ai/architectureDoorCirculationVerifier.ts)
- [architectureInteriorDocuments.ts](../../src/lib/ai/architectureInteriorDocuments.ts)
- [architectureInteriorConceptTransaction.ts](../../src/lib/ai/architectureInteriorConceptTransaction.ts)
- [architectureInteriorToolCatalog.ts](../../src/lib/precision-cad-agent/architectureInteriorToolCatalog.ts)

### 6.5 토목 CAD

현재 위치: 계산·문서·일부 생성기는 있으나 완성형 정밀 토목 CAD는 `PARTIAL/Beta`.

구현:

- civil domain module과 LLM planner
- beam/column/wall/slope 기초 검증
- CRS·survey·terrain·alignment·profile·corridor·drainage 목표 문서
- LandXML import, corridor/road/site layout 관련 스크립트와 테스트
- earthwork, drainage, cross-section 관련 일부 계산
- survey control/point, surface/TIN 정의, alignment/profile/corridor, drainage node/link의 승인형 stable-ID plan → challenge → approval → execute → verify → receipt 내부 executor
- surface point/triangle/breakline/evidence topology 검증, profile-alignment/corridor station 결속, drainage 참조·표고 검증, no-op/위조 승인/stale CAS 차단
- shared workspace revision 변경 시 civil/landscape current artifact 전체를 fail-closed stale 처리
- output truth registry와 실제 exporter→parser 실행, exact element-count·revision/artifact/parser/verifier SHA-256 결속형 내부 LandXML roundtrip probe receipt(`releaseReady: false`)
- alignment/cross-section geometry와 station/point count를 source/output bytes에 결속한 내부 cross-section JSON probe(`PARTIAL/VERIFIED`, `releaseReady: false`)
- alignment/profile line·arc·spiral과 PVI station을 결속한 내부 profile JSON probe(`PARTIAL/VERIFIED`, `releaseReady: false`)
- stable-ID vertical curve의 profile/PVI 소유권, station/length 범위, overlap과 PVI 중복 소유를 차단하는 승인형 의미 편집
- stable-ID superelevation region의 alignment 소유권, 연속 station 범위, 좌·우 경사율과 비중첩을 차단하는 승인형 의미 편집
- 기존/계획 surface point와 sampled grid, checked-in calculator의 cut/fill/net을 결속한 내부 earthwork JSON probe(`PARTIAL/VERIFIED`, `releaseReady: false`)

미완료:

1. 현재 의미 편집을 넘어선 대규모 survey point/TIN interactive 편집
2. surface/breakline 의미 편집 뒤 실제 TIN rebuild와 alignment line/arc/spiral geometry 전용 Inspector
3. stable-ID PVI·bounded vertical-curve·superelevation·corridor-target 의미 편집과 caller-supplied 속도/K/경사 기준의 포물선 종곡선 evaluator는 구현됐으나 권위 법규표 기반 곡선/편경사 계산, 실제 corridor target 적용, grading solver와 native interactive profile/corridor editor는 미완료
4. 내부 JSON 종단·횡단·sampled-grid earthwork 외 native 산출과 독립 수치 검증, 동일 revision 연관 재생성
5. LandXML/GeoJSON/IFC/DXF/PDF 실제 왕복 자격
6. 현장 좌표·측량·지반·배수 권위 입력과 전문가 승인

주의: domain profile의 import/export 목록은 목표 계약을 포함한다. 실제 형식 지원과 동일하지 않다.

핵심 파일:

- [civilLandscapeToolExecutor.ts](../../src/lib/precision-cad-agent/civilLandscapeToolExecutor.ts)
- [civilLandscapeOutputCapabilities.ts](../../src/lib/ai/civilLandscapeOutputCapabilities.ts)
- [civilCrossSectionArtifact.ts](../../src/lib/ai/civilCrossSectionArtifact.ts)
- [civilProfileArtifact.ts](../../src/lib/ai/civilProfileArtifact.ts)
- [civilEarthworkArtifact.ts](../../src/lib/ai/civilEarthworkArtifact.ts)
- [landxml-roundtrip-probe.mjs](../../scripts/drawing-to-3d/landxml-roundtrip-probe.mjs)
- [civil-profile-probe.mjs](../../scripts/drawing-to-3d/civil-profile-probe.mjs)
- [civil-earthwork-probe.mjs](../../scripts/drawing-to-3d/civil-earthwork-probe.mjs)

### 6.6 시공·수량·공정

현재 위치: 별도 설계 workspace라기보다 engineering domain module.

구현:

- RC frame 기본 생성
- concrete/rebar/formwork takeoff
- schedule feasibility와 predecessor/lag
- cost rollup, earthwork cut/fill balance
- under-claim reconciliation과 fail-closed 검사
- source payload SHA-256, workspace revision/content hash, concrete/rebar/formwork/schedule object ID의 결정론적 provenance 결속
- 명시적 workspace binding과 legacy-derived binding의 구분, 각 입력 쌍 완전성 및 binding-mode 포함 hash 검증
- fixture package의 실제 비용·현장 claim boundary와 `releaseEligible: false` 강제

미완료:

- 내부 fixture provenance를 넘어선 실제 BIM revision과 BOQ·공정의 양방향 결속
- 실제 BIM 객체와 quantity provenance의 외부 양방향 결속
- 내부 hash-bound 4D/5D 객체·수량·공정 change-impact를 넘어선 실제 procurement, 현장 진도와 계약 영향
- 실제 단가·지역·시점 데이터와 계약/승인

가격이나 공정 결과는 권위 데이터가 없으면 `NOT_RUN` 또는 estimate로 유지한다.

### 6.7 조경 CAD

현재 위치: 의미 문서·계산기는 존재하지만 직접 편집과 산출 폐루프가 부족한 `PARTIAL/Beta`.

구현:

- site/terrain, planting, hardscape, soil, irrigation, drainage 의미 모델
- planting spacing, green area ratio, soil depth
- irrigation coverage, drainage slope
- landscape module과 LLM planner, release certificate 구조
- revision-bound terrain modifier 의미 모델과 site-boundary 검증
- terrain modifier, plant/planting zone, hardscape/soil volume, irrigation node/pipe/zone, drainage path, maintenance zone의 승인형 stable-ID atomic executor
- site boundary·비퇴화 polygon·plant/soil/valve/emitter 참조·배수 하강 slope 검증, CAS·승인·no-op·shared artifact stale 전파
- revision/hash와 artifact/parser/source SHA-256에 결속된 내부 irrigation-only JSON schedule exporter→parser probe
- plant/planting-zone/soil stable ID와 species·설치/성숙 치수·수량을 실제 source/output SHA-256에 결속한 내부 planting JSON schedule exporter→parser probe

미완료:

1. 토목 terrain revision 충돌의 실제 다중 사용자·브라우저 복구 E2E
2. 실제 TIN/grading solver와 현재 의미 편집을 넘어선 hardscape 상세 geometry
3. plant catalog의 mature size·root/soil·지역성·계절성 provenance
4. irrigation hydraulic network와 유지관리; 내부 schedule은 hydraulic evidence가 아님
5. 내부 planting/irrigation schedule을 넘어선 통합 plan, 외부 schedule, BOQ의 동일 revision 산출

핵심 파일:

- [landscapePlantingSchedule.ts](../../src/lib/ai/landscapePlantingSchedule.ts)
- [landscape-planting-schedule-probe.mjs](../../scripts/drawing-to-3d/landscape-planting-schedule-probe.mjs)
- [landscapeIrrigationSchedule.ts](../../src/lib/ai/landscapeIrrigationSchedule.ts)
- [landscape-irrigation-schedule-probe.mjs](../../scripts/drawing-to-3d/landscape-irrigation-schedule-probe.mjs)

### 6.8 인테리어 CAD

현재 위치: 건축과 같은 새 candidate/exact/artifact 기반을 사용하며 로컬 핵심 회귀는 통과. 실제 프로젝트·전문가 자격은 `HOLD`.

구현:

- 건축 host revision을 참조하는 interior document
- 공간 polygon과 furniture placement
- finish, ceiling, light, millwork, MEP reference 의미 객체
- circulation, door swing, furniture clearance, egress, space closure
- placement transaction과 AI handoff
- furniture/exact geometry 일부
- 건축과 함께 exact artifact, drawing, quantity, IFC binding
- section/gauge UI를 포함한 6언어 공간 작업공간
- ceiling/opening/ceiling-system/light를 동일 revision/hash에 결속하는 구조화 내부 RCP와 독립 parser/verifier
- finish/millwork의 승인형 stable-ID 생성·수정, exact space/host binding, no-op/CAS rollback
- space·finish·surface host와 source/output hash를 결속하는 내부 finish schedule exporter→parser probe
- space·furniture·위치·치수·회전·clearance와 source/output hash를 결속하는 내부 FF&E schedule exporter→parser probe

미완료:

1. furniture/light/finish/millwork의 stable-ID 의미 편집은 구현됐으나 모든 설비 유형·host 전환·제품 catalog 연결과 exact geometry 편집은 미완료
2. field measurement/as-built revision 충돌 검토
3. document-bound sampled door swing + circulation + accessible route, line/directed-arc wall analytic aperture crossing, 다중 문 순서·카디널리티, source-bound obstacle/furniture envelope·route/swing collision은 구현됐으나 권위 accessibility/egress 판정, native 연관 산출, 현장 검토는 미완료
4. 내부 구조화 RCP는 구현됐으나 native RCP 도면, lighting/acoustics/ceiling MEP 종합 검증은 미완료
5. 실물 catalog dimension/clearance/connection point
6. 내부 finish/FF&E JSON schedule을 넘어선 native layout/RCP/elevation, millwork detail, 외부 schedule, catalog/가격/BOQ
7. 실제 인테리어 holdout와 독립 리뷰

핵심 파일:

- [interiorFinishSchedule.ts](../../src/lib/ai/interiorFinishSchedule.ts)
- [interiorFfeSchedule.ts](../../src/lib/ai/interiorFfeSchedule.ts)
- [interior-finish-schedule-probe.mjs](../../scripts/drawing-to-3d/interior-finish-schedule-probe.mjs)
- [interior-ffe-schedule-probe.mjs](../../scripts/drawing-to-3d/interior-ffe-schedule-probe.mjs)

## 7. 실제 참고자료와 현재 연결 상태

### 7.1 원본 위치

- `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\7.3 example`
- `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\document(manuals)`
- `C:\Users\gomd9\Downloads\참고파일들`

### 7.2 인벤토리

- 전체 7,407개 파일의 path, SHA-256, bytes, extension을 인덱싱했다.
- 별도 원본 파일은 저장소에 복사하지 않는다.
- 전체 원본 중 DWG 151, IFC 87, RVT 76, DXF 19, SKP 15, 3DM 7개가 확인됐다.
- `약 899개`라는 종전 키워드 추정치는 재현 가능한 matcher/산출물이 없어 공식 수치에서 제외한다.
- 원본 전체 7,407개는 `170 + 21 + 7,216`이며, operator 참고자료 7,216개는 6,914개 배정·해시 고정, 302개 보안 제외, 467개 lineage로 관리한다.
- 포맷 probe는 1,076개 중 1,074개 통과했다. 실패 2개는 `.step` 확장자와 실제 Creo/STL 내용이 다른 확장자 불일치 자료다.

인벤토리: [reference-inventory.json](../evidence/architecture-interior-reference-inventory-260821/reference-inventory.json)

### 7.3 먼저 연결할 골든 시나리오

| 골든 시나리오 | 실제 reference 후보 | 목적 |
|---|---|---|
| single/multi-storey office | `office-design-14` IFC+DWG+이미지, `6-story-corporate-office-revit` | 공간·층·개구부·IFC/DWG 정합성 |
| multi-storey apartment | `3-story-100-square-meteres-apartment-revit` RVT+DWG+이미지 | 반복층·세대·core·수량 |
| cafe/restaurant kitchen | `reconstruction-of-the-restaurant-s-kitchen...` RVT+이미지 | 가구·설비·동선·마감·millwork |
| MEP companion | `sprinkler-design-using-revit-mep` RVT+DWG | 천장 MEP, 간섭, service opening |
| comprehensive residential | `las-vegas-dream-home` RVT+DWG+PDF+schedule+이미지 | 모델·도면·스케줄 revision 일치 |
| IFC regression | IFC4.3 wall/slab/opening/placement/georeference 샘플 | 공간 관계와 왕복 |

generic 전용 manifest 5개 entry는 source hash가 모두 `null`이고 license/approval도 완료되지 않았다. 별도의 golden lineage qualification과 운영 리포트는 이제 office/apartment/cafe뿐 아니라 MEP companion, comprehensive residential, IFC regression까지 6개 시나리오를 모두 fail-closed 강제한다. 실제 7,407-file inventory에서 CAD 형식만 허용해 각각 `8/8/7/7/8/8`, 총 46개 path/SHA-256 후보를 재검증했으며 이미지와 파생 IR JSON은 후보에서 제외했다. 아직 명시 assignment, license attestation, 독립 reviewer approval이 없으므로 선택 수는 0이고 6개 모두 `HOLD`, `scoreEligible: false`다. 일반 golden corpus의 pass/not-run 판정은 이 source 승인과 별개이므로 raw inventory나 내부 회귀 통과를 외부 정확도 승인으로 사용하면 안 된다.

매니페스트: [architectureInteriorReferenceManifest.ts](../../src/lib/ai/architectureInteriorReferenceManifest.ts)

### 7.4 매뉴얼 활용

매뉴얼 위치의 21개 파일 중 PDF 20개가 read-only index에 있고, 나머지 1개는 원본 ZIP이다. 20개 PDF의 bytes/SHA-256은 현재 인덱스와 일치한다.

- AutoCAD: 좌표, snap, layer, dimension, model/paper space
- Rhino/Grasshopper: B-Rep, tolerance, persistent reference, dependency graph
- SketchUp Interior: 개념 공간·component·presentation
- Vectorworks: class/layer/sheet, data-rich object, worksheet/schedule
- Enscape/3ds Max: exact model과 visualization asset 분리
- Civil 3D/MicroStation: survey, alignment, level, infrastructure drawing
- SOLIDWORKS/Fusion: feature intent, assembly, drawing, manufacturing workflow

매뉴얼 원문·화면·문장을 제품에 복제하지 않는다. 추상화한 requirement와 테스트만 반영한다.

`manual-requirements.json`과 v2 ledger의 최신 기준은 `20 manuals / 46 requirements / 30 atomic / 20 mapped / 0 unmapped`다. `MANUAL-04`, `07`, `11`, `19`, `20`도 source locator·hash와 구현 검증에 매핑되어 자동 계약상 verified 목록에 포함되지만, 20개 전체의 실제 reference license/provenance/독립 reviewer receipt와 workspace revision/hash는 여전히 `HOLD`다. 따라서 manual index SHA-256과 stable parent lineage가 통과해도 전체 상업 점수에는 `scoreEligible: false`를 유지한다.

## 8. 다국어 현황

### 8.1 지원 언어

Canonical route 언어:

- 한국어 `kr`
- 영어 `en`
- 일본어 `ja`
- 중국어 `cn`
- 스페인어 `es`
- 아랍어 `ar`

Alias:

- `ko → kr`
- `zh → cn`
- 일부 legacy `jp → ja`

### 8.2 현재 판정

2026-08-22 실행:

```powershell
npx vitest run scripts/i18n/commercial-catalog.test.ts scripts/i18n/lang-coverage.test.ts scripts/i18n/locale-hardcode.test.ts src/lib/i18n/adminTranslations.test.ts src/lib/i18n/manufacturingTerms.test.ts src/lib/i18n/normalize.test.ts src/lib/i18n/serverLocale.test.ts --reporter=dot
```

결과:

- 공식 기준선 7 test files / 40 tests 전부 `PASS`
- 확장 명령 `npx vitest run i18n --reporter=dot`: 30 test files / 224 tests 전부 `PASS`
- 생성 catalog의 bare `{{0}}` count template이 임의 단위·식별자까지 받아 일본어/중국어 `個/个`를 붙이던 결함을 숫자/count-like 값으로 제한했다.
- FabPanel의 rate unit과 breakdown label은 6언어 catalog를 사용하되 `₩/kg`, `₩/m`, `%` 같은 단위 토큰은 count 명사로 번역하지 않는다.

이는 현재 자동 회귀 범위의 통과를 뜻하며, 사이트의 모든 런타임 문자열·이메일·PDF·외부 metadata를 사람이 전수 검토했다는 주장은 아니다.

다음 세션의 i18n 원칙:

1. 새 UI·상태·오류·도구명은 첫 구현부터 6언어 dictionary에 추가한다.
2. 한국어/영어 binary branch를 새로 만들지 않는다.
3. 데이터 catalog의 제품·품목·공장명도 사용자 노출 시 translation key 또는 locale field를 사용한다.
4. 아랍어 RTL에서 패널 방향과 숫자·단위·CAD canvas 정렬을 분리 검증한다.
5. admin, 사용자창, 이메일, PDF, export metadata, API error까지 범위에 포함한다.

## 9. 다음 구현 우선순위

### Wave 0 — 현재 기준선과 서비스 진실성

1. 1,325개 dirty 경로 분류 및 재현 가능한 RC 생성
2. i18n 공식 40/40과 확장 224/224 기준선 유지
3. production Pro 로그인 E2E
4. AI proposal → commit → exact → artifacts → reload 전체 smoke
5. production DB/object storage/provider/approval secret의 존재만 확인하고 값은 출력하지 않음

종료 조건:

- 재현 가능한 commit/tag 또는 명시적 candidate manifest
- production Pro 흐름 PASS evidence
- known i18n test 0 fail

### Wave 1 — 건축·인테리어 실제 reference 연결

1. office, apartment, cafe 3개 골든 시나리오에 실제 lineage를 지정
2. source hash, license status, provenance 등록
3. reference/regression/holdout을 서로 다른 hash로 분리
4. RVT는 native review, IFC/DWG는 지원 가능한 자동 probe로 분리
5. 독립 리뷰 전에는 score eligible을 false로 유지

종료 조건:

- 세 시나리오 모두 실제 source hash 존재
- holdout tuning 사용 0
- reviewer 2명과 approval receipt 계약 준비

### Wave 2 — 건축·인테리어 직접 정밀 편집

1. stable object selection
2. wall/space/opening/storey 직접 Inspector
3. furniture/finish/millwork/light/ceiling host-aware edit
4. apply/undo/redo/reconnect recovery
5. 평·입·단·RCP·schedule artifact stale/rebuild

종료 조건:

- 실제 project revision에서 object identity 보존
- AI와 수동 수정이 서로 덮어쓰지 않음
- 모든 산출물이 같은 revision/hash를 참조

### Wave 3 — 정밀 CAD agent 도구 확대

1. 건축: add/move/resize wall/space/opening, level/grid, section
2. 인테리어: place/move/rotate furniture, clearance envelope, finish/millwork/RCP
3. 토목: survey/TIN/alignment/profile/corridor/drainage
4. 조경: terrain modifier/planting/hardscape/irrigation
5. 기계: 30기능 closed-loop와 assembly/drawing/PDM 잔여

모든 도구는 plan → challenge → approval → execute → verify → receipt 흐름을 따른다.

현재 내부 구현 진척: 건축 grid/stair/concept shaft/elevator/service opening, 인테리어 finish/millwork, 토목 PVI/vertical curve/superelevation/corridor target/cross-section/catchment/structure, 조경 maintenance zone까지 승인·CAS·stable-ID 계약에 연결됐다. 외부 CAD/현장 검증 전에는 Wave 3 완료로 승격하지 않는다.

### Wave 4 — 분야별 산출·상호운용

- 기계: STEP, DXF, PDF, BOM, inspection evidence
- 건축: plans/elevations/sections/schedules, IFC/DXF/PDF
- 인테리어: layout/RCP/elevation/millwork/finish/FF&E/BOQ
- 토목: alignment/profile/cross-section/earthwork/drainage, LandXML/DXF/PDF
- 조경: grading/planting/hardscape/irrigation/schedule/BOQ

실제 parser/exporter/roundtrip가 없는 버튼은 비활성화하고 `TARGET`으로 표시한다.

현재 내부 구현 진척: 건축 elevation/section과 수직 slab 및 수평·사선 wall service-opening exact STEP, 인테리어 RCP/finish/FF&E, 토목 profile/cross-section/earthwork, 조경 planting/irrigation schedule, 시공 BIM revision change-impact는 hash-bound 내부 probe/receipt까지 구현됐다. native 형식, 독립 외부 parser, 실제 survey/catalog/field/contract evidence가 없으므로 모두 `PARTIAL/HOLD` 경계를 유지한다.

### Wave 5 — 독립 자격과 상업 승급

1. 분야별 blind holdout campaign
2. 최소 정확도와 false-verified 0 정책
3. 독립 전문가 2인 승인
4. 기계 실제 제작 영수증
5. 건축·인테리어 실제 프로젝트·도면·IFC 비교
6. 토목·조경 현장 좌표·수량 비교
7. 7일 운영, 장애 복구, provider failover, 비용·quota

기계와 각 공간 분야는 독립 release channel로 승급한다.

## 10. 다음 세션 작업 방식

사용자가 선호한 반복 사이클:

```text
Sol 점검·범위 고정
  → Luna가 독립 가능한 bounded 작업을 병렬 구현
  → Sol이 통합 검증·거짓 PASS 점검·조정
  → 다음 단계
```

규칙:

- 여러 agent가 같은 파일을 동시에 수정하지 않도록 파일 소유권을 분리한다.
- sub-agent 결과는 루트 agent가 실제 diff와 테스트를 다시 검토한다.
- 사용자 소유 변경을 reset하거나 덮어쓰지 않는다.
- 각 wave가 종료 조건을 통과하기 전 다음 wave의 완료를 선언하지 않는다.
- 새 기능은 i18n, 권한, revision/hash, error 상태, 테스트를 함께 구현한다.

## 11. 다음 세션 시작 명령

```powershell
Set-Location 'C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new'
Get-Content -LiteralPath '.\docs\strategy\NEXYFAB_SERVICE_AI_DESIGN_PRECISION_CAD_HANDOFF_260822.md' -Raw
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

우선 회귀:

```powershell
npx vitest run architectureInterior --reporter=dot
npx vitest run scripts/i18n/commercial-catalog.test.ts scripts/i18n/lang-coverage.test.ts scripts/i18n/locale-hardcode.test.ts src/lib/i18n/adminTranslations.test.ts src/lib/i18n/manufacturingTerms.test.ts src/lib/i18n/normalize.test.ts src/lib/i18n/serverLocale.test.ts --reporter=dot
```

다음으로 실행할 검증:

```powershell
npm run test:accuracy:mechanical
npm run test:accuracy:building
npm run test:accuracy:interior
npm run test:accuracy:civil
npm run test:accuracy:landscape
npm run build
```

배포 직전만 실행:

```powershell
npm run commercial:preflight
npm run mechanical:contracts:check
npm run commercial:release-gate
npm run deploy:railway:verified
```

`deploy:railway:verified`는 테스트·build·환경·대상 서비스가 확인된 뒤에만 실행한다.

## 12. 배포 직전 확인할 설정

값을 문서나 채팅에 출력하지 말고 설정 존재·유효성만 확인한다.

- production Railway project/environment/service가 `nexyfab.com`인지
- `DATABASE_URL`과 versioned migration 상태
- Redis/Upstash quota backend
- private S3/R2 bucket, access key, secret, region/endpoint
- AI provider 키와 primary/fallback 정책
- architecture/interior approval/session secret
- 기계 direct-design 역할별 Ed25519 verifier public-key registry(`NEXYFAB_MECHANICAL_DESIGN_VERIFIER_KEYS`)
- generation/evidence signing secret
- JWT, admin, cron, Next server action encryption key
- CAPTCHA/CORS/allowed hosts
- SMTP, Sentry, payment/webhook가 이번 release scope에 필요한지
- migration `2026082201` 이후 pending migration
- production Pro 계정과 실제 프로젝트 ID
- rollback deployment와 담당자

## 13. 새 세션에 그대로 전달할 요청문

```text
작업 폴더는 C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new 이다.

먼저 docs/strategy/NEXYFAB_SERVICE_AI_DESIGN_PRECISION_CAD_HANDOFF_260822.md와 AGENTS.md를 끝까지 읽고, 현재 git 변경을 삭제하거나 reset하지 말라.

문서의 Wave 0부터 이어서 진행하라. 우선 서비스·배포·dirty working tree·known failing i18n을 다시 점검하고, 그 결과로 계획을 갱신하라. 그다음 AI 설계와 정밀 CAD를 기계·복합기계·건축·토목·시공·조경·인테리어 전체 분야에서 순차 개선하라.

작업 방식은 Sol 점검 → Luna bounded 병렬 구현 → Sol 통합 검증·조정 → 다음 단계다. 각 새 UI와 데이터는 처음부터 kr/en/ja/cn/es/ar i18n을 포함한다.

코드 존재, fixture 통과, 파일 생성만으로 상업·제조·시공 PASS를 선언하지 말라. 실제 exact kernel, revision/hash, 외부 roundtrip, 독립 전문가, 실제 제작·프로젝트 증거를 분리해서 PASS/PARTIAL/HOLD/NOT_RUN/BLOCK으로 보고하라.

배포 설정은 배포 요청 직전에 다시 목록으로 알려주고, 승인 없이 배포하지 말라.
```

## 14. 최종 완료 정의

### 서비스 완료

- clean/reproducible RC
- 6언어 전 페이지·admin·메일·export audit 0 fail
- production Pro browser E2E
- DB/Redis/storage/provider/payment/worker 장애·복구 증거
- release gate 0 blocker

### AI 설계 완료

- 모든 분야에서 authoritative input → candidate → approval → revision commit
- 사용자 lock과 직접 수정 보존
- 실제 도메인 도구를 호출하고 결과를 검증
- 불확실성·미입력·미검증을 숨기지 않음
- 분야별 blind holdout와 false-verified 0

### 정밀 CAD 완료

- stable semantic object와 exact geometry의 양방향 결속
- 직접 편집/Undo/Redo/recovery
- current revision 기반 도면·수량·교환파일 재생성
- 지원 형식의 독립 왕복
- 제조·시공·전문가 release는 별도 승인

### 분야 완료

한 분야의 완료가 다른 분야를 자동 인증하지 않는다. 기계, 건축, 토목, 조경, 인테리어는 각각 독립적으로 위 조건과 분야별 evidence axis를 통과해야 한다.

## 15. 연결 문서

- [5개 분야 완성형 CAD 마스터 계획](./multi-domain-complete-cad-master-plan-260820.md)
- [정밀 CAD 구현 현황](../NEXYCAD_PRECISION_CAD_IMPLEMENTATION_STATUS_260813.md)
- [상업 정밀 CAD 마스터 계획](../NEXYCAD_COMMERCIAL_PRECISION_CAD_MASTER_PLAN_260814.md)
- [현재 서비스 재평가](../NEXYFAB_CURRENT_STATUS_AND_REASSESSMENT_260812.md)
- [도메인 프로필](../../src/lib/ai/domainProfileRegistry.ts)
- [건축·인테리어 골든 시나리오](../../src/lib/ai/architectureInteriorGoldenScenarios.ts)
- [건축·인테리어 reference manifest](../../src/lib/ai/architectureInteriorReferenceManifest.ts)
- [CAD 매뉴얼 인덱스](../cad-program/requirements/manual-index.json)
- [매뉴얼 요구사항](../cad-program/requirements/manual-requirements.json)
- [상업화 준비 상태](../evidence/release/commercialization-readiness-current.json)

## 16. 독립 왕복·전문가·현장/제조 증거 감사 (2026-08-22)

로컬에서 자동 생성·검증 가능한 것은 내부 구조/해시/receipt 바인딩과 결정론적 검증 결과뿐이다. 실제 native CAD 재수입, 제조·측정·현장 결과, 독립 전문가 서명은 외부 실행과 자격 있는 서명자가 없으면 `HOLD`로 유지한다. 기존 review-kit validator는 receipt 경로와 SHA 형식만 확인하므로 파일 바이트 존재·JSON binding까지는 별도 검증해야 한다.

추가 검증 명령:

```text
npm run accuracy:independent-review-kit:evidence-verify -- --kit=docs/evidence/release/independent-domain-review-kit-260810.json --evidence-root=docs/evidence/release
npx vitest run scripts/verify-independent-domain-review-evidence.test.mjs --reporter=dot
```

`verify-independent-domain-review-evidence.mjs`는 receipt 파일의 경로 탈출·symlink·실제 SHA-256·case/input/output-hash binding을 검증하고, output artifact의 파일 경로가 kit에 결속되지 않은 상태에서는 독립 byte 검증을 선언하지 않는다. 따라서 현재 pending kit은 자동으로 fail-closed한다. 이 도구는 서명·제조·현장 증거를 생성하지 않는다.

## 17. 병렬 실행 후 재검증·RC 조립 상태 (2026-08-22)

이번 실행은 원본 dirty 작업트리를 reset하거나 기존 파일을 삭제하지 않고 진행했다. production 배포와 Railway 변수 변경도 수행하지 않았다. 내부 구현과 검증은 진행했지만 외부 전문가 서명, 실제 제조·현장 측정, 7일 경과 시간은 생성하거나 대체하지 않았다.

### 17.1 내부 CAD·AI 검증

- 기계 30개 핵심 기능의 로컬 exact closed loop: 기능별 7축, 총 `210/210 PASS_LOCAL`
- 직접 설계 회귀: `17 files / 133 tests PASS`
- 기계 정확도: `49/49 PASS`
- AI intent 로컬 자격 corpus: `150 cases` 분류·계약 검사 통과. 실제 AI model/geometry/verification 상업 campaign은 `NOT_RUN`
- 대표 exact runtime: `10 cases / 70 axes PASS_LOCAL`
- assembly/drawing handoff: `3 files / 11 tests PASS_LOCAL`, 외부 상업 증거가 없어 `HOLD`
- OCCT STEP C4 형상·solid·volume·view와 occurrence transform은 `PASS_LOCAL`
- 현재 OCCT 바인딩에는 `STEPCAFControl_Reader`가 없어 XCAF PRODUCT/NAUO/label 재수입 검증을 할 수 없다. component name, part number, occurrence label은 `HOLD`이며 텍스트 패치로 승격하지 않는다.
- 실제 외부 holdout 취득을 위한 32-slot submission draft만 만들었고, 실제 자료·license·review가 없으므로 제출 완료로 간주하지 않는다.

### 17.2 독립 리뷰와 운영 증거

- 독립 review evidence verifier는 receipt 경로, 실제 파일 SHA-256, case/input/output binding, parent junction/symlink 탈출을 검사한다.
- 현재 기계·건축·인테리어·토목·조경 kit은 각각 `0/20`, platform kit은 `0/100`이다. 외부 산출물과 서명이 없으므로 의도된 `HOLD`다.
- production pre-RC 운영 표본은 web/OpenSCAD worker/FEA worker 각각 1개 6시간 창과 비용 표본 1개를 보존했다.
- 7일 운영 receipt는 최소 `168시간`, 서비스별 `28개 × 6시간`, 정확한 release build ID와 세 deployment ID를 요구한다. 현재 `releaseBinding=null`, FEA binding 미충족, 경과 시간 부족이므로 `BLOCK`이다.
- 기존 production health는 `HTTP 200`이지만 응답 build ID가 `unknown`이다. 강화된 verified deploy는 정확한 `NEXYFAB_BUILD_ID`가 없거나 health build ID가 다르면 실패한다.

### 17.3 Railway production 설정 판정

2026-08-22 존재 여부만 읽기 전용으로 확인한 결과 다음 항목이 상업 배포 blocker다.

- 미충족: `NEXYFAB_BUILD_ID`, 강한 `GENERATION_EVIDENCE_SIGNING_SECRET`, `RECAPTCHA_ALLOWED_HOSTNAMES`, `CAD_RUNTIME_EXTERNAL_WORKER=1`, `NEXYFAB_COMMERCIAL_MODE=1`, 명시적 `SECURITY_GATE_MODE`
- 확인: `OPENSCAD_EXTERNAL_WORKER=1`, `NEXYFAB_CAD_INDEPENDENT_MODE=1`, 강한 `SCAD_AGENT_SESSION_SECRET`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
- Railway dashboard에서 GitHub auto deploy의 `Wait for CI` 또는 auto deploy 비활성화, 실제 Config File 경로(`railway.json`/`railway.toml`), cron 별도 서비스 구성을 확인해야 한다.
- 현재 `railway.toml`의 `[[cronJobs]]`만으로는 공식 Railway cron 서비스 구성이 되지 않는다. 서비스별 종료형 start command와 cron schedule로 외부 설정해야 한다.

### 17.4 최종 로컬 회귀

- 릴리스 baseline·운영 receipt·상업 gate·verified deploy·독립 evidence·STEP·RC exporter 회귀: `53 tests`, `52 PASS`, `1 SKIP`, `0 FAIL`; skip은 Windows에서 테스트용 symlink 생성 권한이 없는 경우다.
- `npm run typecheck`: `PASS`
- `npm run build`: `PASS`, 292개 static page 생성, bundle budget 내 통과
- 잔여 build warning: `scripts/drawing-to-3d/verify.mjs`의 표현식 dependency 1건
- 로컬 build에는 `REDIS_URL`이 없어 in-memory rate-limit 경고가 발생했다. production은 분산 Redis가 없으면 상업 preflight에서 차단한다.
- 원본 working tree는 `2,625` leaf changes 상태이므로 직접 release commit하지 않는다.

### 17.5 깨끗한 RC 스냅샷 정책

`release:candidate:export`는 최종 baseline에 기록된 `deployable`, `documentation`, `evidence` 파일만 exact bytes/SHA-256으로 복사하고 `protected`, `temporary`를 제외한다. 기존 목적지, path traversal, 절대경로, source symlink/junction 탈출, 복사 전후 hash drift를 거부하며 실패 시 자신이 만든 불완전 목적지만 정리한다.

이번 후보의 고정 경로는 다음과 같다.

```text
C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\nexyfab-rc-20260822-001
```

스냅샷의 `RC-SNAPSHOT-MANIFEST.json`은 포함 파일과 원본/목적지 SHA-256, 제외 그룹, source branch/HEAD를 기록한다. 이 스냅샷은 `SNAPSHOT_ONLY`, `releaseReady=false`이며 외부 증거와 운영 gate가 닫히기 전 배포 대상으로 승격하지 않는다.

### 17.6 현재 승급 결론

- 내부 개발 후보: `PASS_LOCAL`
- clean source snapshot: manifest 검증을 전제로 `SNAPSHOT_ONLY`
- private beta: dirty original, 배포 build binding, 외부 기계 evidence 때문에 `BLOCK`
- GA: 30-feature 외부 closed loop, 30 direct designs, AI intent 150 외부 campaign, 표준 STEP/XCAF identity, blind holdout, 3개 제조 pilot, 독립 전문가 승인, 7일 운영이 없어 `BLOCK`
- production deploy: 실행하지 않음

## 18. 2026-08-22 후속 구현 — AI 설계·agentic 정밀 CAD 상용 실행 경계

이 절은 위 인계 이후 같은 dirty 작업트리를 보존한 채 진행한 Cycle 1~9 후속 구현과 재검증 결과다. production 배포, Railway 변수 변경, staging/production migration 적용은 수행하지 않았다.

### 18.1 구현 완료 범위

- Cycle 1~3: XCAF/실행 저널/7,407 reference lineage와 제조·MEP·ECAD·건축·인테리어·토목·조경 qualification을 실제 bytes, parser output, 역할 분리 Ed25519 trust, verifier-owned clock에 결속했다. 외부 reviewer·제작·현장 evidence가 없으면 계속 `HOLD`다.
- Cycle 4: approval challenge, one-use CAS, full command binding, durable execution journal, agentic common qualification receipt를 연결했다. synthetic qualification, signature transplant, replay, stale receipt, worker 실행 후 persistence 실패 재실행을 차단했다.
- Cycle 5: append-only migration `2026082202`, DB execution journal, atomic challenge/claim/journal, server-owned three-role trust registry, private receipt metadata store, strict `/api/health/ready`, migration checksum preflight, verified deploy/rollback/i18n release evidence를 추가했다.
- Cycle 6: append-only migration `2026082203`/`2026082204`, commercial worker v2 job/outbox/lease/callback, Ed25519 worker receipt, external verifier request/claim/callback, private evidence store를 추가했다. HMAC은 transport capability에만 사용하고 worker/verifier identity는 공개키 registry로 분리했다.
- Cycle 7: append-only migration `2026082205`/`2026082206`, actual private artifact snapshot readback, native-parser receipt, workspace CAS와 journal `COMMITTED`의 단일 transaction, candidate/final receipt binary codec와 server runtime 재검증을 추가했다.
- Cycle 8~9: append-only migration `2026082207`, PostgreSQL-authoritative generation run, server-generated run ID, tenant/project/editor/workspace binding, canonical state SHA append chain, program/state/workspace binding, exact part-set finalize, lifecycle-correct v2 enqueue를 연결했다. approval consume→journal→claim→outbox와 artifact→workspace→receipt→journal commit은 PG-style rollback/concurrency fixture로 검증했다.
- commercial mode에서는 Redis/memory state, local child worker, caller-provided registry/time/mode/raw receipt를 authoritative 경로로 사용하지 않는다. migration/checksum/trust/worker/object storage가 빠지면 fail-closed `HOLD`다.

### 18.2 최신 독립 재검증

- Cycle 9 generation/worker 통합 회귀: `17 files / 63 tests PASS`
- migration/rollback Node 회귀: `6/6 PASS`
- 공식 i18n: `7 files / 40 tests PASS`
- 확장 i18n: `30 files / 224 tests PASS`
- 변경 범위 ESLint: `PASS`
- 전체 `npm run typecheck`: `PASS`
- 전체 `npm run build`: `PASS`, static page `292`, bundle budget `PASS`
- build 잔여 경고는 기존 `scripts/drawing-to-3d/verify.mjs` 표현식 dependency 1건과 로컬 `REDIS_URL` 부재에 따른 in-memory rate-limit 경고다.

### 18.3 현재 commercial preflight

로컬 read-only `npm run commercial:preflight`는 의도대로 `12 blocker`로 실패했다. 주요 원인은 `DATABASE_URL`, `REDIS_URL`, `RECAPTCHA_ALLOWED_HOSTNAMES`, 명시적 `SECURITY_GATE_MODE`, worker isolation 설정, generation signing secret, stable Server Actions key가 이 로컬 실행 환경에 없고 DB migration을 검증할 수 없기 때문이다. 비밀값은 출력하지 않았다.

다음 항목은 코드로 합성하지 않고 실제 외부 실행 전까지 계속 `HOLD/BLOCK`한다.

- Railway PostgreSQL에 `2026082202`~`2026082207` 적용 및 각 source checksum/readiness 검증
- 실제 배포된 commercial executor/verifier와 분리 보관된 Ed25519 private key
- 실제 private object storage artifact/evidence readback 및 signed worker/parser/verifier receipt
- staging PostgreSQL 동시성·rollback·crash recovery E2E
- clean immutable RC, 실제 rollback drill, exact build/deployment binding
- 168시간·서비스별 28개 운영 window, 비용 표본, provider failover
- 독립 전문가·제작·측정·현장 evidence 및 blind holdout campaign
- 전체 제품 i18n 육안·RTL·이메일·PDF·export 검증

현재 판정은 `PASS_LOCAL / COMMERCIAL HOLD`다. 내부 protocol·state·receipt·migration·fail-closed 경계는 구현됐지만, 위 외부 증거와 실제 운영 환경 검증 없이 private beta/GA 또는 production 배포로 승격하지 않는다.

## 19. 2026-08-23 상용화 경계 보강 및 통합 재검증

이 절은 18절 이후 같은 dirty 작업트리를 보존하면서 수행한 Sol 점검, Luna bounded 구현, Sol 보완 및 통합 검증 결과다. 이번 작업에서도 production 배포, Railway 환경변수 변경, staging/production DB migration 적용은 수행하지 않았다.

### 19.1 구현·보강 결과

- append-only migration `2026082208`을 추가해 agentic journal identity 불변성, event/evidence/callback append-only, generation/request identity 불변성, receipt foreign key, private object key 제약을 정의했다. migration 존재 여부와 readiness는 이름만 세지 않고 정확한 table/constraint 및 table/trigger 쌍으로 검증한다.
- `npm run database:2208:verify-readonly`는 migration source checksum, 4개 constraint, 8개 trigger와 legacy 위반 row를 `SELECT`만으로 검사한다. `VALIDATE CONSTRAINT`는 실행하지 않고 계획만 출력한다. 현재 로컬에는 `DATABASE_URL`이 없어 결과는 `HOLD(database_url_missing)`이며 DB 변경은 없었다.
- `/api/health/ready`는 production Railway에서 commercial mode가 누락돼도 fail-closed하고 migration `2026082202`~`2026082208`과 정확한 catalog binding을 요구한다.
- `/api/health/release`를 read-only 상용 release evidence endpoint로 추가했다. exact build/deployment/git, DB migration/checksum, signed i18n receipt, 실제 evidence bytes에 결속된 7일 운영 receipt, 서로 다른 유효 verifier fingerprint 3개를 모두 검증할 때만 HTTP 200 `PASS`를 반환하고 그 외에는 HTTP 503 `HOLD/NOT_RUN`을 반환한다. DB URL, secret, 내부 오류는 노출하지 않는다.
- closed-beta integrity 및 production protected-state receipt를 immutable v2 계약으로 강화했다. 실제 source/state hash, release binding, freshness, self-hash를 재검산하며 legacy `ok: true`만 있는 receipt는 차단한다. protected-state 비교는 credential-free DB identity가 서로 달라야 하고 양측 protected table set이 정확히 같아야 한다.
- 7일 운영 receipt는 release head, 실제 source binding, self-hash와 HMAC을 함께 검증한다. 168시간, 28개 이상의 고유 sample binding, 2개 이상의 고유 cost binding, 정확한 service set과 freshness를 충족하지 않으면 승격하지 않는다.
- 상용 i18n catalog 자동 검증은 `2711/2711`이다. 다만 전체 제품의 6개 locale별 visual/RTL/email/PDF/export 육안 검토 packet은 unsigned `HOLD`이며, signer는 stale·synthetic·미승인·형식 불일치 artifact를 서명 전에 거부한다.
- 기계 분야 adapter v2와 건축·인테리어 golden-lineage operations report, 건설 canonical work-package receipt를 추가했다. 실제 reviewer, license, assignment, 제작·측정·현장 evidence가 없는 항목은 계속 `HOLD/NOT_RUN`이다.

### 19.2 최신 독립 검증

- focused Node integration: `64/64 PASS`
- focused Vitest: `37/37 PASS`
- 합계: `101 tests PASS`
- 변경 범위 ESLint: `PASS`
- 전체 `npm run typecheck`: `PASS`
- 전체 `npm run build`: `PASS`, static page `292/292`, App Router entry `157`, bundle budget `PASS`
- build 경고는 기존 `scripts/drawing-to-3d/verify.mjs` expression dependency와 로컬 `REDIS_URL` 부재 경고뿐이다.

### 19.3 실제 배포 상태와 현재 판정

2026-08-23 read-only 점검 기준 production web deployment와 staging web deployment 자체는 Railway에서 `SUCCESS`였고 public `/api/health/live`와 `/api/health/ready`는 HTTP 200이었다. 그러나 production 응답은 build가 `unknown`이고 strict readiness/release endpoint가 반영되기 전 코드이므로 현재 소스의 상용 release gate 통과 증거가 아니다. production commercial mode, migration checksum `2026082202`~`2026082208`, external worker/verifier와 일부 필수 secret도 검증되지 않았다.

최신 `docs/evidence/release/commercialization-readiness-current.json` 판정은 다음과 같다.

- private beta: `eligible=false`
- commercial GA: `eligible=false`
- 공통 blocker: uncommitted/dirty release candidate, build/deployment/rollback/image identity 누락, closed-beta integrity, protected-state 비교, production smoke, authenticated-user E2E, production migration receipt, backup/restore receipt
- 추가 GA blocker: 30-feature closed loop, 30 direct designs, 150 intent campaign, STEP conformance, blind challenge, manufacturing pilots/receipt, independent review, 7일 운영 receipt

따라서 현재 판정은 계속 `PASS_LOCAL / COMMERCIAL HOLD`다. production에 올라간 과거 build의 health 200을 현재 변경분의 검증이나 상용화 승인으로 간주하지 않는다.

### 19.4 다음 실행 순서

1. clean immutable RC를 만들기 전까지 dirty 사용자 변경을 보존하고 release identity를 합성하지 않는다.
2. staging에서 migration `2026082202`~`2026082208` checksum/read-only verification, 동시성, crash recovery, backup/restore, rollback drill을 수행한다.
3. 동일 build/deployment identity로 commercial worker, external verifier, private object storage readback, authenticated-user E2E와 `/api/health/release`를 검증한다.
4. 7일 운영 campaign과 비용 표본을 실제 시간·서비스별로 수집한다.
5. 독립 전문가, 실제 제작·측정·현장, blind holdout, 전체 제품 i18n reviewer evidence를 확보한다.
6. 모든 receipt를 exact build/deployment/git에 결속한 뒤 `npm run commercial:release-gate`와 `npm run commercialization:gate`가 모두 통과할 때만 승인된 production 배포로 진행한다.

주요 로컬 명령은 `npm run database:2208:verify-readonly`, `npm run i18n:full-product-review-packet`, `npm run operations:seven-day:receipt`, `npm run commercialization:gate`, `npm run typecheck`, `npm run build`다. 외부 증거가 없는 명령 실행 결과는 PASS로 승격하지 않는다.

## 20. 2026-08-23 v2 상용 증거·공개 AI 경계 통합

### 20.1 이번 구현 주기

- Railway resource baseline v2는 실제 source JSON의 경로·바이트·SHA-256을 결속하고 memory maximum, limit, capture time, 판정을 gate가 다시 계산한다. receipt만 다시 해시한 위조 값은 승격 근거가 되지 않는다.
- synthetic campaign v2는 5개 분야의 source case와 commercial corpus를 exact hash로 대조하고, case × campaign × repeat의 1,500개 run 및 모든 required gate 통과를 원시 결과에서 재도출한다.
- PostgreSQL migration receipt v2는 `2026082202`~`2026082208` source와 database checksum, 실행 결정, 전후 business row-count snapshot을 결속한다. staging/production DB에는 이번 주기에도 쓰기나 migration apply를 하지 않았다.
- OpenSCAD HTTP smoke v2는 production-bound HTTP request/response와 실제 STL bytes, binary/ASCII 분류, release identity, freshness를 검증한다. mock 응답으로 PASS receipt를 만드는 CLI는 제거했다.
- Railway staging isolation v2는 production/staging 변수의 원문을 저장하지 않고 fingerprint만 기록하며, DB·Redis·결제·object storage·quota 격리와 HMAC/self-hash를 검증한다. 이번 주기에는 Railway 변수 조회나 변경을 실행하지 않았다.
- commercial security receipt v2는 route matrix, CAD API control, secret scan, dependency audit, `package-lock.json`을 exact bytes로 결속한다. readiness gate는 이제 raw aggregate boolean이 아니라 이 receipt verifier만 승격 권한으로 사용하고, receipt hash·source binding·derived 결과를 최종 report에 남긴다.
- Railway resource capture는 `railway metrics --memory --raw --json`의 비밀값 없는 측정치만 정규화해 저장하며, source/receipt 출력 모두 lexical path뿐 아니라 realpath와 부모 junction 경계까지 검사한다. 실제 Railway 질의는 clean RC와 승인 전이므로 `NOT_RUN`이다.
- closed-beta/protected-state v2는 빈 protected table, malformed/duplicate file, primary-key 변경, 누락·변경 행을 blocker 없이 숨긴 내부 불일치를 거부한다. 상용화 gate는 source binding boolean만이 아니라 두 v2 verifier의 전체 재파생 결과도 요구한다.
- production live smoke와 isolated staging authenticated E2E는 각 check의 정확한 HTTP method/path/status, response body bytes/hash, ready commercial boundary, source artifact, freshness, release identity와 self-hash를 결속한다. 인증 E2E는 workspace marker, credential 비지속, 임시 project cleanup과 production/staging deployment 분리까지 확인하며 gate가 두 verifier 결과를 직접 요구한다.

### 20.2 공개 mutation 및 AI 비용 경계 보강

- route analyzer는 `getAuthUser(...).catch(() => null)`을 인증 gate로 오인하지 않으며, 즉시 401로 강제하는 경로와 선택적 identity enrichment를 구분한다. forwarding route는 실제 parent route source hash까지 결속한다.
- 최신 route security matrix는 `606 route files / 836 handlers`, unknown classification `0`, route gap `0`, exact public mutation policy `93`이다.
- `evaluate-report`는 shared studio AI budget/monthly slot guard, 256 KiB body bound, 128개 metrics key bound, provider task/signal을 적용한다.
- `quick-quote/upload`은 익명 vision에 guest daily quota를, 모든 vision 요청에 shared studio AI guard를 적용한다. JPEG/WebP MIME와 abort signal을 보존하고 client/dimension geometry의 finite·크기 상한을 검사한다.
- public telemetry는 전용 `30 requests/min` 제한과 context depth 4, 4 KiB bound를 적용한다. partner portfolio view는 trusted client IP, `60 requests/min`, source 64자 제한, 실제 partner role/directory 존재 확인 후에만 기록한다.
- public DFM은 `60 requests/min`, 최대 128개 finite parameter와 key/file ID bound를 적용한다. estimate는 8개 지원 공정 enum 외 임의 공정 ID를 거부한다.

### 20.3 최신 독립 검증

- focused Node component/gate/manual suite: `87/87 PASS`. Windows sandbox의 child-process `EPERM` 한 건은 승인된 동일 테스트 재실행에서 `3/3 PASS`로 확인했다.
- 새 public-boundary focused Vitest: telemetry/portfolio/DFM `15/15 PASS`, quick-quote geometry/quota `12/12 PASS`.
- manual ledger는 `20 manuals / 46 requirements / 30 atomic / 20 mapped / 0 unmapped`, trace validator는 `40 baseline requirements`를 통과했다. 실제 license/provenance/독립 reviewer evidence는 계속 `HOLD`다.
- 변경 범위 ESLint: `0 errors / 0 warnings`.
- 전체 `npm run typecheck`: `PASS`.
- 전체 `npm run build`: `PASS`, static page `292/292`, App Router entry `157`, bundle budget `PASS`.
- build 경고는 기존 `scripts/drawing-to-3d/verify.mjs` expression dependency 1건과 로컬 `REDIS_URL` 부재에 따른 in-memory rate-limit 경고다.
- 최신 secret scan은 `7,545 files / 87,351,459 bytes / 0 findings`, dependency audit은 모든 심각도 합계 `0`, supply-chain manifest는 CycloneDX 1.5 `1,005 components / 1,006 dependencies / 0 vulnerabilities`다.
- 최신 v2 receipt/gate 통합 Node 검증은 `71/71`, authenticated E2E receipt Vitest는 `3/3`을 통과했다. 하위 묶음으로 Railway resource `9/9`, closed-beta/protected-state/gate `36/36`, production live smoke/gate `29/29`도 확인했으며 해당 변경 범위 ESLint와 전체 typecheck도 `PASS`다.
- arbitrary-axis exact CAD 재검증은 architecture adapter·실제 OCCT integration·node bridge `3 files / 60 PASS / 1 skipped`다. 수평 X/Y와 사선 cylinder가 실제 boolean subtraction 뒤 유효 폐쇄 솔리드 STEP으로 남고, 잘못된 축·반지름·깊이는 fail-closed한다.
- golden campaign source resolver는 6개 scenario의 23개 authoritative input을 실제 regular-file bytes/SHA-256에서만 해석한다. office/apartment/cafe에 MEP service opening companion, comprehensive residential, IFC4.3 regression을 추가했다. approved root realpath, symlink/junction, traversal, duplicate realpath, 선언 hash/bytes, file/total cap과 read 도중 identity drift를 검사하며 license/reviewer/score eligibility는 생성하지 않는다. source resolver focused 회귀는 `8/8 PASS`다.
- golden holdout 승인은 더 이상 `reviewerId + 임의 hash`만으로 eligibility를 만들 수 없다. canonical receipt bytes/path, actual SHA-256, Ed25519 signature, trusted reviewer role/key, distinct reviewer/key, source/suite/release hash, freshness, approved-root realpath를 모두 검증한다. `requiredReviewers=0` 약화와 16개 초과 입력도 fail-closed하며 실제 서명 receipt가 없으므로 현재 6개 scenario 모두 `HOLD`다.
- sheet metal, welded fabrication, mold tooling, piping, HVAC, ECAD/MCAD 6개 독립 release channel을 추가했다. 각 채널은 기계·공간·다른 전문분야 boolean을 빌리지 않고 실제 qualification/evidence bytes, release identity, self/target hash, distinct Ed25519 reviewer 2인을 결속한 specialty receipt가 있어야 private beta와 GA가 열린다. verifier는 `6 PASS / 1 symlink-permission skip`, commercialization gate는 `26/26 PASS`다.
- API/CLI/MCP parity 회귀는 기존 `4 files / 75 PASS`를 유지한다. 새 CLI offline roundtrip은 help→capabilities→STEP reference analyze→release decision→assembly verify와 malformed/exit/path boundary를 통과했고, package 응답의 traversal·absolute path·duplicate·malformed entry·invalid ZIP·size cap을 write 전에 거부한다.
- local agent MCP gateway는 strict JSON-RPC envelope/id/params, notification 무응답, serialized framing, scope/profile, inherited tool name, Windows/Unix separator, drive/UNC/NUL, project-root/junction/symlink containment, sanitized error를 검사한다. focused MCP policy/server 회귀는 `2 files / 17 PASS`이며 실제 stdio `initialize`/`tools/list`는 protocol `2025-03-26`, source profile, `43`개 read-only tool을 반환했다.
- Chrome DevTools MCP로 production landing과 CAD capabilities를 직접 관찰했다. landing은 1920×1080에서 horizontal overflow가 없고 46개 network request가 모두 HTTP 200이었으며, capabilities는 HTTP 200·42 operations다. production Lighthouse baseline은 Accessibility `97`, Best Practices `100`, SEO `100`, Agentic Browsing `59`, CLS `0.147`이었다. local source는 chat file/textarea identity, language accessible name, article role, 10개 contrast 대상과 client-only hero의 `560px → 100dvh` loading height mismatch를 보정했고 source 회귀·typecheck·build를 통과했다. Chrome local 재측정은 MCP tab timeout으로 완료하지 못했고 배포하지 않았으므로 production 해소 증거는 계속 `NOT_RUN`이다.
- golden lineage qualification과 operations report를 3개에서 6개 시나리오로 동기화했다. 실제 source root와 inventory에서 CAD 확장자만 사용한 46개 후보를 path/bytes/SHA-256으로 재검증했고, 두 영수증은 구조 검증 `valid: true`이면서 assignment/license/reviewer 부재에 따라 의도대로 6개 모두 `HOLD`다. 관련 Node 회귀는 `13/13 PASS`다.
- robot swept interval 검증, civil parabolic vertical-curve evaluator, empty exact-worker queue release 차단을 추가했다. Sol 보강 후 invalid sample period, 빈 식별자, 인접 접선 범위 초과도 fail-closed하며 새/직접 영향 Vitest는 `4 files / 19 PASS`, 전체 typecheck와 변경 범위 ESLint는 `PASS`다. exact worker 실제 명령, exact B-rep robot backend, 법규 권위와 native civil roundtrip은 계속 `HOLD/NOT_RUN`이다.
- 다음 내부 라운드에서 exact-worker corpus locator의 symlink/junction realpath escape를 차단하고, robot verified-systems audit이 continuous collision coverage를 직접 요구하도록 연결했으며, document-bound door/circulation verifier를 추가했다. Sol 보강으로 빈/malformed route, sample/path budget, 과도한 swing과 clearance 누락을 차단했다. 직접·소비자 영향 Vitest는 `6 files / 33 PASS`, 전체 typecheck와 변경 범위 ESLint는 `PASS`다. lineage qualification도 license와 scenario-fit reviewer가 같으면 `independent_reviewer_required`로 거절하며 Node 회귀는 `14/14 PASS`다.
- 라운드 3은 exact-worker queue/native request를 500개로 제한하고 schema/ID/hash/member/locator/worker kind/duplicate case를 worker spawn 전에 검증하며 native↔queue archive hash 불일치도 거절한다. robot motion coverage는 path/frame/segment/swept-artifact content binding을 재계산해 최종 audit까지 전달하고, architecture route는 line-wall door aperture crossing을 검증한다. Sol 통합 후 직접·소비자 Vitest는 `6 files / 40 PASS`, lineage Node는 `14/14 PASS`, 전체 typecheck와 변경 범위 ESLint는 `PASS`다. curved door host, 실제 swept artifact bytes/독립 kernel, native worker 실행은 계속 `HOLD/NOT_RUN`이다.
- 라운드 4는 exact-clash의 transient allowlist·5회 상한·durable backoff retry, robot swept evidence 실제 bytes 재해시와 최종 audit 결속, directed arc-wall analytic aperture crossing을 추가했다. Sol 검토에서 robot library만 강화되고 HTTP/UI가 evidence bytes를 전달하지 않아 정상 입력도 422가 되는 통합 결함을 발견해, 최대 512개·파일당 5MB·합계 50MB의 반복 `sweptEvidence` multipart 경계와 UI 업로드를 연결했다. 직접·소비자 통합 Vitest는 `9 files / 57 PASS`, 정밀 CAD agent 전체는 `25 files / 171 PASS`, MCP/CLI 경계는 `7 files / 98 PASS`, lineage Node는 `14/14 PASS`, 전체 typecheck와 변경 범위 ESLint는 `PASS`다. 실제 exact-clash worker 운영·비용/quota, 독립 swept B-rep 산출, obstacle/furniture·다중 문 순서·native 산출은 계속 `HOLD/NOT_RUN`이다.
- 라운드 3/4 이후 production build도 다시 통과했다. static page `292/292`, App Router entry `157`, shared chunk `723.5/795.7 KB`, worst first-paint `1759.8/1851.5 KB`로 budget 내다. 경고는 기존 MCP 동적 dependency와 local `REDIS_URL` 부재다. commercialization gate는 의도대로 exit 1이며 private beta/GA 모두 `eligible=false`다. dirty/uncommitted RC, release identity, protected-state/smoke/authenticated E2E, OpenSCAD/runtime/distributed quota, migration/restore, 1,500-run campaign, 기계 직접 설계·제작·7일 운영 증거와 현재 변경으로 stale해진 security source binding(`source_integrity_invalid`)을 거짓 PASS로 승격하지 않았다.
- 이번 통합 재검증은 앞선 AI 설계·exact CAD·OCCT·golden·release channel·API/CLI/MCP·landing 묶음 `16 files / 206 PASS / 1 skipped`에 이어, 이번 변경과 직접 영향 범위를 실제 OCCT STEP 생성·재수입까지 포함해 `19 files / 188 PASS / 1 skipped`로 다시 통과했다. lineage Node 회귀는 별도로 `13/13 PASS`, 전체 typecheck와 production build도 `PASS`다. build는 static page `292/292`, App Router entry `157`, bundle budget `PASS`; 경고는 기존 dynamic dependency 1건과 local `REDIS_URL` 부재뿐이다.
- 최신 post-build `git status --short`는 총 `1,648`개 항목(`modified 867`, `deleted 2`, `untracked 779`)으로 계속 dirty다. 사용자 소유 변경을 reset/삭제하지 않았으며 이 상태 자체가 commercial gate의 `release_candidate_not_committed`와 `current_release_working_tree_dirty`를 유지한다.
- standalone에는 `/api/health/release`가 사용하는 i18n·7일 운영 receipt가 source와 동일 SHA-256으로 포함됐다. commercial security receipt는 배포 전 gate 입력이며 runtime standalone 증거로 포장하지 않는다.

### 20.4 현재 판정과 다음 실행

현재 commercial security의 네 source 영역은 모두 local PASS지만 receipt 자체는 `HOLD`다. 실제 `buildId`, `deploymentId`, 40/64자리 `gitHead`가 없으므로 `release_build_id_missing`, `release_deployment_id_missing`, `release_git_head_invalid`를 그대로 유지한다. 통합 gate 역시 private beta와 GA 모두 `eligible=false`이며, OpenSCAD live smoke, runtime memory, isolated distributed quota, 1,500-run release-bound campaign, production migration/restore, authenticated E2E, clean RC와 exact release identity가 없으면 승격하지 않는다.

다음 순서는 다음과 같다.

1. dirty 사용자 작업을 그대로 보존한 채 closed-beta/protected-state, authenticated E2E/live smoke, resource capture 경로의 v2 source binding과 gate 연결을 완료했다. 실제 외부 capture는 아직 `NOT_RUN`이다.
2. clean immutable RC가 준비된 뒤에만 staging Railway variables를 read-only capture하고 동일 build/git에 결속한다.
3. 승인 후 staging에서 migration checksum/read-only verification, backup/restore/rollback, OpenSCAD HTTP 및 authenticated E2E를 실행한다.
4. production과 분리된 staging 증거가 모두 PASS인 뒤 production candidate를 배포하고 exact deployment identity로 receipt를 다시 생성한다.
5. 독립 전문가, 실제 제작·측정·현장, 7일 운영 증거는 실제 수행 전까지 `HOLD/NOT_RUN`으로 유지한다.

주요 v2 명령은 `npm run evidence:resource-baseline:v2`, `npm run evidence:synthetic-campaign:v2`, `npm run evidence:openscad-http:v2`, `npm run evidence:environment-isolation:v2`, `npm run evidence:security:v2`, `npm run commercialization:gate`다. `chrome-devtools` MCP 1.7.0은 Codex 전역 설정에 추가했으며 저장소 변경은 없다. 현재 Codex 세션에서 29개 tool 주입, 실제 `new_page`/snapshot/evaluate/network 호출, production `GET https://nexyfab.com/api/health/live/` HTTP 200과 JSON `status=ok`까지 확인했다. 응답의 `build=unknown`은 release identity 증거로 사용할 수 없으므로 production release gate는 계속 `HOLD`다.

### 20.5 2026-08-23 AI 설계·정밀 CAD·Agent·MCP·CLI 최종 통합 점검

- 전체 `src/lib/ai` 회귀는 `411 files / 3,032 PASS / 1 file skipped / 3 tests skipped`다. 실제 OCCT B-rep 생성, STEP 쓰기·재수입, 기계 design driver, 건축·인테리어 exact geometry, 로봇·전문 제조 release 계약을 포함한다. 최초 실행에서 assembly template 수가 59로 고정된 stale 회귀 1건을 발견했고, 현재 60개 template 전부가 `DEEP_DOCUMENT_ADAPTER_NOT_RUN` 경계를 가지도록 교정 후 전체 재실행을 통과했다.
- 건축·인테리어 집중 회귀는 `42 files / 272 PASS`, 정밀 CAD Agent 전체 실행·승인·journal/outbox/persistence/remote·Tauri bridge는 `25 files / 171 PASS`다.
- exact-clash 실패 API는 `RETRY_SCHEDULED`, `TERMINAL_FAILURE`, `LEASE_REJECTED`, `INVALID_FAILURE`, `RETRY_NOT_SAFE`를 구분하고 durable retry/backoff와 stale lease를 fail-closed 처리한다.
- robot swept evidence는 canonical artifact bytes/content hash, motion/path/frame/segment binding, 등록된 Ed25519 worker·kernel 서명, role/identity, 서로 다른 public key와 서로 다른 runtime identity를 요구한다. HTTP route는 multipart와 JSON MIME, 파일 수·개별/총 bytes를 제한한다. 다만 chunked multipart를 `formData()` 이전에 완전히 차단하는 ingress-level cap과 실제 독립 native B-rep/물리 backend 증거는 아직 `HOLD`다.
- architecture door/circulation은 architecture ID/revision/content hash, obstacle source revision/hash, obstacle clearance envelope의 공간 포함, route storey와 door host storey, 다중 door order/cardinality, line/directed-arc aperture, route/swing obstacle collision까지 검증한다. sampled geometry를 권위 법규·native BIM·현장 검토로 승격하지 않는다.
- 공개 다운로드 MCP, 로컬 Agent MCP, engineering-core/drawing-to-3d 공유 stdio transport를 legacy `2025-11-25` 이하와 modern `2026-07-28` dual-era로 정리했다. modern 요청은 매 요청 protocol `_meta`, namespaced discovery client info/capabilities, `resultType`, server info, `ttlMs/cacheScope`, 표준 `-32022`의 `supported/requested`를 사용한다. JSON-RPC error에는 비표준 top-level `_meta`를 넣지 않으며 unknown tool은 `-32602`, schema 실패는 `isError` tool result다. id 없는 request형 method는 응답뿐 아니라 실행·era 변경도 하지 않는다. 기준은 공식 [MCP Discovery](https://modelcontextprotocol.io/specification/draft/server/discover)와 [Versioning and Compatibility](https://modelcontextprotocol.io/specification/draft/basic/versioning)다.
- CLI는 request+body 전체 timeout, redirect 거절, declared/streaming response cap, 성공 응답의 malformed JSON 거절, 입력 JSON/text bytes·UTF-8·확장자·traversal 경계를 적용한다. 공개/Agent MCP도 upstream error body·URL·credential/path 진단 노출을 축소했다.
- 최종 직접 통합 회귀는 `13 files / 168 PASS`; 공유 MCP transport 단독은 `16/16 PASS`; CLI offline 왕복은 `1/1 PASS`; Windows Agent sidecar `installer-core` check도 `PASS`다. 전체 typecheck와 변경 범위 ESLint는 `0 errors / 0 warnings`다.
- 최종 production build는 `PASS`: static page `292/292`, App Router entry `157`, shared chunk `723.5/795.7 KB`, worst first-paint `1759.8/1851.5 KB`. 경고는 기존 dynamic dependency 1건과 로컬 `REDIS_URL` 부재다.
- 최신 `git status --short`는 `1,655`개 항목(`modified 871`, `deleted 2`, `untracked 782`)이며, `--untracked-files=all` leaf 기준은 `2,849`개(`modified 871`, `deleted 2`, `untracked 1,976`)다. 사용자 변경은 reset·삭제·checkout하지 않았다.
- 최신 commercialization gate는 의도대로 exit `1`: private beta `eligible=false / 19 blockers`, GA `eligible=false / 28 blockers`, commercial security receipt `verified=false / 5 blockers`다. clean immutable RC, exact build/deployment/rollback/image identity, staging 격리·migration/restore, production smoke/authenticated E2E, distributed quota/runtime memory, 1,500-run campaign, 실제 기계 직접 설계·제작·측정·7일 운영 및 독립 전문가 증거가 없으므로 상용 출시를 선언하지 않는다.
- `chrome-devtools-mcp` 1.7.0은 Codex 전역 stdio MCP로 등록·패키지 확인됐다. 새로 등록된 도구가 현재 세션의 tool inventory에 나타나지 않으면 Codex 새 세션/재시작 후 사용한다. 이번 주기에는 Railway 변수 변경, migration, 배포, production mutation을 실행하지 않았다.

### 20.6 2026-08-23 스트림 경계·MCP 프레이밍·실제 복구 E2E 보강

- 로봇 motion coverage 업로드는 chunked multipart를 포함해 실제 수신 바이트를 `formData()` 이전에 최대 55,000,000 bytes로 제한한다. 초과 즉시 reader를 cancel하고 413 `TOO_LARGE`를 반환하며, 빈 본문·stream 오류·malformed multipart는 400으로 fail-closed한다. 검증된 본문을 다시 파싱할 때는 multipart boundary가 포함된 `content-type`은 유지하되 공격자가 선언한 `content-length`와 `transfer-encoding`은 제거한다. 파일 수 512개, 개별 5 MB, evidence 합계 50 MB, JSON MIME 경계도 그대로 유지한다. 플랫폼 ingress 자체 상한과 실제 독립 swept B-rep backend는 계속 `HOLD/NOT_RUN`이다.
- engineering-core/drawing-to-3d 공유 stdio, 로컬 Agent MCP, 공개 다운로드 MCP는 `readline`의 사후 문자열 길이 검사가 아니라 incremental byte-bounded newline framer를 사용한다. 최대 1 MB frame만 보존하고 초과 frame은 다음 newline까지 버린 뒤 frame당 canonical error 하나만 출력한다. split UTF-8 bytes, split CRLF, oversized frame 뒤 정상 요청 복구와 비동기 tool call의 직렬 응답 순서를 검증했다. id 없는 request형 method는 실행·protocol era 변경·응답을 만들지 않으며 legacy/modern dual-era와 표준 오류 envelope는 유지한다.
- staging 전용 authenticated architecture/interior recovery E2E를 추가했다. 실제 project 생성과 concept commit 뒤 동일 wall ID를 apply edit → undo → browser reconnect/reload → redo하고, revision 증가·content hash 변화·architecture/interior document ID·전체 object ID set·편집 대상 값을 대조한다. viewer의 agent/history write는 각각 403 `EDITOR_REQUIRED`여야 하며 임시 project 삭제 후 GET 404까지 확인해야만 release identity가 결속된 PASS receipt를 쓸 수 있다. production host, staging marker 없는 계정, 명시적 mutation confirmation 없는 원격 staging을 거부한다. 현재 자격증명과 승인된 staging 실행이 없으므로 Playwright 2개 구성은 수집만 확인했고 실제 결과는 `NOT_RUN`이다.
- Sol 재검토에서 reconstructed multipart의 stale transport framing 제거와 MCP JS stream JSDoc 타입을 보정했다. 독립 회귀는 MCP/CLI `7 files / 110 PASS`, 로봇 multipart·motion·verified audit `4 files / 34 PASS`, 전체 `src/lib/ai` `411 files / 3,032 PASS / 1 file skipped / 3 tests skipped`다. 전체 typecheck, 변경 범위 ESLint와 세 MCP entry의 `node --check`는 모두 PASS다.
- production build는 다시 PASS했다. static page `292/292`, App Router entry `157`, shared chunk `723.5/795.7 KB`, worst first-paint `1759.8/1851.5 KB`로 budget 이내다. 기존 expression dependency 1건과 로컬 `REDIS_URL` 부재 경고는 남아 있으며 distributed production rate limit 증거로 승격하지 않는다.
- 2026-08-23 read-only production 재확인은 `/api/health/live/` HTTP 200, `/api/health/ready/` HTTP 200, `/api/health/release/` HTTP 404다. 따라서 production은 살아 있지만 현재 소스의 strict release endpoint가 반영된 동일 build가 아니며, 이번 로컬 PASS를 production 검증으로 간주하지 않는다.
- 변경 후 security source evidence는 route `606 files / 836 handlers / 0 gaps / 93 public mutation policies`, CAD API `83 files / 85 handlers / 0 issues`, secret scan `7,564 files / 87,681,967 bytes / 0 findings`다. commercial security receipt 자체의 blocker는 `release_build_id_missing`, `release_deployment_id_missing`, `release_git_head_invalid` 3개이며 source-derived route/CAD/secret/dependency 검사는 PASS다.
- 기계 로컬 폐루프는 `30/30 features`, `210/210 axes PASS`이지만 claim boundary가 local-only이고 external CAD/manufacturing 승인이 없으므로 commercial release는 false다. PostgreSQL `2026082208` read-only 검증은 `DATABASE_URL` 부재, mutation attempted false로 `HOLD`; synthetic 1,500-run campaign과 실제 recovery E2E도 원시 실행 증거 부재로 `NOT_RUN`이다.
- 최종 `git status --short`는 `1,659`개 항목(`modified 871`, `deleted 2`, `untracked 786`)이고 `--untracked-files=all` leaf 기준은 `2,853`개(`modified 871`, `deleted 2`, `untracked 1,980`)다. 기존 사용자 변경은 reset·삭제·checkout하지 않았다. 문서 내부 상대 링크는 `48/48` 유효하다.
- 최신 commercialization gate는 의도대로 exit `1`: private beta `eligible=false / 19 blockers`, GA `eligible=false / 28 blockers`다. clean immutable RC, exact deployment/build/rollback/image identity, staging DB·backup/restore, production smoke, distributed quota/runtime memory, 직접 설계·STEP conformance·blind challenge·제작/측정·독립 전문가·7일 운영 증거가 준비될 때까지 현재 판정은 `PASS_LOCAL / COMMERCIAL HOLD`다. 이번 주기에도 배포, Railway 변수 변경, DB migration/apply, production mutation은 실행하지 않았다.

### 20.7 2026-08-23 전 제품 API ingress 상한·최종 Sol 검증

- `src/app/api`의 606개 route file 전체를 다시 조사해 mutation 본문을 읽는 직접 `req/request.json()`, `text()`, `formData()`, `arrayBuffer()`, `blob()` 호출을 `0`건으로 만들었다. JSON, raw signature body, multipart는 실제 streaming byte를 측정하는 bounded reader를 사용하고 declared oversize와 거짓으로 작은 `Content-Length` 모두에서 reader를 취소한다. disabled SCIM과 deprecated 410 route처럼 본문을 읽지 않는 handler는 그대로 유지했다.
- AI 설계·정밀 CAD ingress뿐 아니라 auth, admin, billing/payment/webhook, partner/contracts, RFQ/BOM/manufacturer, order/org/team, document/template/quote, account/service, collaboration/project, STEP/file import, 내부 worker callback까지 동일 경계를 적용했다. webhook은 Stripe/Toss/Airwallex/Dodo/inbound email/shipping의 원문 바이트를 서명 검증까지 보존하고 invalid UTF-8 또는 초과 입력에서 DB·결제 side effect 전에 fail-closed한다.
- 최신 route security matrix는 `606 files / 836 handlers / 0 gaps / 93 public mutation policies`, CAD API control은 `83 files / 85 handlers / 0 issues`다. secret scan은 `7,596 files / 88,005,694 bytes / 0 findings`, dependency audit은 모든 심각도 `0`, CycloneDX 1.5 supply chain은 `1,005 components / 1,006 dependencies / 0 vulnerabilities`, license check는 `685 packages`를 통과했다. 확인된 critical-copyleft 3개는 notice/정책 대상이며 이 검사에서는 실패가 아니다.
- 전체 API 회귀에서 `197 files / 1,149 PASS`를 확인했다. 최초 실행에서 image-to-sketch 테스트 fixture가 실제 streaming `Request`가 아닌 `.json()` mock에 의존하던 1건을 발견해 실제 JSON Request로 교정했다. 첫 production build는 Next route가 허용하지 않는 body-cap 상수 export 5건을 잡았고, 상수를 route 내부로 숨기고 테스트 상수를 분리한 뒤 관련 `6 files / 20 PASS`, typecheck, scoped ESLint를 통과했다.
- 전체 `src/lib/ai`는 `411 files PASS / 1 file skipped`, `3,040 tests PASS / 3 skipped`다. 실제 OCCT STEP 생성·쓰기·재수입을 포함한다. 분야별 정확도는 기계 `49`, 건축 `99`, 인테리어 `84`, 토목 `85`, 조경 `72`로 합계 `389/389 PASS`; i18n은 공식 `40/40`, 확장 `228/228 PASS`다.
- CAD v1은 `69 files / 229 PASS`, 전체 API의 실제 OCCT 경로까지 포함한 회귀도 위 `1,149/1,149 PASS`다. 기계 내부 검증은 direct CAD `17 files / 136 PASS`, accuracy `49/49`, intent qualification 150개와 runtime 10×7축, SQLite assembly/drawing handoff `3 files / 11 PASS`, 전체 typecheck를 모두 통과했다. receipt의 claim boundary는 계속 internal-only이며 AI model 실호출·독립 STEP 적합성·blind challenge·실제 제작은 승격하지 않았다.
- Agent/MCP/CLI 경계는 MCP transport·installer/sidecar·downloadable/local server·capability parity·CLI 묶음 `6 files / 89 PASS`, 실제 CLI subprocess offline roundtrip `1/1 PASS`, Windows sidecar bundle/check `PASS`다. `chrome-devtools-mcp` 1.7.0은 Codex 전역 stdio MCP로 enabled 상태이며 현재 세션에 도구가 노출되지 않으면 새 Codex 세션/재시작 후 사용한다.
- 최종 전체 `npm run typecheck`, `npm run lint:ci`, `git diff --check`는 PASS다. production build도 PASS했고 static page `292/292`, App Router entry `157`, shared chunk `723.5/795.7 KB`, worst first-paint `1764.0/1851.5 KB`로 budget 안이다. 경고는 기존 MCP expression dependency 1건과 local `REDIS_URL` 부재다.
- 메모리 안전의 남은 GA HOLD를 명시한다. system scale multipart는 최대 500 MB급을 재버퍼링해 1 GB 이상 peak 가능성이 있고, mesh slice/unfold는 384/192 MiB, Replicad·partner model·send-mail attachment는 약 100/102 MiB, drawing import는 86 MiB, quick quote는 250 MiB급 in-memory 경로가 남아 있다. object-storage direct streaming, incremental multipart parser, worker isolation과 실제 runtime memory capture 전에는 상용 대용량 ingress PASS가 아니다. SAML assertion signature validation도 아직 구현되지 않아 commercial SAML activation은 HOLD다.
- read-only production 확인은 `/api/health/live/` HTTP 200, `/api/health/ready/` HTTP 200, `/api/health/release/` HTTP 404다. 현재 production은 살아 있지만 이 소스의 strict release endpoint와 같은 build가 아니다. commercial security receipt는 source-derived 네 영역이 PASS이나 `release_build_id_missing`, `release_deployment_id_missing`, `release_git_head_invalid` 3개로 `HOLD`; commercialization gate는 private beta `19 blockers`, GA `28 blockers`로 계속 `eligible=false`다.
- 최종 working tree는 `git status --short` 기준 `1,958`개 항목(`modified 1,135`, `deleted 2`, `untracked 821`), leaf 기준 `3,153`개(`modified 1,135`, `deleted 2`, `untracked 2,016`)다. 문서 내부 상대 링크는 `49/49` 유효하다. 기존 사용자 변경을 reset·삭제·checkout하지 않았다. 이번 주기에도 deployment, Railway variable mutation, DB migration/apply, 실제 결제·메일·스토리지·provider mutation을 실행하지 않았다.

### 20.8 2026-08-23 SSO 차단 경계·대용량 메모리·Agent 실행물 후속 Sol 검증

- 상용 SAML은 불완전한 XML 파싱이나 자체 서명 검증을 만들지 않았다. 유지보수되는 XMLDSig/SAML verifier, IdP 인증서 rollover allowlist, signed Response/Assertion과 unique-ID reference, wrapping/duplicate-ID 거절, issuer/audience/destination/time, AuthnRequest `InResponseTo`, replay cache, 검증된 principal의 로컬 세션 발급이 하나의 경계로 연결되기 전까지 설정 활성화와 callback을 `503 SAML_SIGNATURE_VERIFIER_UNAVAILABLE`로 fail-closed한다. disabled metadata staging은 허용하고, 활성화 요청은 DB mutation 전에 거절한다.
- 기존 OIDC callback은 one-use state/nonce/PKCE와 ID token 검증 없이 discovery→token→userinfo 결과와 token을 반환할 수 있었다. 해당 경로를 제거하고 OIDC 활성화와 callback을 DB·IdP fetch 전에 `503 OIDC_COMMERCIAL_FLOW_UNAVAILABLE`로 차단했다. `jose`는 이미 있지만 login-start transaction store, pinned HTTPS discovery, JWKS/algorithm allowlist, `iss/aud/azp/exp/iat/nonce`, userinfo `sub` binding, redirect allowlist, verified provisioning과 HttpOnly local session이 함께 구현되기 전까지 상용 OIDC는 `HOLD`다. SAML/OIDC 집중 회귀는 `4 files / 12 PASS`다.
- 대용량 ingress는 route가 광고하는 cap과 proxy의 route-specific cap을 맞췄다. scale multipart는 `128 MiB body / 124 MiB file aggregate`, quick quote와 partner upload는 `64 MiB`, 일반 CAD·papercraft JSON은 `16 MiB`, send-mail은 `20 MiB body / 18 MiB attachment aggregate`다. quick quote 파일 처리는 순차화했고 papercraft mesh scalar 상한을 추가했다. send-mail은 `File.arrayBuffer()+Buffer` 추가 복제를 제거하고 UUID-only private spool, root/request/file realpath containment, symlink/junction 거절, 가능한 `0700/0600`, 실제 stream byte count, partial-file 삭제와 모든 성공·실패 경로의 `finally` cleanup을 적용했다.
- 위 변경을 완전 streaming ingress로 부르지 않는다. Next `formData()`는 여전히 body를 materialize하고, server storage API는 Buffer 전용이며, scale verifier·OCCT/Replicad·papercraft 결과는 전체 artifact/working set을 메모리에 보유한다. 증분 multipart parser, object-storage direct upload, worker isolation과 실제 runtime memory capture 전까지 대용량 상용 증거는 `HOLD`다.
- `scripts/drawing-to-3d/verify.mjs`의 고정 OpenSCAD glue import는 `openscad.js`/`openscad.wasm` exact allowlist와 root containment를 거친 runtime-isolated import로 바꿨다. 변경 전 최소 webpack probe의 expression dependency 1건은 변경 후 0건이며, 최종 Next production build에서도 해당 경고가 사라졌다. caller-controlled module specifier는 허용하지 않는다.
- Windows Agent sidecar는 source bundle과 MCP smoke만 PASS다. 현재 Node v25.2.1은 legacy SEA config만 있고 `postject`, `signtool`, 예상 `.exe`가 없다. 가짜 실행물을 만들지 않고 [Windows SEA readiness receipt](../evidence/agent-sidecar/windows-sea-readiness-260823.json)와 [release HOLD](../agent-sidecar-windows-release-hold.md)를 추가했다. verifier는 exact source binding 집합·SHA-256·realpath, unsigned PE manifest, receipt self-hash, blocker 은폐와 signing claim 위조를 검사한다. 남은 blocker는 SEA injection toolchain, unsigned SEA, SHA manifest, 실제 SEA MCP/CLI parity smoke, Authenticode, disposable-VM installer evidence의 6개다.
- Sol 통합에서 테스트용 cap·spool helper를 route에서 export한 7건을 발견했다. helper를 일반 library로 분리하고 모든 route에는 Next가 허용하는 export만 남겼으며, 전체 API route의 비허용 export는 다시 `0`이다. 메일 spool root의 부모 junction에 의한 realpath 이탈도 추가로 차단했다.
- 새/직접 영향 회귀는 `11 files / 65 PASS`, 전체 API는 `199 files / 1,158 PASS`다. Agent/MCP/CLI는 `9 files / 146 PASS`, 실제 CLI subprocess offline roundtrip `1/1 PASS`, Windows SEA receipt/tamper Node 회귀 `3/3 PASS`다. 전체 `npm run typecheck`, `npm run lint:ci`, `git diff --check`는 PASS다.
- production build는 PASS다. webpack compile `3.3분`, TypeScript `119초`, static page `292/292`, App Router entry `157`, shared chunk `723.5/795.7 KB`, worst first-paint `1764.0/1851.5 KB`로 budget 안이다. 잔여 build 경고는 로컬 `REDIS_URL` 부재에 따른 in-memory rate-limit뿐이며 distributed production quota 증거로 승격하지 않는다.
- 최신 source evidence는 route security `606 files / 836 handlers / 0 gaps / 93 public mutation policies`, CAD API `83 files / 85 handlers / 0 issues`, secret scan `7,606 files / 88,046,001 bytes / 0 findings`, dependency audit 모든 심각도 `0`, CycloneDX 1.5 `1,005 components / 1,006 dependencies / 0 vulnerabilities`, license `685 packages`다. commercial security receipt의 raw blocker는 `release_build_id_missing`, `release_deployment_id_missing`, `release_git_head_invalid` 3개다.
- commercialization gate는 의도대로 private beta `eligible=false / 19 blockers`, GA `eligible=false / 28 blockers`다. 기계 scope는 `private_beta_evidence_pending`이며 30-feature 외부 closed loop, 10/30 direct designs, AI intent 150 실제 campaign, 표준 STEP 적합성, 20 blind challenge, 3 manufactured pilot receipt가 없다. 내부 구조·회귀 PASS를 외부 제작·측정·전문가 승인으로 승격하지 않는다.
- 최신 working tree는 branch `release/2026-08-10`, HEAD `3d6ba1ec461169d9d331b939e432483c3953b752`에서 `git status --short` `1,970`개(`modified 1,136`, `deleted 2`, `untracked 832`), leaf `3,166`개(`modified 1,136`, `deleted 2`, `untracked 2,028`)로 계속 dirty다. 사용자 변경을 reset·삭제·checkout하지 않았다. production은 앞선 read-only 확인의 live/ready HTTP 200, release HTTP 404인 이전 build이며, 이번 라운드에도 deploy, Railway variable mutation, DB migration/apply, 실제 IdP·메일·스토리지·결제 호출을 하지 않았다.

다음 순서는 clean immutable RC를 별도 조립한 뒤 exact build/git identity를 고정하고, 승인된 격리 staging에서 migration checksum·동시성·backup/restore·rollback, Redis 분산 quota, object-storage/worker memory, authenticated E2E와 `/api/health/release`를 검증하는 것이다. 그 다음에만 candidate deploy identity를 결속하고 7일 운영, 독립 전문가, blind holdout, 실제 제작·측정·현장 evidence를 수집한다. SAML/OIDC 또는 Windows SEA를 제품 범위에 포함해 출시하려면 위 fail-closed blocker를 먼저 실제 구현·검증해야 하며, 기능을 끈 상태로 출시할 때도 UI·계약·가격표에 미지원으로 명시해야 한다.

### 20.9 2026-08-23 제품 범위 gate·SSO 계약·clean RC 후속 점검

- SAML/OIDC 상용 경계와 고객에게 보이는 계약을 일치시켰다. 6개 locale의 공통 상태 계약은 모든 Free/Pro/Team/Enterprise plan에서 SSO entitlement를 `false`로 고정하고, 가격표와 Team 화면의 즉시 제공·99.9% SLA·전용 담당자 표현을 제거했다. Enterprise에는 `출시 전·별도 계약·보안 검증 필요`로 표시한다. SSO 설정 화면은 비활성 metadata staging만 허용하며 legacy `enabled=true`도 화면에서 비활성화하고 저장 payload를 항상 `enabled=false`로 강제한다. 로그인 활성화와 연결 테스트는 제공하지 않는다. 이는 상용 SSO 기능 PASS가 아니라 API와 UI가 함께 지키는 정직한 `HOLD` 계약이다.
- commercialization gate를 `nexyfab.commercialization-readiness.v4`로 올리고 제품 표면을 `web`, `enterprise`, `desktop`, `large-upload`로 명시했다. 기존 scope 미지정 mechanical-core 판정은 web-only private beta 호환성을 유지하지만 GA는 `product_release_scope_not_explicit_for_ga`로 차단한다. 모호한 scope는 전체 제품으로 해석해 fail-closed한다. Enterprise를 포함하면 isolated staging SAML/OIDC receipt, Desktop을 포함하면 실제 Windows PE SEA·SHA manifest·MCP/CLI parity·Authenticode·일회용 VM install/upgrade/uninstall/rollback receipt, large-upload를 포함하면 staging object-storage roundtrip·resume·abort cleanup·SHA readback·worker RSS receipt가 exact release/source/self-hash에 결속돼야 한다. 누락되거나 위조된 receipt는 합성 PASS 없이 `HOLD`다.
- 현재 scope 미지정 web-only 실행은 private beta `eligible=false / 19 blockers`, GA `eligible=false / 29 blockers`다. GA 수에는 명시적 제품 범위와 7일 운영 receipt가 포함된다. 전체 제품 scope로 실행하면 SSO·SEA·large-upload 실제 receipt가 추가로 필요하다. 따라서 이 수치는 전체 제품 승인 수치가 아니라 현재 기본 claim boundary의 fail-closed 진단이다.
- [전체 제품 commercialization report](../evidence/release/commercialization-readiness-full-product-current.json)는 명시적 `full-product` scope(`web`, `enterprise`, `desktop`, `large-upload`)에서 2026-08-23 최종 재평가 기준 private beta `eligible=false / 29 blockers`, GA `eligible=false / 53 blockers`다. `enterprise_sso_readiness_receipt_missing`, `windows_sea_release_receipt_missing`, `large_upload_staging_readiness_receipt_missing`이 최상위 private-beta blocker로 추가된다. 하위 진단에는 isolated staging SAML/OIDC, 실제 PE/manifest/MCP·CLI parity/Authenticode/installer lifecycle, object-storage roundtrip/resume/abort/SHA readback/worker memory의 미검증 항목이 각각 보존된다.
- 과거 `mechanical-single-part-candidates-260813` receipt는 receipt 자체 checksum은 유효하지만 결속된 source SHA-256 `79d9344b…`와 현재 source SHA-256 `2fce7ffc…`가 달라 stale임을 재현했다. 원본 receipt와 checksum은 수정하지 않고 동일 디렉터리의 `STALE.json`으로 `canonicalGateInput=false`, `usedForRelease=false`, `freshQualificationRequired=true`를 선언했다. release baseline은 stale receipt와 checksum을 `temporary/quarantined`로 분류하고 marker만 evidence로 유지한다. 오래된 baseline이 이를 evidence로 내보내려 하면 `baseline_group_classification_mismatch`로 실패한다.
- 최초 RC-002는 `9,421 files / 344,166,925 bytes`의 해시 무결성은 통과했지만 루트 생성 산출물 7개가 포함된 분류 결함이 있어 중간 스냅샷으로만 보존했다. 분류 규칙과 exporter의 group 재검증을 보강한 RC-003은 `9,414 files / 331,179,946 bytes`, 모든 destination SHA-256 일치, extra/missing/unsafe path `0`, `.git`·symlink·junction·reparse point `0`, protected `18`개와 temporary `381`개 전부 미포함으로 독립 재감사를 통과했다. 다만 이후 이 절의 SSO/gate/quarantine 변경이 추가됐으므로 RC-003도 최종 current-source snapshot은 아니다.
- release baseline/export 회귀는 `40 PASS / 1 Windows symlink-permission skip`, SSO·기계 focused Vitest는 `7 files / 22 PASS`, 전체 typecheck와 lint는 PASS다. 내부 상대 링크의 권위값은 문서 최종 편집 후 다시 계산한 §21 감사값을 따른다. 이 절 이후 다시 생성하는 `secret-scan-260810.json`과 commercial security receipt가 최종 스캔 수치·source binding의 권위이며, 앞 절의 시점별 스캔 수치를 current 보증으로 재사용하지 않는다. 여기서 말하는 build는 로컬 Next production-mode build이며 production deploy를 뜻하지 않는다.
- 이 절을 포함한 최종 source baseline과 새 absent destination RC는 아래 검증이 모두 끝난 뒤 별도로 생성한다. 그 manifest의 `status=SNAPSHOT_ONLY`, `releaseReady=false`가 권위 있는 상태다. build/deployment/rollback/image digest/DB schema provenance, staging·외부 전문가·제작·측정·현장 evidence가 null/HOLD인 동안 clean snapshot을 release-ready 승인물로 승격하지 않는다.
- 최종 source 고정 직전 working tree는 branch `release/2026-08-10`, HEAD `3d6ba1ec461169d9d331b939e432483c3953b752`에서 short `1,974`개(`modified 1,136`, `deleted 2`, `untracked 836`), leaf `3,171`개(`modified 1,136`, `deleted 2`, `untracked 2,033`)다. release baseline의 `workingTreeChanges=3,169`은 mutable web-only current receipt와 baseline current 2개를 의도적으로 제외한 값이다. 기존 사용자 변경은 reset·삭제·checkout하지 않았다.

최종 판정은 계속 `PASS_LOCAL / COMMERCIAL HOLD`다. 이번 후속에서도 deployment, Railway variable mutation, DB migration/apply, 실제 IdP·메일·스토리지·결제 호출을 수행하지 않았다.

### 20.10 2026-08-23 외부 제품 증거의 합성 PASS 차단 및 Sol 재검증

- Enterprise SSO, Windows SEA, large-upload의 최초 receipt 계약은 기본 `NOT_RUN/HOLD`는 안전했지만, 공격자 관점 재점검에서 자체 작성 JSON과 공개 self-hash만으로 양성 fixture를 합성할 수 있는 공통 결함이 확인됐다. 해당 PASS 경로를 승인 authority로 사용하지 않고 세 계약을 신뢰 키와 원시 artifact 재도출 기준으로 다시 구현했다.
- [Enterprise SSO staging runbook](../process/enterprise-sso-staging-evidence-runbook.md)과 [기본 SSO receipt](../evidence/release/enterprise-sso-readiness-receipt.json)는 고정 allowlist의 Ed25519 collector 서명, exact staging origin/deployment, DB·Redis·session 격리 receipt, 24시간 freshness와 run/receipt 시간 경계, 22개 SAML/OIDC case의 exact error·암호·transaction·session 관측을 요구한다. caller가 고른 allowlist, unsigned 합성 case, stale 재포장, 임의 staging 유사 도메인, 연결되지 않은 replay는 승격되지 않는다. release baseline 파일 자체의 bytes를 receipt가 다시 결속하면 baseline↔receipt 순환 해시가 생기므로 이를 제거하고 exact release tuple을 gate가 외부 권위로 대조하도록 조정했다. baseline 재생성 뒤에도 default receipt contract check가 안정적으로 통과한다.
- [Large-upload staging runbook](../runbooks/large-upload-staging-readiness.md)과 [기본 large-upload receipt](../evidence/release/large-upload-staging-readiness-receipt.json)는 실제 `>=64 MiB` source와 roundtrip/resume readback 두 파일의 streaming SHA-256, roundtrip·resume·abort provider response, worker RSS samples, 별도 runtime-limit export, staging isolation artifact를 각각 독립 binding으로 요구한다. 세 operation의 request/upload/object fingerprint는 모두 달라야 하며 hardlink·symlink·root escape, caller-inflated memory limit, hand-authored 단일 JSON, signer transplant를 거부한다.
- [Windows SEA release runbook](../agent-sidecar-windows-release-hold.md)과 [기본 Windows release receipt](../evidence/release/windows-agent-sidecar-release-receipt.json)는 allowlisted Ed25519 CI/release attestation을 필수화했다. 구조가 유효한 PE/WIN_CERTIFICATE, machine-readable Authenticode·chain·certificate·timestamp imprint, 실제 MCP/CLI JSONL의 request/baseline/SEA response와 exit code, provider-attested disposable VM의 install→upgrade→rollback→uninstall 순서·version transition·rollback recovery·residue 0을 raw bytes에서 다시 계산한다. 과거 512-byte fake certificate table, 임의 `Status: Valid`, 임의 `PASS` 로그는 attestation이 있어도 통과하지 않는다.
- 공유 commercialization gate의 양성 fixture도 동일한 서명·원시 증거 계약으로 교체했다. Sol 최종 묶음 회귀는 `55 tests / 54 PASS / 1 Windows symlink-permission SKIP / 0 FAIL`이며, SSO `7 PASS / 1 SKIP`, large-upload `7/7 PASS`, Windows SEA/readiness `8/8 PASS`, gate `32/32 PASS`를 포함한다. 변경 스크립트 ESLint, 전체 `npm run typecheck`, 전체 `npm run lint:ci`, syntax와 diff 검사는 PASS다.
- 최신 secret scan은 `7,657 files / 88,863,058 bytes / 0 findings`다. commercial security receipt는 raw source 영역은 유효하지만 release identity가 없으므로 `release_build_id_missing`, `release_deployment_id_missing`, `release_git_head_invalid`로 계속 `HOLD`다.
- 현재 web-only 기본 gate는 private beta `19 blockers`, GA `29 blockers`; 명시적 full-product gate는 private beta `29 blockers`, GA `53 blockers`다. 세 제품 receipt는 모두 구조적으로 정직한 `HOLD`이며 SSO에는 실제 서명된 staging case, Desktop에는 실제 signed SEA와 VM lifecycle, large-upload에는 실제 staging object-storage 측정이 없으므로 `receiptVerified=false`다. 내부 양성 fixture는 verifier 회귀일 뿐 외부 상용 증거가 아니다.
- 2026-08-23 최종 export 직전 baseline은 `workingTreeChanges=3,410`, deployable `8,021`, documentation `331`, evidence `1,239`, protected `18`, temporary `383` 파일이다. 이전 short/leaf/workingTree 숫자는 작성 시점 스냅샷이며, 사용자 변경을 reset·삭제·checkout하지 않았다.

현재 판정은 `PASS_LOCAL / COMMERCIAL HOLD`다. 이번 단계에서도 production 배포, Railway 변수 변경, DB migration/apply, 실제 IdP·object storage·서명·installer·VM 실행을 하지 않았다.

### 20.11 2026-08-23 전체제품 의미·Agent/MCP/CLI·RC provenance 보강

- 최종 공격 관점 감사에서 기존 `full-product` 보고서가 제품 표면은 모두 선택하면서 release channel은 `mechanical-core`를 유지해, 기계 외 CAD 분야를 평가하지 않고도 전체제품으로 오인될 수 있는 의미 불일치를 발견했다. 전용 `npm run commercialization:gate:full-product` 명령은 이제 `platform + full-product`와 고정 출력 경로를 강제한다. `full-product`를 비호환 channel로 평가하면 `full_product_scope_release_channel_incompatible`로 fail-closed한다.
- platform 전체제품 계약은 기계·건축·토목·조경·인테리어 5개 domain, robot·gearbox·pressure vessel·turbomachinery·factory equipment·machine skid·welded enclosure·interior 8개 complex family뿐 아니라 sheet metal·welded fabrication·mold tooling·piping·HVAC·ECAD/MCAD 6개 specialty receipt를 각각 독립 검증한다. 한 track의 영수증을 다른 track에 재사용할 수 없고, 현재 실제 독립 영수증이 없으므로 6개 모두 `HOLD`다.
- [전체제품 commercialization report](../evidence/release/commercialization-readiness-full-product-current.json)는 평가한 baseline의 exact path/bytes/SHA-256과 release tuple의 명시적 null을 보존한다. Enterprise SSO, Windows SEA, large-upload와 6개 specialty의 상세 verifier blocker를 하위 evidence에 남기며, private beta와 GA 모두 `eligible=false`다. mutable current report를 baseline 입력에서 제외해 baseline↔report 순환 해시도 제거했다.
- large-upload 상태 보고는 caller가 적은 blocker를 그대로 신뢰하지 않는다. self-hash, source binding, 원시 artifact 재도출이 모두 일치한 receipt에 한해 object-storage roundtrip/resume/abort/SHA readback, operation identity, worker RSS, collector attestation, staging isolation의 상세 blocker를 보고서로 전파한다.
- [Agent/MCP/CLI 로컬 readiness receipt](../evidence/local/agent-mcp-cli-readiness-current.json)를 추가했다. 고정된 MCP/CLI parity Vitest 9개 파일, 실제 CLI offline subprocess, Agent sidecar source-bundle check, Windows SEA fail-closed 회귀의 raw result와 source inventory를 SHA-256/self-hash로 결속한다. 실제 실행은 MCP/CLI `145/145 PASS`, CLI roundtrip `1/1 PASS`, Windows SEA 계약 `8/8 PASS`이며 receipt는 `integrityOk=true`, `status=PASS_LOCAL`, `commercialReleaseEligible=false`다. 실제 signed SEA·Authenticode·disposable VM lifecycle은 별도 외부 `HOLD`로 남는다.
- clean RC exporter는 baseline 원문을 path/bytes/SHA-256으로 결속하고 sorted-key canonical manifest payload self-hash를 검증한다. 이 self-hash는 신뢰 서명이 아니므로 `trustedSignature=false`, `releaseAuthorization=false`, `deploymentAuthorization=NO_DEPLOY`, `status=SNAPSHOT_ONLY`, `releaseReady=false`를 강제한다. 실제 배포 승인에는 여전히 외부 서명된 release/build/deployment/rollback/image/DB provenance가 필요하다.
- 새/직접 영향 회귀는 commercialization gate `33/33 PASS`, large-upload+gate `40/40 PASS`, RC exporter `8 PASS / 1 Windows symlink-permission SKIP`, baseline `4/4 PASS`, full-product wrapper·Agent/MCP/CLI receipt `7/7 PASS`, scoped ESLint와 typecheck를 통과했다. production 배포, Railway 변수 변경, DB migration/apply, 실제 IdP·object storage·코드 서명·installer·VM·제조/측정은 실행하지 않았다.

현재 판정은 더 좁고 정확한 `PASS_LOCAL / COMMERCIAL HOLD`다. 로컬 구조·회귀·증거 계약은 상용 전환 준비 수준으로 강화됐지만, clean committed release와 정확한 배포 identity, 격리 staging, 실제 provider/SEA/VM, 독립 전문가, blind holdout, 실제 제작·측정, 7일 운영 증거 없이는 private beta 또는 GA로 승격하지 않는다.

## 21. 2026-08-23 bounded implementation handoff

이번 절은 기존 historical 절과 수치를 덮어쓰지 않고, 이번 라운드에서 실제로 구현·검증한 bounded 사실만 기록한다.

- CAD geometry: hole/slot과 linear/circular pattern 경로의 deterministic identity·parameter guard를 유지하고, kinematic/assembly 경로의 project revision binding을 보존했다. Assembly drawing은 canonical BOM row와 view-bound balloon anchor를 PDF/DXF/SVG export payload에 연결했다. BOM/balloon이 supplemental-only 상태로 남아 export에서 빠지는 경로는 차단했다.
- Sheet metal: P3 U-channel bend feature가 두 번째 bend에서 첫 flange를 재접지 않도록 feature semantics/topology를 분리했다. UI 없이 호출 가능한 flat-pattern DXF text accessor/export contract와 regression coverage를 추가했다.
- SCAD/AI/Agent: SCAD/AI/Agent project와 generation task는 project/workspace/revision/content hash 및 execution/generation task identity에 binding한다. artifact/result는 다른 project 또는 revision으로 재사용할 수 없고, missing/mismatched binding은 fail-closed다.
- MCP/CLI/sidecar: MCP/API/CLI는 동일한 input/read-write 분류·scope·project binding·error contract를 사용한다. durable write와 remote/consequential call에는 명시적 approval/confirmation이 필요하며, installer/sidecar는 source bundle·provenance·signature/VM evidence가 없으면 commercial release로 승격하지 않는다.
- Release boundary: 내부 회귀의 `PASS_LOCAL`과 commercial/release authorization을 분리했다. fail-open으로 보이는 local receipt나 self-hash만으로 release-ready 판정을 만들지 않는다.
- ECAD: connectivity/netlist/ERC 및 Gerber/drill/BOM 제조 export는 실제 지원 범위만 유지하며, 검증되지 않은 parity·manufacturer evidence·license는 `HOLD`다.
- Reference provenance: 세 source의 current utilization inventory는 7,407 files이며 authoritative input은 [current 260823 reference-utilization manifest](../evidence/cad-independent/reference-utilization-manifest-260823.json)다. historical 260809 qualification receipt는 immutable historical evidence로 보존하고 current receipt는 [260823 HOLD receipt](../evidence/architecture-interior-golden-lineage-260823/qualification-receipt.json)에 별도 생성했다. license/scenario attestation과 approved assignment가 없으므로 architecture/interior golden scenarios는 계속 `HOLD`다.
- Chrome DevTools MCP: version 1.7.0 is enabled for the workspace; restart is required before relying on the capability in a new session.
- Agent surface provenance: [current Agent surface matrix](../evidence/local/agent-surface-matrix-current.json)는 web Agent 11개 route, CAD v1 42개 연산, 그중 CLI 34개 연산, local MCP 90 tools, downloadable remote MCP 15 tools, installer sidecar 8 tools를 source path/bytes/SHA-256에 결속한다. 검증값은 `PASS_LOCAL`, `localReady=true`, `commercialReleaseEligible=false`이며 raw MCP entrypoint, web-only Agent parity, signed SEA/VM lifecycle은 계속 `HOLD`다.

이번 라운드의 최종 상태와 남은 경계:

- `PASS_LOCAL`: 전체 typecheck와 전체 `src` ESLint가 통과했다. 최신 production-mode build는 Webpack compile 9.8분 후 postbuild를 완료했고, bundle budget은 shared `723.5/795.7 KB`, worst first-paint `1764.0/1851.5 KB`로 통과했다. Node suite는 `551 PASS / 0 FAIL / 5 Windows symlink-permission SKIP`다.
- `PASS_LOCAL`: 1차 전체 Vitest의 유일한 실패는 OCCT/FEA 전체 부하와 동시에 측정된 ConfigurationTableV2 jsdom 단일 wall-clock 표본 `1538.4 ms > 1500 ms`였다. 단독 재측정은 `210.2 ms`; 제품 예산 1,500ms는 유지하고 3회 중앙값으로 안정화한 뒤 관련 `32/32 PASS`, 중앙값 `281.9 ms`를 확인했다. 최종 무경쟁 전체 재실행은 `2,779 files PASS / 10 SKIP`, `29,415 tests PASS / 89 SKIP / 1 todo`, `0 FAIL`, `1021.93 s`로 통과했다.
- `PASS_LOCAL`: 보안 원시 증빙은 route security `607 files / 837 handlers / 0 gaps`, CAD API control `83 route files / 85 handlers / 0 issues`, secret scan `7,657 files / 88,863,058 bytes / 0 findings`, dependency audit `1,250 dependencies / 0 vulnerabilities`다. commercial security v2 receipt는 raw 검사 PASS와 별개로 release build/deployment/git identity가 없어 정직한 `HOLD`다.
- `PASS_LOCAL`: 문서 링크 재감사는 Markdown link `65 occurrences`, 내부 `63 occurrences / 60 unique`, 외부 `2 occurrences`, missing `0`이다.
- `COMMERCIAL HOLD`: 최신 full-product gate는 private beta `29 blockers`, GA `53 blockers`이며 `eligible=false`다. release baseline은 branch `release/2026-08-10`, HEAD `3d6ba1ec461169d9d331b939e432483c3953b752`, `candidate_uncommitted`, `workingTreeChanges=3,410`; deployable `8,021`, documentation `331`, evidence `1,239`, protected `18`, temporary `383` 파일이다. 앞 절의 더 작은 blocker/route/scan/worktree 수치는 해당 시점의 historical snapshot이며 이 bullet이 current 권위값이다.
- `RC-009 SNAPSHOT_ONLY`: 기존 RC-006/008은 수정하지 않는다. absent sibling destination `../nexyfab-rc-20260823-009`에만 fail-closed exporter를 실행한다. 생성 완료의 권위는 이 문서의 자기주장이 아니라 RC 내부 manifest의 `SNAPSHOT_ONLY`, `releaseReady=false`, `NO_DEPLOY`, exact path/bytes/SHA-256 검증 결과다.
- `HOLD`: 외부 provider/deployment, database migration/apply, independent expert review, license approval, manufacturer/production evidence, signed installer/sidecar and VM lifecycle evidence.
- 따라서 이 절의 구현 및 focused regression 결과는 local engineering evidence이며, commercial release 또는 배포 승인이 아니다.
