#!/usr/bin/env bash
# =============================================================================
# NexyFab Tauri 릴리즈 스크립트
# =============================================================================
# 사용법:
#   ./scripts/tauri-release.sh --gen-keys   # 최초 1회: ed25519 서명 키 쌍 생성
#   ./scripts/tauri-release.sh --build      # MSI/DMG/AppImage 빌드 + 서명
#   ./scripts/tauri-release.sh --env        # 생성된 .sig 파일을 Railway 환경변수 형식으로 출력
#
# 사전 요구:
#   - Rust + cargo 설치: https://rustup.rs
#   - cargo install tauri-cli (v2): cargo install tauri-cli --version "^2"
#   - Node.js 18+
#   - TAURI_SIGNING_KEY, TAURI_SIGNING_KEY_PASSWORD 환경변수 설정 (--build 시)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYS_DIR="$ROOT/.tauri-keys"
DIST_DIR="$ROOT/src-tauri/target/release/bundle"
VERSION=$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version")

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*" >&2; }

# =============================================================================
cmd_gen_keys() {
  info "ed25519 서명 키 생성 중..."
  mkdir -p "$KEYS_DIR"

  if [[ -f "$KEYS_DIR/private.key" ]]; then
    warn "이미 키가 존재합니다: $KEYS_DIR/private.key"
    warn "재생성하려면 $KEYS_DIR 폴더를 삭제 후 다시 실행하세요."
    exit 1
  fi

  # tauri signer generate 는 stdout에 키를 출력
  local output
  output=$(cargo tauri signer generate -w "$KEYS_DIR/private.key" 2>&1)

  # public key 추출
  local pubkey
  pubkey=$(echo "$output" | grep -A1 "PUBLIC KEY" | tail -1 | tr -d '[:space:]')

  if [[ -z "$pubkey" ]]; then
    # fallback: .pub 파일에서 읽기
    pubkey=$(cat "$KEYS_DIR/private.key.pub" 2>/dev/null || echo "")
  fi

  echo "$pubkey" > "$KEYS_DIR/public.key"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  success "키 생성 완료"
  echo ""
  echo "  비밀키: $KEYS_DIR/private.key"
  echo "  공개키: $KEYS_DIR/public.key"
  echo ""
  echo -e "${YELLOW}▶ 다음 단계 (tauri.conf.json 업데이트):${NC}"
  echo "  \"pubkey\": \"$pubkey\""
  echo ""
  echo -e "${YELLOW}▶ 로컬 .env.local에 추가:${NC}"
  echo "  TAURI_SIGNING_KEY=$(cat "$KEYS_DIR/private.key" | base64 -w0)"
  echo "  TAURI_SIGNING_KEY_PASSWORD="
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  warn "비밀키($KEYS_DIR/private.key)는 절대 Git에 커밋하지 마세요!"
}

# =============================================================================
cmd_build() {
  info "NexyFab v$VERSION 빌드 시작..."

  # 서명 키 확인
  if [[ -z "${TAURI_SIGNING_KEY:-}" ]]; then
    if [[ -f "$KEYS_DIR/private.key" ]]; then
      export TAURI_SIGNING_KEY
      TAURI_SIGNING_KEY=$(cat "$KEYS_DIR/private.key" | base64 -w0 2>/dev/null || base64 < "$KEYS_DIR/private.key")
      info "로컬 키 파일 로드: $KEYS_DIR/private.key"
    else
      error "TAURI_SIGNING_KEY 환경변수가 없습니다."
      error "먼저 ./scripts/tauri-release.sh --gen-keys 를 실행하세요."
      exit 1
    fi
  fi

  export TAURI_SIGNING_KEY_PASSWORD="${TAURI_SIGNING_KEY_PASSWORD:-}"

  cd "$ROOT"

  # 1. Next.js 정적 빌드 (Tauri용)
  info "Next.js Tauri 빌드..."
  npm run build:tauri

  # 2. Tauri 번들 빌드
  info "Tauri 번들 빌드 (cargo tauri build)..."
  cargo tauri build

  success "빌드 완료!"
  echo ""

  cmd_env
}

