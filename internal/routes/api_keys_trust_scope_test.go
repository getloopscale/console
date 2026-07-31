package routes

import "testing"

// TestTrustScopesRegistered trava os escopos trust:* no registro ativo.
//
// O DEFEITO QUE ISTO PREVINE, medido em 2026-07-31 no dev host: a cadeia Model B do
// theo-trust estava inteira de pé — borda roteando, ForwardAuth ligado, broker cunhando
// chave por tenant — e NENHUM cliente podia usá-la, porque `trust:read` não existia no
// enum de escopos. A tela de criar API key não o oferecia e o backend o teria recusado
// de qualquer forma. O sintoma é traiçoeiro: cada camada parece correta isolada, e a
// capacidade fica inalcançável sem que nada fique vermelho.
//
// O conjunto vem do que o broker de fato suporta (cmd/main.go: KeyForTenantScoped com
// {trust:read, trust:write, trust:delete}); pedir um escopo que o broker não sabe cunhar
// produziria uma chave que a borda aceita e o mint rejeita.
//
// `trust:admin` NÃO é emitível pelo cliente — mesma razão de `rag:admin` e
// `storage:admin`: é escopo de ciclo de vida de chave, do broker, nunca do consumidor
// (menor privilégio).
func TestTrustScopesRegistered(t *testing.T) {
	for _, s := range []string{"trust:read", "trust:write", "trust:delete"} {
		if !validScopes[s] {
			t.Errorf("scope %q must be in the active validScopes registry", s)
		}
	}
	if validScopes["trust:admin"] {
		t.Error("trust:admin must NOT be customer-issuable")
	}
	if validScopes["trust:platform-admin"] {
		t.Error("trust:platform-admin is the gateway's own credential — never customer-issuable")
	}
}
