---
status: accepted
date: 2026-08-06
executado-em: 2026-08-08
origem-da-execucao: B-055 (cache de API) · B-074 (requisito do SW)
decision-makers: time do dashboard loop-console
origem: tradeoff_decisions#12 · scaling_findings#7 · system_design_findings#9
---

# ADR-0004 — Service worker: declarar o requisito ou remover

## Contexto e enunciado do problema

O dashboard registra um service worker via `vite-plugin-pwa` + Workbox
(`vite.config.ts:86-91`, `src/main.tsx:50-56`). O **como** esta muito bem documentado —
cada opcao vem com o modo de falha que evita (*"auth endpoints nunca cacheados: stale
token = security hole"*; `skipWaiting` porque *"SPA user keeps tab open dias, never sees
update"*), e existe ate um modulo puro com teste dedicado para a denylist de navegacao
(`src/build/sw-bff-paths.ts`).

O **porque** nao existe. `DESIGN.md` (803 linhas) nao contem nenhum requisito de offline,
de instalabilidade ou de PWA — as secoes de performance percebida e de metricas falam de
skeleton, streaming e Web Vitals.

O custo, por outro lado, esta medido e escrito no proprio arquivo:

- Dois incidentes de producao atribuidos ao SW interceptando caminhos de navegacao BFF: `loop-console#112` e `#203` (`vite.config.ts:135-146`).
- Uma armadilha do Workbox que derrubava TODO o roteamento do SW (`vite.config.ts:152-155`).
- Uma segunda camada de cache sobre a API que **contradiz** o `staleTime` do app em 60x: `runtimeCaching` `NetworkFirst` para `/api/v1/` com `maxAgeSeconds: 3600` (`vite.config.ts:162-169`) contra `staleTime: 60_000` do TanStack Query (`src/lib/query-client.ts:41`). Como `engineFetch` prefixa `/engine`, a regex casa por substring e alcanca os reads do control plane — deploys, builds, audit, secrets.

Num dashboard operacional, ver estado velho leva a agir sobre uma realidade que ja mudou.
Isso colide diretamente com o que o proprio `DESIGN.md:775` promete: *"Confiavel — status truthful"*.

## Opcoes consideradas

1. Manter o SW como esta.
2. Remover a regra `NetworkFirst` de `/api/v1/`, mantendo o SW so para assets estaticos e `__config.js`.
3. Remover o service worker inteiro (o `nginx.conf` versionado ja emite os headers de cache de assets).

## Decisao

Adotar a **opcao 2** imediatamente, e condicionar a permanencia do SW a uma declaracao de
requisito.

- O cache de API sai. O TanStack Query passa a ser a **unica** camada de cache de dados de servidor — ele tem invalidacao por `queryKey`, que o SW nao tem.
- As regras de assets estaticos e de `__config.js` ficam: sao o motivo defensavel de existir um SW aqui.
- O time escreve, neste ADR, o requisito que o SW atende. Se a resposta for "cache de assets", o CDN/nginx ja faz e o SW pode sair inteiro (opcao 3), levando junto a classe de bug #112/#203. Se a resposta for "atualizacao automatica de versao para abas longas" — que e o que o comentario do `skipWaiting` sugere — entao esse e o requisito e o custo passa a ser justificavel.

## Consequencias

- Bom: elimina a contradicao de politicas de frescor de 60x e devolve ao Query o monopolio do cache de dados.
- Bom: forca a explicitacao de um requisito que hoje nao existe em nenhum documento.
- Ruim: se algum usuario dependia do read cacheado em rede ruim, ele perde isso. Aceito: num painel de operacao, dado velho e pior que erro visivel.
- Ruim: remover o SW inteiro (opcao 3) invalidaria service workers ja instalados em navegadores de usuarios; exige um SW de auto-unregister antes. Registrado como pre-requisito caso a opcao 3 seja escolhida depois.
