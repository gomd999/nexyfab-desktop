# M5 — 현장 검증 Worksheet (FEA + CAM 실측)

**Status:** template (사용자가 실측 시 직접 채움)
**Pre-requisite:** [M5_FEA_TUTORIAL.md](./M5_FEA_TUTORIAL.md), [M5_CAM_EXPORT.md](./M5_CAM_EXPORT.md), [CAD_COMMERCIAL_COMPLETION_ROADMAP.md](./CAD_COMMERCIAL_COMPLETION_ROADMAP.md) §Phase C3 ("M5 현장 검증 — FEA·G-code 실측 1건 이상 문서화")
**Goal:** Shape Generator의 FEA 예측값과 CAM G-code가 실제 가공 부품과 일치함을 1건 이상 문서화.

이 워크시트는 **한 케이스를 처음부터 끝까지 검증**하는 데 쓰는 단일 파일이다. 케이스별로 복사해서 사용:
- `docs/field-validation/<YYYY-MM-DD>-<part-name>.md` 형식으로 저장

---

## 0. 케이스 메타데이터

| 항목 | 값 |
|---|---|
| 케이스 ID | `___` (예: 2026-06-15-bracket-aluminium) |
| 검증자 | `___` (성명 + 역할) |
| 부품명 | `___` |
| 검증 일자 | `___` |
| Shape Generator 버전 | `___` (`?build=` query 또는 release tag) |
| 가공 장비 | `___` (예: HAAS VF-2 / Tormach 770M / Stratasys F123) |
| 측정 장비 | `___` (캘리퍼·CMM·노기스·로드셀 등) |
| 외부 CAM 사용? | `___` (Yes/No — yes면 Fusion 360 / Mastercam / NX 등 기재) |

---

## 1. FEA 실측 (선택 1: 선형 정적, 인장/굽힘/비틀림 중 1)

### 1.1 부품 설계
- 입력 형상 스크린샷: `___`
- 재료 프리셋: `___` (예: 알루미늄 6061-T6, E=68.9 GPa, ν=0.33, ρ=2.70 g/cm³)
- 부피 (Measure 패널): `___ mm³`
- 표면적: `___ mm²`

### 1.2 경계 조건
- 고정 면 (Fixed): `___` (면 ID 또는 위치 설명)
- 하중 면 (Force): `___`, 방향: `___`, 크기: `___ N`
- 또는 압력 면 (Pressure): `___`, 크기: `___ Pa`

### 1.3 Shape Generator 예측값

| 항목 | 단위 | 예측값 |
|---|---|---|
| 최대 Von Mises 응력 | MPa | `___` |
| 최대 변위 | mm | `___` |
| 안전율 (yield 대비) | — | `___` |
| 1차 고유 진동수 (모달 시) | Hz | `___` |

### 1.4 실측

| 항목 | 단위 | 측정값 | 측정 방법 |
|---|---|---|---|
| 부품 무게 (밀도 검증) | g | `___` | 전자저울 ___ g 분해능 |
| 인장/굽힘 변위 @ 정격 하중 | mm | `___` | dial gauge / DIC / strain gauge |
| 항복 (해당 시) | N 또는 Nm | `___` | 인장 시험기 (___ kN 용량) |
| 1차 진동수 (해당 시) | Hz | `___` | 가속도계 + impulse hammer |

### 1.5 차이 분석

| 항목 | 예측 | 실측 | 차이 (%) | 합격? |
|---|---|---|---|---|
| 변위 | `___` | `___` | `___` | ☐ (±15% 이내) |
| 응력 / 항복 | `___` | `___` | `___` | ☐ (±20% 이내) |
| 진동수 | `___` | `___` | `___` | ☐ (±10% 이내) |

**기준:** v0 FEA는 선형·Tet4 + 보 이론 폴백이므로 ±20% 이내면 PASS. 그 이상은 §3에 사유 기록.

---

## 2. CAM G-code 실측

### 2.1 부품 설계
- 입력 형상: `___` (Box / 캐비티 / 풀 곡면 등)
- 부품 치수 (Measure 패널): X `___` mm × Y `___` mm × Z `___` mm
- 가공 깊이 / 경계: `___`

### 2.2 CAM 라이트 설정

| 필드 | 값 |
|---|---|
| 공구 직경 | `___ mm` |
| 공구 종류 | flat / ball / V |
| stepover | `___ mm` (또는 % of D) |
| stepdown / Z layer | `___ mm` |
| feed rate | `___ mm/min` |
| spindle speed | `___ rpm` |
| stock material | `___` |

