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

	"github.com/usetheoai/theo-cloud/internal/auth"
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

// newSkillsPromotionKeyResolver devolve o resolver do caminho de MUTAÇÃO (T3.5).
//
// Existe separado de `newSkillsDashboardKeyResolver` porque a separação É o mecanismo de segurança,
// não organização: o cliente de LEITURA recebe uma credencial cunhada apenas com `skills:read` e
// portanto **não consegue promover**, mesmo que alguém registre por engano uma rota mutante sobre
// ele. O menor privilégio vira propriedade da chave, e não de uma checagem que se pode esquecer de
// aplicar numa rota nova.
//
// `skills:read` entra junto de `skills:publish` porque a tela de promoção também lê (versões e
// canais) antes de agir — e uma credencial que só publica obrigaria um terceiro cliente sem
// ganho algum de isolamento.
//
// HONESTIDADE sobre o que este resolver NÃO faz, pelo mesmo motivo já registrado em
// `newTrustGuardrailsKeyResolver`: `KeyForTenantScoped` cruza o `want` com a configuração ESTÁTICA
// do broker, e aqui o `want` é um literal. Não há RBAC por usuário neste produto, então **todo
// usuário autenticado do workspace recebe uma chave capaz de promover**. A separação real é entre
// os dois CLIENTES (leitura × mutação), não entre usuários — e é isso que a tela mitiga exigindo
// confirmação com frase digitada.
func newSkillsPromotionKeyResolver(minter skillsDashMinter) func(ctx context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		u := auth.GetUser(ctx)
		if u == nil || u.TenantID == "" {
			return "", fmt.Errorf("skills promotion: no authenticated tenant in context")
		}
		return minter.KeyForTenantScoped(ctx, u.AccountID, u.TenantID,
			[]string{"skills:read", "skills:publish"})
	}
}

// newSkillsAuthoringKeyResolver devolve o resolver do caminho de AUTORIA (M31).
//
// Terceiro cliente, terceira credencial — e a separação É o mecanismo de menor privilégio, não
// organização de arquivo. Os três poderes desta capacidade causam danos diferentes:
//
//	skills:read     leitura do acervo
//	skills:publish  promove canal e deprecia — REDIRECIONA consumidores sem redeploy
//	skills:write    cria, edita e APAGA skills
//
// Fundir os dois últimos daria ao caminho de curadoria o poder de destruir, e ao de autoria o
// poder de reapontar quem já consome. Uma chave que faz as duas coisas transforma qualquer
// vazamento no pior caso possível.
//
// `skills:read` entra junto porque a tela de autoria também LÊ antes de agir — confirmar o que
// será apagado é parte do ato. Uma credencial que só escreve obrigaria um quarto cliente sem
// ganho algum de isolamento.
//
// HONESTIDADE sobre o que este resolver NÃO faz, como os irmãos: `KeyForTenantScoped` cruza o
// `want` com a configuração ESTÁTICA do broker, e aqui o `want` é um literal. Não há RBAC por
// usuário neste produto, então **todo usuário autenticado do workspace recebe uma chave capaz de
// apagar**. A separação real é entre os CLIENTES, não entre usuários — e é isso que a tela mitiga
// exigindo confirmação com frase digitada, sob o `DESIGN.md` §16.
//
// É também a razão pela qual a VISIBILIDADE ficou fora da tela: lá a regra é sobre o papel de
// quem age, e ela não sobrevive a uma credencial igual para todos. Ver ADR 0004 do theo-skills.
func newSkillsAuthoringKeyResolver(minter skillsDashMinter) func(ctx context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		u := auth.GetUser(ctx)
		if u == nil || u.TenantID == "" {
			return "", fmt.Errorf("skills authoring: no authenticated tenant in context")
		}
		return minter.KeyForTenantScoped(ctx, u.AccountID, u.TenantID, []string{"skills:read", "skills:write"})
	}
}
