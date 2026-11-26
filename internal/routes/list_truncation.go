// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

// Uma lista que trunca DIZ que truncou (B-114).
//
// # O defeito que isto fecha
//
// Medido em 2026-08-10: seis rotas deste serviço aplicavam um teto fixo no SQL e devolviam a
// lista sem `total`, sem `has_more` e sem cursor. A 101ª linha sumia, e nada na resposta dizia
// que sumiu — o usuário via uma lista que parecia completa.
//
// E o cliente PEDE um teto que o servidor não lê: `pages/lens/traces/saved-views.tsx:52` chama
// `?limit=${LIST_SAFETY_CEILING}` e `lens_saved_views.go` nunca leu `limit`. O guard
// `request-ceiling.test.ts` do dashboard diz, no próprio cabeçalho, que não consegue provar que
// o servidor honra o teto porque "vários endpoints vivem na engine, outro repositório". Estes
// seis vivem aqui.
//
// # Por que `has_more`, e não `total`
//
// `total` custa um `COUNT(*)` por requisição. A pergunta que importa ao usuário é "há mais do que
// estou vendo?", e ela se responde pedindo ao banco UMA linha a mais do que se devolve — nenhuma
// query extra, nenhuma varredura a mais.
//
// O `{total, limit, offset}` de `lens_alert_rules.go:214` continua sendo o destino de quem ganhar
// paginação de verdade. Estas seis têm um cap DEFENSIVO, não paginação: ninguém pediu a página 2,
// porque não há página 2. O que faltava era admitir que a página 1 não é tudo.
//
// # Por que o corte acontece aqui, e não no banco
//
// O `LIMIT` do SQL passa a ser `cap + 1`. Se voltar `cap + 1` linhas, havia mais — e o handler
// corta a extra antes de responder. Deixar o banco cortar em `cap` tornaria as duas situações
// indistinguíveis: exatamente `cap` linhas e mais de `cap` linhas devolvem a mesma coisa.

// truncar aplica o teto e informa se o banco tinha mais do que cabia.
//
// Recebe até `cap+1` linhas (é o que a query pede). Devolve no máximo `cap`, e `true` quando
// sobrou — a prova de que existe pelo menos uma linha que o usuário não está vendo.
func truncar[T any](linhas []T, cap int) ([]T, bool) {
	if len(linhas) > cap {
		return linhas[:cap], true
	}
	return linhas, false
}
