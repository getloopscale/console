package trust

// CustomerScopes é a fonte ÚNICA dos escopos `trust:*` que um cliente pode pedir.
//
// Ela existe porque a mesma lista precisava estar correta em DOIS lugares — o enum de
// emissão (`internal/routes.validScopes`) e a construção do broker Model B
// (`cmd/main.go`) — e nada obrigava os dois a concordarem. O comentário do teste de
// escopos até dizia "o conjunto vem do que o broker de fato suporta", mas isso era prosa:
// nenhuma asserção cruzava as listas.
//
// O modo de falha que isso produz é silencioso nos DOIS sentidos, e já ocorreu quatro
// vezes nesta base:
//
//   - escopo no broker e ausente do enum → a capacidade existe e nenhum cliente a alcança
//     (foi assim com `trust:read`, medido em 2026-07-31);
//   - escopo no enum e ausente do broker → a API aceita o pedido, devolve 200 e cunha a
//     chave, mas a borda DESCARTA o escopo na travessia; o operador só descobre quando o
//     dado não vem (foi assim com `trust:content`, medido em 2026-08-02 pela borda).
//
// Em ambos os casos cada camada parece correta isolada. Com uma fonte só, a divergência
// deixa de ser possível — não porque alguém lembrou de atualizar os dois lados, mas
// porque só existe um lado.
//
// `trust:admin` e `trust:platform-admin` NÃO entram aqui: são credenciais de ciclo de
// vida, do próprio broker, nunca do consumidor (menor privilégio, NIST AC-6).
var CustomerScopes = []string{
	"trust:read",
	"trust:write",
	"trust:delete",
	// LT-012 / ADR 0009 opção B — ler o conteúdo BRUTO da conversa, separado de
	// `trust:read` porque inclui o trecho que o próprio scanner classificou como segredo.
	"trust:content",
}
