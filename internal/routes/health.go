// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// Pinger e a unica coisa que a sonda precisa do banco. Interface no consumidor (DIP): o handler
// nao conhece pgx, e o teste consegue derrubar a dependencia sem subir Postgres — que e
// exatamente a metade sem a qual a sonda "aponta para o lugar certo e mede nada".
type Pinger interface {
	PingContext(ctx context.Context) error
}

// HealthHandler responde /health.
type HealthHandler struct {
	db           Pinger
	probeTimeout time.Duration
	// integrations devolve, por integracao, a lista de configuracoes AUSENTES (vazia = habilitada).
	// Reusa config.MissingSettings, que o #334 ja usa no boot — a mesma verdade, agora tambem
	// legivel em runtime por quem sonda.
	integrations func() map[string][]string
}

func NewHealthHandler(db Pinger, integrations func() map[string][]string) *HealthHandler {
	return &HealthHandler{db: db, probeTimeout: 2 * time.Second, integrations: integrations}
}

func (h *HealthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	dbStatus := "not_configured"
	if h.db != nil {
		ctx, cancel := context.WithTimeout(r.Context(), h.probeTimeout)
		defer cancel()
		if err := h.db.PingContext(ctx); err != nil {
			dbStatus = "disconnected"
		} else {
			dbStatus = "connected"
		}
	}

	status := "ok"
	if h.db != nil && dbStatus != "connected" {
		status = "degraded"
	}

	body := map[string]any{"status": status, "db": dbStatus}
	if h.integrations != nil {
		body["integrations"] = h.integrations()
	}

	// O STATUS HTTP e a unica parte que uma sonda le. O handler ja calculava `degraded` e
	// terminava sem WriteHeader — e sem ele o Go devolve 200, entao a conclusao certa era
	// computada e descartada na ultima linha. `wget -qO- .../health`, que e o healthcheck do
	// compose, so falha em status de erro: a sonda ficava verde sobre um servico incapaz de
	// servir /v1, /engine e o ForwardAuth que a borda consulta para autorizar cada produto.
	//
	// Integracao ausente NAO entra aqui de proposito: ela e opcional por ambiente, e reprovar
	// por causa dela derrubaria o container em toda topologia que nao a configura. Ela e
	// REPORTADA no corpo — que era o que faltava no #334 e no theo-workspace#27, onde a
	// capacidade sumiu com o container saudavel.
	if status != "ok" {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(body)
}
