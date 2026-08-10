import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus, FileText, Layers, Rocket, Server } from 'lucide-react';
import { Button, Card, MetricCard, PageShell, Skeleton } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { CATALOG_PAGE_LIMIT } from '@/hooks/promptly/promptly-api';
import { catalogRows, resumoCatalogo } from '@/pages/promptly/components/projections';
import { usePromptlyCatalog } from '@/hooks/promptly/use-promptly';

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

// B-052 — Q2 do plano: a forma da chave MUDA ao entrar na factory, entao ha
  // um refetch unico no primeiro carregamento apos o deploy. Esta no CHANGELOG.
  const query = usePromptlyCatalog<unknown>({}, CATALOG_PAGE_LIMIT);

  const resumo = resumoCatalogo(catalogRows(query.data?.data), query.data?.temContinuacao ?? false);

  return (
    <PageShell
      title="Prompts"
      description="Versioned prompts resolved at runtime — and what has been written but is not serving anyone yet."
    >
      {query.error ? (
        <Alert
          intent="destructive"
          title="Could not load the catalog"
          description="No number is shown below because the read failed — this does NOT mean there are no prompts in this workspace."
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
          aria-label="Loading the catalog numbers"
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
              title="The numbers below are partial"
              description={`The service reported more prompts beyond the ${String(resumo.prompts)} on this page. These values are minimums, not totals.`}
            />
          ) : null}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Link to="/promptly/catalog" aria-label="See all prompts in the catalog">
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
            <Link to="/promptly/catalog?recorte=not-promoted" aria-label="See the prompts that were never promoted">
              <MetricCard
                title="Not promoted"
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
              title="Revisions written"
              value={resumo.revisoesPublicadas}
              data-testid="kpi-revisoes"
              icon={<Layers className="h-4 w-4" aria-hidden="true" />}
            />
            <MetricCard
              title="Environments"
              value={resumo.ambientes}
              data-testid="kpi-ambientes"
              icon={<Server className="h-4 w-4" aria-hidden="true" />}
            />
          </div>

          <Card>
            <Card.Header>
              <Card.Title asChild>
                <h2>{resumo.prompts === 0 ? 'No prompts yet' : 'What is not live yet'}</h2>
              </Card.Title>
              <Card.Description>
                {/* `prompts === 0` é testado ANTES de `naoPromovidos === 0`, e a ordem É o
                    conserto: num workspace vazio os dois valem zero, e a frase de promoção
                    afirmava que "toda última revisão está servindo pelo menos um ambiente" sobre
                    revisões que não existem — no primeiro contato de quem acabou de chegar. */}
                {resumo.prompts === 0
                  ? 'Create the first revision and it takes effect at runtime, with no redeploy.'
                  : resumo.naoPromovidos === 0
                    ? 'Every latest revision is serving at least one environment.'
                    : `${String(resumo.naoPromovidos)} ${resumo.naoPromovidos === 1 ? 'prompt has a revision' : 'prompts have revisions'} that no label serves` +
                      (resumo.semAmbiente > 0
                        ? ` — ${String(resumo.semAmbiente)} of them ${resumo.semAmbiente === 1 ? 'was' : 'were'} never promoted.`
                        : '.')}
              </Card.Description>
            </Card.Header>
            <Card.Body className="flex flex-wrap gap-2">
              {resumo.prompts === 0 ? (
                // Zeros AQUI são a verdade: a leitura aconteceu e não há prompts. O caso de falha
                // é o ramo `isError` acima, e é por isso que os dois não podem renderizar igual.
                <Button asChild>
                  <Link to="/promptly/new">Create the first prompt</Link>
                </Button>
              ) : (
                <>
                  <Button asChild>
                    <Link to="/promptly/catalog">See the catalog</Link>
                  </Button>
                  <Button variant="secondary" asChild>
                    <Link to="/promptly/new">
                      <FilePlus className="mr-2 h-4 w-4" aria-hidden="true" />
                      New revision
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
