# Theo Cloud

The control plane for Theo: the **dashboard**, the **cloud API** (accounts, projects,
billing/metering), and the **Model-B MCP credential broker** that mints per-tenant downstream keys
for the Theo MCP Gateway.

> **Status:** active development (pre-v1.0). Not yet validated in sustained production.

## CI/CD

Both workflows run on a **self-hosted runner** — the `usetheodev` org's GitHub-hosted minutes are
currently billing-blocked, so CI executes on a DigitalOcean droplet (runner `theo-ci-theo-cloud`;
cross-repo runbook in the `theo-data` workspace).

The org convention is `ci.yml` (the per-repo test gate) + `publish.yml` (the image build, a thin
caller of the shared reusable `theo/build-publish.yml`).

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push / PR to `develop` | two jobs — **`e2e`** (full `docker compose` stack: pg + themory + Kratos + theo-cloud, `-race`) and **`e2e-edge`** (the same flow through the Traefik ForwardAuth edge). The sibling repos (`theo`, `theo-memory`) are checked out at `develop` so the test runs against the current engine schema. |
| `publish.yml` | push to `develop` (preview) · tag `v*` (release) · manual | builds two images — **`theo-cloud`** + **`theo-dashboard`** — via the reusable `usetheodev/theo/.github/workflows/build-publish.yml`. On a tag, both are **cosign-signed** (keyless, GitHub OIDC) + **identity-pinned verify** + SBOM + SLSA (mode=max). On a `develop` push only the changed image is rebuilt (`:develop` / `:develop-<sha>`, unsigned). |

A release is cut through the `/release` cycle — a human-approved `develop → main` PR tags the merge
commit; the tag triggers the signed image build, and `/release` Step 7.4 verifies the published
digests + cosign result before the run is recorded.

## Governance

This repo is driven by the **Cycle 6+1** pipeline (discover → plan → implement → code-quality →
review → release → analysis). The full contract — rules, skills, knowledge-base — lives under
[`.claude/`](./.claude). See [`CHANGELOG.md`](./CHANGELOG.md) for the change log and
[`ROADMAP.md`](./ROADMAP.md) for milestones.

## License

Apache-2.0 — see the SPDX headers on source files.
