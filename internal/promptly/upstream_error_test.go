package promptly

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// O tipo existe para que a recusa do loopprompt ATRAVESSE as camadas sem virar string. Os
// testes abaixo cobrem exatamente as tres propriedades que a tela consome.

func TestUpstreamError_preserva_codigo_tipado_ao_atravessar_embrulho(t *testing.T) {
	// Arrange — uma recusa de POLITICA, que e a que o operador precisa ler para entender por que
	// a promocao foi barrada.
	original := &UpstreamError{
		Status: http.StatusConflict,
		Body:   json.RawMessage(`{"error":"promotion_blocked","required":0.8,"actual":0.4}`),
		Method: http.MethodPut,
		Path:   "/prompts/saudacao/labels/prod",
	}

	// Act — embrulhado duas vezes, como acontece ao subir pelas camadas.
	embrulhado := fmt.Errorf("camada externa: %w", fmt.Errorf("camada interna: %w", original))
	recuperado, ok := AsUpstreamError(embrulhado)

	// Assert — um type assert direto perderia o erro no primeiro embrulho; errors.As nao.
	if !ok {
		t.Fatal("erro tipado nao sobreviveu ao embrulho — a tela receberia texto, nao codigo")
	}
	if recuperado.Status != http.StatusConflict {
		t.Errorf("status = %d, quer 409", recuperado.Status)
	}
	if !strings.Contains(string(recuperado.Body), "promotion_blocked") {
		t.Errorf("corpo perdeu o codigo tipado: %s", recuperado.Body)
	}
}

func TestUpstreamError_recusa_do_cliente_e_5xx_sao_classificados_diferente(t *testing.T) {
	// A distincao decide se o corpo do upstream chega ao navegador. Um 5xx fala de topologia
	// interna do servico; repassa-lo vaza detalhe sem ajudar ninguem a corrigir nada.
	cliente := &UpstreamError{Status: http.StatusConflict}
	servidor := &UpstreamError{Status: http.StatusBadGateway}

	if !cliente.IsClientRefusal() {
		t.Error("409 deveria ser recusa do cliente — e o motivo acionavel da promocao barrada")
	}
	if servidor.IsClientRefusal() {
		t.Error("502 NAO e recusa do cliente; repassar o corpo vazaria topologia interna")
	}
}

func TestUpstreamError_mensagem_de_log_trunca_corpo_gigante(t *testing.T) {
	// Um corpo pode ser o HTML de um proxy. Despejado inteiro, afoga a linha que importa
	// justamente no incidente em que o log seria lido.
	gigante := strings.Repeat("x", maxCorpoNoLog*3)
	err := &UpstreamError{Status: 500, Body: json.RawMessage(gigante), Method: "GET", Path: "/prompts"}

	msg := err.Error()

	if len(msg) > maxCorpoNoLog+200 {
		t.Errorf("mensagem de log nao foi truncada: %d bytes", len(msg))
	}
	if !strings.Contains(msg, "truncado") {
		t.Error("a truncagem tem de ser declarada — senao o leitor acha que viu o corpo inteiro")
	}
}
