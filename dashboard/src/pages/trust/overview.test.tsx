import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

/**
 * B-227 — o mock desce para a costura de REDE.
 *
 * Antes trocava o export `fetchTrust`. Mas `trust-api.ts:33` faz `fetchValidators` chamar
 * `fetchTrust` pela ligacao INTERNA do modulo, que um mock no nivel do export nao alcanca:
 * a leitura do catalogo escapava para a rede de verdade e falhava sob jsdom. O resultado
 * era um teste VERDE com o catalogo quebrado — `coverageGap` recebia `undefined`, marcava
 * toda politica como nao-bloqueada e pintava tudo de ambar, que e exatamente o all-clear
 * falso que esta tela existe para nao dar.
 *
 * `cloudFetch` e o unico ponto por onde toda a familia passa, entao interceptar ali cobre
 * `fetchTrust` e tudo que o chama, por dentro ou por fora.
 */
const mockTrust = vi.fn();
vi.mock('@/lib/http/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http/api')>();
  return {
    ...actual,
    cloudFetch: (path: string) => mockTrust(String(path).replace('/v1/dashboard/trust', '')),
  };
});

import { TrustOverviewPage } from './overview';

/**
 * Esta tela emite um JULGAMENTO numa frase ("tantas políticas não estão sendo bloqueadas"),
 * e é isso que precisa de proteção: um julgamento errado aqui é pior que nenhum, porque o
 * operador age sobre ele.
 *
 * São TRÊS estados que produzem telas parecidas e significam coisas opostas:
 *
 *   1. leu e não há violação        → pode afirmar ausência
 *   2. NÃO leu as violações         → não pode afirmar nada; o vazio é ignorância
 *   3. leu as violações mas NÃO o catálogo → a lista vale, a coluna "bloqueado" está cega,
 *      e toda política aparece descoberta pelo lado seguro — o operador precisa saber disso,
 *      senão lê "descoberta" como fato medido.
 *
 * O caso 3 é o que mais se perde num refactor, porque a tela continua funcionando.
 */

const VIOLACOES = {
  violations: [
    { id: 'v1', policy: 'credential_leak', severity: 'high', detectedAt: '2026-08-02T12:00:00.000Z' },
  ],
};
/**
 * B-190 — esta fixture não fazia cumprir NADA, e um comentário afirmava que sim.
 *
 * `coverageGap` (`components/trust-series.ts:162-171`) monta o conjunto de políticas aplicadas
 * lendo `policy` OU `category` de cada validador e descartando os vazios. O validador aqui não
 * tinha nenhum dos dois, então `enforcedPolicies` saía VAZIO e toda política voltava
 * `enforced: false` — o caminho "aplicada" nunca era exercitado por teste de tela nenhum,
 * enquanto o comentário em `:123` dizia "e essa política É aplicada pela fixture do catálogo".
 *
 * `policy` agora casa a violação da fixture, então o caminho aplicado existe de verdade.
 */
const CATALOGO = {
  catalogVersion: 1,
  validators: [
    {
      source: 'platform',
      name: 'credential-mask',
      kind: 'rule',
      policy: 'credential_leak',
      directions: ['input', 'output'],
    },
  ],
};

/** Responde por CAMINHO — as duas leituras da tela falham de formas diferentes, e é o ponto. */
function responder({ violacoes, catalogo }: { violacoes?: unknown; catalogo?: unknown }) {
  mockTrust.mockImplementation((path: string) => {
    const alvo = path.startsWith('/validators') ? catalogo : violacoes;
    return alvo instanceof Error ? Promise.reject(alvo) : Promise.resolve(alvo);
  });
}

