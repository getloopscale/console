// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package skills

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// O duplo abaixo espelha o contrato MEDIDO de theo-skills
// `POST /v1/platform/keys` (packages/api/src/server/handlers/platform-keys.ts):
//
//	pedido : {"workspace_id": "...", "scopes": [...]}
//	201    : {"key_id": "...", "workspace_id": "...", "scopes": [...], "token": "..."}
//
// Os nomes importam e são diferentes dos de trust/themory (`name`/`secret`): um
// duplo que inventasse o formato concordaria com este cliente e falharia contra o
// servidor — foi exatamente esse defeito que o registry viveu com `payload_base64`.

func TestMintKey_SendsWorkspaceIDAndReadsToken(t *testing.T) {
	var gotPath, gotAuth string
	var gotBody map[string]any

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"key_id":"key_1","workspace_id":"ws_a","scopes":["skills:read"],"token":"theoskill_live_abc"}`))
	}))
	defer srv.Close()

	res, err := NewAdminClient(srv.URL, "plat-secret", srv.Client()).
		MintKey(context.Background(), "ws_a", "ignorado", []string{"skills:read"})
	if err != nil {
		t.Fatalf("MintKey: %v", err)
	}

	if gotPath != "/v1/platform/keys" {
		t.Errorf("path = %q, quer /v1/platform/keys (a rota de admin exige membro e deriva o tenant do chamador)", gotPath)
	}
	if gotAuth != "Bearer plat-secret" {
		t.Errorf("authorization = %q, quer a credencial de plataforma", gotAuth)
	}
	if gotBody["workspace_id"] != "ws_a" {
		t.Errorf("workspace_id = %v, quer ws_a", gotBody["workspace_id"])
	}
	if _, temNome := gotBody["name"]; temNome {
		t.Error("enviou `name`: o upstream ignora, e mandá-lo sugere uma capacidade de rotular que não existe")
	}
	if res.Secret != "theoskill_live_abc" {
		t.Errorf("Secret = %q — o campo do upstream é `token`, não `secret`", res.Secret)
	}
	if res.ID != "key_1" {
		t.Errorf("ID = %q — o campo do upstream é `key_id`", res.ID)
	}
}

func TestMintKey_EmptyTokenFailsClosed(t *testing.T) {
	// Um 201 com token vazio é a pior resposta possível: parece sucesso. Cachear
	// isso entregaria uma credencial inútil que só falha no primeiro uso real.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"key_id":"key_1","workspace_id":"ws_a","scopes":["skills:read"],"token":""}`))
	}))
	defer srv.Close()

	if _, err := NewAdminClient(srv.URL, "k", srv.Client()).
		MintKey(context.Background(), "ws_a", "", []string{"skills:read"}); err == nil {
		t.Fatal("token vazio devia falhar — o broker nunca pode cachear credencial inútil")
	}
}

func TestMintKey_UpstreamErrorNeverLeaksPlatformKey(t *testing.T) {
	// A credencial de plataforma é o segredo mais poderoso desta cadeia. Ela entra
	// no cabeçalho e não pode sair em erro algum — erros são logados, e log tem
	// retenção mais longa e leitura mais ampla que o cofre de onde o segredo veio.
	const segredo = "plat-super-secreto-nao-vaze"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
	}))
	defer srv.Close()

	_, err := NewAdminClient(srv.URL, segredo, srv.Client()).
		MintKey(context.Background(), "ws_a", "", []string{"skills:read"})
	if err == nil {
		t.Fatal("401 do upstream devia virar erro")
	}
	if strings.Contains(err.Error(), segredo) {
		t.Fatalf("a credencial de plataforma vazou no erro: %v", err)
	}
	var e *Error
	if !asError(err, &e) || e.StatusCode != http.StatusUnauthorized {
		t.Errorf("erro = %v, quer *Error tipado com status 401 para o chamador distinguir", err)
	}
}

func TestMintKey_RefusesEmptyWorkspaceAndEmptyScopes(t *testing.T) {
	// Guardas locais, mesmo com o upstream validando: uma chamada que não chega ao
	// servidor não pode criar credencial não atribuível, e o broker não é o único
	// chamador possível deste cliente.
	c := NewAdminClient("http://exemplo.invalido", "k", nil)
	if _, err := c.MintKey(context.Background(), "", "", []string{"skills:read"}); err == nil {
		t.Error("workspace vazio devia falhar antes da rede")
	}
	if _, err := c.MintKey(context.Background(), "ws_a", "", nil); err == nil {
		t.Error("lista de escopos vazia devia falhar antes da rede")
	}
}

// asError é errors.As com uma assinatura estreita — evita importar errors só para isto.
func asError(err error, target **Error) bool {
	for err != nil {
		if e, ok := err.(*Error); ok {
			*target = e
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
