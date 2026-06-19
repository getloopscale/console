# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 The Theo Authors
#
# Generic runtime image for a host-built static Go binary (theo-cloud OR
# mock-openai). The binary is compiled on the host (CGO_ENABLED=0) by run.sh
# and copied in — this sidesteps the private go-module token the production
# theo-cloud Dockerfile needs to fetch theo-contracts, keeping the e2e
# self-contained and fast.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
ARG BINARY
COPY ${BINARY} /app/server
ENTRYPOINT ["/app/server"]
