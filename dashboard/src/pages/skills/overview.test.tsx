import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/render';

/**
 * `/skills` responde antes de listar (B-126).
 *
 * ## O defeito
 *
 * Medido em 2026-08-11: das sete overviews de capacidade, esta era a única que não respondia
 * nada. Abria num `<Card>` com `<h2>Published skills</h2>` e um `DataTable` — quem chegava via uma
 * LISTA, e uma lista não responde "como está esta capacidade?".
 *
 * É a mesma classe do defeito que o `B-125` corrigiu um nível acima, na Overview de plataforma.
 *
 * ## Por que veredito e não KPIs
 *
 * Decisão D1 de `capability-overviews-answer-a-question-plan.md`: a forma segue a existência de uma REGRA, não a maioria. O acervo tem um
 * "deveria" — uma skill publicada deveria ser carregável — e `latest_revision_id: null` significa
 * que ela não é. Cinco telas usarem KPIs não prova que KPIs respondem melhor.
 *
 * ## E este é o primeiro teste de tela do diretório
 *
 * Medido enquanto escrevia: nenhuma das oito telas de `pages/skills/` tinha teste; a cobertura
 * vivia nos hooks e no e2e. Um teste de hook passa idêntico com a tela nunca montada.
 */

const mockCatalogo = vi.fn();
vi.mock('@/hooks/skills/use-skills', () => ({
  useSkillsCatalog: () => mockCatalogo(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 'u', traits: { email: 'o@x.com' } } }),
}));

import { SkillsOverviewPage } from './overview';

function skill(over: Record<string, unknown> = {}) {
  return {
    skill_id: 's-1',
    name: 'resumir-conversa',
    description: 'Resume uma conversa longa.',
    state: 'published',
    latest_revision_id: 'rev-1',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCatalogo.mockReturnValue({ data: { skills: [skill()] }, loading: false, error: false, isSuccess: true });
});

describe('a tela responde antes de listar', () => {
  it('test_o_veredito_aparece', async () => {
    render(<SkillsOverviewPage />);

    const veredito = await screen.findByRole('status', { name: /skill registry/i });
    expect(within(veredito).getByText(/published and loadable/i)).toBeInTheDocument();
  });

  it('test_o_problema_ganha_a_frase_em_vez_do_total', async () => {
    // O caso que justifica o veredito existir. `1 skill published` é verdade e inútil; `1 skill
    // cannot be loaded` é a mesma leitura respondendo o que o operador precisa fazer.
    mockCatalogo.mockReturnValue({
      data: { skills: [skill(), skill({ skill_id: 's-2', latest_revision_id: null })] },
      loading: false,
      error: false,
      isSuccess: true,
    });

    render(<SkillsOverviewPage />);

    const veredito = await screen.findByRole('status', { name: /skill registry/i });
    expect(within(veredito).getByText(/cannot be loaded/i)).toBeInTheDocument();
  });

  it('test_leitura_que_falhou_nao_vira_acervo_saudavel', async () => {
    // A distinção que este repositório defende em toda superfície de leitura. Um "tudo carregável"
    // sobre uma requisição que caiu tranquiliza sobre o que ninguém olhou.
    mockCatalogo.mockReturnValue({ data: undefined, loading: false, error: true, isSuccess: false });

    render(<SkillsOverviewPage />);

    const veredito = await screen.findByRole('status', { name: /skill registry/i });
    expect(within(veredito).queryByText(/loadable/i)).not.toBeInTheDocument();
    expect(within(veredito).getByText(/couldn't read/i)).toBeInTheDocument();
  });

  it('test_a_tela_avisa_quando_o_acervo_foi_truncado', async () => {
    // decisão D2 de `capability-overviews-answer-a-question-plan.md`. Um resumo calculado sobre leitura truncada e apresentado como total não tem como ser
    // desconfiado por quem lê.
    mockCatalogo.mockReturnValue({
      data: { skills: [skill()], next_page_token: 'proxima-pagina' },
      loading: false,
      error: false,
      isSuccess: true,
    });

    render(<SkillsOverviewPage />);

    const veredito = await screen.findByRole('status', { name: /skill registry/i });
    expect(within(veredito).getByText(/more beyond this page|minimum/i)).toBeInTheDocument();
  });

  it('test_leitura_inteira_nao_avisa_de_parcialidade', async () => {
    // Um aviso que sempre aparece deixa de ser lido, e aí some justamente quando importa.
    render(<SkillsOverviewPage />);

    const veredito = await screen.findByRole('status', { name: /skill registry/i });
    expect(within(veredito).queryByText(/more beyond this page/i)).not.toBeInTheDocument();
  });
});

describe('nada se perde', () => {
  it('test_a_tabela_continua_onde_estava', async () => {
    // O critério que o `B-125` deixou como aprendizado: nenhuma tela pode perder informação que só
    // ela mostra. O veredito ENTRA acima da tabela; ele não a substitui.
    render(<SkillsOverviewPage />);

    expect(await screen.findByText('resumir-conversa')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /published skills/i })).toBeInTheDocument();
  });
});

