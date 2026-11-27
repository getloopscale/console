import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/render';
import { AGENT_SERVICES_GROUP_TITLE, MENUS } from '@/components/layout/app-sidebar-menus';

/**
 * O grid é a tela do B-112: a Overview passa a representar a PLATAFORMA.
 *
 * `capabilities.test.ts` já trava o contrato (registro ↔ descritores, e a máquina de estados que
 * nunca confunde "não consegui ler" com "não há"). Este arquivo trava o que o usuário vê — que é
 * onde aquele contrato ou vira produto, ou fica sendo um tipo bonito que ninguém renderizou.
 *
 * As três asserções são as do plano, e cada uma falha por um motivo diferente:
 *
 *   1. cobertura   — uma capacidade nova aparece sozinha, porque o grid deriva do registro
 *   2. honestidade — falha de leitura é dita, nunca renderizada como capacidade vazia
 *   3. utilidade   — o grid existe ANTES da primeira resposta (D4 de `platform-overview-plan.md`)
 */

const respostas = new Map<string, { data: unknown; loading: boolean; error: boolean }>();
const PADRAO = { data: null, loading: false, error: false, isSuccess: true };

vi.mock('@/hooks/use-api', () => ({
  useCloudApi: (path: string, options?: { enabled?: boolean }) => {
    // Espelha o contrato real do hook: desabilitado nunca carrega e nunca falha.
    if (options?.enabled === false) return PADRAO;
    return respostas.get(path) ?? PADRAO;
  },
}));

import { CapabilityGrid } from './capability-grid';
import { CAPACIDADES } from './capabilities';

/** As capacidades como o menu as declara — a mesma fonte que o grid consome. */
function capacidadesDoMenu(): { label: string; path: string }[] {
  const grupo = MENUS.main?.groups.find((g) => g.title === AGENT_SERVICES_GROUP_TITLE);
  if (!grupo) throw new Error('o grupo `Agent Services` sumiu do registro do menu');
  return grupo.items.map((i) => ({ label: i.label, path: i.path }));
}

function rotaDe(path: string): string {
  const c = CAPACIDADES.find((x) => x.path === path);
  if (!c) throw new Error(`sem descritor para ${path}`);
  if (!('rota' in c.sinal)) throw new Error(`${path} não tem rota (é em-breve)`);
  return c.sinal.rota;
}

beforeEach(() => {
  respostas.clear();
});

describe('o grid mostra a plataforma inteira', () => {
  it('test_o_grid_mostra_as_oito_capacidades', () => {
    // Quantificado sobre o REGISTRO, nunca sobre uma lista escrita à mão aqui: uma lista à mão
    // passaria verde no dia em que a nona capacidade fosse criada e esquecida — que é este mesmo
    // defeito, um nível acima.
    render(<CapabilityGrid />);

    const declaradas = capacidadesDoMenu();
    expect(declaradas.length).toBeGreaterThanOrEqual(8);

    const ausentes = declaradas
      .filter((d) => screen.queryByRole('heading', { name: d.label, level: 3 }) === null)
      .map((d) => `${d.label} (${d.path})`);

    expect(ausentes, 'capacidade declarada no menu e ausente do grid da Overview').toEqual([]);
  });

  it('cada capacidade disponível leva à sua página; a que não existe ainda não leva a lugar nenhum', () => {
    render(<CapabilityGrid />);

    const memory = screen.getByRole('link', { name: /Memory/ });
    expect(memory).toHaveAttribute('href', '/memory');

    // `Databases` é `comingSoon` no menu. Um link para uma tela que não existe é pior que não ter
    // o card: promete e falha no clique. Anunciar sem navegar é a decisão que o menu já tomou.
    expect(screen.queryByRole('link', { name: /Databases/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Databases', level: 3 })).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});

describe('o grid nunca confunde ignorância com ausência', () => {
  it('test_capacidade_que_falhou_diz_que_falhou', () => {
    // A asserção central da DoD. Uma capacidade que aparece como "not set up yet" por causa de uma
    // leitura que caiu convida o usuário a concluir que ela não serve para nada — e ele não volta
    // para conferir.
    respostas.set(rotaDe('/memory'), { data: null, loading: false, error: true });

    render(<CapabilityGrid />);

    const card = screen.getByTestId('capability-card-/memory');
    expect(within(card).getByText(/couldn't load/i)).toBeInTheDocument();
    expect(within(card).queryByText(/not set up yet/i)).not.toBeInTheDocument();
  });

  it('capacidade lida e genuinamente vazia diz que está vazia', () => {
    // A contraparte. Sem ela, o conserto acima poderia ter sido "tudo vira erro", e a tela
    // deixaria de distinguir quem nunca usou de quem não conseguiu ler.
    respostas.set(rotaDe('/memory'), {
      data: { total_memories: 0 },
      loading: false,
      error: false,
    });

    render(<CapabilityGrid />);

    const card = screen.getByTestId('capability-card-/memory');
    expect(within(card).getByText(/not set up yet/i)).toBeInTheDocument();
  });

  it('capacidade em uso mostra o número que o backend serviu, com a sua unidade', () => {
    respostas.set(rotaDe('/memory'), {
      data: { total_memories: 1234 },
      loading: false,
      error: false,
    });

    render(<CapabilityGrid />);

    const card = screen.getByTestId('capability-card-/memory');
    // Agrupado — o mesmo `formatNumber` que o resto da Overview usa. Um número de quatro dígitos
    // sem separador é onde a leitura em diagonal erra por uma ordem de grandeza.
    expect(within(card).getByText(/1,234/)).toBeInTheDocument();
    expect(within(card).getByText(/memories/i)).toBeInTheDocument();
  });

  it('sinal de presença responde ADOÇÃO e não inventa quantidade', () => {
    // Observability responde uma SÉRIE. Somar os baldes para produzir uma manchete atribuiria ao
    // número uma janela que esta tela não declara — o defeito que `tabs/producao.tsx` documenta.
    respostas.set(rotaDe('/observability'), {
      data: { traffic: [{ t: 1 }, { t: 2 }] },
      loading: false,
      error: false,
    });

    render(<CapabilityGrid />);

    const card = screen.getByTestId('capability-card-/observability');
    expect(within(card).getByText(/in use/i)).toBeInTheDocument();
    expect(within(card).queryByText(/\b2\b/)).not.toBeInTheDocument();
  });
});

describe('a tela é útil antes da rede', () => {
  it('test_a_tela_renderiza_antes_de_qualquer_resposta', () => {
    // Decisão D4 de `platform-overview-plan.md`. O problema que o item descreve — a plataforma não se anunciar — é resolvido pelo
    // GRID, não pelos números. Bloquear a página mais visitada em sete requisições trocaria um
    // defeito de descoberta por um de latência.
    for (const c of CAPACIDADES) {
      if ('rota' in c.sinal) respostas.set(c.sinal.rota, { data: null, loading: true, error: false });
    }

    render(<CapabilityGrid />);

    for (const d of capacidadesDoMenu()) {
      expect(
        screen.getByRole('heading', { name: d.label, level: 3 }),
        `${d.label} sumiu enquanto o seu sinal carregava`,
      ).toBeInTheDocument();
    }

    // E o card em carregamento não afirma nada sobre a capacidade.
    const card = screen.getByTestId('capability-card-/memory');
    expect(within(card).queryByText(/not set up yet/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });
});
