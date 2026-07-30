# 1.26.5 fecha 11 dos 14 HIGH medidos (todos `stdlib`), incluindo CVE-2026-39822, que so tem
# correcao em 1.26.5. A variante alpine3.23 e usada porque `golang:1.26.5-alpine3.22` NAO existe
# (verificado com `docker manifest inspect`; o maximo em alpine3.22 e 1.26.4). O bump do alpine e
# seguro para a superficie publicada: o build e multi-stage e o estagio final e distroless, entao
# pacotes do builder nao sao embarcados — o que o Trivy aponta e o `stdlib` compilado no binario.
FROM golang:1.26.5-alpine3.23 AS builder
WORKDIR /workspace

ENV GOWORK=off
ENV GOPRIVATE=github.com/usetheodev/*

# theo-contracts is a PINNED published module (M5 version-pin cutover — go.mod requires
# github.com/usetheodev/theo-contracts v0.1.0, NO replace). The private module is fetched via
# a short-lived token mounted as a buildx secret (id=gomod_token); the token is NEVER written
# to an image layer. git is required for the module VCS fetch.
RUN apk add --no-cache git

# Post-M4 decomposition: theo-cloud is its own repo (no more cloud/ subdir).
# Build context is theo-cloud/ root; main.go lives at cmd/main.go directly.
COPY go.mod go.sum ./

RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=secret,id=gomod_token \
    sh -c 'if [ -s /run/secrets/gomod_token ]; then \
      git config --global url."https://x-access-token:$(cat /run/secrets/gomod_token)@github.com/usetheodev/".insteadOf "https://github.com/usetheodev/"; \
    fi' \
    && go mod download

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
