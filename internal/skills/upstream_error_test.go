package skills

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

// O defeito que estes testes existem para impedir: uma recusa TIPADA do loopskills chegar ao
// operador como "erro". O registro recusa publicacao por razoes que o proprio operador pode
// corrigir — frontmatter invalido, nome ja tomado, versao repetida — e cada uma delas diz O QUE
// arrumar. Colapsada num 502 generico, a tela manda o operador tentar de novo identico.
//
// A alternativa que parece funcionar e nao funciona: formatar status e corpo numa string
// (`fmt.Errorf("upstream %d: %s", ...)`). A informacao esta ali, visivel no log, e mesmo assim
// PERDIDA — quem recebe a string nao tem como separar de volta o codigo do texto, entao responde
// generico. O tipo existe para que a separacao sobreviva ao caminho.

func TestUpstreamError_preservaStatusECorpoTipadoDoUpstream(t *testing.T) {
	// Um 422 real do loopskills: o registro recusou o frontmatter e disse por que.
	corpo := json.RawMessage(`{"code":"INVALID_FRONTMATTER","message":"campo 'version' ausente"}`)
	var err error = &UpstreamError{Status: 422, Body: corpo, Method: "POST", Path: "/v1/skills"}

	ue, ok := AsUpstreamError(err)
	if !ok {
		t.Fatal("AsUpstreamError nao extraiu o erro tipado — a recusa some no caminho")
	}
	if ue.Status != 422 {
		t.Errorf("status perdido: quero 422, tenho %d", ue.Status)
	}

	// A asserção que DISCRIMINA: o codigo tipado tem de sobreviver como DADO, nao como texto
	// dentro de uma mensagem. Uma implementacao que so guardasse `Error() string` passaria em
	// qualquer verificacao de "contem INVALID_FRONTMATTER" e ainda assim seria inutil para a
	// tela, que precisa DECIDIR sobre o codigo.
	var decodificado struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if e := json.Unmarshal(ue.Body, &decodificado); e != nil {
		t.Fatalf("corpo do upstream nao e JSON navegavel: %v", e)
	}
	if decodificado.Code != "INVALID_FRONTMATTER" {
		t.Errorf("codigo tipado perdido: quero INVALID_FRONTMATTER, tenho %q", decodificado.Code)
	}
	if decodificado.Message != "campo 'version' ausente" {
		t.Errorf("mensagem acionavel perdida: tenho %q", decodificado.Message)
	}
}

func TestUpstreamError_recusaDoClienteSeparadaDeFalhaDeInfra(t *testing.T) {
	// Esta e a distincao que decide o que a tela mostra. Sem ela, ou nada do upstream chega
	// (operador cego), ou tudo chega (vazamento de topologia interna num 5xx).
	casos := []struct {
		nome      string
		status    int
		doCliente bool
	}{
		{"422 frontmatter invalido — o operador corrige", 422, true},
		{"409 nome ja tomado — o operador corrige", 409, true},
		{"404 skill inexistente — o operador corrige", 404, true},
		{"400 pedido malformado — o operador corrige", 400, true},
		{"500 do registro — nao e culpa do operador", 500, false},
		{"502 upstream do upstream — infraestrutura", 502, false},
		{"503 registro fora do ar — infraestrutura", 503, false},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			ue := &UpstreamError{Status: c.status, Body: json.RawMessage(`{}`)}
			if got := ue.IsClientRefusal(); got != c.doCliente {
				t.Errorf("status %d: IsClientRefusal()=%v, quero %v", c.status, got, c.doCliente)
			}
		})
	}
}

func TestUpstreamError_errorNaoVazaCorpoInteiroNoLog(t *testing.T) {
	// Um corpo de upstream pode ser enorme (stack trace, HTML de proxy). Despejado inteiro no
	// log, ele afoga a linha que importa. O truncamento e o que mantem o log legivel — e a
	// assercao aqui e sobre TAMANHO, nao sobre "contem", porque `contem` passa com corpo inteiro.
	gigante := strings.Repeat("x", 5000)
	ue := &UpstreamError{
		Status: 500,
		Body:   json.RawMessage(fmt.Sprintf(`{"stack":%q}`, gigante)),
		Method: "GET",
		Path:   "/v1/skills",
	}
	msg := ue.Error()
	if len(msg) > 600 {
		t.Errorf("Error() despeja o corpo inteiro (%d chars) — o log fica ilegivel", len(msg))
	}
	// E ainda assim precisa dizer O QUE aconteceu: sem status e caminho, o log nao localiza nada.
	if !strings.Contains(msg, "500") || !strings.Contains(msg, "/v1/skills") {
		t.Errorf("Error() perdeu status ou caminho: %q", msg)
	}
}

func TestUpstreamError_sobreviveAEmbrulho(t *testing.T) {
	// O erro atravessa camadas (data client -> rota -> handler). Se ele nao sobrevive a um
	// `%w`, a preservacao existe so no ponto de origem e nao serve para nada la na tela.
	original := &UpstreamError{Status: 409, Body: json.RawMessage(`{"code":"CONFLICT"}`)}
	embrulhado := fmt.Errorf("ao promover canal: %w", original)

	ue, ok := AsUpstreamError(embrulhado)
	if !ok {
		t.Fatal("o erro tipado nao sobreviveu ao embrulho — errors.As nao o encontra")
	}
	if ue.Status != 409 {
		t.Errorf("status perdido no embrulho: %d", ue.Status)
	}
	if !errors.Is(embrulhado, error(original)) {
		t.Error("a cadeia de erros quebrou")
	}
}
