# Railway 배포 가이드 (NexyFab 기준)

## 1. 프로젝트 구조

```
nexyfab.com/new/
├── Dockerfile          # Railway 빌드에 사용
├── .gitignore          # 대용량 파일 제외 필수
├── .dockerignore       # Docker 빌드 컨텍스트 제외
├── package.json
├── package-lock.json
├── next.config.ts
├── src/
└── public/
```

## 2. Dockerfile (Next.js standalone)

```dockerfile
# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runner stage ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy only what's needed
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Data directory
RUN mkdir -p /app/data /app/adminlink \
 && chown -R nextjs:nodejs /app/data /app/adminlink

USER nextjs

EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
```

### 핵심 포인트
- `npm ci --legacy-peer-deps`: peer dependency 충돌 방지
- `output: 'standalone'`이 next.config.ts에 설정되어야 `.next/standalone` 생성됨
- Railway 기본 포트는 `8080` (Railway 대시보드에서 확인 가능)
- HEALTHCHECK 포트도 동일하게 맞출 것

## 3. next.config.ts 필수 설정

```typescript
const nextConfig: NextConfig = {
  output: 'standalone',    // Railway용 (Cloudflare Pages는 'export')
  trailingSlash: true,
  // ...
};

export default nextConfig;  // withSentryConfig 등 래퍼 사용 시 해당 패키지 설치 필수
```

## 4. .gitignore (대용량 파일 제외)

Railway CLI는 git archive 기반으로 업로드하므로 **git에 추적되는 파일만** 업로드됨.

```gitignore
# 대용량 파일 반드시 제외
*.db
*.zip
*.wasm
*.sqlite
*.tar.gz
/out/
/out2/
/data/
/.next/
/node_modules/
```

### 413 Payload Too Large 에러 발생 시
1. 대용량 파일 찾기: `git ls-files | while read f; do sz=$(wc -c < "$f" 2>/dev/null); if [ "$sz" -gt 1000000 ]; then echo "$sz $f"; fi; done | sort -rn`
2. git에서 제거: `git rm --cached <파일경로>`
3. .gitignore에 추가
4. 커밋 후 재업로드
5. 목표: `git archive HEAD | wc -c` 결과가 100MB 이하

## 5. Railway CLI 사용법

### 설치 및 로그인
```bash
# PowerShell 실행 정책 문제 시
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

# 로그인 (브라우저 인증)
npx @railway/cli login

# 프로젝트 연결 확인
npx @railway/cli status
```

### 배포
```bash
# 프로젝트 디렉토리에서 실행
cd C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new

# 업로드 및 빌드
npx @railway/cli up

# 로그 확인
npx @railway/cli logs -n 50

# CDN 캐시 퍼지 (이전 버전이 계속 보일 때)
npx @railway/cli redeploy --yes
```

### 도메인 관리
```bash
# 도메인 확인
npx @railway/cli domain

# 커스텀 도메인 추가
npx @railway/cli domain nexyfab.com
```

### 주요 명령어 정리
| 명령어 | 설명 |
|--------|------|
| `railway login` | 브라우저 인증 로그인 |
| `railway whoami` | 로그인 상태 확인 |
| `railway status` | 연결된 프로젝트/서비스 확인 |
| `railway up` | 코드 업로드 + 빌드 + 배포 |
| `railway logs -n 50` | 최근 로그 50줄 |
| `railway redeploy --yes` | 강제 재배포 (CDN 캐시 퍼지) |
| `railway domain` | 도메인 목록 |
| `railway link` | 프로젝트 연결 |

## 6. 환경변수

Railway 대시보드 > Variables 탭에서 설정.

### 필수 환경변수
```
DATABASE_URL=postgresql://...          # PostgreSQL 연결 (Railway Postgres 플러그인)
JWT_SECRET=<32자 이상 랜덤 문자열>      # NexyFlow와 동일해야 함
CROSS_SERVICE_SECRET=<64자 랜덤 문자열> # 서비스 간 인증용
NEXT_PUBLIC_SITE_URL=https://nexyfab.com
SERVICE_NAME=nexyfab
```

