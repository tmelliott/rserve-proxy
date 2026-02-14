#!/usr/bin/env bash
#
# E2E smoke test — exercises the full app lifecycle via the API.
#
# Requires a running dev environment:
#   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
#   bun run dev  (in packages/api)
#
# Usage: ./scripts/smoke-test.sh [base_url]
#   default base_url: http://localhost:3000

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
COOKIE_JAR=$(mktemp)
APP_ID=""

# Colours
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${YELLOW}→${NC} $1"; }

cleanup() {
  rm -f "$COOKIE_JAR"
  if [[ -n "$APP_ID" ]]; then
    info "Cleaning up: deleting app $APP_ID"
    curl -s -b "$COOKIE_JAR" -X DELETE "$BASE_URL/api/apps/$APP_ID" > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Helper: make a curl request and capture status + body
# ---------------------------------------------------------------------------
request() {
  local method="$1"
  local url="$2"
  local data="${3:-}"

  local args=(-s -w '\n%{http_code}' -b "$COOKIE_JAR" -c "$COOKIE_JAR")

  if [[ -n "$data" ]]; then
    args+=(-H "Content-Type: application/json" -d "$data")
  fi

  local response
  response=$(curl "${args[@]}" -X "$method" "$BASE_URL$url")

  # Last line is status code
  HTTP_CODE=$(echo "$response" | tail -n1)
  HTTP_BODY=$(echo "$response" | sed '$d')
}

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Rserve Proxy — E2E Smoke Test"
echo "  Base URL: $BASE_URL"
echo "══════════════════════════════════════════════════════"
echo ""

# ---------------------------------------------------------------------------
# 1. Health check
# ---------------------------------------------------------------------------
info "Checking API health..."
request GET "/api/health"
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "Health check: $HTTP_BODY"
else
  fail "Health check failed (HTTP $HTTP_CODE)"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Login
# ---------------------------------------------------------------------------
info "Logging in as admin..."
request POST "/api/auth/login" '{"username":"admin","password":"admin"}'
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "Login successful"
else
  fail "Login failed (HTTP $HTTP_CODE): $HTTP_BODY"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Check /me
# ---------------------------------------------------------------------------
info "Checking /me..."
request GET "/api/auth/me"
if [[ "$HTTP_CODE" == "200" ]]; then
  USERNAME=$(echo "$HTTP_BODY" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
  pass "Authenticated as: $USERNAME"
else
  fail "/me failed (HTTP $HTTP_CODE)"
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Create an app
# ---------------------------------------------------------------------------
info "Creating test app..."
request POST "/api/apps" '{
  "name": "Smoke Test App",
  "slug": "smoke-test",
  "rVersion": "4.4.1",
  "packages": [],
  "codeSource": {"type": "upload"},
  "entryScript": "run_rserve.R"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  APP_ID=$(echo "$HTTP_BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  pass "Created app: $APP_ID"
else
  fail "Create app failed (HTTP $HTTP_CODE): $HTTP_BODY"
  exit 1
fi

# ---------------------------------------------------------------------------
# 5. List apps
# ---------------------------------------------------------------------------
info "Listing apps..."
request GET "/api/apps"
if [[ "$HTTP_CODE" == "200" ]]; then
  COUNT=$(echo "$HTTP_BODY" | grep -o '"id"' | wc -l)
  pass "Listed $COUNT app(s)"
else
  fail "List apps failed (HTTP $HTTP_CODE)"
  exit 1
fi

# ---------------------------------------------------------------------------
# 6. Get app detail
# ---------------------------------------------------------------------------
info "Getting app detail..."
request GET "/api/apps/$APP_ID"
if [[ "$HTTP_CODE" == "200" ]]; then
  SLUG=$(echo "$HTTP_BODY" | grep -o '"slug":"[^"]*"' | cut -d'"' -f4)
  pass "App slug: $SLUG"
else
  fail "Get app failed (HTTP $HTTP_CODE)"
  exit 1
fi

# ---------------------------------------------------------------------------
# 7. Update app
# ---------------------------------------------------------------------------
info "Updating app name..."
request PUT "/api/apps/$APP_ID" '{"name": "Smoke Test App (Updated)"}'
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "App updated"
else
  fail "Update app failed (HTTP $HTTP_CODE): $HTTP_BODY"
  exit 1
fi

# ---------------------------------------------------------------------------
# 8. Create API token
# ---------------------------------------------------------------------------
info "Creating API token..."
request POST "/api/auth/tokens" '{"name":"smoke-test-token","expiresInDays":1}'
if [[ "$HTTP_CODE" == "201" ]]; then
  TOKEN=$(echo "$HTTP_BODY" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  TOKEN_ID=$(echo "$HTTP_BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  pass "Created token: ${TOKEN:0:16}..."
else
  fail "Create token failed (HTTP $HTTP_CODE): $HTTP_BODY"
  exit 1
fi

# ---------------------------------------------------------------------------
# 9. Use API token for auth
# ---------------------------------------------------------------------------
info "Testing Bearer auth with token..."
TOKEN_BODY=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/auth/me")
TOKEN_USER=$(echo "$TOKEN_BODY" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
if [[ -n "$TOKEN_USER" ]]; then
  pass "Token auth works (user: $TOKEN_USER)"
else
  fail "Token auth failed: $TOKEN_BODY"
fi

# ---------------------------------------------------------------------------
# 10. List tokens
# ---------------------------------------------------------------------------
info "Listing tokens..."
request GET "/api/auth/tokens"
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "Tokens listed"
else
  fail "List tokens failed (HTTP $HTTP_CODE)"
fi

# ---------------------------------------------------------------------------
# 11. Delete token
# ---------------------------------------------------------------------------
info "Deleting token..."
request DELETE "/api/auth/tokens/$TOKEN_ID"
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "Token deleted"
else
  fail "Delete token failed (HTTP $HTTP_CODE): $HTTP_BODY"
fi

# ---------------------------------------------------------------------------
# 12. Delete app
# ---------------------------------------------------------------------------
info "Deleting test app..."
request DELETE "/api/apps/$APP_ID"
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "App deleted"
  APP_ID="" # Don't cleanup again in trap
else
  fail "Delete app failed (HTTP $HTTP_CODE): $HTTP_BODY"
fi

# ---------------------------------------------------------------------------
# 13. Logout
# ---------------------------------------------------------------------------
info "Logging out..."
request POST "/api/auth/logout"
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "Logged out"
else
  fail "Logout failed (HTTP $HTTP_CODE)"
fi

# Confirm logged out
request GET "/api/auth/me"
if [[ "$HTTP_CODE" == "401" ]]; then
  pass "Session properly destroyed"
else
  fail "Session still active after logout (HTTP $HTTP_CODE)"
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo -e "  ${GREEN}All smoke tests passed!${NC}"
echo "══════════════════════════════════════════════════════"
echo ""
