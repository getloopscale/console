import { ConfigTab } from '@/pages/promptly/tabs/config';
import { PRODUCTION_ENVIRONMENTS, CONSUMPTION_BASE, USAGE_WINDOW_DAYS, snippetEnvironment } from './constantes';
import { ProductionTab } from '@/pages/promptly/tabs/producao';
import { ConsumptionTab } from '@/pages/promptly/tabs/consumo';
import type { PromptQuery, Ponteiros } from './tipos';
import type { PromptlyQuery } from '@/hooks/promptly/use-promptly';
import type { UsageRow } from '@/pages/promptly/components/usage';
import type { Dependente } from '@/pages/promptly/components/composicao';

interface Props {
  usageByRevision: Map<number, UsageRow>;
  labels: PromptlyQuery<unknown>;
  dependentsRows: Dependente[];
  dependentes: PromptlyQuery<unknown>;
  abaAtiva: string;
  prompt: PromptQuery;
  promptName: string;
  promptContent: string | null;
  latestVersion: number | null;
  compoe: boolean;
  ponteiros: Ponteiros;
}

/**
 * As três abas que NÃO são a de conteúdo — afinação, produção e consumo.
 *
 * ## Por que a de conteúdo fica de fora
 *
 * Ela não é um painel: são quatro cartões (texto, discussão, revisões) espalhados
 * entre outros que aparecem em TODAS as abas — tags e ambientes. Trazê-la para cá
 * exigiria mover os vizinhos junto, e eles não são dela.
 *
 * A assimetria é do desenho da tela, não deste arquivo, e escondê-la faria a
 * próxima pessoa procurar aqui um cartão que nunca esteve aqui.
 */
export function PainelDeAbas({ usageByRevision, labels, dependentsRows, dependentes, abaAtiva, prompt, promptName, promptContent, latestVersion, compoe, ponteiros }: Props) {
  return (
    <>
    {/* M21 — as três abas que não são a de conteúdo. `Tags` e `Ambientes` ficam FORA delas, no
        corpo do layout, porque o DoD-3 pede promover e etiquetar SEM SAIR DA TELA: numa aba, a
        ação sumiria em três dos quatro estados. */}
    {abaAtiva === 'config' ? (
      <ConfigTab
        ilegivel={Boolean(prompt.error)}
        versao={latestVersion}
        modelConfig={prompt.data?.modelConfig ?? null}
        variables={prompt.data?.variables ?? []}
      />
    ) : null}

    {abaAtiva === 'producao' ? (
      <ProductionTab
        promptName={promptName}
        windowDays={USAGE_WINDOW_DAYS}
        rows={[...usageByRevision.values()]}
        dependentes={dependentsRows}
        dependentesIlegiveis={Boolean(dependentes.error)}
        dependentsLoading={dependentes.loading}
      />
    ) : null}

    {abaAtiva === 'consumo' ? (
      <ConsumptionTab
        unreadableEnvironments={Boolean(labels.error)}
        promptIlegivel={Boolean(prompt.error)}
        target={
          // `latestVersion === null` é ausência de dado, não "versão 1". Cair para `1` fabricaria
          // um número que PODE existir e ser a revisão errada — num trecho feito para ser copiado.
          promptContent === null || latestVersion === null
            ? null
            : {
                name: promptName,
                compoe,
                latestVersion: latestVersion,
                label: snippetEnvironment(ponteiros),
                environmentIsProduction:
                  snippetEnvironment(ponteiros) === null
                    ? true // sem ambiente, o trecho usa versão e não afirma nada sobre produção
                    : PRODUCTION_ENVIRONMENTS.has(snippetEnvironment(ponteiros) as string),
                variables: prompt.data?.variables ?? [],
                baseUrl: CONSUMPTION_BASE,
              }
        }
      />
    ) : null}
    </>
  );
}
