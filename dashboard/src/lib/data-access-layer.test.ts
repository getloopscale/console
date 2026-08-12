import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const PAGES = resolve(__dirname, '../pages');
const SRC = resolve(__dirname, '..');

/**
 * B-012 / B-029 / B-052 / B-053 — quantas páginas ainda falam HTTP direto.
 *
 * ## O que isto mede
 *
 * Um arquivo sob `src/pages/**` que importa `cloudFetch` ou `engineFetch` está
 * fazendo acesso a dados na camada de interface: ele monta o request, escolhe a
 * query key e decide a política de cache, tudo dentro da tela. O resultado é que
 * o mesmo endpoint é lido de formas diferentes em telas diferentes — foi assim
 * que `query-key-convergence.test.ts` precisou existir.
 *
 * O `ADR-0006` decidiu a camada por domínio em 2026-08-06 e nunca foi executado.
 * O plano `dashboard-data-access-layer-plan.md` é a execução, e este é o número
 * que ele move.
 *
 * ## Por que um teto e não zero
 *
 * Afirmar zero exigiria migrar os 64 num plano só, o que não cabe numa métrica
 * (Regra de Qualidade 0 do `/to-plan`). Um teto que **só desce** dá rede contra
 * regressão desde o primeiro dia e deixa a migração acontecer em planos
 * sucessivos — que é o mesmo formato de `adr-nomenclature.test.ts` e
 * `sse-token-in-url.test.ts`, já em uso aqui.
 *
 * Sem ele, os arquivos restantes crescem livremente durante os planos seguintes.
 * Foi assim que se chegou a 64.
 *
 * ## O que ele NÃO prova
 *
 * Que a camada existe. Ele prova que ela não encolheu. Um domínio migrado com
 * hook errado — query key literal, sem invalidação — baixa este número e não
 * melhora nada; quem cobre isso é `query-key-convergence.test.ts`.
 */

/**
 * Medido em 2026-08-07 sobre `549d198b`. **SÓ DESCE.**

O plano dizia 64. Estava errado: aquele número veio de `grep -rl` sobre o
arquivo inteiro, que casa comentário. Sete dos 64 apenas MENCIONAM transporte —
quatro deles para dizer que pararam de usar, e um injeta `cloudFetch` como
dependência, que é o padrão certo. O número real é 58, e a diferença é
exatamente a classe "grep casa prosa".
 *
 * Baixar este número num commit mantém o teste verde — é a direção certa. Subir
 * exige explicar por quê, e o plano diz que não há razão: uma página nova busca
 * dado pelo hook do domínio.
 */
