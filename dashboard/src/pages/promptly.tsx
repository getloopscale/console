import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FilePlus, FileText, Layers, Rocket, Server } from 'lucide-react';
import { Button, Card, MetricCard, PageShell, Skeleton } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchCatalogPage, CATALOG_PAGE_LIMIT, CATALOG_QUERY_KEY } from '@/components/promptly/promptly-api';
import { catalogRows, resumoCatalogo } from '@/components/promptly/projections';

/**
 * M13 — `/promptly`: o painel da capacidade.
 *
 * Até aqui esta rota era o catálogo, e o submenu já a rotulava `Overview` — o rótulo prometia
 * painel e entregava tabela. Nas outras capacidades (memory, rag, lens) a raiz é o painel e a lista
 * vive um nível abaixo; aqui a lista mudou para `/promptly/catalogo` e o endereço antigo continua
 * resolvendo. Nada que já circulava passou a dar 404: mudou o que a rota renderiza, não se ela
 * resolve.
 *
 * O painel existe para responder uma pergunta que a lista não responde: **"o que eu escrevi e ainda
 * não está no ar?"**. Sem ela seria enfeite, e um enfeite não justifica uma tela (rung 1 da
 * parsimony ladder).
 *
 * A HONESTIDADE DOS NÚMEROS É O CONTRATO DESTA TELA, e ela tem duas metades:
 *
 *   1. Os três estados (erro / carregando / sucesso) são disjuntos, como em `memory.tsx`. Zeros
 *      fabricados nunca podem pintar por cima de um outage: "0 não promovidos" durante uma queda
 *      afirma "não há nada para promover" no exato momento em que a tela não sabe de nada.
 *   2. Os números vêm de UMA página. Quando o serviço sinaliza continuação, eles são limites
 *      inferiores — e a tela diz isso. Quando ele NÃO sinaliza, são totais, mesmo numa página
 *      cheia: marcar de parcial um número correto ensina o operador a desconfiar dele.
 */

