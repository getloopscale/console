// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package serviceversions

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// #345 — um indicador permanentemente vermelho e um indicador DESLIGADO.
//
// O dashboard mostrava "Degraded" em TODAS as telas porque o probe do engine recebia 401. A
// classificacao era `probe.go`: QUALQUER nao-200 virava `Unreachable`, e o agregado do dashboard
// transforma tudo que nao e `ok`/`not_deployed` em `degraded`.
//
// Mas 401 nao e evidencia de degradacao — e evidencia de que NAO NOS DEIXARAM PERGUNTAR. O
// servico respondeu: a pilha HTTP esta de pe. Chamar isso de "inalcancavel" e a imagem espelhada
// do defeito do reconciliador desta mesma corrida, que lia 401 como "a rota existe".
//
// Detectar sem que alguem consiga distinguir sinal de ruido equivale a NAO detectar: o usuario
// aprende a ignorar o vermelho, e quando algo degradar de verdade ninguem olha.
//
// O PAR e obrigatorio. So a primeira metade aceitaria uma implementacao que nunca reprova —
// trocar sempre-vermelho por sempre-verde, que e pior.

func probeStatus(t *testing.T, code int, body string) ServiceStatus {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	at := time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)
	return probe(context.Background(), srv.Client(), Target{Name: "loopzero", BaseURL: srv.URL},
		2*time.Second, func() time.Time { return at })
}

// METADE 1 — 401/403 nao pode contar como degradacao.
func TestProbe_treats_unauthorized_as_unmeasured_not_as_unhealthy(t *testing.T) {
	for _, code := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		got := probeStatus(t, code, `{"code":"UNAUTHORIZED"}`)
		if got.State() == StateUnreachable {
			t.Errorf("http %d classificado como %q. O servico RESPONDEU — a pilha esta de pe; o "+
				"que faltou foi credencial no probe. Chamar de inalcancavel pinta o indicador de "+
				"vermelho para sempre, e um indicador sempre-vermelho e um indicador desligado",
				code, got.State())
		}
		if got.State() != StateUnauthorized {
			t.Errorf("http %d devia virar %q, virou %q", code, StateUnauthorized, got.State())
		}
	}
}

// METADE 2 — degradacao REAL continua sendo detectada. Sem ela, "nunca reprova" passaria.
func TestProbe_still_reports_unreachable_for_real_failure(t *testing.T) {
	for _, code := range []int{http.StatusInternalServerError, http.StatusBadGateway, http.StatusNotFound} {
		if got := probeStatus(t, code, `{}`); got.State() != StateUnreachable {
			t.Errorf("http %d tem de continuar %q, virou %q — trocar sempre-vermelho por "+
				"sempre-verde e pior que o defeito original", code, StateUnreachable, got.State())
		}
	}
}

// E o caminho feliz segue feliz.
func TestProbe_ok_is_untouched(t *testing.T) {
	got := probeStatus(t, http.StatusOK, `{"version":"0.9.0","built_at":"2026-08-02T00:00:00Z"}`)
	if got.State() != StateOK {
		t.Errorf("200 com versao devia ser %q, virou %q (reason=%q)", StateOK, got.State(), got.reason)
	}
}
