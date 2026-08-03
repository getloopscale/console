// M25 — fiação do BFF do catálogo de prompts.
//
// Vive em arquivo próprio, e não inline no `main.go`, pelas mesmas duas razões registradas em
// `trust_dashboard_wiring.go`: `main.go` já passa de mil linhas contra um teto de 300, e o
// resolver por inquilino é o ponto onde os invariantes de menor privilégio e fail-closed vivem —
// extraí-lo permite exercitá-los no CAMINHO QUE DE FATO EMBARCA, e não numa cópia escrita no teste.
package main

import (
	"context"
	"fmt"

	"github.com/usetheodev/theo-cloud/internal/auth"
)

// promptlyDashMinter é a porta que a fiação consome do broker (ISP): apenas a cunhagem escopada.
type promptlyDashMinter interface {
	KeyForTenantScoped(ctx context.Context, accountID, tenantID string, want []string) (string, error)
}

// newPromptlyDashboardKeyResolver devolve o resolver por requisição do caminho de LEITURA.
//
// Lê o inquilino do contexto derivado do JWT — NUNCA de parâmetro de requisição, que o usuário
// controla. Cunha somente `prompt:read`: com essa chave, uma rota mutante registrada por engano
// sobre o cliente de leitura recebe recusa do próprio serviço. O menor privilégio vira propriedade
// da credencial, não de uma checagem que se pode esquecer de aplicar.
//
// Fail-closed: sem inquilino autenticado devolve erro, e o data client então não emite requisição
// alguma — em vez de emiti-la com a credencial errada, que é como um vazamento entre inquilinos
// começa.
func newPromptlyDashboardKeyResolver(minter promptlyDashMinter) func(ctx context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		u := auth.GetUser(ctx)
		if u == nil || u.TenantID == "" {
			return "", fmt.Errorf("promptly dashboard: no authenticated tenant in context")
		}
		// O namespace pedido é o do CLOUD (`promptly:`), não o do serviço. O broker TRADUZ
		// (`promptly:X` → `prompt:X`) e DESCARTA o que já vier traduzido — pedir `prompt:read`
		// aqui produz interseção vazia, o mint falha, e a tela recebe 502 opaco (#366).
		return minter.KeyForTenantScoped(ctx, u.AccountID, u.TenantID, []string{"promptly:read"})
	}
}

// newPromptlyPromotionKeyResolver devolve o resolver do caminho de PROMOÇÃO.
//
// Separado do de leitura porque a separação é o mecanismo de segurança. `prompt:write` só existe
// nesta chave, e ela só é usada pelo `WriteClient` — que expõe um único verbo.
//
// Honestidade sobre o que este resolver NÃO garante: todo usuário autenticado do workspace recebe
// uma chave com `prompt:write`. Não há RBAC por usuário neste plano de controle
// (`auth.UserContext` carrega `Role`, não escopos), e o broker cruza o `want` com a configuração
// ESTÁTICA do gateway, não com o que o chamador possui. A separação real, hoje, é entre os dois
// CLIENTES — não entre usuários. Quem depende de "só o dono promove" precisa da checagem de papel,
// que este milestone não entrega.
func newPromptlyPromotionKeyResolver(minter promptlyDashMinter) func(ctx context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		u := auth.GetUser(ctx)
		if u == nil || u.TenantID == "" {
			return "", fmt.Errorf("promptly promotion: no authenticated tenant in context")
		}
		// Idem: namespace do cloud. Ver o comentário no resolver de leitura e o `#366`.
		return minter.KeyForTenantScoped(ctx, u.AccountID, u.TenantID, []string{"promptly:read", "promptly:write"})
	}
}
