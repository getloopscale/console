# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 The LoopScale Authors
#
# Runtime image for the host-built static loop-console gateway binary (dev stack).
# Mirrors tests/e2e/runtime.Dockerfile — the binary is compiled on the host by
# dev/run.sh (CGO_ENABLED=0) and copied in.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
ARG BINARY
COPY ${BINARY} /app/server
ENTRYPOINT ["/app/server"]
