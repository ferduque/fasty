#!/bin/sh
# Double-click this ONCE to turn on the Fasty safety net.
# After this, Git will automatically refuse to push code that would break the
# live site (broken links, typos, or a forgotten cache-number bump).
cd "$(dirname "$0")" || exit 1
clear
echo "🛡️   Installing the Fasty safety net…"
echo ""

chmod +x tools/hooks/pre-push 2>/dev/null
if git config core.hooksPath tools/hooks; then
  echo "✅  Done! From now on, pushing broken code is blocked automatically."
  echo ""
  echo "    • To check anything by hand, double-click \"Check Fasty.command\"."
  echo "    • This stays on until you turn it off (no need to run this again)."
else
  echo "❌  Couldn't configure Git. Make sure you're inside the Fasty project folder."
fi

echo ""
echo "— Press any key to close this window —"
read -r _
