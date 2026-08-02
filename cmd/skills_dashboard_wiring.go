// M26 — fiação do BFF de leitura do registro de skills.
//
// Vive em arquivo próprio, e não inline no `main.go`, pelas duas razões já registradas em
// `trust_dashboard_wiring.go`. A primeira é o gate de qualidade: `main.go` passa de 1700 linhas
// contra um teto de 300, e toda edição nele agrava dívida pré-existente. A segunda é
// testabilidade — o resolver por tenant é o ponto onde os invariantes de menor privilégio e
// fail-closed vivem, e extraí-lo permite exercitá-los NO CAMINHO QUE DE FATO EMBARCA, em vez de
// numa cópia escrita no teste.
package main

import (
	"context"
	"fmt"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// skillsDashMinter é a porta que a fiação consome do broker (ISP): apenas a cunhagem escopada.
type skillsDashMinter interface {
	KeyForTenantScoped(ctx context.Context, accountID, tenantID string, want []string) (string, error)
}

// newSkillsDashboardKeyResolver devolve o resolver por requisição do BFF de leitura.
//
// Lê o tenant do contexto derivado do JWT — NUNCA de parâmetro de requisição, que o usuário
// controla. Cunha somente `skills:read`.
//
// O escopo restrito não é zelo: `skills:publish` é o que promove um canal, e promover aponta os
// consumidores do canal para outro conteúdo sem redeploy. Uma credencial de LEITURA que
// carregasse esse escopo daria ao caminho de leitura o poder mais perigoso do produto — e não
// haveria rota mutante para alguém revisar e notar. O menor privilégio vira propriedade da
// chave, não de uma checagem que se pode esquecer de aplicar numa rota nova.
//
// Fail-closed: sem tenant autenticado devolve erro ANTES de cunhar, e o data client então não
// emite requisição alguma — em vez de emiti-la com a credencial errada, que é como um vazamento
// entre inquilinos começa.
func newSkillsDashboardKeyResolver(minter skillsDashMinter) func(ctx context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		u := auth.GetUser(ctx)
		if u == nil || u.TenantID == "" {
			return "", fmt.Errorf("skills dashboard: no authenticated tenant in context")
		}
		return minter.KeyForTenantScoped(ctx, u.AccountID, u.TenantID, []string{"skills:read"})
	}
}