### 2.3 G-code export
- 파일명: `___.gcode`
- 줄 수: `___`
- 추정 가공 시간 (포스트 추출): `___ min`

### 2.4 실제 가공

| 항목 | 단위 | 값 | 비고 |
|---|---|---|---|
| 실제 가공 시간 | min | `___` | 시작-종료 wall clock |
| 가공 후 X 치수 | mm | `___` | 캘리퍼 @ ___ 위치 |
| 가공 후 Y 치수 | mm | `___` | |
| 가공 후 Z 치수 | mm | `___` | |
| 깊이 (cavity 가공 시) | mm | `___` | |
| 표면 거칠기 Ra | μm | `___` | 표면 조도계 / 시각 등급 |

### 2.5 차이 분석

| 항목 | CAD 값 | 측정값 | 차이 (mm) | 합격? |
|---|---|---|---|---|
| X 치수 | `___` | `___` | `___` | ☐ (±0.10 mm) |
| Y 치수 | `___` | `___` | `___` | ☐ (±0.10 mm) |
| Z 치수 | `___` | `___` | `___` | ☐ (±0.10 mm) |
| 깊이 | `___` | `___` | `___` | ☐ (±0.05 mm) |
| Ra | (목표 ___) | `___` | — | ☐ |

**기준:** 일반 3축 밀링 v0 = ±0.10 mm. 그 이상 차이는 §3에 사유 기록.

---

## 3. 차이 / 이슈 노트

> 예측과 실측이 다를 때 가능한 원인:
> - **FEA**: 비선형 (대변형 / 항복 이후), 경계 조건 단순화, 메시 quality
> - **CAM**: 공구 마모, stock 부정확, 백래시, 가공 진동, post processor 회전축 가정
> - **공통**: 재료 spec 시트와 실제 lot 차이, 치수 공차의 누적

| 이슈 ID | 항목 (FEA/CAM) | 관측 | 추정 원인 | 후속 조치 |
|---|---|---|---|---|
| I-1 | `___` | `___` | `___` | `___` |
| I-2 | `___` | `___` | `___` | `___` |

---

## 4. 첨부

- Shape Generator 스크린샷: `___` (파트 + Measure 값 + FEA 결과 패널)
- G-code 파일: `___`
- 가공 사진: `___` (가공 중 / 완료 / 측정 장면)
- 측정 raw 데이터: `___` (csv / 사진)

---

## 5. 결과 (PASS / FAIL / YELLOW)

- [ ] FEA: 예측 ↔ 실측 모든 항목 ±기준 이내 → **PASS**
- [ ] CAM: 모든 치수 ±0.10 mm 이내 + Ra 목표 달성 → **PASS**
- [ ] 둘 다 PASS → **이 케이스는 commercial-roadmap §Phase C3 evidence로 인용 가능**

PASS 시:
1. `docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md` §Phase C3 행에 본 케이스 link 추가
2. 가공 사진 1장을 `nexyfab.com` 마케팅 자산으로 사용 가능 (당사자 동의 시)
3. 본 worksheet를 `docs/field-validation/` 에 append-only로 보관

FAIL / YELLOW 시:
1. §3 이슈 노트의 후속 조치를 backlog 티켓으로 변환
2. Shape Generator의 FEA/CAM v0 한계는 [M5_SIMULATION_DFM_CAM.md](./M5_SIMULATION_DFM_CAM.md) §한계 절에 추가
3. 다음 케이스 (다른 재료 / 다른 형상)로 재시도

---

## 6. 참고

- [M5_FEA_TUTORIAL.md](./M5_FEA_TUTORIAL.md) — FEA 실행 절차
- [M5_CAM_EXPORT.md](./M5_CAM_EXPORT.md) — CAM 라이트 설정
- [M5_SIMULATION_DFM_CAM.md](./M5_SIMULATION_DFM_CAM.md) — 전체 시뮬레이션 정책
- [CAD_COMMERCIAL_COMPLETION_ROADMAP.md](./CAD_COMMERCIAL_COMPLETION_ROADMAP.md) §Phase C3 — 현장 검증 요건
- 첫 케이스 권장 부품: **간단한 알루미늄 L-bracket (60×60×10mm, 4-hole)** — FEA + CAM 둘 다 단순 + 측정 쉬움.
