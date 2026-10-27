#!/usr/bin/env bash
# Copyright Ayers Electronics Inc. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# The identity gate. Four rules, all hard:
#   1. No forbidden identity string anywhere in the tree (the legacy handle, the retired
#      publisher names and mail handle, any iCloud address).
#   2. The publisher law: "Ayers Software Repair" appears on no package.json. The publisher is
#      Ayers Electronics; the copyright holder is Ayers Electronics Inc.
#   3. The author law: author credit is the root package.json alone.
#   4. The organization law: the GitHub organization's handle appears in a package.json only on
#      the repository url, the bugs url and the homepage.
set -euo pipefail
cd "$(dirname "$0")/.."

# Assembled from fragments, so that this file does not contain the names it forbids.
PATTERN='zj''ayers|meridian ?ve''ga|n733''11|asm''bl|i''cloud'
PUBLISHER='Ayers Software Repair'
ORGANIZATION='ayers-software-repair'

# The gate scans what git tracks, and what is staged: a file that can be committed or shipped.
# An ignored or untracked file is neither.
tracked() {
  git ls-files -c -- . | grep -vE '^(scripts/identity-gate\.sh|package-lock\.json)$'
}

# Both rules over whatever file list is piped in. An empty list is a failure, not a pass: a
# list that selects nothing looks the same as a clean tree.
scan() {
  local files fail=0
  files=$(cat)
  if [ -z "$files" ]; then
    echo "identity gate: the file list is empty, which is a broken scan and not a clean tree" >&2
    return 1
  fi
  if printf '%s\n' "$files" | xargs -r grep -EIin "$PATTERN"; then
    echo "identity gate: forbidden identity string found (matches above)" >&2
    fail=1
  fi
  while IFS= read -r manifest; do
    [ -n "$manifest" ] || continue
    if grep -n "$PUBLISHER" "$manifest"; then
      echo "identity gate: publisher law violated in $manifest" >&2
      fail=1
    fi
    if [ "$manifest" != "package.json" ] && grep -n '"author"' "$manifest"; then
      echo "identity gate: author law violated in $manifest (credit is the root package.json alone)" >&2
      fail=1
    fi
    if grep -n "$ORGANIZATION" "$manifest" | grep -vE '"(url|bugs|homepage)"'; then
      echo "identity gate: organization law violated in $manifest (the handle belongs on the repository url, bugs url and homepage only)" >&2
      fail=1
    fi
  done < <(printf '%s\n' "$files" | grep -E '(^|/)package\.json$' || true)
  return "$fail"
}

# --self-test runs the gate over a tree built to fail, and requires it to refuse.
if [ "${1:-}" = "--self-test" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  mkdir "$tmp/sub"
  printf '%s\n' "$(printf '%s' 'zj''ayers')" > "$tmp/handle.txt"
  printf '%s\n' "$(printf '%s' 'Meridian''Vega')" > "$tmp/brand.txt"
  printf '%s\n' "$(printf '%s' 'Meridian'' ''Vega')" > "$tmp/spaced.txt"
  printf '%s\n' "$(printf '%s' 'N73''311')" > "$tmp/mail-handle.txt"
  printf '%s\n' "$(printf '%s' 'MERIDIAN''VEGA')" > "$tmp/upper.txt"
  printf '%s\n' "$(printf '%s' 'someone@i''cloud.com')" > "$tmp/mail.txt"
  printf '{\n  "name": "x",\n  "publisher": "Ayers Software Repair",\n  "author": "x",\n  "dep": "ayers-software-repair"\n}\n' > "$tmp/sub/package.json"

  if output=$(find "$tmp" -type f | scan 2>&1); then
    echo "identity gate self-test FAILED: the gate passed a known-bad tree" >&2
    exit 1
  fi
  hits=$(printf '%s\n' "$output" | grep -c "$tmp/.*\.txt:" || true)
  if [ "$hits" -lt 6 ]; then
    echo "identity gate self-test FAILED: $hits of 6 bad files were refused" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
  for law in publisher author organization; do
    printf '%s\n' "$output" | grep -q "$law law violated" || {
      echo "identity gate self-test FAILED: the $law rule never fired" >&2
      exit 1
    }
  done
  if printf '' | scan 2>/dev/null; then
    echo "identity gate self-test FAILED: an empty file list passed" >&2
    exit 1
  fi
  count=$(tracked | wc -l)
  if [ "$count" -lt 15 ]; then
    echo "identity gate self-test FAILED: only $count tracked file(s) would be scanned" >&2
    exit 1
  fi
  echo "identity gate self-test: refused a known-bad tree on $hits file(s) and on the publisher, author and organization rules, and refused an empty list; $count real file(s) are scanned"
  exit 0
fi

tracked | scan
echo "identity gate: clean"
