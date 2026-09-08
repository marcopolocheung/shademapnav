#!/usr/bin/env bash
# Refuse to publish a commit that carries something private.
#
# The mirror pushes this repo's `main` to a *public* repo, so anything committed
# here is public the moment it merges. Publishing is not reversible — a pushed
# secret is a leaked secret even after a force-push — so this runs before the
# push, not after it.
#
# Scope: the tracked tree at HEAD. History is not re-scanned; the two repos share
# history from the mirror's first push onward, so anything already public stays
# public whatever this says about it.
#
#     scripts/mirror-guard.sh [ref]     # default: HEAD
set -euo pipefail

ref="${1:-HEAD}"
fail=0

report() {
  fail=1
  printf '\n\033[31mBLOCKED\033[0m %s\n' "$1"
  shift
  printf '  %s\n' "$@"
}

# 1. Files that are private by name. `.gitignore` already covers `.env*`, so a
#    match here means someone committed one with `--force`.
paths=$(git ls-tree -r --name-only "$ref" \
  | grep -Ei '(^|/)\.env($|\.)|(^|/)\.npmrc$|(^|/)\.netrc$|\.pem$|\.p12$|\.pfx$|(^|/)id_(rsa|ed25519)$|(^|/)\.vercel/' || true)
if [ -n "$paths" ]; then
  report "private-by-name files are tracked:" $paths
fi

# 2. Credential-shaped literals. Prefixes only: a pattern loose enough to catch
#    an unknown key shape is loose enough to cry wolf on every base64 blob, and a
#    guard that cries wolf gets bypassed.
literals=$(git grep -nIE \
  'csk-[a-zA-Z0-9]{20,}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{30,}|gho_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY' \
  "$ref" -- . || true)
if [ -n "$literals" ]; then
  report "credential-shaped literals are committed:" "$literals"
fi

# 3. A key assigned inline rather than read from the environment. Every real key
#    in this repo arrives via `process.env` / `import.meta.env` / `secrets.`.
inline=$(git grep -nIE \
  '(API_KEY|apiKey|api_key|accessToken|access_token|password|secret)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_-]{20,}["'"'"']' \
  "$ref" -- . \
  | grep -viE 'process\.env|import\.meta\.env|secrets\.|\$\{|example|placeholder|your_|xxx|fixture|mock|dummy|test' || true)
if [ -n "$inline" ]; then
  report "a credential looks hard-coded rather than read from the environment:" "$inline"
fi

if [ "$fail" -ne 0 ]; then
  cat >&2 <<'MSG'

The mirror push was not attempted. Remove the finding from `main` — and rotate
the credential if one was real — before merging anything else.
MSG
  exit 1
fi

echo "mirror-guard: $ref carries no .env, credential literal or hard-coded key."
