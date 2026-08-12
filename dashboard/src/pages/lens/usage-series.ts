import type { TrendPoint } from '@usetheo/ui';
import type { PontoDaSerie } from '@/hooks/lens/use-usage-by-user';

/**
 * M144 — a densificação da série de consumo.
 *
 * A série que o M143 devolve é **esparsa por decisão**: um dia sem consumo não produz ponto, porque
 * um zero inventado é indistinguível de consumo real zero. Mas o `seriesPath` do `@usetheo/ui` só
 * quebra a linha onde encontra um `y` não-finito — ele precisa **receber** o buraco.
 *
 * Esta função transforma "ausência de ponto" em "ponto ausente", que é o formato que toda biblioteca
 * de gráfico espera (`null` no array) e a razão de o padrão delas ser não-conectar.
 *
 * Pura e fora do componente, pela mesma razão do M142 e do M143: o que quebra nesta família de
 * milestones não é a renderização, é a aritmética sem oráculo — e aritmética isolada é aritmética
 * que a mutação alcança.
 */

const DIA_MS = 86_400_000;

/**
 * A janela do eixo: onde ela começa e quantas fatias tem.
 *
 * Duas correções do review do M144 moram aqui, e as duas eram invisíveis dentro do componente:
 *
 * 1. **`dias` é `days + 1`.** Uma janela ROLANTE de N dias atravessa N+1 dias de calendário — o
 *    serviço recorta por instante (`now - N dias`) e agrupa por `date_trunc('day')`. `cabeSerie` já
 *    orçava `(days + 1) × linhas`; o eixo gerava `days` fatias, então o balde mais antigo — dado
 *    real, já pago pelo orçamento — caía fora do mapa e sumia **sem erro algum**.
 *
 * 2. **O fim é HOJE, não o último dia com consumo.** Ancorar no maior `periodStart` visto apagava o
 *    silêncio final: se ninguém consumiu nos últimos quatro dias, o eixo terminava quatro dias atrás
 *    e "o consumo parou" — informação de primeira ordem — simplesmente não existia no gráfico.
 *    `Math.max` com o maior ponto garante que um relógio de navegador atrasado nunca corte dado: o
 *    dado manda sobre o relógio, nunca o contrário.
 */
export function janelaDaSerie(
  diasComPonto: number[],
  days: number,
  agoraMs: number,
): { inicio: number; dias: number } {
  const aoDia = (t: number): number => Math.floor(t / DIA_MS) * DIA_MS;
  const fim = Math.max(aoDia(agoraMs), ...diasComPonto.map(aoDia));
  return { inicio: fim - days * DIA_MS, dias: days + 1 };
}

/** Um ponto como o serviço o devolve (`usageByUserSeriesPointSchema` do theo-lens). */
// B-244 — a forma do ponto passou a morar com o ENDPOINT que a devolve
// (`hooks/lens/use-usage-by-user.ts`). Esta aritmética é consumidora dela, não dona.
export type { PontoDaSerie };

/** Os campos plotáveis. `tokens` é derivado — entrada + saída, como a coluna da tabela. */
export type CampoPlotavel = keyof Omit<PontoDaSerie, 'periodStart'> | 'tokens';

const valorDe = (p: PontoDaSerie, campo: CampoPlotavel): number =>
  campo === 'tokens' ? p.inputTokens + p.outputTokens : p[campo];

/**
 * Expande `pontos` sobre os `dias` dias a partir de `inicioMs`, projetando `campo`.
 *
 * O `x` é o **dia em epoch-ms**, não o índice: dois usuários com dias diferentes precisam cair na
 * mesma posição horizontal para o mesmo dia, senão as linhas ficam desalinhadas entre si.
 *
 * Um usuário sem ponto algum recebe série **toda em lacuna**, nunca vazia. Série vazia sumiria do
 * gráfico sem dizer nada; toda em lacuna mantém o nome na legenda — e "não consumiu nesta janela" é
 * diferente de "não está no recorte".
 */
export function densificar(
  pontos: PontoDaSerie[],
  inicioMs: number,
  dias: number,
  campo: CampoPlotavel,
): TrendPoint[] {
  // `Date.parse` do `periodStart` truncado ao dia: o serviço já devolve meia-noite, mas o truncamento
  // torna a chave imune a um fuso que desloque o horário sem mudar o dia.
  const porDia = new Map<number, PontoDaSerie>();
  for (const p of pontos) {
    const t = Date.parse(p.periodStart);
    if (Number.isFinite(t)) porDia.set(Math.floor(t / DIA_MS) * DIA_MS, p);
  }

  const base = Math.floor(inicioMs / DIA_MS) * DIA_MS;
  return Array.from({ length: dias }, (_, i) => {
    const x = base + i * DIA_MS;
    const p = porDia.get(x);
    // NaN, nunca 0 — é o que faz o `seriesPath` quebrar a linha em vez de desenhar um vale que não
    // aconteceu.
    return { x, y: p === undefined ? Number.NaN : valorDe(p, campo) };
  });
}
