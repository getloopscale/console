// M23 — fiação do BFF de leitura da capacidade trust.
//
// Vive em arquivo próprio, e não inline no `main.go`, por duas razões. A primeira é o gate de
// qualidade: `main.go` já tem ~1740 linhas contra um teto de 300, e toda edição nele agrava uma
// dívida pré-existente. A segunda é testabilidade — o resolver por tenant é o ponto onde os
// invariantes de menor privilégio e fail-closed vivem, e extraí-lo permite exercitá-los no CAMINHO
// QUE DE FATO EMBARCA, em vez de numa cópia escrita no teste. Mesmo motivo registrado em
// `newRagDashboardKeyResolver`.
package main

import (
	"context"
	"fmt"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// trustDashMinter é a porta que a fiação consome do broker (ISP): apenas a cunhagem escopada.
type trustDashMinter interface {
	KeyForTenantScoped(ctx context.Context, accountID, tenantID string, want []string) (string, error)
}

// newTrustDashboardKeyResolver devolve o resolver por requisição do BFF de leitura.
//
// Lê o tenant do contexto derivado do JWT — NUNCA de parâmetro de requisição, que o usuário
// controla. Cunha somente `trust:read`: o ForwardAuth da borda carrega os três escopos porque
// intermedia um consumidor que pode legitimamente escrever, mas o caminho de leitura do dashboard
// não pode, e a chave que ele recebe não deve poder.
//
// Fail-closed: sem tenant autenticado devolve erro, e o data client então não emite requisição
// alguma — em vez de emiti-la com a credencial errada, que é como um vazamento entre tenants começa.
func newTrustDashboardKeyResolver(minter trustDashMinter) func(ctx context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		u := auth.GetUser(ctx)
		if u == nil || u.TenantID == "" {
			return "", fmt.Errorf("trust dashboard: no authenticated tenant in context")
		}
		return minter.KeyForTenantScoped(ctx, u.AccountID, u.TenantID, []string{"trust:read"})
	}
}
