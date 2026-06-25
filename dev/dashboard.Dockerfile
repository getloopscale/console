# syntax=docker/dockerfile:1
#
# Dashboard SPA — multi-stage build (dashboard-manualchunks-tdz-fix T2.1, ADR D3).
# Builds the production bundle FROM SOURCE so the unified Traefik edge serves the
# FIXED bundle reproducibly in any environment — `dashboard/dist` is gitignored and
# NOT built by dev/run.sh (which runs vite-dev on :5173), so mounting it was stale /
# non-reproducible. Context is the gateway repo root (see docker-compose.dev.yaml);
# .dockerignore keeps host node_modules out of the context (EC-1).

# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app/dashboard
# Deps in a cached layer (EC-5): copy manifests first, then the source.
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# --- serve stage ---
# Dev edge image (plain nginx:alpine). The HARDENED production counterpart is
# dashboard/Dockerfile (nginx-unprivileged, non-root, CSP/security headers). The TDZ
# fix lives in the shared vite build, so it reaches BOTH images (review BUILD-6).
FROM nginx:alpine
# Static SPA output + the history-API fallback config (the slice-3a nginx.conf).
COPY --from=build /app/dashboard/dist /usr/share/nginx/html
COPY dev/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
