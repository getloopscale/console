/**
 * Tetos de leitura de coleção.
 *
 * Duas naturezas diferentes, e confundi-las é o erro que este módulo evita.
 *
 * ## `LIST_SAFETY_CEILING` — rede de proteção
 *
 * Para coleções que o domínio já limita: os ambientes de um projeto, os membros
 * de um time, os conectores de uma workspace. Ninguém tem 200 webhooks, e o teto
 * não é paginação — é o que impede que um bug de servidor, um tenant anômalo ou
 * um dado de teste mal-formado virem um download de megabytes numa tela que
 * ninguém desconfia.
 *
 * O número é generoso de propósito. Ele nunca deve cortar um caso legítimo; se
 * cortar, o pressuposto "o domínio limita isso" estava errado, e a tela precisa
 * de paginação de verdade — não de um teto maior.
 *
 * ## `PAGE_SIZE` — janela de página
 *
 * Para coleções que crescem com o uso: faturas, traces, sessões, objetos. Aqui o
 * teto É o produto: a tela mostra uma página e oferece navegação. Um teto de
 * segurança nessas telas seria pior que nada, porque esconderia dados sem dizer.
 *
 * ## O que nenhum dos dois prova
 *
 * Que o servidor honra o parâmetro. Boa parte destes endpoints vive na engine,
 * outro repositório. Mandar um teto que o servidor ignora não custa nada; não
 * mandar é que garante o pior caso.
 */

/** Rede de proteção para coleções limitadas pelo domínio. Não é paginação. */
export const LIST_SAFETY_CEILING = 200;

/** Janela de página para coleções que crescem com o uso. */
export const PAGE_SIZE = 50;
