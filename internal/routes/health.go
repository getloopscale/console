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
	// failWhenDegraded separa readiness de liveness — ver NewReadyHandler.
	failWhenDegraded bool
	// integrations devolve, por integracao, a lista de configuracoes AUSENTES (vazia = habilitada).
	// Reusa config.MissingSettings, que o #334 ja usa no boot — a mesma verdade, agora tambem
	// legivel em runtime por quem sonda.
	integrations func() map[string][]string
}

// NewHealthHandler — LIVENESS. "O processo esta vivo." NUNCA reprova por falha de dependencia:
// um livenessProbe que reprova porque o banco piscou MATA o container, e o container reinicia
// sem corrigir nada (LT-038 do theo-trust, LT-040/LT-041 do promptly). O estado do banco vai no
// corpo, para quem investiga; nao no status, que e o que decide se o processo morre.
func NewHealthHandler(db Pinger, integrations func() map[string][]string) *HealthHandler {
	return &HealthHandler{db: db, probeTimeout: 2 * time.Second, integrations: integrations}
}

// NewReadyHandler — READINESS. "Consigo servir agora." REPROVA quando a dependencia nao serve,
// para que o trafego seja retirado desta instancia enquanto ela nao pode atender.
//
// As duas existem porque as perguntas sao diferentes e as acoes tambem: liveness reprovada mata o
// processo, readiness reprovada apenas o tira do balanceamento. Um endpoint so obriga a escolher
// entre nao detectar degradacao e derrubar o servico por um piscar do banco.
func NewReadyHandler(db Pinger, integrations func() map[string][]string) *HealthHandler {
	h := NewHealthHandler(db, integrations)
	h.failWhenDegraded = true
	return h
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
	if status != "ok" && h.failWhenDegraded {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(body)
}
