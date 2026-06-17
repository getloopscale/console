FROM golang:1.26.1-alpine3.22 AS builder
WORKDIR /workspace

ENV GOWORK=off

# Sibling theo-contracts module: go.mod uses `replace => ../theo-contracts`
# which from /workspace/ resolves to /theo-contracts. Provided via BuildKit
# named build context `theo-contracts` so the sibling repo is reachable inside
# the Docker build (per M5 decomposition; see theo/docs/version-pin-cutover-runbook.md).
# Sponsor-direct-approval 2026-06-17 ("O sistema deve rodar no k3, continue").
COPY --from=theo-contracts . /theo-contracts

# Post-M4 decomposition: theo-cloud is its own repo (no more cloud/ subdir).
# Build context is theo-cloud/ root; main.go lives at cmd/main.go directly.
COPY go.mod go.sum ./

RUN --mount=type=cache,target=/root/go/pkg/mod \
    go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY openapi/ ./openapi/

RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /cloud-api ./cmd/main.go

# Distroless static runtime (find_infra_009): no shell/apk/utilities to reduce
# post-compromise attack surface. Includes ca-certificates and runs as the
# built-in nonroot user (uid 65532). The binary is fully static (CGO_ENABLED=0).
FROM gcr.io/distroless/static-debian12:nonroot

LABEL org.opencontainers.image.source="https://github.com/usetheodev/theo-cloud"
LABEL org.opencontainers.image.title="theo-cloud"
LABEL org.opencontainers.image.description="TheoCloud service"

COPY --from=builder /cloud-api /cloud-api
USER nonroot:nonroot
EXPOSE 13002

# No Docker HEALTHCHECK: distroless has no shell/wget. Kubernetes liveness and
# readiness probes (httpGet /health on 13002) own health checking in production.

CMD ["/cloud-api"]
