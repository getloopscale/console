/**
 * M12 T2 — o preview de render de uma revisão, FORA do React.
 *
 * Duas decisões que valem mais que o código:
 *
 * 1. Os campos vêm de `variables`, que a API DECLARA por revisão — nunca de um regex nosso
 *    sobre o texto. O `GET /prompts/:name?version=N` já devolve a lista, deduplicada e na
 *    ordem da 1ª aparição (medido). Derivar por conta própria seria inventar dado que o
 *    serviço não afirmou, e divergir dele em silêncio no dia em que a gramática mudar.
 *
 * 2. Renderizar é substituição local e determinística. NENHUMA chamada a modelo, nenhum
 *    request. O eixo de custo fecha aqui por construção — não por alguém lembrar de não
 *    clicar. A única rota faturável do produto é `POST /evaluations/runs`, fora desta jornada.
 */

export type CamposPreview = Record<string, string>;

/**
 * Um campo por variável DECLARADA, na ordem em que a API as devolveu.
 *
 * O `conteudo` entra só para manter a assinatura honesta com o chamador (ele tem o texto em
 * mãos) — e deliberadamente NÃO é lido: quem decide quais campos existem é a API.
 */
export function camposDeVariaveis(
  variaveis: readonly string[],
  _conteudo: string,
): CamposPreview {
  const campos: CamposPreview = {};
  for (const nome of variaveis) campos[nome] = '';
  return campos;
}

/** `{{ nome }}` com espaços internos tolerados — é o que a API aceita ao extrair `variables`. */
const MARCADOR = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * As variáveis de um texto que AINDA NÃO EXISTE como revisão.
 *
 * Esta é a única situação em que derivamos a lista nós mesmos, e ela é estreita de propósito: o
 * operador está digitando o conteúdo agora, então não há `GET` a consultar. Em toda tela de
 * LEITURA a lista vem de `variables`, que o serviço declara.
 *
 * Mora aqui, e não na tela, porque o regex é o MESMO de `renderTemplate` — em dois lugares eles
 * divergiriam no dia em que a gramática mudasse, e a divergência seria invisível: o preview
 * mostraria um campo que a substituição não preenche.
 *
 * Deduplicado e na ordem da 1ª aparição — o mesmo contrato que a API cumpre (medido).
 */
export function variaveisDoTexto(conteudo: string): string[] {
  const achadas = conteudo.match(MARCADOR) ?? [];
  return [...new Set(achadas.map((m) => m.replace(/[{}\s]/g, '')))];
}

/**
 * Substitui cada marcador pelo valor preenchido; deixa intacto o que estiver vazio.
 *
 * Uma passada só, sobre o texto ORIGINAL: um valor que pareça marcador (`{{b}}`) não dispara
 * segunda substituição. Reprocessar a saída seria injeção de template a partir de entrada do
 * operador.
 */
export function renderTemplate(conteudo: string, valores: CamposPreview): string {
  return conteudo.replace(MARCADOR, (marcador, nome: string) => {
    const valor = valores[nome];
    // Vazio ⇒ o marcador PERMANECE. Apagá-lo esconderia o buraco que o modelo receberia.
    return valor === undefined || valor === '' ? marcador : valor;
  });
}
