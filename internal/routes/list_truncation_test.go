// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"

	"github.com/getloopscale/loop-console/internal/auth"
)

// B-114 — uma lista que trunca DIZ que truncou.
//
// # O defeito, medido em 2026-08-10
//
// Seis rotas deste serviço aplicam um teto fixo no SQL e devolvem a lista sem `total`, sem
// `has_more` e sem cursor:
//
//	lens/dashboards          LIMIT 100    {dashboards}
//	lens/alert-rules         LIMIT 200    {alert_rules}
//	lens/saved-views         LIMIT 100    {saved_views}
//	memory/webhooks/list     LIMIT 100    {webhooks}
//	workspace/webhooks       LIMIT 100    {webhooks}
//	api-keys                 LIMIT 100    {keys}
//
// A 101ª linha some, e nada na resposta diz que sumiu. O usuário vê uma lista completa.
//
// E o cliente PEDE um teto: `pages/lens/traces/saved-views.tsx:52` chama
// `?limit=${LIST_SAFETY_CEILING}`, e `lens_saved_views.go:112` nunca lê `limit` — aplica o seu.
// O guard `request-ceiling.test.ts` do dashboard declara, no próprio cabeçalho, que não consegue
// provar que o servidor honra o teto porque "vários endpoints vivem na engine, outro repositório".
// Estes seis vivem aqui. Daqui dá.
//
// # Por que `has_more`, e não `total`
//
// `total` custa um `COUNT(*)` por requisição. A pergunta que o usuário precisa que seja
// respondida é "há mais do que estou vendo?", e ela se responde pedindo uma linha a mais do que
// se devolve — nenhuma query extra. O `{total, limit, offset}` de `lens_alert_rules.go:214` é o
// destino de quem ganhar paginação de verdade; estas seis têm um cap defensivo, não paginação.

// respostaComMais decodifica o corpo e devolve (o campo da lista, has_more).
func respostaComMais(t *testing.T, corpo string, campo string) (int, bool) {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(corpo), &m); err != nil {
		t.Fatalf("corpo não é JSON: %v — %s", err, corpo)
	}
	lista, ok := m[campo].([]any)
	if !ok {
		t.Fatalf("resposta sem o campo %q: %s", campo, corpo)
	}
	mais, _ := m["has_more"].(bool)
	return len(lista), mais
}

func linhasDeSavedView(n int) *sqlmock.Rows {
	linhas := sqlmock.NewRows([]string{"id", "name", "query_string", "created_at"})
	for i := 0; i < n; i++ {
		linhas.AddRow("lsv-00112233445566"+string(rune('a'+i%26)), "View", "q", "2026-08-10T10:00:00Z")
	}
	return linhas
}

func TestSavedViews_List_DizQueTruncou(t *testing.T) {
	// O cap é 100. Com 101 linhas disponíveis, a resposta devolve 100 e PRECISA dizer que há
	// mais — senão o usuário conclui que tem exatamente 100 views, e a 101ª não existe para ele.
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()

	mock.ExpectQuery("SELECT id, name, query_string, created_at").
		WithArgs("sub-1", "tn-1").
		WillReturnRows(linhasDeSavedView(101))

	h := NewLensSavedViewsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/dashboard/lens/saved-views", nil)
	r = r.WithContext(auth.WithUser(r.Context(), &auth.UserContext{
		Subject: "sub-1", Email: "o@x.com", TenantID: "tn-1",
	}))
	h.List(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 — %s", w.Code, w.Body.String())
	}

	n, mais := respostaComMais(t, w.Body.String(), "saved_views")
	if n != 100 {
		t.Errorf("devolveu %d linhas, quer 100 (o cap)", n)
	}
	if !mais {
		t.Errorf("truncou em 100 de 101 e NÃO disse: has_more ausente ou false — %s", w.Body.String())
	}
}

func TestSavedViews_List_NaoMenteQuandoNaoTruncou(t *testing.T) {
	// A contraparte, e ela importa: sem este caso o conserto poderia ser "has_more sempre true",
	// e a tela passaria a avisar de um truncamento que não houve — um aviso que sempre aparece é
	// um aviso que ninguém lê.
	dbConn, mock, _ := sqlmock.New()
	defer func() { _ = dbConn.Close() }()

	mock.ExpectQuery("SELECT id, name, query_string, created_at").
		WithArgs("sub-1", "tn-1").
		WillReturnRows(linhasDeSavedView(3))

	h := NewLensSavedViewsHandler(dbConn, nil)
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/dashboard/lens/saved-views", nil)
	r = r.WithContext(auth.WithUser(r.Context(), &auth.UserContext{
		Subject: "sub-1", Email: "o@x.com", TenantID: "tn-1",
	}))
	h.List(w, r)

	n, mais := respostaComMais(t, w.Body.String(), "saved_views")
	if n != 3 {
		t.Errorf("devolveu %d linhas, quer 3", n)
	}
	if mais {
		t.Errorf("disse que truncou sem ter truncado — %s", w.Body.String())
	}
}
