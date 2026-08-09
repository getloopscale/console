FROM node:20-alpine3.21 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY . .
# No VITE_* build args — config is injected at runtime via docker-entrypoint.sh.
# This makes the image environment-independent (same commit = same artifact).
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine3.21
LABEL org.opencontainers.image.source="https://github.com/usetheo/theo"
LABEL org.opencontainers.image.title="theo-dashboard"

# Upgrade Alpine packages to get latest security patches (openssl, musl).
#
# ARG BUILT_AT existe AQUI por seguranca, nao por proveniencia. MEDIDO (run 30577983071 contra um
# build local --no-cache do MESMO arquivo, MESMA base):
#
#   CI, com cache-from: type=gha ....... 4 HIGH  (c-ares 1.34.6-r0, libexpat 2.7.5-r0)
#   local, --no-cache .................. 0 HIGH
#
# A base nao tem culpa: TODAS as candidatas carregam esses CVEs, e todas listam a correcao como
# disponivel. O `apk upgrade` resolve — quando roda. No CI ele nao rodava: nada acima desta camada
# muda entre releases, entao o buildkit a servia do cache, congelada em quando foi criada. Um
# upgrade de seguranca em cache e um upgrade que parou de acontecer.
#
# BUILT_AT muda a cada run e ja e passado aos dois builds para carimbar proveniencia, entao declara-lo
# imediatamente antes do upgrade invalida exatamente esta camada e nenhuma acima dela. Sem mecanismo
# novo. O custo e o de reinstalar pacotes no estagio final, que e pequeno.
ARG BUILT_AT=unknown
USER root
RUN apk upgrade --no-cache
USER 101

COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
# Committed nginx config with CSP + security headers (find_infra_012).
COPY nginx.conf /etc/nginx/conf.d/default.conf
# B-100 — snippet incluido pelo default.conf. FORA de conf.d/ de proposito: a
# imagem base faz `include /etc/nginx/conf.d/*.conf`, entao um snippet ali seria
# carregado DUAS vezes — uma pelo glob, no contexto http, e outra pelos includes.
COPY nginx-security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/ || exit 1
