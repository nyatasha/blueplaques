#!/usr/bin/env bash
#
# London Uncovered — full test run.
#
#   bash tests/run.sh
#
# 1. Logic suite  — runs the game rules in JavaScriptCore (Safari's engine).
# 2. SEO suite    — generates the static plaque pages into a temporary
#                   directory and asserts on the HTML and the sitemap.
# 3. Analytics    — reads the event adapter and every call site and asserts
#                   the two agree, and that no path can identify anyone.
# 4. Smoke suite  — drives the real app in headless Chrome and asserts on the
#                   DOM a user would actually see.
#
# All four are dependency-free: JavaScriptCore ships with macOS, and both the
# SEO suite and the DevTools client in tests/cdp.py are plain Python 3.

set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8123}"
JSC="/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"
status=0

echo "── logic suite ──────────────────────────────────────────────"
if [ -x "$JSC" ]; then
  ( cd tests && "$JSC" --module-file=logic.test.mjs ) || status=1
else
  echo "SKIP  JavaScriptCore not found at $JSC"
fi

echo
echo "── seo suite ────────────────────────────────────────────────"
python3 tests/seo.test.py || status=1

echo
echo "── analytics suite ──────────────────────────────────────────"
python3 tests/analytics.test.py || status=1

echo
echo "── smoke suite ──────────────────────────────────────────────"
started_server=0
if ! curl -sf -o /dev/null "http://localhost:$PORT/index.html"; then
  echo "starting a server on :$PORT"
  python3 -m http.server "$PORT" >/dev/null 2>&1 &
  server_pid=$!
  started_server=1
  sleep 1
fi

if [ -d "/Applications/Google Chrome.app" ]; then
  python3 tests/cdp.py smoke "$PORT" || status=1
else
  echo "SKIP  Google Chrome not installed"
fi

[ "$started_server" = 1 ] && kill "$server_pid" 2>/dev/null

echo
[ "$status" = 0 ] && echo "ALL TESTS PASSED" || echo "TESTS FAILED"
exit $status
