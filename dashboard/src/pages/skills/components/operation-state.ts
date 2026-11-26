/**
 * M31 — traduz o estado bruto de uma operação para a fase que a tela precisa mostrar.
 *
 * O vocabulário é do registro, não desta tela (`loopskills`
 * `packages/core/src/contract/index.ts:5-15`):
 *
 *   > In-progress states reflect the job type (CREATING/UPDATING/DELETING);
 *   > terminal states are ACTIVE (succeeded) / FAILED.
 *
 * O ponto que engana: **`ACTIVE` é o sucesso**. Lido como "ativo, trabalhando" ele vira o oposto
 * do que significa — e foi assim que a tela de autoria ficou dizendo "Em andamento" sobre uma
 * skill que já estava no acervo e já era descobrível.
 */

/** A fase que a tela mostra. Deliberadamente diferente do vocabulário do registro. */
export type FaseOperacao = 'aguardando' | 'em_andamento' | 'concluida' | 'falhou';

export function faseDaOperacao(estado: string | null | undefined): FaseOperacao {
  // Ainda não houve resposta do primeiro poll. Dizer "em andamento" afirmaria que o trabalho
  // começou; não sabemos disso — sabemos apenas que ainda não perguntamos com sucesso.
  if (estado === null || estado === undefined || estado === '') return 'aguardando';

  if (estado === 'ACTIVE') return 'concluida';
  if (estado === 'FAILED') return 'falhou';

  // Qualquer outro estado — os três de trabalho conhecidos e qualquer um que um registro mais
  // novo venha a inventar — é tratado como trabalho em curso. É a única leitura segura: chutar
  // "concluída" ofereceria testar a descoberta de uma skill que pode não existir, e chutar
  // "falhou" declararia morto algo que pode estar vivo. Continuar perguntando não afirma nada.
  return 'em_andamento';
}
