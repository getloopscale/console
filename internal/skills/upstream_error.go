package skills

import (
	"encoding/json"
	"errors"
	"fmt"
)

// UpstreamError e uma recusa do loopskills que precisa CHEGAR ao operador.
//
// Porte do padrao ja provado em `internal/trust/upstream_error.go`. Nao e generalizacao
// especulativa: os dois clientes falam com produtos que recusam por razoes do cliente, e no trust
// a ausencia deste tipo produziu um defeito real (M24) — um 422 tipado virando 502 generico. O
// registro de skills recusa pelas mesmas classes de motivo, entao o defeito seria o mesmo.
//
// A alternativa que parece bastar e nao basta: `fmt.Errorf("upstream %d: %s", status, corpo)`.
// A informacao fica visivel no log e PERDIDA para o codigo — quem recebe a string nao tem como
// separar de volta o codigo tipado do texto, e responde generico. Este tipo existe para que a
// separacao sobreviva ate a tela, que precisa DECIDIR sobre o codigo, nao exibi-lo.
type UpstreamError struct {
	// Status e o codigo HTTP que o loopskills devolveu.
	Status int
	// Body e o corpo do upstream, intacto. Carrega `{code, message}` quando tipado.
	Body json.RawMessage
	// Method e Path servem ao log; nunca vao para a resposta do usuario.
	Method string
	Path   string
}

// maxCorpoNoLog limita o quanto do corpo do upstream entra na mensagem de erro.
//
// Um corpo pode ser um stack trace ou o HTML de um proxy. Despejado inteiro, afoga a linha que
// importa e torna o log ilegivel justamente no incidente em que ele seria lido.
const maxCorpoNoLog = 300

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("skills data client: %s %s: upstream %d: %s",
		e.Method, e.Path, e.Status, truncarCorpo(string(e.Body), maxCorpoNoLog))
}

func truncarCorpo(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…(truncado)"
}

// IsClientRefusal responde se a recusa e do CLIENTE (4xx) e portanto acionavel por ele.
//
// 5xx nao entra, e a exclusao e deliberada: ali o corpo fala de topologia interna do registro,
// nao do que o operador escreveu. Repassa-lo vazaria detalhe de infraestrutura sem ajudar
// ninguem a corrigir nada.
func (e *UpstreamError) IsClientRefusal() bool {
	return e.Status >= 400 && e.Status < 500
}

// AsUpstreamError extrai um *UpstreamError de uma cadeia de erros, se houver.
//
// Usa errors.As (nao um type assert) porque o erro atravessa camadas embrulhado com %w: um
// assert direto o perderia no primeiro embrulho, e a preservacao existiria so no ponto de origem.
func AsUpstreamError(err error) (*UpstreamError, bool) {
	var ue *UpstreamError
	if errors.As(err, &ue) {
		return ue, true
	}
	return nil, false
}
