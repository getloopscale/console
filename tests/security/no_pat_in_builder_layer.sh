#!/usr/bin/env bash
# T7.1 — the PAT must not survive the RUN that uses it.
#
# `git config --global` writes $HOME/.gitconfig with the token ALREADY EXPANDED. That path is in
# none of the RUN's mounts, so it persisted in the builder layer — and `cache-to: mode=max` exports
# intermediate-stage layers to the repository-scoped Actions cache. Anyone who could run a workflow
# here could restore the cache and read the PAT.
#
# The published image never had the problem (distroless final stage, one COPY --from). The cache did.
#
# The fix routes git's global config into a tmpfs mount, so the file never exists in a layer at all.
set -euo pipefail

IMG="${1:-loop-console:builder-residue-check}"
SECRET="${2:-}"

[ -n "$SECRET" ] || { echo "usage: $0 <image-tag> <path-to-gomod-token>"; exit 2; }

docker build -q --target builder -t "$IMG" --secret id=gomod_token,src="$SECRET" -f Dockerfile . >/dev/null

docker run --rm --entrypoint sh "$IMG" -c '
  fail=0
  if [ -f /root/.gitconfig ]; then echo "FAIL: /root/.gitconfig persists in the builder layer"; fail=1; fi
  n=$(grep -rl "x-access-token" /root /home /tmp /etc 2>/dev/null | wc -l)
  if [ "$n" -ne 0 ]; then
    echo "FAIL: $n file(s) in the builder layer contain an expanded PAT:"
    grep -rl "x-access-token" /root /home /tmp /etc 2>/dev/null | head -5
    fail=1
  fi
  [ "$fail" -eq 0 ] && echo "PASS: no PAT residue in the builder layer"
  exit $fail
'
