#!/usr/bin/env bash
# Run after `railway up` (or any deploy) to confirm the site is up.
# Hits 30 critical URLs in parallel and reports anything that didn't return 200.
#
# Usage:
#   bash scripts/health-check.sh                     # production (nexyfab.com)
#   BASE_URL=http://localhost:3000 bash scripts/health-check.sh   # local
#
# Exit code: 0 if every URL returns HTTP 2xx/3xx, 1 if any failed.

set -uo pipefail

BASE_URL="${BASE_URL:-https://nexyfab.com}"
TIMEOUT=10
fail_count=0

readonly URLS=(
  # Health
  "/api/health/live"
  # Marketing
  "/"
  "/kr"
  "/en"
  "/kr/help"
  "/en/help"
  "/kr/trust"
  "/kr/how-it-works"
  "/kr/company-introduction"
  "/kr/factories"
  # App entry points
  "/kr/shape-generator"
  "/kr/quick-quote"
  "/kr/nexyfab"
  "/kr/nexyfab/pricing"
  "/kr/nexyfab/rfq"
  "/kr/nexyfab/orders"
  "/kr/nexyfab/marketplace"
  "/kr/nexyfab/projects"
  "/kr/nexyfab/billing"
  "/kr/nexyfab/settings"
  "/kr/project-inquiry"
  # Legal
  "/kr/privacy-policy"
  "/kr/terms-of-use"
  # i18n smoke (one URL per locale beyond ko/en)
  "/ja/help"
  "/cn/help"
  "/es/help"
  "/ar/help"
  # SEO
  "/sitemap.xml"
  "/robots.txt"
  "/api/og?title=Health"
)

echo "─── NexyFab health-check ───"
echo "Target: $BASE_URL"
echo "URLs:   ${#URLS[@]}"
echo ""

print_result() {
  local url="$1"
  local code="$2"
  local time="$3"
  local mark
  if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
    mark="✓"
  else
    mark="✗"
    fail_count=$((fail_count + 1))
  fi
  printf "  %s %-45s %3s  %s\n" "$mark" "$url" "$code" "$time"
}

for url in "${URLS[@]}"; do
  out=$(curl -sSL -o /dev/null \
    -w "%{http_code} %{time_total}s" \
    --max-time "$TIMEOUT" \
    "${BASE_URL}${url}" 2>&1) || out="--- (timeout/error)"
  read -r code time <<< "$out"
  print_result "$url" "${code:-???}" "${time:-?}"
done

echo ""
if [[ $fail_count -eq 0 ]]; then
  echo "✅ All ${#URLS[@]} URLs healthy."
  exit 0
else
  echo "❌ $fail_count / ${#URLS[@]} URLs failed."
  exit 1
fi