// 58 em 2026-08-07; 53 desde 2026-08-08, quando `settings/api-keys.tsx`,
// `settings/components/api-key-lineage.tsx` e `lens/traces.tsx` ganharam hooks
// de domínio (B-012 / B-053).
//
// 52 desde 2026-08-12 (B-244): `infra/domains.tsx` passou a ler por
// `hooks/infra/use-domains.ts`. A migração revelou algo que só aparece quando a
// forma sai da tela: a página carregava um `Domain` LOCAL mais rico que o de
// `@/lib/api/types` — com `nameservers` e `failure_mode`, que o backend devolve
// e o tipo compartilhado não declara. O `tsc` acusou no instante em que o hook
// tentou usar o compartilhado; adotá-lo teria apagado dois campos que a UI
// renderiza. Reconciliar os dois é trabalho de quem possui o tipo compartilhado,
// e está registrado (B-262) em vez de resolvido alargando um tipo global a
// partir da evidência de um chamador só.
//
// Distribuição do que resta: lens 18, memory 12, rag 9, settings 6, projects 3,
// deployment-tabs 2, workspace 2.
//
// SÓ DESCE.
// 50 desde 2026-08-12, com as duas abas de cadeia de suprimentos
// (`deployment-tabs/{sbom,attestation}-tab.tsx`) lendo por
// `hooks/deploy/use-build-artifacts.ts`. Elas não faziam apenas transporte na
// camada de interface: rodavam `useEffect` + `useState` + flag `cancelled` — um
// SEGUNDO mecanismo de busca ao lado do react-query, sem cache e sem dedup, com
// cancelamento reimplementado por aba.
//
// A migração também separou dois estados que dividiam título: uma leitura que
// FALHA dizia "No SBOM for this build". Para artefato de cadeia de suprimentos as
// duas conclusões são opostas — "este build subiu sem proveniência" é achado de
// conformidade; "não consegui ler a proveniência" é retry. Nenhuma das duas abas
// tinha teste; agora têm seis.
// 49 desde 2026-08-12, com `projects/components/create-project-sheet.tsx` lendo
// por `hooks/projects/use-create-project.ts`. A migração fechou parte do B-260 de
// tabela: o corpo passou a ser tipado com `ProjectCreateInput`, um tipo que
// existia em `lib/api/types.ts` e que ninguém importava — o dashboard criava
// projetos enquanto a descrição do payload de criação ficava sem conferência.
// O knip caiu 31 -> 30 pelo mesmo motivo.
// 47 desde 2026-08-12, com `settings/{profile,overview}.tsx` lendo por
// `hooks/settings/use-delete-tenant.ts`. As duas rodavam a MESMA operação
// destrutiva — `DELETE /api/v1/tenants/{id}` — em cópias separadas, e nenhuma
// tratava falha: sem `throwOnError` uma recusa resolvia `null`, ninguém olhava, e
// a tela seguia fechando o diálogo e encerrando a sessão / navegando embora.
// Apagar a conta podia falhar em silêncio e a tela dizia que deu certo (B-264).
// 46 desde 2026-08-12, com `settings/webhooks.tsx` inteira lendo por
// `hooks/settings/use-workspace-webhooks.ts` — lista, criação, revogação e histórico de entregas.
// Duas das quatro chamadas não passavam `throwOnError`, e nas duas operações onde isso custa mais:
// criar um webhook que o servidor RECUSOU fechava o diálogo e atualizava a lista, então o usuário
// saía acreditando que eventos passariam a chegar numa URL nunca registrada; revogar um que o
// servidor recusou fazia o mesmo, e um endpoint que o usuário acredita ter cortado continua
// recebendo os payloads dele. Mesma classe do B-264, em mais dois lugares.
//
// O `ConfirmDialog` só vê a recusa se `onConfirm` devolver promessa que rejeita (ele dá `await`):
// a tela passou de `revoke.mutate` para `mutateAsync`. E `AddWebhookDialog` ganhou `errorMessage`,
// porque ele NÃO espera o `onSubmit` — sem isso o diálogo ficaria aberto e mudo.
// 45 desde 2026-08-12, com `memory/exports.tsx` lendo por `hooks/memory/use-memory-exports.ts`.
// A criação do export não passava `throwOnError`: uma recusa RESOLVIA `null`, o `onSuccess`
// disparava com esse `null` e a primeira linha do handler era `if (!row?.id) return`. O usuário
// clicava em "Create export", nada aparecia e nada dizia por quê — falha engolida vestida de no-op.
//
// A tela JÁ TINHA o `Alert` de "Could not start export", e ele era inalcançável: sem o contrato,
// `isError` nunca ficava true. Código morto com aparência de tratamento de erro.
// 44 desde 2026-08-12, com `lens/datasets.tsx` lendo por `hooks/lens/use-datasets.ts` — que já
// existia com a LISTA e ganhou o detalhe, criar, remover item, renomear e apagar.
//
// Duas das cinco não passavam `throwOnError`, com efeitos opostos e igualmente mudos: criar um
// dataset que o servidor RECUSOU fechava o diálogo e limpava o campo, então o usuário saía achando
// que criou e a lista simplesmente não o mostrava — o que se lê como "sumiu", não como "nunca
// existiu". Remover um item recusado fazia a linha sumir da tela e voltar na leitura seguinte.
//
// A chave do detalhe passou a DERIVAR da chave da lista. Montada nos dois lugares, o acordo entre
// elas era coincidência: invalidar a lista sem alcançar o detalhe aberto mostra item já removido.
// 42 desde 2026-08-12, com `lens/{agents,usage-by-user}.tsx`.
//
// A `usage-by-user` é a que valeu o trabalho: `days`, `page` e `withSeries` TÊM de estar na chave
// de cache, senão o react-query responde uma pergunta de 30 dias com a resposta de 7 e a tela
// afirma um período que não está mostrando. Esse acordo entre a URL e a chave vinha mantido à mão
// nos dois lugares — dura enquanto uma pessoa cuida dos dois, e quebra no primeiro filtro que
// alguém acrescenta à URL e esquece na chave. Agora saem dos mesmos argumentos.
//
// Duas correções minhas no caminho, ambas pegas pelo `tsc`: inventei a forma de `UsageRow` e depois
// a de `PontoDaSerie`, em vez de ler as reais. É a armadilha que o `DomainRow` já havia registrado
// — adotar uma forma adivinhada apaga em silêncio campos que a UI renderiza — e o compilador foi a
// única razão de custar minutos em vez de dados sumindo do gráfico.
// 41 desde 2026-08-12, com `lens/traces/metadata-card.tsx` lendo por
// `hooks/lens/use-trace-metadata.ts`. Três das quatro chamadas não passavam `throwOnError`, e as
// três falhavam do mesmo jeito — a escrita é recusada, o `onSuccess` dispara, o campo limpa e nada
// é dito. Não são igualmente graves:
//
//   addTag         o campo limpa e a etiqueta some na leitura seguinte
//   removeTag      a confirmação fecha e a etiqueta VOLTA, o que se lê como o produto desfazendo
//                  a ação do usuário
//   addAnnotation  o usuário ESCREVEU. O textarea limpa, a nota some, e não há erro nem rascunho
//                  a recuperar — esta destrói trabalho, não apenas reporta estado errado.
const TETO_PAGINAS_COM_TRANSPORTE = 41;

