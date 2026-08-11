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
  mockCatalogo.mockReturnValue({ data: { skills: [skill()] }, loading: false, error: false });
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
    });

    render(<SkillsOverviewPage />);

    const veredito = await screen.findByRole('status', { name: /skill registry/i });
    expect(within(veredito).getByText(/cannot be loaded/i)).toBeInTheDocument();
  });

  it('test_leitura_que_falhou_nao_vira_acervo_saudavel', async () => {
    // A distinção que este repositório defende em toda superfície de leitura. Um "tudo carregável"
    // sobre uma requisição que caiu tranquiliza sobre o que ninguém olhou.
    mockCatalogo.mockReturnValue({ data: undefined, loading: false, error: true });

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
