// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M149 / usetheoai/theo-cloud#405 — a chave usada pela BORDA precisa registrar o uso.
//
// Havia dois caminhos de autenticação e só um gravava: `RequireScope` (rotas Bearer do próprio
// theo-cloud) atualizava `last_used_at`, e `ResolveAPIKey` — sobre a qual o ForwardAuth da borda é
// montado, e por onde passa TODO produto Model-B — não. Consequência medida no app-dev: 9 de 9
// chaves marcando `Never`, incluindo uma usada em seis chamadas minutos antes.
//
// A coluna existe para responder "quais credenciais estão vivas?". Respondendo errado, quem fizer a
// limpeza correta — revogar o que nunca foi usado — revoga produção; e uma chave vazada em uso ativo
// fica indistinguível de uma esquecida.

package auth

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

/** Espera a escrita assíncrona por POLLING — nunca `sleep` fixo, que é fonte de flakiness. */
func esperarEscrita(t *testing.T, mock sqlmock.Sqlmock) error {
	t.Helper()
	limite := time.Now().Add(2 * time.Second)
	var ultimo error
	for time.Now().Before(limite) {
		if ultimo = mock.ExpectationsWereMet(); ultimo == nil {
			return nil
		}
		time.Sleep(5 * time.Millisecond)
	}
	return ultimo
}

// esperarFilaVazia espera os escritores TIRAREM os pedidos do canal. Vive aqui, e não na produção,
// porque é instrumento de teste — e o nome diz o que ele faz de fato: fila vazia não é o mesmo que
// escrita concluída, e prometer o segundo levaria um teste a fechar o `db` com a escrita em voo.
func esperarFilaVazia(limite time.Duration) bool {
	fim := time.Now().Add(limite)
	for time.Now().Before(fim) {
		if len(filaDeRegistro) == 0 {
			return true
		}
		time.Sleep(2 * time.Millisecond)
	}
	return false
}

// zerarDedup limpa a memória de deduplicação entre casos. Sem isto, o segundo teste a autenticar a
// MESMA chave teria seu pedido suprimido pela janela — e passaria a verificar nada, que é a forma
// de falha que este arquivo inteiro existe para não repetir.
func zerarDedup(t *testing.T) {
	t.Helper()
	muUltimoEnfileiramento.Lock()
	ultimoEnfileiramento = map[string]time.Time{}
	muUltimoEnfileiramento.Unlock()
}

func linhaDeChave() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "subject", "tenant_id", "account_id", "scopes", "expires_at"}).
		AddRow("k-borda", "user-a", "tenant-a", nil, []byte(`["observability:write"]`), nil)
}