export function PromptlyOverviewPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Prompts'), [setPageTitle]);
  useRequireAuth();

  const query = useQuery({
    // A MESMA chave da tela de lista: um recurso, uma entrada de cache. A primeira versão usava
    // `[..., 'pagina']`, que além de duplicar a leitura colidia com a chave do detalhe de um
    // prompt CHAMADO `pagina` — e nomes não têm restrição de caractere, fato que este mesmo
    // milestone estabelece duas vezes (EC-4, EC-10).
    queryKey: CATALOG_QUERY_KEY,
    queryFn: () => fetchCatalogPage<unknown>(CATALOG_PAGE_LIMIT),
  });

  const resumo = resumoCatalogo(catalogRows(query.data?.data), query.data?.temContinuacao ?? false);

  return (
    <PageShell
      title="Prompts"
      description="Prompts versionados resolvidos em runtime — e o que já foi escrito mas ainda não está servindo ninguém."
    >
      {query.isError ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar o catálogo"
          description="Nenhum número é exibido abaixo porque a leitura falhou — isto NÃO significa que não há prompts neste workspace."
          /* Sem saída, o operador que cai numa falha transitória só pode recarregar a página
             inteira. O mecanismo já existia em `AlertProps.action` e não estava sendo usado. */
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          }
        />
      ) : null}

      {/* Carregando: esqueleto, NUNCA `dados ?? zeros`. Incluir a janela de retry aqui é o que
          garante que zeros fabricados não pintem por cima nem de um outage nem de uma carga lenta. */}
      {query.isPending ? (
        <div
          role="status"
          aria-label="Carregando os números do catálogo"
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          {/* `aria-hidden` nos esqueletos DE PROPÓSITO: cada `Skeleton` traz `role="status"`, e
              quatro deles dentro de um quinto fariam cinco live regions anunciarem a mesma espera.
              Uma região rotulada anuncia; os retângulos são decorativos. */}
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} aria-hidden="true" className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : null}

      {query.isSuccess ? (
        <>
          {resumo.parcial ? (
            <Alert
              intent="warning"
              title="Os números abaixo são parciais"
              description={`O serviço indicou que há mais prompts além dos ${String(resumo.prompts)} desta página. Os valores são mínimos, não totais.`}
            />
          ) : null}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Link to="/promptly/catalogo" aria-label="Ver todos os prompts no catálogo">
              <MetricCard
                title="Prompts"
                value={resumo.prompts}
                data-testid="kpi-prompts"
                icon={<FileText className="h-4 w-4" aria-hidden="true" />}
              />
            </Link>
            {/* O número que traz o operador ao painel — e ele LEVA à lista correspondente, que é
                o que o DoD-3 pede. Sem o link, o painel diria "2 não promovidos" e deixaria o
                operador abrir prompt por prompt para descobrir QUAIS. O recorte vive no endereço,
                então o link é colável. */}
            <Link to="/promptly/catalogo?recorte=nao-promovidos" aria-label="Ver os prompts não promovidos">
              <MetricCard
                title="Não promovidos"
                value={resumo.naoPromovidos}
                data-testid="kpi-nao-promovidos"
                icon={<Rocket className="h-4 w-4" aria-hidden="true" />}
              />
            </Link>
            {/* Estes dois NÃO são links, e a razão é que não existe lista correspondente: são
                agregados (uma soma e uma contagem de distintos), não subconjuntos do catálogo.
                O DoD-3 diz "cada número leva à lista correspondente" — onde a lista não existe,
                inventar um destino seria pior que a ausência. Declarado no registro de aceitação
                em vez de fingido aqui. */}
            <MetricCard
              title="Revisões escritas"
              value={resumo.revisoesPublicadas}
              data-testid="kpi-revisoes"
              icon={<Layers className="h-4 w-4" aria-hidden="true" />}
            />
            <MetricCard
              title="Ambientes"
              value={resumo.ambientes}
              data-testid="kpi-ambientes"
              icon={<Server className="h-4 w-4" aria-hidden="true" />}
            />
          </div>

          <Card>
            <Card.Header>
              <Card.Title asChild>
                <h2>{resumo.prompts === 0 ? 'Nenhum prompt ainda' : 'O que ainda não está no ar'}</h2>
              </Card.Title>
              <Card.Description>
                {/* `prompts === 0` é testado ANTES de `naoPromovidos === 0`, e a ordem É o
                    conserto: num workspace vazio os dois valem zero, e a frase de promoção
                    afirmava que "toda última revisão está servindo pelo menos um ambiente" sobre
                    revisões que não existem — no primeiro contato de quem acabou de chegar. */}
                {resumo.prompts === 0
                  ? 'Crie a primeira revisão e ela passa a valer no runtime, sem redeploy.'
                  : resumo.naoPromovidos === 0
                    ? 'Toda última revisão está servindo pelo menos um ambiente.'
                    : `${String(resumo.naoPromovidos)} ${resumo.naoPromovidos === 1 ? 'prompt tem uma revisão' : 'prompts têm revisões'} que nenhum label serve` +
                      (resumo.semAmbiente > 0
                        ? ` — ${String(resumo.semAmbiente)} ${resumo.semAmbiente === 1 ? 'deles nunca foi promovido' : 'deles nunca foram promovidos'}.`
                        : '.')}
              </Card.Description>
            </Card.Header>
            <Card.Body className="flex flex-wrap gap-2">
              {resumo.prompts === 0 ? (
                // Zeros AQUI são a verdade: a leitura aconteceu e não há prompts. O caso de falha
                // é o ramo `isError` acima, e é por isso que os dois não podem renderizar igual.
                <Button asChild>
                  <Link to="/promptly/new">Criar o primeiro prompt</Link>
                </Button>
              ) : (
                <>
                  <Button asChild>
                    <Link to="/promptly/catalogo">Ver o catálogo</Link>
                  </Button>
                  <Button variant="secondary" asChild>
                    <Link to="/promptly/new">
                      <FilePlus className="mr-2 h-4 w-4" aria-hidden="true" />
                      Nova revisão
                    </Link>
                  </Button>
                </>
              )}
            </Card.Body>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