# =============================================================================
cmd_env() {
  info "서명 파일 → Railway 환경변수 출력"
  echo ""

  local found=0

  # Windows MSI
  local win_sig
  win_sig=$(find "$DIST_DIR" -name "*.msi.sig" 2>/dev/null | head -1)
  if [[ -n "$win_sig" ]]; then
    echo "TAURI_SIG_WIN_X64=$(cat "$win_sig")"
    found=$((found+1))
  else
    warn "TAURI_SIG_WIN_X64 → .msi.sig 파일 없음 (Windows에서 빌드했는지 확인)"
  fi

  # macOS ARM
  local mac_arm_sig
  mac_arm_sig=$(find "$DIST_DIR" -name "*aarch64.dmg.sig" 2>/dev/null | head -1)
  if [[ -n "$mac_arm_sig" ]]; then
    echo "TAURI_SIG_MAC_AARCH64=$(cat "$mac_arm_sig")"
    found=$((found+1))
  else
    warn "TAURI_SIG_MAC_AARCH64 → *aarch64.dmg.sig 파일 없음 (Apple Silicon Mac에서 빌드 필요)"
  fi

  # macOS x64
  local mac_x64_sig
  mac_x64_sig=$(find "$DIST_DIR" -name "*x64.dmg.sig" 2>/dev/null | head -1)
  if [[ -n "$mac_x64_sig" ]]; then
    echo "TAURI_SIG_MAC_X64=$(cat "$mac_x64_sig")"
    found=$((found+1))
  else
    warn "TAURI_SIG_MAC_X64 → *x64.dmg.sig 파일 없음 (Intel Mac에서 빌드 필요)"
  fi

  # Linux AppImage
  local linux_sig
  linux_sig=$(find "$DIST_DIR" -name "*.AppImage.sig" 2>/dev/null | head -1)
  if [[ -n "$linux_sig" ]]; then
    echo "TAURI_SIG_LINUX_X64=$(cat "$linux_sig")"
    found=$((found+1))
  else
    warn "TAURI_SIG_LINUX_X64 → .AppImage.sig 파일 없음 (Linux에서 빌드 필요)"
  fi

  echo ""
  if [[ $found -gt 0 ]]; then
    success "$found개 서명 추출 완료"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${YELLOW}▶ Railway 환경변수 설정 방법:${NC}"
    echo "  railway variables set TAURI_SIG_WIN_X64=\"...\""
    echo "  또는 Railway 대시보드 → Variables → 위 값 붙여넣기"
    echo ""
    echo -e "${YELLOW}▶ 인스톨러 업로드 위치:${NC}"
    echo "  nexyfab.com/releases/$VERSION/NexyFab_${VERSION}_x64_en-US.msi"
    echo "  nexyfab.com/releases/$VERSION/NexyFab_${VERSION}_aarch64.dmg"
    echo "  nexyfab.com/releases/$VERSION/nexyfab_${VERSION}_amd64.AppImage"
    echo ""
    echo "  → Cloudflare R2 nexyfab 버킷 / releases/$VERSION/ 에 업로드하거나"
    echo "    Cloudflare Pages의 /releases/ 정적 경로에 배치하세요."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  else
    warn "서명 파일을 찾지 못했습니다. --build 먼저 실행하세요."
  fi
}

# =============================================================================
cmd_help() {
  echo ""
  echo "사용법: $(basename "$0") [옵션]"
  echo ""
  echo "  --gen-keys   최초 1회 ed25519 서명 키 쌍 생성"
  echo "  --build      Tauri 앱 빌드 + 서명 (TAURI_SIGNING_KEY 필요)"
  echo "  --env        빌드된 .sig 파일을 환경변수 형식으로 출력"
  echo "  --help       이 도움말 출력"
  echo ""
}

# =============================================================================
case "${1:-}" in
  --gen-keys) cmd_gen_keys ;;
  --build)    cmd_build ;;
  --env)      cmd_env ;;
  --help|-h)  cmd_help ;;
  *)
    error "알 수 없는 옵션: ${1:-}"
    cmd_help
    exit 1
    ;;
esac
