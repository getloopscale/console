#!/usr/bin/env bash
# T1.1 — the CVE surface the publish gate will enforce.
#
# Replicates `build-publish.yml:100-109` exactly: severity CRITICAL,HIGH, --ignore-unfixed, and the
# same exit-code semantics. Run it BEFORE enabling `trivy: true` on the channel; a non-zero exit
# here is a non-zero exit there, and there it stops the deploy.
#
# It scans an image built from the WORKING TREE, because that is what the gate scans
# (`build-publish.yml:83-95` builds `:scan-target` with `load: true` before any push). A clean
# published image does not predict the gate's verdict.
set -euo pipefail

IMG="${1:-loop-console:cve-check}"
DOCKERFILE="${2:-Dockerfile}"

command -v trivy >/dev/null || { echo "FAIL: trivy not installed — a scan that did not run is never clean"; exit 2; }

docker build -q -t "$IMG" -f "$DOCKERFILE" . >/dev/null

trivy image --quiet --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed \
      --format json "$IMG" > /tmp/trivy-${IMG//[:\/]/_}.json

python3 - "$IMG" <<'PY'
import json, sys, collections
img = sys.argv[1]
d = json.load(open(f"/tmp/trivy-{img.replace(':','_').replace('/','_')}.json"))
c = collections.Counter()
rows = []
for r in d.get("Results") or []:
    for v in r.get("Vulnerabilities") or []:
        c[v["Severity"]] += 1
        rows.append((v["Severity"], v["VulnerabilityID"], v.get("PkgName"),
                     v.get("InstalledVersion"), v.get("FixedVersion", "")))
total = sum(c.values())
print(f"{img}: CRITICAL={c['CRITICAL']} HIGH={c['HIGH']} TOTAL={total}")
for s, i, p, iv, f in rows:
    print(f"  {s:8s} {i:22s} {p} {iv} -> {f}")
if total:
    print(f"FAIL: {total} CRITICAL/HIGH remain; the publish gate would exit 1")
    sys.exit(1)
print("PASS: the publish gate would exit 0")
PY
