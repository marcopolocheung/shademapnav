#!/usr/bin/env bash
# PostToolUse(Edit|Write) — lint only the file that just changed.
#
# Why this and not "run npm run lint at the end": `npm run lint` reports the whole repo, and
# a known ~180-finding warn-level backlog buries the one error the edit just introduced.
# (There is a standing trap here: Biome's max-diagnostics cap can print "0 errors" while a
# real error is truncated away.) Scoping to the touched file makes the signal unmissable and
# lands it in context while the edit is still the subject.
#
# Never blocks — PostToolUse fires after the write. It reports, Claude decides.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[[ -z "$root" ]] && exit 0

input=$(cat)
file=$(jq -r '.tool_input.file_path // ""' <<<"$input")
case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac
[[ -f "$file" ]] || exit 0

biome="$root/node_modules/.bin/biome"
[[ -x "$biome" ]] || exit 0

# --max-diagnostics is explicit so nothing is silently truncated for a single file.
report=$("$biome" lint --max-diagnostics=50 --colors=off "$file" 2>&1) || true
grep -qE '^\s*(×|Found [1-9])' <<<"$report" || exit 0

jq -n --arg r "$(printf '%s' "$report" | head -60)" --arg f "${file##*/}" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("Biome findings in \($f) after your edit. Errors fail CI; warn-level items are the known backlog and do not block.\n\n\($r)")
  }
}'
