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
    --mount=type=tmpfs,target=/tmp/gitcfg \
    # GIT_CONFIG_GLOBAL aponta para um tmpfs: o `git config --global` abaixo grava o token JA
    # EXPANDIDO, e o caminho padrao (`$HOME/.gitconfig`) nao esta em nenhum mount deste RUN,
    # entao ele persistiria na camada do builder. `cache-to: mode=max` exporta camadas de
    # estagios intermediarios para o cache do Actions, com escopo de repositorio: quem pudesse
    # rodar um workflow aqui restauraria o cache e leria o PAT. A imagem publicada nunca teve o
    # problema (estagio final distroless, um unico COPY --from), mas o cache tinha.
    #
    # tmpfs em vez de remover depois: nao ha codigo de saida a preservar nem passo a esquecer —
    # o arquivo simplesmente nunca chega a existir numa camada.
    #
    # `export` dentro de UM unico sh -c, nao um prefixo `VAR=x cmd1 && cmd2`: nessa forma o
    # shell exporta a variavel apenas para cmd1, e o `go mod download` rodaria sem ela,
    # caindo no $HOME/.gitconfig vazio. Medido: `fatal: could not read Username`.
    sh -c 'export GIT_CONFIG_GLOBAL=/tmp/gitcfg/config; \
      if [ -s /run/secrets/gomod_token ]; then \
        git config --global url."https://x-access-token:$(cat /run/secrets/gomod_token)@github.com/usetheodev/".insteadOf "https://github.com/usetheodev/"; \
      fi; \
      go mod download'

COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY openapi/ ./openapi/

# Proveniencia injetada no link. Declarada DEPOIS do `go mod download` de proposito: um valor que
# muda a cada commit invalidaria a camada de modulos e o build re-baixaria o grafo inteiro toda vez.
#
# Os defaults reproduzem os sentinelas do pacote: um build local sem --build-arg reporta "dev" e
# "unknown", nunca uma string vazia e nunca um valor mentiroso.
ARG VERSION=dev
ARG GIT_SHA=unknown
ARG BUILT_AT=unknown

RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath \
      -ldflags="-s -w \
        -X github.com/usetheodev/theo-cloud/internal/version.Version=${VERSION} \
        -X github.com/usetheodev/theo-cloud/internal/version.GitSHA=${GIT_SHA} \
        -X github.com/usetheodev/theo-cloud/internal/version.BuiltAt=${BUILT_AT}" \
      -o /cloud-api ./cmd/main.go

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