describe('TrustOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responder({ violacoes: VIOLACOES, catalogo: CATALOGO });
  });

  it('quando a leitura das violações FALHA, não afirma ausência de violação', async () => {
    responder({ violacoes: new Error('trust fora do ar'), catalogo: CATALOGO });
    render(<TrustOverviewPage />);

    expect(await screen.findByText('Could not read the trust layer')).toBeInTheDocument();
    expect(screen.getByText('No reading from the trust layer.')).toBeInTheDocument();
    expect(screen.getByText('No data — the read failed')).toBeInTheDocument();

    // O julgamento de ausência não pode aparecer: a tela não sabe.
    expect(screen.queryByText('No violation recorded.')).not.toBeInTheDocument();
  });

  it('quando só o CATÁLOGO falha, mantém a lista e avisa que a cobertura está cega', async () => {
    responder({ violacoes: VIOLACOES, catalogo: new Error('catálogo fora do ar') });
    render(<TrustOverviewPage />);

    // A falha do catálogo NÃO é a falha da tela — o alerta destrutivo não deve aparecer.
    expect(await screen.findByText('The guardrail catalog did not respond')).toBeInTheDocument();
    expect(screen.queryByText('Could not read the trust layer')).not.toBeInTheDocument();
    expect(screen.queryByText('No data — the read failed')).not.toBeInTheDocument();
  });

  it('quando LEU tudo e não há violação, aí sim afirma a ausência', async () => {
    // O par que impede a correção de virar "nunca afirme nada": sem ele, uma tela que só
    // emitisse avisos passaria nos dois testes acima e não informaria coisa alguma.
    responder({ violacoes: { violations: [] }, catalogo: CATALOGO });
    render(<TrustOverviewPage />);

    expect(await screen.findByText('No violation recorded.')).toBeInTheDocument();
    expect(screen.queryByText('Could not read the trust layer')).not.toBeInTheDocument();
    expect(screen.queryByText('The guardrail catalog did not respond')).not.toBeInTheDocument();
  });
});

