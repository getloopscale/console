import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card } from '@getloopscale/ui';
import { useCloudApi } from '@/hooks/use-api';
import { useTrustEnforcement } from '@/hooks/trust/use-trust';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';
import { formatCost } from '@/lib/formatting/format';
import { attentionItems, type AttentionItem, type SignalReading } from './attention';
import { spendByModel } from './spend';

/**
 * O que a plataforma está fazendo, custando e pedindo (B-125).
 *
 * ## O defeito que isto fecha
 *
 * A faixa `PLATFORM` do `B-112` diz quais capacidades existem. Abaixo dela, a página dedicava
 * quatro painéis a UMA delas mais cobrança: `Usage` (cotas), `Deploy activity`, `Projects` e
 * `Quick actions` — este último gastando 51 das 365 linhas do arquivo para produzir três links
 * que a barra lateral, sempre visível, já tem.
 *
 * Resultado medido em 2026-08-11: a tela não respondia "tem algo errado agora?", não mostrava o
 * que rodou além de deploys, e o único valor em dinheiro era `USD 20/mo` — o preço do plano.
 *
 * ## Por que "precisa de você" só existe aqui
 *
 * Cada capacidade enxerga a si mesma. O Lens sabe da taxa de erro, o Trust sabe do que barrou, o
 * RAG sabe dos retrievals vazios — e ninguém junta. Esta é a única superfície do produto de onde
 * a pergunta é respondível, e é por isso que ela vale o espaço que as cotas ocupavam.
 *
 * ## As chaves de query são as mesmas das páginas de capacidade
 *
 * Decisão D3 do `platform-overview-plan`, herdada: abrir a Overview aquece o cache em vez de
 * duplicar busca. A requisição não é a mais — é mais cedo.
 */
export function PlatformSignals() {
  const observability = useCloudApi<unknown>('/v1/dashboard/lens/observability');
  const rag = useCloudApi<unknown>('/v1/dashboard/rag/analytics');
  const trust = useTrustEnforcement(LIST_SAFETY_CEILING);

  const leitura = {
    observability: forReading(observability),
    rag: forReading(rag),
    trust: { failed: trust.error, loading: trust.loading, dados: trust.data ?? null },
  };

  const itens = attentionItems(leitura);
  const anyFailed = [leitura.observability, leitura.rag, leitura.trust].some((r) => r.failed);
  const stillReading = [leitura.observability, leitura.rag, leitura.trust].some((r) => r.loading);

  return (
    <div className="space-y-6">
      <AttentionBand
        items={itens}
        anyFailed={anyFailed}
        stillReading={stillReading}
      />
      <SpendBand reading={leitura.observability} />
    </div>
  );
}

/** O formato que `attention.ts` espera, a partir do que `useCloudApi` devolve. */
function forReading(q: { data: unknown; loading: boolean; error: boolean }): SignalReading {
  return { failed: q.error, loading: q.loading, dados: q.data };
}

/**
 * A faixa de atenção.
 *
 * Três estados, e a distinção entre os dois últimos é a que faz a faixa valer alguma coisa:
 *
 *   itens        há o que fazer, mais severo primeiro
 *   calmaria     LEU tudo e não há nada
 *   leu-em-parte alguma capacidade não respondeu — e aí a tela NÃO diz que está calmo
 *
 * Uma tela que afirma "nada precisa de você" a partir de uma leitura que caiu é a pior linha
 * possível: ela tranquiliza sobre o que não olhou.
 */
function AttentionBand({
  items,
  anyFailed,
  stillReading,
}: {
  readonly items: readonly AttentionItem[];
  readonly anyFailed: boolean;
  readonly stillReading: boolean;
}) {
  return (
    <section aria-label="Needs attention">
      <h2 className="text-label-caps text-muted-foreground uppercase mb-3 tracking-wider">
        Needs attention
      </h2>

      {items.length > 0 ? (
        <Card>
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-4 py-3 pr-4">
                <span
                  aria-hidden={true}
                  className={`w-0.5 self-stretch rounded-r ${
                    item.severity === 'critical' ? 'bg-destructive' : 'bg-warning'
                  }`}
                />
                <span className="min-w-0 flex-1 pl-3">
                  <span className="block text-sm font-medium text-foreground">{item.headline}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>
                </span>
                <Link
                  to={item.path}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/40"
                >
                  {item.cta}
                  <ArrowRight className="size-3.5" aria-hidden={true} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <Card.Body className="py-4">
            {/* A ordem importa: falha primeiro. Uma leitura pendente ainda pode virar item; uma
                que falhou nunca vai, e afirmar calmaria sobre ela seria mentir por omissão. */}
            {anyFailed ? (
              <p className="text-sm text-warning">
                Couldn&apos;t read every capability, so this is not a clean bill of health.
              </p>
            ) : stillReading ? (
              <p className="text-sm text-muted-foreground" aria-busy="true">
                Checking your capabilities…
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing needs you right now. Every capability answered.
              </p>
            )}
          </Card.Body>
        </Card>
      )}
    </section>
  );
}

/**
 * O que os agentes custaram.
 *
 * O total NUNCA é renderizado a partir de uma leitura que falhou: um `US$ 0,00` sobre uma
 * requisição que caiu diria ao operador que os agentes não custaram nada.
 */
function SpendBand({ reading }: { readonly reading: SignalReading }) {
  const spend = reading.failed || reading.loading ? null : spendByModel(reading.dados);
  const maior = spend?.models[0]?.costUsd ?? 0;

  return (
    <section aria-label="What your agents cost">
      <h2 className="text-label-caps text-muted-foreground uppercase mb-3 tracking-wider">
        What your agents cost
      </h2>
      <Card>
        <Card.Body className="py-4">
          {reading.failed ? (
            <p className="text-sm text-warning">Couldn&apos;t read model spend.</p>
          ) : reading.loading ? (
            <span
              aria-busy="true"
              aria-label="Loading"
              className="block h-7 w-32 animate-pulse rounded bg-muted"
            />
          ) : spend === null ? (
            <p className="text-sm text-muted-foreground">No model spend recorded yet.</p>
          ) : (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums text-foreground">
                  {formatCost(spend.total, 2)}
                </span>
                <span className="text-xs text-muted-foreground">last 7 days</span>
              </p>

              <ul className="mt-4 space-y-2.5">
                {spend.models.map((m) => (
                  <li key={m.model} className="text-sm">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-muted-foreground">{m.model}</span>
                      <span className="font-medium tabular-nums text-foreground">
                        {formatCost(m.costUsd, 2)}
                      </span>
                    </span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${String(maior === 0 ? 0 : Math.round((m.costUsd / maior) * 100))}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>

              {spend.unpricedSpans > 0 ? (
                // Fora do total, e visível por contrato: um total que ignora spans sem preço em
                // silêncio é menor que a verdade, apresentado como a verdade.
                <p className="mt-4 border-t border-border pt-3 text-xs text-warning">
                  {spend.unpricedSpans} spans ran on a model with no price on file — they are not in
                  this total.
                </p>
              ) : null}
            </>
          )}
        </Card.Body>
      </Card>
    </section>
  );
}