### R2 스토리지 (Cloudflare R2)
```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_PUBLIC_URL=...
```

### 선택 환경변수
```
SMTP_HOST=...                    # 이메일 발송
STRIPE_SECRET_KEY=sk_...         # 결제
STRIPE_WEBHOOK_SECRET=whsec_...  # Stripe 웹훅
```

## 7. 커스텀 도메인 DNS 설정

Railway는 Fastly CDN을 사용함.

1. Railway 대시보드 > Settings > Networking > Custom Domain에서 도메인 추가
2. 표시되는 DNS 레코드를 도메인 등록업체에 설정
3. TLS 인증서 자동 발급 확인 (실패 시 "Try Again" 클릭)

### DNS 문제 체크
```bash
# DNS 확인
nslookup nexyfab.com

# SSL 인증서 확인
curl -sI https://nexyfab.com/

# SSL 무시하고 응답 확인
curl -k -sI https://nexyfab.com/
```

## 8. CDN 캐시 문제

Railway + Fastly CDN은 `s-maxage` 헤더 기반으로 캐싱함.
Next.js가 `s-maxage=31536000` (1년) 설정하면 CDN에 오래된 버전이 남음.

### 해결 방법
1. `railway redeploy --yes` — 새 배포 시 CDN 캐시 자동 퍼지
2. 브라우저: `Ctrl+Shift+R` (강력 새로고침) 또는 시크릿 모드

## 9. 빌드 실패 트러블슈팅

| 에러 | 원인 | 해결 |
|------|------|------|
| `413 Payload Too Large` | 업로드 파일 너무 큼 | .gitignore에 대용량 파일 추가, `git rm --cached` |
| `ERESOLVE could not resolve` | npm peer dependency 충돌 | Dockerfile에서 `npm ci --legacy-peer-deps` |
| `Module not found: @sentry/nextjs` | 삭제된 패키지를 코드에서 참조 | import 및 사용처 전부 제거 |
| `Cannot find module` | package.json에서 제거했지만 코드에 남음 | `grep -r "모듈명" src/` 으로 찾아서 제거 |
| `Failed to issue TLS certificate` | DNS가 Railway를 안 가리킴 | DNS 레코드 확인 후 수정, "Try Again" |
| 이전 버전이 계속 보임 | CDN 캐시 | `railway redeploy --yes` |

## 10. 배포 체크리스트

```
[ ] .gitignore에 대용량 파일 제외됐는지 확인
[ ] git archive 크기 확인: git archive HEAD | wc -c (100MB 이하)
[ ] package.json에서 불필요한 패키지 제거 (Cloudflare 전용 등)
[ ] 제거한 패키지의 import가 코드에 남아있지 않은지 확인
[ ] next.config.ts: output: 'standalone' 설정
[ ] Dockerfile: 포트 번호가 Railway 설정과 일치
[ ] 환경변수 Railway 대시보드에 설정
[ ] railway login → railway status 로 프로젝트 연결 확인
[ ] railway up 실행
[ ] 빌드 로그 확인 (대시보드 또는 CLI)
[ ] 배포 후 railway redeploy --yes (CDN 캐시 퍼지)
[ ] 도메인 접속 확인 (시크릿 모드)
```

## 11. Git 관련 주의사항

Railway CLI(`railway up`)는 **현재 디렉토리의 git repo**를 기준으로 업로드함.

- `git rev-parse --show-toplevel`로 git root 확인
- git root가 홈 디렉토리(`C:/Users/gomd9`)면 전체 홈 폴더가 업로드됨 → 프로젝트 디렉토리에 독립 git repo 필요
- `railway up`은 `git archive` 결과를 업로드하므로 **git에 추적된 파일만** 올라감
- 커밋하지 않은 변경사항은 업로드 안 됨 → **반드시 commit 후 up**
