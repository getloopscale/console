/**
 * Teto de leitura para coleções que o domínio já limita.
 *
 * Para os ambientes de um projeto, os membros de um time, os conectores de uma
 * workspace. Ninguém tem 200 webhooks, e o teto **não é paginação** — é o que
 * impede que um bug de servidor, um tenant anômalo ou um dado de teste
 * mal-formado virem um download de megabytes numa tela que ninguém desconfia.
 *
 * O número é generoso de propósito. Ele nunca deve cortar um caso legítimo; se
 * cortar, o pressuposto "o domínio limita isso" estava errado, e a tela precisa
 * de paginação de verdade — não de um teto maior.
 *
 * ## A outra natureza NÃO mora aqui, e a distinção é o ponto
 *
 * Coleções que crescem com o uso — faturas, traces, sessões, objetos — precisam
 * de **janela de página**, não de rede de proteção. Ali o tamanho da página É o
 * produto: a tela mostra uma e oferece navegação, e um teto de segurança
 * esconderia dados sem dizer.
 *
 * Esse tamanho é uma decisão de CADA tela, e vive nela: `traces-export.ts` usa
 * 500 porque exporta em lote; uma listagem usa 50 porque a pessoa lê. Este
 * módulo chegou a exportar um `PAGE_SIZE` genérico, e ninguém o importou — o
 * gate de código morto o apanhou. Uma janela de página compartilhada é uma
 * média de necessidades que não se parecem.
 *
 * ## O que este teto NÃO prova
 *
 * Que o servidor honra o parâmetro. Boa parte destes endpoints vive na engine,
 * outro repositório. Mandar um teto que o servidor ignora não custa nada; não
 * mandar é que garante o pior caso.
 */

/** Rede de proteção para coleções limitadas pelo domínio. Não é paginação. */
export const LIST_SAFETY_CEILING = 200;
