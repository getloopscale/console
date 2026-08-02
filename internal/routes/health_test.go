// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type stubPinger struct{ err error }

func (s stubPinger) PingContext(context.Context) error { return s.err }

func probe(t *testing.T, h *HealthHandler) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("corpo nao e JSON: %v (%s)", err, rec.Body.String())
	}
	return rec.Code, body
}

// O NEGATIVO — e ele reprova o comportamento que esta EM PRODUCAO hoje.
//
// O handler ja calculava `status: degraded` com o banco fora e nunca escrevia status HTTP; sem
// WriteHeader o Go devolve 200. O healthcheck do compose usa `wget -qO- .../health`, que so falha
// em status de erro — entao a sonda ficava VERDE com o servico incapaz de servir. A informacao
// certa era computada e descartada na ultima linha.
func TestHealth_returns_503_when_the_database_cannot_serve(t *testing.T) {
	h := NewHealthHandler(stubPinger{err: errors.New("connection refused")}, nil)

	code, body := probe(t, h)

	if code != http.StatusServiceUnavailable {
		t.Errorf("banco fora tem de reprovar a sonda: got %d, want 503. Com 200 o healthcheck "+
			"do compose fica verde sobre um servico que nao consegue servir /v1 nem o ForwardAuth "+
			"que a borda consulta", code)
	}
	if body["status"] != "degraded" || body["db"] != "disconnected" {
		t.Errorf("o corpo tem de dizer O QUE degradou: %v", body)
	}
}

// O POSITIVO. Sem ele, uma sonda que reprova SEMPRE passaria no teste acima e derrubaria o
// container em toda inicializacao — o erro classico deste tipo de correcao.
func TestHealth_returns_200_when_the_database_serves(t *testing.T) {
	h := NewHealthHandler(stubPinger{}, nil)

	code, body := probe(t, h)

	if code != http.StatusOK {
		t.Errorf("banco saudavel tem de PASSAR: got %d, want 200", code)
	}
	if body["status"] != "ok" || body["db"] != "connected" {
		t.Errorf("corpo inesperado: %v", body)
	}
}

// Implantacao sem banco configurado nao e degradada — e outra topologia. Reprovar aqui
// derrubaria um deploy legitimo.
func TestHealth_returns_200_when_no_database_is_configured(t *testing.T) {
	if code, body := probe(t, NewHealthHandler(nil, nil)); code != http.StatusOK || body["db"] != "not_configured" {
		t.Errorf("sem banco configurado: got %d %v, want 200 not_configured", code, body)
	}
}

// Integracao desligada e REPORTADA, nunca gatilho de reprovacao.
//
// Esta e a metade que impede a correcao de virar o proprio defeito que ela combate: as chaves de
// broker sao opcionais por ambiente, e reprovar a sonda por causa delas derrubaria o container
// toda vez que uma nao estivesse configurada. O #334 e o theo-workspace#27 sao dois casos em que a
// capacidade sumiu com o container saudavel — o que faltava era VISIBILIDADE, e visibilidade se
// entrega no corpo, nao no status.
func TestHealth_reports_a_disabled_integration_without_failing_the_probe(t *testing.T) {
	h := NewHealthHandler(stubPinger{}, func() map[string][]string {
		return map[string][]string{
			"skills":   {"SKILLS_PLATFORM_ADMIN_KEY"},
			"promptly": {},
		}
	})

	code, body := probe(t, h)

	if code != http.StatusOK {
		t.Fatalf("integracao ausente NAO pode reprovar a sonda: got %d, want 200", code)
	}
	integrations, ok := body["integrations"].(map[string]any)
	if !ok {
		t.Fatalf("a sonda nao reporta integracoes: %v", body)
	}
	missing, ok := integrations["skills"].([]any)
	if !ok || len(missing) != 1 || missing[0] != "SKILLS_PLATFORM_ADMIN_KEY" {
		t.Errorf("a sonda tem de NOMEAR o que falta (foi assim que o #334 doeu): %v", integrations)
	}
}
