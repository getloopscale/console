import { Badge, Card, PageShell, Skeleton } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  useServiceVersions,
  type ServiceStatus,
} from '@/hooks/use-service-versions';

/**
 * /status (M21) — the detail behind the sidebar's health indicator: one row per
 * data-plane service with its state, its version when there IS one, and when it
 * was built. The aggregate's own collection time is shown once, at the top.
 *
 * The central invariant is structural, not editorial: in the `unreachable` /
 * `timeout` branches below, `s.version` does not EXIST on the narrowed type
 * (ADR D3), so this page cannot show a stale version even by accident.
 */
export function StatusPage() {
  useRequireAuth();
  const { setPageTitle } = usePageMeta();
  const { data, isPending } = useServiceVersions();

  return (
    <PageShell
      title="Service versions"
      description="What each platform service reports about itself."
      onTitleChange={setPageTitle}
    >
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <Report data={data} />
      )}
    </PageShell>
  );
}

function Report({
  data,
}: {
  data:
    | { collected_at: string; services: readonly ServiceStatus[] }
    | null
    | undefined;
}) {
  // Never an empty list in silence: not knowing is itself the news (the failure
  // mode this milestone exists to remove).
  if (!data) {
    return (
      <Card>
        <Card.Body>
          <p role="alert">Could not read service status.</p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Body>
        <p
          className="text-body-sm text-muted-foreground"
          data-testid="collected-at"
        >
          Checked at {formatInstant(data.collected_at)}
        </p>
        {data.services.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            No services configured.
          </p>
        ) : (
          // `<table>` e nao lista de linhas flex: dado tabular tem elemento nativo
          // (rung 3 da escada), e ele resolve as DUAS coisas de uma vez — o olho
          // alinha as colunas verticalmente, e o leitor de tela anuncia qual
          // coluna esta lendo. Empilhado, nenhuma das duas acontecia.
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-label">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-6 font-normal">
                    Service
                  </th>
                  <th scope="col" className="py-2 pr-6 font-normal">
                    State
                  </th>
                  <th scope="col" className="py-2 pr-6 font-normal">
                    Version
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    Built
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.services.map((s) => (
                  <tr
                    key={s.name}
                    data-testid={`service-row-${s.name}`}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="py-2.5 pr-6 font-mono text-foreground">
                      {s.name}
                    </td>
                    <td className="py-2.5 pr-6">{stateCell(s)}</td>
                    <td className="py-2.5 pr-6 font-mono text-muted-foreground">
                      {versionCell(s)}
                    </td>
                    <td className="py-2.5 text-muted-foreground tabular-nums">
                      {builtCell(s)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

/**
 * As tres celulas variaveis de uma linha, uma funcao por COLUNA.
 *
 * Separar por coluna (em vez de um `renderState` que devolvia tudo em fragmento)
 * e o que permite a tabela: cada celula precisa saber o proprio conteudo. E
 * mantem o invariante do ADR D3 intacto — nos ramos `unreachable`/`timeout`/
 * `not_deployed` o campo `version` NAO EXISTE no tipo estreitado, entao a coluna
 * de versao nao consegue mostrar valor velho nem por acidente.
 */
function stateCell(s: ServiceStatus) {
  switch (s.state) {
    case 'ok':
      return <Badge variant="success">ok</Badge>;
    case 'unreachable':
      return (
        <span className="flex items-center gap-2">
          <Badge variant="destructive">unreachable</Badge>
          <span className="text-muted-foreground">{s.reason}</span>
        </span>
      );
    case 'timeout':
      return (
        <span className="flex items-center gap-2">
          <Badge variant="warning">timeout</Badge>
          <span className="text-muted-foreground">
            {s.reason ?? 'timed out'}
          </span>
        </span>
      );
    // O token do contrato continua `not_deployed`, mas o rotulo diz o que foi MEDIDO.
    // O coletor nao observa deploy algum: ele observa que a base URL do alvo esta
    // vazia (internal/serviceversions/probe.go). "not deployed" afirmava mais do que
    // a medicao sustenta, e o custo foi real — o theo-traefik-mcp apareceu assim
    // enquanto roteava MCP normalmente, e quem leu a tela foi depurar deploy em vez
    // de topologia. Mesmo tratamento que o #345 deu ao `unauthorized` logo abaixo:
    // o estado permanece, a frase para de exagerar.
    case 'not_deployed':
      return (
        <span className="flex items-center gap-2">
          <Badge variant="outline">not configured</Badge>
          <span className="text-muted-foreground">
            no base URL for this service in this environment
          </span>
        </span>
      );
    // #345 — o alvo RESPONDEU e recusou a sondagem. Nao e degradacao (a pilha esta de pe), entao
    // nao usa o visual de falha; mas tambem nao e saude, entao a razao aparece: e a configuracao
    // que falta, e escondê-la era o que fazia o indicador ficar vermelho sem dizer por que.
    case 'unauthorized':
      return (
        <span className="flex items-center gap-2">
          <Badge variant="outline">not measured</Badge>
          <span className="text-muted-foreground">
            probe not authorized ({s.reason})
          </span>
        </span>
      );
    // ADR D11: nao lanca. O parametro `never` mantem a exaustividade de
    // compilacao (remover um `case` acima quebra o `tsc`), e em runtime degrada
    // para o estado literal que chegou. Lancar aqui apagaria a pagina INTEIRA —
    // levando os servicos saudaveis junto — porque este payload vem da rede.
    default:
      return <Badge variant="outline">{unknownStateOf(s)}</Badge>;
  }
}

/** Celula vazia quando nao ha versao — nunca "undefined". Ausencia e a leitura honesta. */
function versionCell(s: ServiceStatus) {
  return s.state === 'ok' ? s.version : null;
}

function builtCell(s: ServiceStatus) {
  return s.state === 'ok' && s.built_at ? formatInstant(s.built_at) : null;
}

function unknownStateOf(s: never): string {
  return (s as { state: string }).state;
}

/**
 * Render an instant as `YYYY-MM-DD HH:mm UTC` — deterministic, and readable next to
 * the other one on the page. A value the gateway could not have produced is shown
 * verbatim rather than crashing the page, for the same reason as D11.
 */
function formatInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