describe('the KPI dashboard (B-126, amendment D1-bis)', () => {
  // Explicit setup rather than leaning on the sibling describe's `beforeEach`: a test that only
  // passes because another block ran first is order-dependent, and order dependence is the failure
  // that passes in isolation and breaks in the suite.
  beforeEach(() => {
    vi.clearAllMocks();
    responder({ violacoes: VIOLACOES, catalogo: CATALOGO });
  });

  // Owner's decision: every capability opens with the same four-number dashboard `memory` opens
  // with. The verdict stays above it — the amendment adds, it does not replace.

  it('opens with the four numbers, above the discovered rows', async () => {
    render(<TrustOverviewPage />);

    // B-190 — este comentário era FALSO até a fixture ganhar `policy`: o validador não trazia
    // `policy` nem `category`, então nenhuma política contava como aplicada.
    expect(await screen.findByText('Violations')).toBeInTheDocument();
    expect(screen.getByText('Policies seen')).toBeInTheDocument();
    // B-190 — `Blocked` aparece DUAS vezes agora, e a duplicata é a prova: antes existia só o
    // rótulo do card de KPI, porque a fixture não fazia nenhuma política contar como aplicada e
    // nenhuma linha bloqueada era renderizada. Este caso passava sobre o rótulo, não sobre a
    // leitura.
    expect(screen.getAllByText('Blocked').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Unblocked')).toBeInTheDocument();
  });

  it('a read that FAILED renders no numbers at all', async () => {
    // Four zeros over a failed read are fabricated numbers standing where an error belongs — they
    // reassure about what nobody looked at. This is the same distinction the verdict already
    // defends one line above; the dashboard must not undo it.
    responder({ violacoes: new Error('trust down'), catalogo: CATALOGO });
    render(<TrustOverviewPage />);

    await screen.findByText('Could not read the trust layer');
    expect(screen.queryByText('Violations')).not.toBeInTheDocument();
    expect(screen.queryByText('Policies seen')).not.toBeInTheDocument();
  });
});

describe('the chart under the counts (B-129)', () => {
  // Explicit setup rather than leaning on the sibling describe's `beforeEach`: a test that only
  // passes because another block ran first is order-dependent, and order dependence is the failure
  // that passes in isolation and breaks in the suite.
  beforeEach(() => {
    vi.clearAllMocks();
    responder({ violacoes: VIOLACOES, catalogo: CATALOGO });
  });

  it('shows which policies dominate, and which of them are unblocked', async () => {
    // The table below already lists the same rows. The bars add the PROPORTION: `40 / 2 / 1` and
    // `15 / 14 / 14` are the same three rows and completely different situations, and the table
    // makes you read three numbers to see which.
    //
    // Bars and not a line, deliberately: `PolicyViolation` declares `detectedAt` and the real
    // deploy DOES NOT SEND IT (`hooks/trust/trust-payloads.ts:26`). A time series here would be
    // empty in production while looking correct against this mock — the exact shape of failure this
    // repository keeps paying for.
    render(<TrustOverviewPage />);

    const chart = await screen.findByRole('table', { name: /violations by policy/i });
    expect(within(chart).getByRole('row', { name: /credential_leak\s*1/i })).toBeInTheDocument();
  });

  it('a read that FAILED draws no chart', async () => {
    responder({ violacoes: new Error('trust down'), catalogo: CATALOGO });
    render(<TrustOverviewPage />);

    await screen.findByText('Could not read the trust layer');
    // B-152/B-189 — esta asserção olhava a TABELA e não conseguia falhar. `CategoryBars` renderiza
    // um `<p>` (não uma tabela) quando não há barras, e uma leitura que falhou produz zero barras:
    // o papel `table` está ausente no mundo que passa E no que falha. Apagar o gate de
    // settled-success deixava tudo verde — foi assim, por execução, que se provou o defeito.
    //
    // O `<h2>` fica FORA do `CategoryBars` e DENTRO do gate, então ele existe exatamente quando o
    // bloco existe. É isso que torna a ausência dele uma afirmação com conteúdo.
    expect(screen.queryByRole('heading', { name: /violations by policy/i })).toBeNull();
  });
});

/**
 * B-227 — o caso que ficava verde sobre o defeito.
 *
 * Com o catálogo em falha, `coverageGap` marca TODA política como não-bloqueada e o gráfico
 * pinta tudo de âmbar. A asserção antiga ("existe uma tabela chamada violations by policy")
 * era satisfeita por esse estado tanto quanto pelo correto — e por isso não podia falhar.
 * Aqui a leitura do catálogo falha de propósito e o gráfico tem de SUMIR.
 */
describe('B-227 — o gráfico não afirma cobertura que não leu', () => {
  it('test_chart_is_absent_when_the_catalogue_read_fails', async () => {
    responder({ violacoes: VIOLACOES, catalogo: new Error('catalogue down') });
    render(<TrustOverviewPage />);

    // A tabela de violações continua: a leitura dela deu certo e vale.
    await screen.findByText(/credential_leak/i);
    // O gráfico não: sem catálogo ele só saberia dizer "âmbar em tudo".
    // B-152/B-189 — esta asserção olhava a TABELA e não conseguia falhar. `CategoryBars` renderiza
    // um `<p>` (não uma tabela) quando não há barras, e uma leitura que falhou produz zero barras:
    // o papel `table` está ausente no mundo que passa E no que falha. Apagar o gate de
    // settled-success deixava tudo verde — foi assim, por execução, que se provou o defeito.
    //
    // O `<h2>` fica FORA do `CategoryBars` e DENTRO do gate, então ele existe exatamente quando o
    // bloco existe. É isso que torna a ausência dele uma afirmação com conteúdo.
    expect(screen.queryByRole('heading', { name: /violations by policy/i })).toBeNull();
  });
});

describe('B-187 — the enforcement reading is not carried by colour alone', () => {
  it('says in words which policies are not enforced', async () => {
    // The amber tone was the ONLY carrier of "this policy is not being applied", and it lived
    // inside the bar's aria-hidden track. On a compliance screen, a reading that exists only in
    // colour does not exist for a screen-reader user, nor for anyone who does not separate the
    // two hues (WCAG 2.2 SC 1.4.1).
    // B-190 — antes a fixture não fazia cumprir nada, então QUALQUER política aparecia como
    // "not enforced" e este caso passava sem provar que o tom âmbar tinha portador em palavras.
    // Com a fixture real, é preciso uma política de fato AUSENTE do catálogo.
    responder({
      violacoes: { violations: [{ id: 'v9', policy: 'pii_leak', severity: 'high' }] },
      catalogo: CATALOGO,
    });
    render(<TrustOverviewPage />);

    const chart = await screen.findByRole('table', { name: /violations by policy/i });
    expect(within(chart).getByText(/not enforced/i)).toBeInTheDocument();
  });
});

describe('B-190 — o caminho "política aplicada" é de fato exercitado', () => {
  it('uma política presente no catálogo aparece como aplicada, não como desbloqueada', async () => {
    // Até aqui NENHUM teste de tela exercitava este caminho: o validador da fixture não trazia
    // `policy` nem `category`, `enforcedPolicies` saía vazio, e toda política voltava
    // `enforced: false`. O gráfico pintava tudo de âmbar — "nada está sendo barrado" — e passava.
    responder({ violacoes: VIOLACOES, catalogo: CATALOGO });
    render(<TrustOverviewPage />);

    const chart = await screen.findByRole('table', { name: /violations by policy/i });
    expect(within(chart).getByText(/^enforced$/i)).toBeInTheDocument();
  });

  it('e uma política AUSENTE do catálogo continua aparecendo como não aplicada', async () => {
    // O contrário também precisa valer, ou a correção só trocaria um estado fixo por outro.
    responder({
      violacoes: { violations: [{ id: 'v2', policy: 'pii_leak', severity: 'high' }] },
      catalogo: CATALOGO,
    });
    render(<TrustOverviewPage />);

    const chart = await screen.findByRole('table', { name: /violations by policy/i });
    expect(within(chart).getByText(/not enforced/i)).toBeInTheDocument();
  });
});