/** Os identificadores que caracterizam transporte. `ApiError` NÃO é um deles. */
const TRANSPORTE = ['cloudFetch', 'engineFetch', 'cloudFetchRaw'];

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

/**
 * Casa o BLOCO importado, não o caminho do módulo.
 *
 * A distinção é o que faz o número medir a coisa certa: `import { ApiError } from
 * '@/lib/http/api'` é uma página tratando erro tipado, o que é correto e deve
 * continuar. Contar por caminho do módulo somaria esses arquivos e o teto
 * mediria "quem conhece o módulo de HTTP" em vez de "quem faz request".
 */
function importaTransporte(src: string): boolean {
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@\/lib\/http\/api'/g)) {
    const nomes = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    if (nomes.some((n) => TRANSPORTE.includes(n))) return true;
  }
  return false;
}

export function paginasComTransporte(): string[] {
  return arquivos(PAGES)
    .filter((f) => importaTransporte(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f).replace(/\\/g, '/'))
    .sort();
}

/**
 * Os três domínios que já têm arquivo de transporte por domínio, sem query key.
 * `promptly` tem UMA chave local (`CATALOG_QUERY_KEY`), o que não muda a
 * classificação: 20 exports e uma chave é transporte com exceção, não camada.
 */
const DOMINIOS_COM_API_PARCIAL = ['trust', 'skills', 'promptly'];

/**
 * A métrica DESTE plano, e ela é diferente da de cima — a distinção custou uma
 * versão inteira do plano para aparecer.
 *
 * As 19 páginas dos três domínios NÃO importam transporte: elas importam o
 * `*-api.ts`, e é ele que importa. Então migrá-las move `TETO_PAGINAS_COM_TRANSPORTE`
 * em ZERO. A v1.0 do plano usava aquele número como Goal e teria chegado à
 * última fase com todo o trabalho feito e a métrica intacta.
 *
 * O que o trabalho de fato move é isto: quantas páginas consomem um `*-api.ts`
 * e ainda montam o `useQuery` à mão. Zerar é o que significa "a camada existe".
 */
const TETO_PAGINAS_COM_QUERY_MANUAL = 0;

export function paginasComQueryManual(): string[] {
  const fora: string[] = [];
  for (const f of arquivos(PAGES)) {
    const src = readFileSync(f, 'utf8');
    const usaApiParcial = DOMINIOS_COM_API_PARCIAL.some((d) =>
      new RegExp(`from\\s*'[^']*${d}-api'`).test(src),
    );
    // O sinal é a página CONHECER UMA QUERY KEY. São dois verbos, e a escolha
    // deles foi corrigida duas vezes por medição.
    //
    // `useQueryClient` ENTROU: `trust/guardrail-new.tsx:52` não montava
    // `useQuery`, ele invalidava à mão — e invalidar exige conhecer a chave, que
    // é exatamente o defeito. Contar só `useQuery` deixaria de fora a página que
    // faz a pior metade do trabalho.
    //
    // `useMutation` SAIU. Ele estava aqui por simetria e não por medição: uma
    // mutation NÃO precisa conhecer chave nenhuma. Depois de migrar skills, as
    // quatro páginas que ainda contavam tinham `useQueryClient=0` e
    // `queryKey:=0` — o defeito havia saído inteiro delas, e o número não descia
    // porque o sinal media o verbo errado. Uma `useMutation` cujo `onSuccess`
    // chama `invalidarSkills()` delega o cache; é o oposto de gerenciá-lo à mão.
    //
    // A fronteira de palavra também é medida: `'useQuery' in src` casa
    // `useQueryClient` por substring, e foi assim que a contagem deu 19 pelo
    // motivo errado antes de dar 19 pelo certo.
    if (usaApiParcial && /\buseQuery\b|\buseQueryClient\b/.test(src)) {
      fora.push(relative(SRC, f).replace(/\\/g, '/'));
    }
  }
  return fora.sort();
}

