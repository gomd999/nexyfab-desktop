# NexyFab LGPL 배포 준수 기록

- 상태: 기술 증거 구현 완료, 최종 법률 승인 대기
- 적용 대상: 웹 정적 자산, 서버 번들, Tauri/desktop bundle에 포함되는 JS/WASM
- 원칙: 이 문서는 법률 의견을 대체하지 않으며 승인 artifact가 없으면 상용 release gate를 통과시키지 않는다.

## 핵심 구성요소

| 구성요소 | 버전 기준 | 라이선스 | upstream source |
|---|---|---|---|
| opencascade.js | package-lock | LGPL-2.1-only | https://github.com/donalffons/opencascade.js |
| occt-import-js | package-lock | LGPL-2.1 | https://github.com/kovacsv/occt-import-js |
| @salusoft89/planegcs | package-lock | LGPL-2.0-or-later | https://github.com/Salusoft89/planegcs |

정확한 배포 버전, license text SHA-256 및 전체 production dependency 목록은 `src/content/third-party-notices.generated.json`에서 package-lock SHA-256과 함께 고정한다.

## 검토된 메타데이터 보완

`buffers@0.1.1`의 npm 배포물에는 license 필드와 별도 LICENSE 파일이 없었다. 이를 임의 추정으로 통과시키지 않고 Debian Sources의 `node-buffers/0.1.1-2` 저작권 기록과 그 기록이 연결한 upstream license 선언 commit을 근거로 MIT로 검토했다.

- 검토 원장: `docs/legal/license-overrides.json`
- 배포할 license text: `docs/legal/licenses/buffers-0.1.1-MIT.txt`
- 근거: `https://sources.debian.org/copyright/license/node-buffers/0.1.1-2/`

생성기는 정확한 package/version, 근거 URL, 검토일, license text 존재 여부와 SHA-256을 모두 확인한다. 해당 dependency가 사라지거나 버전이 바뀌면 override를 미사용 오류로 처리하여 재검토 없이 다른 버전에 승계하지 않는다.

## Release마다 필요한 증거

1. `npm run licenses:generate` 후 `npm run licenses:check` 통과
2. 실제 배포 JS/WASM 목록과 각 SHA-256
3. 해당 버전에 대응하는 upstream source 또는 수정 source archive의 불변 URL과 SHA-256
4. NexyFab이 해당 library를 수정했는지 여부와 patch 목록
5. 사용자가 LGPL library를 교체하거나 relink할 수 있는 배포·설치 절차 검토
6. copyright notice와 license text가 제품 내 고지 페이지 및 배포물에 포함됐다는 확인
7. 법률 검토자, 승인 일시, 승인 문서 SHA-256

## 현재 fail-closed 항목

- 법률 승인 문서가 아직 저장소 증거로 등록되지 않음
- release별 corresponding-source archive와 실제 배포 WASM의 결속이 아직 구현 전
- Tauri 및 기타 재배포 형태별 relinking/replacement 절차의 법률 검토 필요

위 항목은 owner·승인 artifact 없이 완료로 변경하지 않는다.
