/**
 * M26 T2.2 — o texto da confirmação de promoção de canal.
 *
 * Vive fora do React porque é a frase que o operador lê antes do ato mais perigoso do produto:
 * promover reaponta um canal e, **sem redeploy**, troca o conteúdo que os consumidores daquele
 * canal resolvem. Não derruba nada — muda comportamento em silêncio, que é bem pior de
 * diagnosticar. Uma frase assim precisa de teste que asserte CONTEÚDO, e teste de conteúdo dentro
 * de componente ninguém re-executa.
 *
 * ## DECISÃO 1 — opção (a) do DoD, e por quê
 *
 * O DoD exigia dizer **quantos consumidores** passam a receber outro conteúdo. **Esse número não
 * existe na API.** Medido: a telemetria de adoção do `theo-skills` (M21) responde por **bundle**
 * (`GET /v1/bundles/:bundleId/adoption`); não há rota que responda "quantos consumidores deste
 * canal", e `GET /v1/skills/:id/channels` devolve apenas
 * `{channel, revision_id, previous_revision_id}`.
 *
 * Então o diálogo nomeia o que é **verificável hoje**: o canal, a revisão que **sai** e a que
 * **entra**. A letra do DoD ("quantos") fica declaradamente **não atendida**, com a razão medida —
 * não atendida por interpretação generosa.
 *
 * **A terceira via está PROIBIDA pelo DoD e não deve ser reintroduzida:** a tela NÃO pode derivar
 * a contagem por conta própria cruzando dados de bundle. Seria a interface afirmando um número que
 * o serviço não afirma — o Risco 1 deste milestone, literalmente. Se um dia a contagem por canal
 * for necessária, ela entra como **rota nova no `theo-skills`**, não como aritmética aqui.
 */

export interface PromotionTarget {
  /** O canal cujo ponteiro se move. */
  readonly channel: string;
  /** A revisão que o canal serve HOJE. `null` quando o canal ainda não existe. */
  readonly fromRevision: string | null;
  /**
   * A versão legível de `fromRevision` — o que o operador reconhece.
   *
   * `null` é um estado REAL e medido, não um descuido: um canal pode servir uma revisão sem linha
   * em `/versions` (promovida pelo `latest_revision_id`). Nesse caso o texto **declara a lacuna**
   * em vez de inventar um rótulo. Ausente (`undefined`) só quando `fromRevision` também é `null`.
   */
  readonly fromVersion?: string | null;
  /** A revisão que passará a ser servida. */
  readonly toRevision: string;
  /** A versão legível correspondente a `toRevision` — o que o operador reconhece. */
  readonly version: string;
}

/**
 * A frase que descreve o que deixa de valer.
 *
 * Dois casos, e a distinção importa: promover para um canal **novo** não tira nada de serviço.
 * Inventar um "sai da revisão X" ali afirmaria um estado anterior que nunca existiu.
 */
export function promotionConfirmation(t: PromotionTarget): string {
  const entra = `Quem resolver «${t.channel}» passa a receber a revisão ${t.toRevision} (versão ${t.version}).`;

  if (t.fromRevision === null) {
    return (
      `O canal «${t.channel}» ainda não serve nenhuma revisão — ele passa a existir com esta promoção. ` +
      entra
    );
  }

  // A que SAI é identificada como a que ENTRA — por versão, não só por id.
  //
  // Achado da validação independente: o texto dizia "versão 1.1.0" na que entra e apenas
  // `rev_qjaapjby…` na que sai. Um id opaco obriga quem está prestes a confirmar a ir procurar o
  // que aquilo era, no exato momento da decisão. O diálogo existe para dizer O QUE DEIXA DE VALER,
  // e meia identificação é meia informação.
  const sai =
    t.fromVersion === null || t.fromVersion === undefined
      ? `a revisão ${t.fromRevision} (sem versão publicada)`
      : `a versão ${t.fromVersion} (revisão ${t.fromRevision})`;

  return (
    `${entra} Deixa de receber ${sai}, que continua existindo no registro mas ` +
    `sai de serviço neste canal. ` +
    // Esta frase é a que impede o texto de mentir por omissão: promover de volta restaura o
    // PONTEIRO, não a leitura. Quem já resolveu o canal já levou o conteúdo novo.
    `Promover de volta não desfaz o efeito: quem já resolveu «${t.channel}» depois desta mudança já leu a revisão nova.`
  );
}

/**
 * A frase que o operador precisa digitar para confirmar: **o nome do canal**.
 *
 * Não é "PROMOVER" nem "CONFIRMO". Uma palavra fixa vira reflexo muscular — a mesma digitação em
 * qualquer canal, o que devolve ao gate a mesma força de um botão. O nome do canal obriga a ler
 * QUAL ponteiro está sendo movido, que é exatamente o erro que a confirmação previne.
 */
export function promotionPhrase(channel: string): string {
  return channel;
}
