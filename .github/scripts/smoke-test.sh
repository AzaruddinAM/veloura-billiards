#!/usr/bin/env bash
# End-to-end smoke test of a built release/ folder against a throwaway SQLite database.
# Usage: .github/scripts/smoke-test.sh [release-dir] [port]
set -euo pipefail

RELEASE="${1:-release}"
PORT="${2:-8085}"
BASE="http://127.0.0.1:$PORT"
API="$BASE/api"

[ -f "$RELEASE/public/index.php" ] || { echo "No release at $RELEASE — run build-release.sh first"; exit 1; }
rm -f "$RELEASE"/data/veloura.sqlite*

php -S "127.0.0.1:$PORT" -t "$RELEASE/public" "$RELEASE/public/index.php" > /tmp/vb-smoke-server.log 2>&1 &
SERVER=$!
cleanup() { kill "$SERVER" 2>/dev/null || true; rm -f "$RELEASE"/data/veloura.sqlite*; }
trap cleanup EXIT
for _ in $(seq 1 30); do curl -s -o /dev/null "$BASE/" && break; sleep 0.2; done

fail() { echo "✗ $1"; echo "--- server log"; cat /tmp/vb-smoke-server.log; exit 1; }
pass() { echo "✓ $1"; }
json() { php -r '$d=json_decode(stream_get_contents(STDIN),true); $v=$d; foreach(explode(".",$argv[1]) as $k){ $v=is_array($v)&&array_key_exists($k,$v)?$v[$k]:null; } echo is_bool($v)?($v?"true":"false"):(is_array($v)?json_encode($v):$v);' "$1"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# --- static app + SPA fallback
[ "$(status "$BASE/")" = 200 ] || fail "home page"
curl -s "$BASE/" | grep -q '<app-root' || fail "home page is not the Angular app"
[ "$(status "$BASE/month-end")" = 200 ] || fail "deep link /month-end"
JS=$(ls "$RELEASE/public" | grep -m1 '^main-.*\.js$')
curl -s -o /dev/null -w '%{content_type}' "$BASE/$JS" | grep -q javascript || fail "JS bundle content type"
pass "Angular app, deep links and bundles are served"

# --- auth
[ "$(status "$API/settings")" = 401 ] || fail "API must require sign-in"
[ "$(status -X POST "$API/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"wrong"}')" = 401 ] || fail "wrong password must be rejected"
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | json token)
[ -n "$TOKEN" ] || fail "admin login"
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
pass "auth: protected API, bad password rejected, admin login works"

# --- floor has billiards tables and gaming stations
FLOOR=$(curl -s "${H[@]}" "$API/floor")
COUNT=$(echo "$FLOOR" | php -r 'echo count(json_decode(stream_get_contents(STDIN),true)["tables"]);')
[ "$COUNT" = 9 ] || fail "expected 9 seeded tables/stations, got $COUNT"
echo "$FLOOR" | grep -q '"type":"ps5"' || fail "PS5 bays missing"
echo "$FLOOR" | grep -q '"type":"simulator"' || fail "simulator missing"
pass "floor: 9 tables and stations incl. PS5 and simulator"

# --- timer: start, double-start rejected, stop & bill
SID=$(curl -s -X POST "${H[@]}" "$API/tables/1/start" -d '{"customer_name":"CI"}' | json id)
[ -n "$SID" ] || fail "start timer"
[ "$(status -X POST "${H[@]}" "$API/tables/1/start" -d '{}')" = 409 ] || fail "second start on a running table must be refused"
BILL=$(curl -s -X POST "${H[@]}" "$API/sessions/$SID/stop" -d '{"payment_method":"cash","discount":10}')
[ "$(echo "$BILL" | json billed_minutes)" = 15 ] || fail "minimum charge should bill 15 min: $BILL"
[ "$(echo "$BILL" | json total)" = 40 ] || fail "15 min at 200/h minus 10 discount should be 40: $BILL"
pass "timer: start/stop, minimum charge and discount billed correctly (₹40)"

# --- member account: charge on account, partial payment, ledger balance
MID=$(curl -s -X POST "${H[@]}" "$API/members" -d '{"name":"CI Member"}' | json id)
SID=$(curl -s -X POST "${H[@]}" "$API/tables/7/start" -d "{\"member_id\":$MID}" | json id)
curl -s -o /dev/null -X POST "${H[@]}" "$API/sessions/$SID/stop" -d '{"payment_method":"account"}'
curl -s -o /dev/null -X POST "${H[@]}" "$API/members/$MID/payments" -d '{"amount":20,"method":"upi"}'
BAL=$(curl -s "${H[@]}" "$API/members/$MID/ledger" | json balance)
[ "$BAL" = 17.5 ] || fail "PS5 15 min at 150/h (37.5) minus 20 paid should leave 17.5, got $BAL"
pass "accounts: on-account charge, payment and ledger balance"

# --- month end
curl -s -o /dev/null -X POST "${H[@]}" "$API/expenses" -d '{"category":"Electricity","amount":100}'
REP=$(curl -s "${H[@]}" "$API/reports/month")
[ "$(echo "$REP" | json revenue)" = 77.5 ] || fail "month revenue should be 77.5: $(echo "$REP" | json revenue)"
[ "$(echo "$REP" | json net)" = -22.5 ] || fail "month net should be -22.5"
[ "$(status -X POST "${H[@]}" "$API/reports/month/close" -d "{\"period\":\"$(date +%Y-%m)\"}")" = 409 ] || fail "current month must not be closable"
pass "month end: revenue, expenses, net, and close-lock on an unfinished month"

# --- roles
STAFF=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -d '{"username":"staff","password":"staff123"}' | json token)
[ "$(status -H "Authorization: Bearer $STAFF" "$API/reports/month")" = 403 ] || fail "staff must not see month-end"
[ "$(status -H "Authorization: Bearer $STAFF" "$API/floor")" = 200 ] || fail "staff must see the floor"
pass "roles: staff blocked from admin reports, allowed on the floor"

echo "All smoke tests passed."
