package trust

import (
	"encoding/json"
	"errors"
	"fmt"
)

// UpstreamError e uma recusa do loopguardrails que precisa CHEGAR ao operador.
//
// Existe porque a alternativa — formatar status e corpo numa string de erro — perde a informacao
// no caminho: quem recebe a string nao tem como separar de volta o codigo tipado do texto, e acaba
// respondendo "erro" generico. Foi exatamente o que aconteceu no M24 ate o review pegar.
//
// A distincao que este tipo carrega e a que importa para a tela: uma recusa de VALIDACAO da spec
// que o proprio operador enviou (`422 INVALID_SPEC`, `422 VALIDATOR_NAME_RESERVED`, `409 CONFLICT`)
// nao e um problema de infraestrutura. Ela diz O QUE corrigir, e esconde-la faz o operador tentar
// de novo identico.
type UpstreamError struct {
	// Status e o codigo HTTP que o loopguardrails devolveu.
	Status int
	// Body e o corpo do upstream, intacto. Carrega `{code, message}` quando tipado.
	Body json.RawMessage
	// Method e Path servem ao log; nunca vao para a resposta do usuario.
	Method string
	Path   string
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("trust data client: %s %s: upstream %d: %s",
		e.Method, e.Path, e.Status, truncate(string(e.Body), 300))
}

// IsClientRefusal responde se a recusa e do CLIENTE (4xx) e portanto acionavel por ele.
//
// 5xx do upstream nao entra: ali o corpo fala de topologia interna, nao do que o operador
// escreveu, e repassa-lo seria vazar detalhe de infraestrutura sem ajudar ninguem.
func (e *UpstreamError) IsClientRefusal() bool {
	return e.Status >= 400 && e.Status < 500
}

// AsUpstreamError extrai um *UpstreamError de uma cadeia de erros, se houver.
func AsUpstreamError(err error) (*UpstreamError, bool) {
	var ue *UpstreamError
	if errors.As(err, &ue) {
		return ue, true
	}
	return nil, false
}
