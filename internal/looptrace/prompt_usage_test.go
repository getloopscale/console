// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package looptrace

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// M15 (loopprompt) — o agregado de uso por revisão atravessa o BFF.
//
// O que precisa ser provado aqui não é a forma da resposta (o proxy passa o corpo
// do upstream adiante, e é isso que o impede de divergir): é o CAMINHO, o escopo
// por inquilino, e a distinção entre "não consegui ler" e "não há dado" — que o
// DoD-3 do milestone exige e que o M13 já mostrou ser onde a tela mente.

func TestPromptUsage_HitsRealPath_WithBearer(t *testing.T) {
	var gotPath, gotQuery, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery, gotAuth = r.URL.Path, r.URL.RawQuery, r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"promptName":"saudacao","windowDays":7,"rows":[{"revision":6,"resolutions":12,"totalTokens":1500,"costUsd":0.031}]}`))
	}))
	t.Cleanup(srv.Close)

	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}).WithKeyResolver(fixedResolver("theo_live_minted"))
	body, err := c.PromptUsage(context.Background(), "saudacao", 7)
	if err != nil {
		t.Fatalf("PromptUsage: %v", err)
	}

	if gotPath != "/v1/analytics/prompt-usage" {
		t.Fatalf("path = %q, want /v1/analytics/prompt-usage", gotPath)
	}
	if gotQuery != "prompt=saudacao&windowDays=7" {
		t.Fatalf("query = %q", gotQuery)
	}
	if gotAuth != "Bearer theo_live_minted" {
		t.Fatalf("auth = %q", gotAuth)
	}
	// O corpo do upstream atravessa intacto — o BFF não remodela a resposta.
	if want := `"revision":6`; !contains(string(body), want) {
		t.Fatalf("corpo não atravessou: %s", body)
	}
}

func TestPromptUsage_UpstreamDown_IsDistinguishableFromEmpty(t *testing.T) {
	// DoD-3: "não consegui ler" ≠ "não há dado". Se as duas situações produzirem a
	// mesma coisa, a tela mostra zeros sobre uma falha — que é pior que não mostrar.
	indisponivel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"upstream down"}`))
	}))
	t.Cleanup(indisponivel.Close)
	vazio := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"promptName":"saudacao","windowDays":7,"rows":[]}`))
	}))
	t.Cleanup(vazio.Close)

	cFalha := NewDataClient(indisponivel.URL, &http.Client{Timeout: time.Second}).WithKeyResolver(fixedResolver("k"))
	_, errFalha := cFalha.PromptUsage(context.Background(), "saudacao", 7)
	if errFalha == nil {
		t.Fatal("upstream 502 tem de virar erro, nunca agregado vazio")
	}

	cVazio := NewDataClient(vazio.URL, &http.Client{Timeout: time.Second}).WithKeyResolver(fixedResolver("k"))
	body, errVazio := cVazio.PromptUsage(context.Background(), "saudacao", 7)
	if errVazio != nil {
		t.Fatalf("agregado vazio é resposta legítima, não erro: %v", errVazio)
	}
	if !contains(string(body), `"rows":[]`) {
		t.Fatalf("corpo vazio não atravessou: %s", body)
	}
}

func TestPromptUsage_FailClosed_NoResolver(t *testing.T) {
	var atingido bool
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { atingido = true }))
	t.Cleanup(srv.Close)

	c := NewDataClient(srv.URL, &http.Client{Timeout: time.Second}) // sem WithKeyResolver
	if _, err := c.PromptUsage(context.Background(), "saudacao", 7); err == nil {
		t.Fatal("sem resolvedor de chave, tem de falhar")
	}
	if atingido {
		t.Fatal("nenhuma requisição pode sair sem inquilino resolvido (fail-closed)")
	}
}

// TestPromptUsage_concurrent_nao_mistura_tenants — o cliente é composto UMA vez
// (cmd/main.go) e servido a todas as requisições em goroutines paralelas,
// compartilhando o resolvedor de chave. Um teste single-thread nunca provaria que
// dois inquilinos concorrentes não trocam de credencial. Rodar com -race.
func TestPromptUsage_concurrent_nao_mistura_tenants(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// O servidor ecoa a credencial que recebeu, para o chamador conferir que é a dele.
		_, _ = fmt.Fprintf(w, `{"echo":%q}`, r.Header.Get("Authorization"))
	}))
	t.Cleanup(srv.Close)

	// O resolvedor lê o inquilino do contexto — como o broker real faz.
	type chaveCtx struct{}
	c := NewDataClient(srv.URL, &http.Client{Timeout: 5 * time.Second}).
		WithKeyResolver(func(ctx context.Context) (string, error) {
			inq, _ := ctx.Value(chaveCtx{}).(string)
			if inq == "" {
				return "", fmt.Errorf("sem inquilino no contexto")
			}
			return "chave-de-" + inq, nil
		})

	var wg sync.WaitGroup
	erros := make(chan error, 50)
	for i := 0; i < 50; i++ {
		inq := fmt.Sprintf("inquilino-%d", i%2)
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx := context.WithValue(context.Background(), chaveCtx{}, inq)
			body, err := c.PromptUsage(ctx, "saudacao", 7)
			if err != nil {
				erros <- err
				return
			}
			if esperado := "Bearer chave-de-" + inq; !contains(string(body), esperado) {
				erros <- fmt.Errorf("resposta de %s carregou credencial de outro: %s", inq, body)
			}
		}()
	}
	wg.Wait()
	close(erros)
	for err := range erros {
		t.Fatalf("credencial cruzou entre inquilinos concorrentes: %v", err)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}