describe('camada de acesso a dados (B-012/B-029/B-052/B-053)', () => {
  it('nenhuma página monta o useQuery à mão sobre um *-api.ts', () => {
    const ofensores = paginasComQueryManual();

    expect(
      ofensores.length,
      `${ofensores.length} páginas consomem um *-api.ts e montam o useQuery à mão; o teto é ${TETO_PAGINAS_COM_QUERY_MANUAL}.\n\n` +
        'Um `*-api.ts` exporta transporte e (quase) nenhuma query key, então cada\n' +
        'página que o consome reescreve a chave, o staleTime e a invalidação. O mesmo\n' +
        'endpoint acaba com identidades de cache diferentes em telas diferentes.\n\n' +
        'Vale para `useQueryClient` sozinho: invalidar à mão exige conhecer a chave,\n' +
        'que é a metade do defeito que mais cala quando erra.\n\n' +
        'Busque por um hook de domínio em `src/hooks/<dominio>/`, com a chave vinda\n' +
        'de `queryKeys` (ADR-0006). `src/hooks/projects/use-projects.ts` é a forma\n' +
        'canônica; o `*-api.ts` permanece como camada de transporte sob o hook.\n',
    ).toBeLessThanOrEqual(TETO_PAGINAS_COM_QUERY_MANUAL);
  });

  it('o número de páginas que falam HTTP direto só desce', () => {
    const ofensores = paginasComTransporte();

    expect(
      ofensores.length,
      `${ofensores.length} arquivos de src/pages importam transporte; o teto é ${TETO_PAGINAS_COM_TRANSPORTE}.\n\n` +
        'Uma página que importa `cloudFetch`/`engineFetch` monta o request, escolhe a\n' +
        'query key e decide a política de cache dentro da tela. O mesmo endpoint acaba\n' +
        'lido de formas diferentes em telas diferentes — foi por isso que\n' +
        '`query-key-convergence.test.ts` precisou existir.\n\n' +
        'Busque o dado por um hook de domínio em `src/hooks/<dominio>/`, com a chave\n' +
        'vinda de `queryKeys` (ADR-0006). `src/hooks/projects/use-projects.ts` é a\n' +
        'forma canônica.\n\n' +
        'Este teto SÓ DESCE. Se você precisa subi-lo, o plano\n' +
        '`dashboard-data-access-layer-plan.md` diz que não há razão.\n',
    ).toBeLessThanOrEqual(TETO_PAGINAS_COM_TRANSPORTE);
  });

  it('o teto bate com o disco — sem folga onde crescer', () => {
    // Faltava, e a ausência tinha custo: com apenas `<=`, o teto podia ficar ACIMA do real e a
    // catraca virava enfeite para tudo abaixo dele. Uma página migrada abria uma vaga silenciosa
    // para outra nascer falando transporte direto, e nenhum teste dizia nada.
    //
    // É a mesma lacuna que as catracas do B-235 e do B-242 já fecharam com este par de casos:
    // `<=` diz "não piorou", `toBe` diz "o número no arquivo é o número no disco".
    expect(paginasComTransporte().length).toBe(TETO_PAGINAS_COM_TRANSPORTE);
  });

  it('importar apenas `ApiError` NÃO conta como acesso a dados', () => {
    // Uma página que trata erro tipado está fazendo a coisa certa (`rules/
    // error-handling.md` § 2: erros explícitos e tipados). Se o guard contasse
    // por caminho do módulo, ele mediria "quem conhece o módulo de HTTP" em vez
    // de "quem faz request" — e puniria justamente o tratamento correto.
    expect(importaTransporte("import { ApiError } from '@/lib/http/api';")).toBe(false);
    expect(importaTransporte("import type { CloudFetchConfig } from '@/lib/http/api';")).toBe(false);
  });

  it('reconhece transporte em qualquer posição do bloco e sob alias', () => {
    expect(importaTransporte("import { ApiError, cloudFetch } from '@/lib/http/api';")).toBe(true);
    expect(importaTransporte("import { engineFetch } from '@/lib/http/api';")).toBe(true);
    // O alias é o caminho mais curto para escapar de um guard que casa texto
    // cru — aqui ele não escapa, porque a comparação é sobre o nome ORIGINAL.
    expect(importaTransporte("import { cloudFetch as buscar } from '@/lib/http/api';")).toBe(true);
  });
});