func TestResolveAPIKey_RegistraUso(t *testing.T) {
	zerarDedup(t)
	db, mock := newAuthMock(t)
	mock.ExpectQuery("FROM theo_api_keys").WillReturnRows(linhaDeChave())
	// O defeito: este UPDATE nunca era emitido no caminho da borda.
	mock.ExpectExec("UPDATE theo_api_keys").
		WithArgs("k-borda", janelaDeRegistroDeUso.Seconds()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if _, _, err := ResolveAPIKey(context.Background(), db, bearerOf("theo_live_x")); err != nil {
		t.Fatalf("autenticação deveria suceder: %v", err)
	}
	if err := esperarEscrita(t, mock); err != nil {
		t.Fatalf("o caminho da borda não registrou o uso: %v", err)
	}
}

func TestResolveAPIKey_OUpdateCarregaOAcelerador(t *testing.T) {
	// Sem o predicado, a ingestão — o caminho de maior volume do produto — escreveria uma linha por
	// requisição: WAL, índice e autovacuum por lote OTLP. O acelerador é o BANCO e não um limitador
	// em memória, que aceleraria por réplica e ainda escreveria N vezes com N réplicas.
	zerarDedup(t)
	db, mock := newAuthMock(t)
	mock.ExpectQuery("FROM theo_api_keys").WillReturnRows(linhaDeChave())
	mock.ExpectExec("last_used_at IS NULL OR last_used_at <").
		WithArgs("k-borda", janelaDeRegistroDeUso.Seconds()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if _, _, err := ResolveAPIKey(context.Background(), db, bearerOf("theo_live_x")); err != nil {
		t.Fatalf("autenticação deveria suceder: %v", err)
	}
	if err := esperarEscrita(t, mock); err != nil {
		t.Fatalf("o UPDATE não carrega o predicado de janela: %v", err)
	}
}

func TestResolveAPIKey_FalhaNaEscritaNaoDerrubaAAutenticacao(t *testing.T) {
	// A regressão a evitar é trocar um defeito de OBSERVABILIDADE por um de DISPONIBILIDADE na borda,
	// que autentica todo o tráfego de data-plane.
	zerarDedup(t)
	db, mock := newAuthMock(t)
	mock.ExpectQuery("FROM theo_api_keys").WillReturnRows(linhaDeChave())
	mock.ExpectExec("UPDATE theo_api_keys").
		WillReturnError(errors.New("banco fora do ar"))

	uc, scopes, err := ResolveAPIKey(context.Background(), db, bearerOf("theo_live_x"))
	if err != nil {
		t.Fatalf("a autenticação NÃO pode falhar por causa do registro: %v", err)
	}
	if uc == nil || uc.TenantID != "tenant-a" || len(scopes) == 0 {
		t.Fatalf("identidade corrompida pela falha de escrita: %+v %v", uc, scopes)
	}
}

func TestResolveAPIKey_AEscritaNaoBloqueiaOCaminhoDeResposta(t *testing.T) {
	// A propriedade mais importante deste arquivo, e a que estava INDETECTÁVEL: uma revisão mostrou
	// que, depois de o registro migrar para `lookupAPIKey`, os testes que provavam não-bloqueio
	// tinham parado de casar o UPDATE (um argumento contra dois) — e como descartavam o veredito do
	// mock, seguiam verdes. Tornar a escrita síncrona não quebrava teste nenhum.
	zerarDedup(t)
	db, mock := newAuthMock(t)
	mock.ExpectQuery("FROM theo_api_keys").WillReturnRows(linhaDeChave())
	mock.ExpectExec("UPDATE theo_api_keys").
		WithArgs("k-borda", sqlmock.AnyArg()).
		WillDelayFor(400 * time.Millisecond). // se a escrita fosse síncrona, a auth pagaria isto
		WillReturnResult(sqlmock.NewResult(0, 1))

	inicio := time.Now()
	if _, _, err := ResolveAPIKey(context.Background(), db, bearerOf("theo_live_x")); err != nil {
		t.Fatalf("autenticação deveria suceder: %v", err)
	}
	decorrido := time.Since(inicio)
	if decorrido > 100*time.Millisecond {
		t.Fatalf("a autenticação esperou pela escrita (%s) — ela precisa ser assíncrona", decorrido)
	}
	esperarFilaVazia(2 * time.Second)
}

func TestDedup_SegundaAutenticacaoDaMesmaChaveNaoEnfileira(t *testing.T) {
	// O dedup existe para que o descarte sob degradação não seja ENVIESADO: sem ele, a chave quente
	// da ingestão inunda a fila e a chave fria — a que alguém olharia para decidir revogar, e que é
	// a população do #405 — perde o único pedido dela.
	//
	// A asserção é sobre a FUNÇÃO, não sobre o mock. Minha primeira versão contava execuções pela
	// expectativa do sqlmock e era intermitente: os escritores são compartilhados entre casos, então
	// "fila vazia" não significa "escrita concluída" — o caveat que a revisão levantou, e no qual eu
	// caí no teste seguinte. Aqui não há relógio nem goroutine no caminho da asserção.
	zerarDedup(t)
	if recemEnfileirada("k-fria") {
		t.Fatal("a primeira autenticação de uma chave DEVE enfileirar")
	}
	if !recemEnfileirada("k-fria") {
		t.Fatal("a segunda autenticação dentro da janela NÃO deve enfileirar")
	}
	if recemEnfileirada("k-outra") {
		t.Fatal("o dedup é por CHAVE — outra chave não pode ser suprimida pela primeira")
	}
}

func TestDedup_PassadaAJanelaVoltaAEnfileirar(t *testing.T) {
	// Contrapeso: um dedup que nunca mais libera para de registrar para sempre, e passaria pelo teste
	// acima. Sem este caso, `return true` fixo seria indistinguível do comportamento certo.
	zerarDedup(t)
	muUltimoEnfileiramento.Lock()
	ultimoEnfileiramento["k-antiga"] = time.Now().Add(-2 * janelaDeRegistroDeUso)
	muUltimoEnfileiramento.Unlock()
	if recemEnfileirada("k-antiga") {
		t.Fatal("passada a janela, a chave deve voltar a enfileirar")
	}
}

func TestDedup_OMapaNaoCresceSemLimite(t *testing.T) {
	// Um mapa por chave num ambiente com muitas chaves cresceria sem teto. O custo de limpar é, no
	// pior caso, algumas escritas redundantes — que o predicado do banco absorve.
	zerarDedup(t)
	for i := 0; i < tetoDoMapaDeDedup+10; i++ {
		recemEnfileirada(fmt.Sprintf("k-%d", i))
	}
	muUltimoEnfileiramento.Lock()
	tamanho := len(ultimoEnfileiramento)
	muUltimoEnfileiramento.Unlock()
	if tamanho > tetoDoMapaDeDedup {
		t.Fatalf("o mapa de dedup passou do teto: %d > %d", tamanho, tetoDoMapaDeDedup)
	}
}

func TestJanelaDeRegistro_ValorLiteral(t *testing.T) {
	// Os outros testes referenciam `janelaDeRegistroDeUso` simbolicamente, então trocá-la por uma
	// HORA os manteria todos verdes — uma mudança de comportamento invisível. Este fixa o número.
	if janelaDeRegistroDeUso != time.Minute {
		t.Fatalf("a janela de registro mudou para %v; se foi deliberado, atualize este teste e o CHANGELOG", janelaDeRegistroDeUso)
	}
	if orcamentoDaEscritaDeUso > 500*time.Millisecond {
		t.Fatalf("o orçamento da escrita (%v) voltou a ser generoso o bastante para disputar o pool com a autenticação", orcamentoDaEscritaDeUso)
	}
}

func TestResolveAPIKey_ConcorrenteNaoCorrompe(t *testing.T) {
	// Executar com -race. A escrita é assíncrona; este teste prova que o lado Go não tem corrida.
	zerarDedup(t)
	db, mock := newAuthMock(t)
	const n = 8
	for i := 0; i < n; i++ {
		mock.ExpectQuery("FROM theo_api_keys").WillReturnRows(linhaDeChave())
		mock.ExpectExec("UPDATE theo_api_keys").WillReturnResult(sqlmock.NewResult(0, 1))
	}
	mock.MatchExpectationsInOrder(false)

	var wg sync.WaitGroup
	erros := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := ResolveAPIKey(context.Background(), db, bearerOf("theo_live_x")); err != nil {
				erros <- err
			}
		}()
	}
	wg.Wait()
	close(erros)
	for err := range erros {
		t.Fatalf("autenticação concorrente falhou: %v", err)
	}
}