describe('the KPI dashboard (B-126, amendment D1-bis)', () => {
  // Owner's decision: every capability opens with the same four-number dashboard `memory` opens
  // with. The verdict stays above it — the amendment adds, it does not replace.

  it('opens with the four numbers, and keeps the verdict above them', async () => {
    mockCatalogo.mockReturnValue({
      data: { skills: [skill(), skill({ skill_id: 's-2', latest_revision_id: null })] },
      loading: false,
      error: false,
      isSuccess: true,
    });

    render(<SkillsOverviewPage />);

    // The verdict is still the first thing that answers.
    const veredito = await screen.findByRole('status', { name: /skill registry/i });
    expect(within(veredito).getByText(/cannot be loaded/i)).toBeInTheDocument();

    expect(screen.getByText('In registry')).toBeInTheDocument();
    expect(screen.getByText('Loadable')).toBeInTheDocument();
    expect(screen.getByText('Not loadable')).toBeInTheDocument();
    expect(screen.getByText('Deprecated')).toBeInTheDocument();
  });

  it('a read that FAILED renders no numbers at all', async () => {
    // Four zeros over a failed read are fabricated numbers standing where an error belongs. The
    // verdict already refuses to say "healthy" here; the dashboard must not undo that refusal by
    // showing a confident `0`.
    mockCatalogo.mockReturnValue({ data: undefined, loading: false, error: true, isSuccess: false });

    render(<SkillsOverviewPage />);

    await screen.findByRole('status', { name: /skill registry/i });
    expect(screen.queryByText('Loadable')).not.toBeInTheDocument();
    expect(screen.queryByText('Not loadable')).not.toBeInTheDocument();
  });
});

describe('the chart under the counts (B-129)', () => {
  it('shows what the registry is made of', async () => {
    // The four cards answer "how many, and how many work". They do not answer "what IS this
    // registry" — which is the question somebody browsing an agent's skills actually has.
    mockCatalogo.mockReturnValue({
      data: {
        skills: [
          skill({ skill_id: 'a', category: 'engineering' }),
          skill({ skill_id: 'b', category: 'engineering' }),
          skill({ skill_id: 'c', category: 'finance' }),
        ],
      },
      loading: false,
      error: false,
      isSuccess: true,
    });

    render(<SkillsOverviewPage />);

    const chart = await screen.findByRole('table', { name: /by category/i });
    expect(within(chart).getByRole('row', { name: /engineering\s*2/i })).toBeInTheDocument();
    expect(within(chart).getByRole('row', { name: /finance\s*1/i })).toBeInTheDocument();
  });

  it('a read that FAILED draws no chart', async () => {
    mockCatalogo.mockReturnValue({ data: undefined, loading: false, error: true, isSuccess: false });
    render(<SkillsOverviewPage />);

    await screen.findByRole('status', { name: /skill registry/i });
    // B-152/B-189 — esta asserção olhava a TABELA e não conseguia falhar. `CategoryBars` renderiza
    // um `<p>` (não uma tabela) quando não há barras, e uma leitura que falhou produz zero barras:
    // o papel `table` está ausente no mundo que passa E no que falha. Apagar o gate de
    // settled-success deixava tudo verde — foi assim, por execução, que se provou o defeito.
    //
    // O `<h2>` fica FORA do `CategoryBars` e DENTRO do gate, então ele existe exatamente quando o
    // bloco existe. É isso que torna a ausência dele uma afirmação com conteúdo.
    expect(screen.queryByRole('heading', { name: /by category/i })).toBeNull();
  });
});

