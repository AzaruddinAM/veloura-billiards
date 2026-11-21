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

# --- online booking (public) + staff handling
TZ_VENUE=$(curl -s "$API/public/info" | json settings.timezone)
TOMORROW=$(php -r 'date_default_timezone_set($argv[1]); echo date("Y-m-d", time() + 86400);' "$TZ_VENUE")
J=(-H 'Content-Type: application/json')
BK=$(curl -s -X POST "${J[@]}" "$API/public/bookings" -d "{\"table_id\":2,\"date\":\"$TOMORROW\",\"time\":\"18:00\",\"duration_minutes\":60,\"customer_name\":\"CI Guest\",\"phone\":\"+91 90000 11111\",\"players\":3}")
CODE=$(echo "$BK" | json code)
[ -n "$CODE" ] && [ "$(echo "$BK" | json status)" = pending ] || fail "public booking should be created as pending: $BK"
[ "$(status -X POST "${J[@]}" "$API/public/bookings" -d "{\"table_id\":2,\"date\":\"$TOMORROW\",\"time\":\"18:30\",\"duration_minutes\":60,\"customer_name\":\"Clash\",\"phone\":\"9000022222\"}")" = 409 ] || fail "overlapping booking must be refused"
[ "$(status "$API/public/bookings/$CODE?phone=1234567")" = 404 ] || fail "lookup with the wrong phone must fail"
[ "$(curl -s "$API/public/bookings/$CODE?phone=919000011111" | json customer_name)" = "CI Guest" ] || fail "lookup with code + phone"
BID=$(curl -s "${H[@]}" "$API/bookings?date=$TOMORROW" | php -r '$d=json_decode(stream_get_contents(STDIN),true); foreach($d as $b) if($b["code"]===$argv[1]) echo $b["id"];' "$CODE")
[ -n "$BID" ] || fail "staff should see the online booking"
[ "$(curl -s -X PUT "${H[@]}" "$API/bookings/$BID/status" -d '{"status":"confirmed"}' | json status)" = confirmed ] || fail "staff confirm"
BUSY=$(curl -s "$API/public/availability?date=$TOMORROW" | php -r '$d=json_decode(stream_get_contents(STDIN),true); foreach($d["tables"] as $t) if($t["id"]==2) echo count($t["busy"]);')
[ "$BUSY" -ge 1 ] || fail "booked slot must show as busy"
[ "$(curl -s -X POST "${J[@]}" "$API/public/bookings/$CODE/cancel" -d '{"phone":"9000011111"}' | json status)" = cancelled ] || fail "customer cancel"
[ "$(status -X POST "${J[@]}" "$API/public/bookings" -d "{\"table_id\":2,\"date\":\"$TOMORROW\",\"time\":\"18:00\",\"duration_minutes\":60,\"customer_name\":\"Rebook\",\"phone\":\"9000033333\"}")" = 200 ] || fail "cancelled slot should be bookable again"
SB=$(curl -s -X POST "${H[@]}" "$API/bookings" -d "{\"table_id\":3,\"date\":\"$TOMORROW\",\"time\":\"12:00\",\"duration_minutes\":60,\"customer_name\":\"Desk Guest\",\"phone\":\"9000044444\"}")
SBID=$(echo "$SB" | json id); [ "$(echo "$SB" | json status)" = confirmed ] || fail "staff bookings are confirmed: $SB"
SEAT=$(curl -s -X POST "${H[@]}" "$API/bookings/$SBID/start")
[ "$(echo "$SEAT" | json booking.status)" = seated ] && [ -n "$(echo "$SEAT" | json session.id)" ] || fail "seating a booking starts a session: $SEAT"
# Floor shows a table's next booking: open round the clock, book 2h from now, check, restore hours.
curl -s -o /dev/null -X PUT "${H[@]}" "$API/settings" -d '{"open_time":"00:00","close_time":"00:00"}'
read -r SOON_DATE SOON_TIME < <(php -r 'date_default_timezone_set($argv[1]); $t = (int) (ceil((time() + 7200) / 1800) * 1800); echo date("Y-m-d", $t), " ", date("H:i", $t), "\n";' "$TZ_VENUE")
NB=$(curl -s -X POST "${H[@]}" "$API/bookings" -d "{\"table_id\":5,\"date\":\"$SOON_DATE\",\"time\":\"$SOON_TIME\",\"duration_minutes\":60,\"customer_name\":\"Soon Guest\",\"phone\":\"9000077777\"}")
FLOOR_NB=$(curl -s "${H[@]}" "$API/floor" | php -r '$d=json_decode(stream_get_contents(STDIN),true); if(!is_array($d)) { echo "NOT-JSON"; exit; } foreach($d["tables"] as $t) if($t["id"]==5) echo $t["next_booking"]["code"] ?? "none";')
curl -s -o /dev/null -X PUT "${H[@]}" "$API/settings" -d '{"open_time":"10:00","close_time":"23:00"}'
[ "$FLOOR_NB" = "$(echo "$NB" | json code)" ] || fail "floor should show the table's next booking (got '$FLOOR_NB', booking: $NB)"
pass "booking: public create, clash refused, code+phone lookup, confirm, cancel/rebook, staff booking seated"

# --- roles
STAFF=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -d '{"username":"staff","password":"staff123"}' | json token)
[ "$(status -H "Authorization: Bearer $STAFF" "$API/reports/month")" = 403 ] || fail "staff must not see month-end"
[ "$(status -H "Authorization: Bearer $STAFF" "$API/floor")" = 200 ] || fail "staff must see the floor"
pass "roles: staff blocked from admin reports, allowed on the floor"

# --- no PHP warnings/notices/errors anywhere during the run
if grep -qE "PHP (Warning|Notice|Deprecated|Fatal|Parse)" /tmp/vb-smoke-server.log; then
  grep -E "PHP (Warning|Notice|Deprecated|Fatal|Parse)" /tmp/vb-smoke-server.log | sort -u | head -10
  fail "PHP reported warnings or errors during the run"
fi
pass "no PHP warnings or errors logged"

echo "All smoke tests passed."
