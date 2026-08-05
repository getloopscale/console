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
	KeyForUser(ctx context.Context, accountID, tenantID, userID, role, email string, want []string) (string, error)
}

// promptlyRoleResolver é a fonte AUTORITATIVA do papel — `tenant_members`, nunca o token.
//
// Existe porque a primeira versão deste resolver lia `auth.UserContext.Role`, e esse campo só é
// carimbado pelo middleware `RequireRole`, que as rotas do promptly NÃO montam. O campo chegava
// vazio sempre; o fallback o rebaixava a `member`; e o efeito era um teto silencioso — nenhum
// operador alcançava uma ação que exige `admin`, e nada no sistema dizia por quê. Medido ao vivo
// na terceira rodada de aceitação do M18.
type promptlyRoleResolver interface {
	GetRole(ctx context.Context, userID string) (string, error)
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
// A chave carrega a PESSOA, não só o inquilino — e é isso que faz "só quem tem o papel promove"
// deixar de ser promessa.
//
// Este comentário dizia, com todas as letras, que a checagem de papel não existia: *"todo usuário
// autenticado do workspace recebe uma chave com `prompt:write` (…) quem depende de 'só o dono
// promove' precisa da checagem de papel, que este milestone não entrega"*. A aceitação do M18
// mediu o preço disso — `label.protect` exige `admin`, papel acima de `member` exige identidade, e
// a chave por inquilino não identifica ninguém: o gate que o milestone entregou não podia ser
// ligado por credencial alguma, e toda a discussão nascia sem autor.
//
// O `auth.UserContext` já tinha as duas peças (`Subject` e `Role`), e o vocabulário de papel do
// plano de controle é o MESMO do serviço (`owner|admin|member`) — não há tradução, e por isso não
// há um mapa para divergir.
//
// Fail-closed também no Subject: uma sessão sem sujeito não vira chave anônima com escopo de
// escrita, ela vira erro. Cair para a chave por inquilino "só para não quebrar" devolveria
// exatamente o buraco que este slice fecha, e em silêncio.
func newPromptlyPromotionKeyResolver(minter promptlyDashMinter, papeis promptlyRoleResolver) func(ctx context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		u := auth.GetUser(ctx)
		if u == nil || u.TenantID == "" {
			return "", fmt.Errorf("promptly promotion: no authenticated tenant in context")
		}
		if u.Subject == "" {
			return "", fmt.Errorf("promptly promotion: authenticated session without a subject")
		}
		// A FONTE, não o token nem um campo que ninguém preencheu.
		papel, pErr := papeis.GetRole(ctx, u.Subject)
		if pErr != nil {
			// Fail-closed: não saber o papel é diferente de saber que ele é o menor. Cair para
			// `member` aqui converteria uma falha de leitura em concessão silenciosa.
			return "", fmt.Errorf("promptly promotion: resolve role: %w", pErr)
		}
		if papel == "" {
			// Ausência REAL: quem não tem papel declarado tem o menor. Distinto do caso acima —
			// um é ausência, o outro é cegueira.
			papel = "member"
		}
		// Idem: namespace do cloud. Ver o comentário no resolver de leitura e o `#366`.
		if u.Email == "" {
			// Fail-closed pelo mesmo motivo do sujeito: o serviço exige o e-mail para materializar
			// a pessoa, e inventá-lo gravaria um fato falso. Sessão sem e-mail é sessão que não
			// identifica ninguém.
			return "", fmt.Errorf("promptly promotion: authenticated session without an email")
		}
		return minter.KeyForUser(ctx, u.AccountID, u.TenantID, u.Subject, papel, u.Email,
			[]string{"promptly:read", "promptly:write"})
	}
}
