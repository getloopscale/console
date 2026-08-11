import { ConfigTab } from '@/pages/promptly/tabs/config';
import { AMBIENTES_DE_PRODUCAO, BASE_DE_CONSUMO, USAGE_WINDOW_DAYS, ambienteDoTrecho } from './constantes';
import { ProducaoTab } from '@/pages/promptly/tabs/producao';
import { ConsumoTab } from '@/pages/promptly/tabs/consumo';
import type { PromptQuery, Ponteiros } from './tipos';
import type { PromptlyQuery } from '@/hooks/promptly/use-promptly';
import type { LinhaDeUso } from '@/pages/promptly/components/usage';
import type { Dependente } from '@/pages/promptly/components/composicao';

interface Props {
  usoPorRevisao: Map<number, LinhaDeUso>;
  labels: PromptlyQuery<unknown>;
  dependentesLinhas: Dependente[];
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
export function PainelDeAbas({ usoPorRevisao, labels, dependentesLinhas, dependentes, abaAtiva, prompt, promptName, promptContent, latestVersion, compoe, ponteiros }: Props) {
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
        variaveis={prompt.data?.variables ?? []}
      />
    ) : null}

    {abaAtiva === 'producao' ? (
      <ProducaoTab
        promptName={promptName}
        janelaDias={USAGE_WINDOW_DAYS}
        linhas={[...usoPorRevisao.values()]}
        dependentes={dependentesLinhas}
        dependentesIlegiveis={Boolean(dependentes.error)}
        dependentesCarregando={dependentes.loading}
      />
    ) : null}

    {abaAtiva === 'consumo' ? (
      <ConsumoTab
        ambientesIlegiveis={Boolean(labels.error)}
        promptIlegivel={Boolean(prompt.error)}
        alvo={
          // `latestVersion === null` é ausência de dado, não "versão 1". Cair para `1` fabricaria
          // um número que PODE existir e ser a revisão errada — num trecho feito para ser copiado.
          promptContent === null || latestVersion === null
            ? null
            : {
                nome: promptName,
                compoe,
                ultimaVersao: latestVersion,
                label: ambienteDoTrecho(ponteiros),
                ambienteEProducao:
                  ambienteDoTrecho(ponteiros) === null
                    ? true // sem ambiente, o trecho usa versão e não afirma nada sobre produção
                    : AMBIENTES_DE_PRODUCAO.has(ambienteDoTrecho(ponteiros) as string),
                variaveis: prompt.data?.variables ?? [],
                baseUrl: BASE_DE_CONSUMO,
              }
        }
      />
    ) : null}
    </>
  );
}
