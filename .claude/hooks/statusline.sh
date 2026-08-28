#!/usr/bin/env bash
# statusLine — context is the binding constraint in this repo (a track session is long and
# the briefs are large), and "which track am I on / are the gates green" are the two questions
# asked most often. Both go in the status line so neither costs a tool call.
#
# Fails silent by design: a status line that errors is worse than no status line.
set -uo pipefail
input=$(cat 2>/dev/null || echo '{}')

dir=$(jq -r '.workspace.current_dir // .cwd // ""' <<<"$input" 2>/dev/null)
[[ -n "$dir" && -d "$dir" ]] && cd "$dir" 2>/dev/null
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "shademapnav"; exit 0; }

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
model=$(jq -r '.model.display_name // ""' <<<"$input" 2>/dev/null)

# Track inferred from the branch name when it follows the brief's conventions.
track=""
case "$branch" in
  shade/*|*/a[0-9]*) track="A" ;;
  nav/*|guidance/*)  track="B" ;;
  agent/*|copilot/*) track="C" ;;
  heat/*|timing/*)   track="D" ;;
  trip/*|mode/*)     track="E" ;;
  ci/*|harness/*)    track="G" ;;
esac

dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
[[ "$dirty" == "0" ]] && dirty="clean" || dirty="${dirty} dirty"

# Do the gates cover the current edits? Same rule the Stop hook uses.
marker="$root/.claude/state/gates-green"
gates="gates:?"
newest=$(git -C "$root" status --porcelain -- app api 2>/dev/null | awk '{print $NF}' \
         | grep -E '\.(ts|tsx)$' | while read -r f; do [[ -f "$root/$f" ]] && echo "$root/$f"; done \
         | xargs -r ls -t 2>/dev/null | head -1)
if [[ -z "$newest" ]]; then
  gates="gates:n/a"
elif [[ -f "$marker" && "$marker" -nt "$newest" ]]; then
  gates="gates:green"
else
  gates="gates:stale"
fi

printf '%s' "${model:+$model · }${track:+[$track] }$branch · $dirty · $gates"
