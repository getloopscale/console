# 1.26.5 fecha 11 dos 14 HIGH medidos (todos `stdlib`), incluindo CVE-2026-39822, que so tem
# correcao em 1.26.5. A variante alpine3.23 e usada porque `golang:1.26.5-alpine3.22` NAO existe
# (verificado com `docker manifest inspect`; o maximo em alpine3.22 e 1.26.4). O bump do alpine e
# seguro para a superficie publicada: o build e multi-stage e o estagio final e distroless, entao
# pacotes do builder nao sao embarcados — o que o Trivy aponta e o `stdlib` compilado no binario.
# 1.26.10 closes the stdlib HIGHs Trivy reported on 1.26.6 (CVE-2026-78667, CVE-2026-78669,
# CVE-2026-97031, CVE-2026-111943). Pinned by digest so a retag cannot change the builder.
FROM golang:1.26.10-alpine3.23@sha256:78e7f1e419545bc4b8b5ee8a40a99ddb5df1216d38681dbab2eeb1fdb2427f43 AS builder
WORKDIR /workspace

ENV GOWORK=off
ENV GOPRIVATE=github.com/getloopscale/*

# contracts is a PINNED published module (M5 version-pin cutover — go.mod requires
# github.com/getloopscale/contracts v0.1.0, NO replace). The private module is fetched via
# a short-lived token mounted as a buildx secret (id=gomod_token); the token is NEVER written
# to an image layer. git is required for the module VCS fetch.
RUN apk add --no-cache git

# Post-M4 decomposition: loop-console is its own repo (no more cloud/ subdir).
# Build context is loop-console/ root; main.go lives at cmd/main.go directly.
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
        git config --global url."https://x-access-token:$(cat /run/secrets/gomod_token)@github.com/getloopscale/".insteadOf "https://github.com/getloopscale/"; \
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
# `${VAR:-sentinela}` no uso, e nao so o default do ARG: um `--build-arg VERSION=` EXPLICITAMENTE
# vazio sobrescreve o default e passaria "" adiante. Medido na review: version="" faz
# normalizeUnknown devolver "", OK() degradar a linha para Unreachable e o painel inteiro ficar
# `degraded` para sempre — exatamente a falha que o sentinela "dev" existe para evitar. O reusable
# declara esses inputs como opcionais com default '', entao qualquer caller futuro cai nisso.
ARG VERSION=dev
ARG GIT_SHA=unknown
ARG BUILT_AT=unknown

RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath \
      -ldflags="-s -w \
        -X github.com/getloopscale/loop-console/internal/version.Version=${VERSION:-dev} \
        -X github.com/getloopscale/loop-console/internal/version.GitSHA=${GIT_SHA:-unknown} \
        -X github.com/getloopscale/loop-console/internal/version.BuiltAt=${BUILT_AT:-unknown}" \
      -o /cloud-api ./cmd

# Distroless static runtime (find_infra_009): no shell/apk/utilities to reduce
# post-compromise attack surface. Includes ca-certificates and runs as the
# built-in nonroot user (uid 65532). The binary is fully static (CGO_ENABLED=0).
FROM gcr.io/distroless/static-debian12:nonroot

LABEL org.opencontainers.image.source="https://github.com/getloopscale/loop-console"
LABEL org.opencontainers.image.title="loop-console"
LABEL org.opencontainers.image.description="LoopConsole service"

COPY --from=builder /cloud-api /cloud-api
USER nonroot:nonroot
EXPOSE 13002

# No Docker HEALTHCHECK: distroless has no shell/wget. Kubernetes liveness and
# readiness probes (httpGet /health on 13002) own health checking in production.

CMD ["/cloud-api"]
