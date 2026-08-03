import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockCatalog = vi.fn();
vi.mock('@/components/promptly/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/promptly/promptly-api')>();
  return { ...actual, fetchCatalog: (...a: unknown[]) => mockCatalog(...a) };
});

import { PromptlyCatalogoPage } from './catalogo';

/**
 * M13 — o catálogo, agora com busca. E é a busca que cria o problema que este arquivo trava.
 *
 * Até aqui a tela distinguia DOIS estados que produzem telas parecidas e significam coisas opostas:
 * "leu e não há nada" (pode afirmar ausência) e "não conseguiu ler" (o vazio é ignorância). Filtrar
 * acrescenta um TERCEIRO — "há prompts, nenhum casa com o termo" — e ele não pode herdar a saída de
 * nenhum dos dois: oferecer "crie o primeiro prompt" a quem filtrou afirma que o workspace está
 * vazio quando ele não está, e o que falta é limpar o filtro.
 */

const CATALOGO = [
  { name: 'saudacao', latestVersion: 3, labels: [{ label: 'prod', version: 1 }], updatedAt: '2026-08-01T10:00:00Z' },
  { name: 'despedida', latestVersion: 1, labels: [], updatedAt: '2026-07-30T09:00:00Z' },
  { name: 'agentbuilder-base', latestVersion: 2, labels: [{ label: 'prod', version: 2 }], updatedAt: '2026-08-02T09:00:00Z' },
];

beforeEach(() => {
  mockCatalog.mockReset();
});

describe('PromptlyCatalogoPage', () => {
  it('lista os prompts do workspace pelo NOME', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText('saudacao')).toBeInTheDocument();
    expect(screen.getByText('agentbuilder-base')).toBeInTheDocument();
  });

  it('filtra por substring do nome', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    await userEvent.type(screen.getByRole('searchbox'), 'agent');

    expect(screen.getByText('agentbuilder-base')).toBeInTheDocument();
    expect(screen.queryByText('saudacao')).not.toBeInTheDocument();
  });

  // EC-7 — o extremo VÁLIDO da busca: vazia devolve tudo, não nada.
  it('busca vazia devolve todas as linhas', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    await userEvent.type(screen.getByRole('searchbox'), 'a');
    await userEvent.clear(screen.getByRole('searchbox'));

    expect(screen.getByText('saudacao')).toBeInTheDocument();
    expect(screen.getByText('despedida')).toBeInTheDocument();
  });

  // EC-7 — o primeiro INVÁLIDO logo após: caractere de regex não pode estourar. Trava o uso de
  // `includes` contra um refactor para `new RegExp(termo)`, que lançaria SyntaxError em input legítimo.
  it('busca com caractere de regex não quebra a tela', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    await userEvent.type(screen.getByRole('searchbox'), 'a(b');

    expect(screen.queryByText('saudacao')).not.toBeInTheDocument();
    expect(screen.getByText(/nenhum prompt casa/i)).toBeInTheDocument();
  });

  it('diz na tela que o filtro é sobre o que está carregado, não sobre o servidor', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);

    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    expect(screen.getByText(/carregad/i)).toBeInTheDocument();
  });

  // ---- os TRÊS estados vazios (MUST FIX EC-2) ----

  it('falha de leitura NÃO oferece criar — o vazio é ignorância, não ausência', async () => {
    mockCatalog.mockRejectedValue(new Error('502'));

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText(/não foi possível carregar/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /criar o primeiro/i })).not.toBeInTheDocument();
  });

  it('vazio de verdade oferece criar', async () => {
    mockCatalog.mockResolvedValue([]);

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByRole('link', { name: /criar o primeiro/i })).toBeInTheDocument();
  });

  it('filtro sem resultado NÃO diz que o workspace está vazio', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);
    render(<PromptlyCatalogoPage />);
    await screen.findByText('saudacao');

    await userEvent.type(screen.getByRole('searchbox'), 'zzz');

    // Nem afirma ausência, nem oferece criar: o que falta é limpar o filtro.
    expect(screen.queryByRole('link', { name: /criar o primeiro/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/nenhum prompt neste workspace/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /limpar/i })).toBeInTheDocument();
  });

  // ---- T4.1 — comparar a um clique ----

  it('a linha leva a comparar em um clique', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);

    render(<PromptlyCatalogoPage />);

    const link = await screen.findByRole('link', { name: /comparar revisões de saudacao/i });
    expect(link).toHaveAttribute('href', '/promptly/saudacao/diff');
  });

  it('prompt com uma única revisão não oferece comparar', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);

    render(<PromptlyCatalogoPage />);
    await screen.findByText('despedida');

    // `despedida` está em v1 — não há duas revisões para comparar.
    expect(screen.queryByRole('link', { name: /comparar revisões de despedida/i })).not.toBeInTheDocument();
  });

  // EC-10 — nomes não têm restrição de caractere (`name: z.string().min(1)`). Sem escape,
  // `a/b` vira `/promptly/a/b/diff`, que NÃO casa com a rota `/promptly/:name/diff`.
  it('o link de comparar escapa nome com barra', async () => {
    mockCatalog.mockResolvedValue([
      { name: 'time/saudacao', latestVersion: 2, labels: [], updatedAt: '2026-08-01T10:00:00Z' },
    ]);

    render(<PromptlyCatalogoPage />);

    const link = await screen.findByRole('link', { name: /comparar revisões de time\/saudacao/i });
    expect(link).toHaveAttribute('href', '/promptly/time%2Fsaudacao/diff');
  });
});

/**
 * Migrados de `pages/promptly.test.tsx` no M13, quando a lista saiu da raiz da capacidade.
 * O comportamento não mudou de dono — a tela é que mudou de endereço.
 */
describe('PromptlyCatalogoPage — herdado do M25', () => {
  it('diz para onde cada ambiente aponta, que é a pergunta que traz o operador aqui', async () => {
    mockCatalog.mockResolvedValue(CATALOGO);

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText('prod → v1')).toBeInTheDocument();
  });

  it('descreve como "nenhum" o prompt que não serve ambiente algum', async () => {
    // Estado normal do dado, distinto de "não sei": o prompt existe e nenhum label o aponta.
    mockCatalog.mockResolvedValue(CATALOGO);

    render(<PromptlyCatalogoPage />);

    expect(await screen.findByText('nenhum')).toBeInTheDocument();
  });

  it('pede um limite EXPLÍCITO ao servidor em vez de herdar o teto dele', async () => {
    mockCatalog.mockResolvedValue([]);

    render(<PromptlyCatalogoPage />);

    await screen.findByText(/Nenhum prompt neste workspace/i);
    expect(mockCatalog).toHaveBeenCalledWith(expect.any(Number));
    expect(mockCatalog.mock.calls[0][0]).toBeGreaterThan(0);
  });
});
