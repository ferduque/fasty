#!/bin/sh
# Double-click this to check Fasty for problems before you push.
# It looks for broken file links, code typos, cache-number mistakes, and
# missing page pieces — the four things that break this app.
cd "$(dirname "$0")" || exit 1
clear
echo "🔎  Checking Fasty for problems that could break the live site…"
echo ""

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$c" ] && NODE_BIN="$c" && break
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo "❌  Could not find Node.js on this Mac, so I can't run the check."
  echo "    Install it from https://nodejs.org and try again."
else
  "$NODE_BIN" tools/healthcheck.mjs
fi

echo ""
echo "— Done. Press any key to close this window —"
read -r _
