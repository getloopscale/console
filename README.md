# LoopScale Cloud

The control plane for LoopScale: the **dashboard**, the **cloud API** (accounts, projects,
billing/metering), and the **Model-B MCP credential broker** that mints per-tenant downstream keys
for the LoopScale MCP Gateway.

> **Status:** active development (pre-v1.0). Not yet validated in sustained production.

## CI/CD

Both workflows run on a **self-hosted runner** — the `getloopscale` org's GitHub-hosted minutes are
currently billing-blocked, so CI executes on a DigitalOcean droplet (runner `loopscale-ci-loop-console`;
cross-repo runbook in the `loopscale-workspace` umbrella).

The org convention is `ci.yml` (the per-repo test gate) + `publish.yml` (the image build, a thin
caller of the shared reusable `loopscale/build-publish.yml`).

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push / PR to `develop` | two jobs — **`e2e`** (full `docker compose` stack: pg + loopmem + Kratos + loop-console, `-race`) and **`e2e-edge`** (the same flow through the Traefik ForwardAuth edge). The sibling repos (`loopscale`, `loopmem`) are checked out at `develop` so the test runs against the current engine schema. |
| `publish.yml` | push to `develop` (preview) · tag `v*` (release) · manual | builds two images — **`loop-console`** + **`loopscale-dashboard`** — via the reusable `getloopscale/loopscale/.github/workflows/build-publish.yml`. On a tag, both are **cosign-signed** (keyless, GitHub OIDC) + **identity-pinned verify** + SBOM + SLSA (mode=max). On a `develop` push only the changed image is rebuilt (`:develop` / `:develop-<sha>`, unsigned). |

A release is cut through the `/release` cycle — a human-approved `develop → main` PR tags the merge
commit; the tag triggers the signed image build, and `/release` Step 7.4 verifies the published
digests + cosign result before the run is recorded.

## Governance

This repo is driven by the **Cycle 6+1** pipeline (discover → plan → implement → code-quality →
review → release → analysis). The pipeline contract (`.claude/`), the `CHANGELOG.md` and the
`ROADMAP.md` are no longer versioned here — they were removed in the docs cleanup (`8cbc8e7`).
Release history is the git tag list; current design docs live under [`docs/`](./docs).

## License

Apache-2.0 — see the SPDX headers on source files.
