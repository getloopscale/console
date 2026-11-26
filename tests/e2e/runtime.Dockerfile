# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 The LoopScale Authors
#
# Generic runtime image for a host-built static Go binary (loop-console OR
# mock-openai). The binary is compiled on the host (CGO_ENABLED=0) by run.sh
# and copied in — this sidesteps the private go-module token the production
# loop-console Dockerfile needs to fetch contracts, keeping the e2e
# self-contained and fast.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
ARG BINARY
COPY ${BINARY} /app/server
ENTRYPOINT ["/app/server"]
