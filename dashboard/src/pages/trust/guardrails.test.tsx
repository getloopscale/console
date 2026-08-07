import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, within } from '@/test/render';

import { ApiError } from '@/lib/http/api';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockList = vi.fn();
const mockDelete = vi.fn();
vi.mock('@/components/trust/trust-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/trust/trust-api')>();
  return {
    ...actual,
    fetchValidators: (...a: unknown[]) => mockList(...a),
    deleteGuardrail: (...a: unknown[]) => mockDelete(...a),
  };
});

import { TrustGuardrailsPage } from './guardrails';

/**
 * M24 T4.2/T6.1 — o catálogo e a remoção.
 *
 * A cobertura vive aqui, na tela, e não num diálogo próprio: a coreografia destrutiva agora é o
 * `ConfirmDialog` canônico do dashboard (o mesmo de `domains` e `previews`), então o que precisa
 * de teste é o COMPORTAMENTO da tela ao usá-lo — não uma reimplementação local que já não existe.
 */

const CATALOG = {
  catalogVersion: 1,
  validators: [
    { source: 'platform', name: 'credential-mask', kind: 'rule', directions: ['input', 'output'] },
    { source: 'tenant', id: 'val-7', name: 'termos-internos', kind: 'ban-list', directions: ['input'] },
  ],
};

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

/** Monta a tela e abre o diálogo de remoção da guardrail do tenant. */
async function openRemovalDialog() {
  const user = userEvent.setup();
  render(<TrustGuardrailsPage />);
  await screen.findByText('termos-internos');
  await user.click(within(rowOf('termos-internos')).getByRole('button', { name: /remover/i }));
  return user;
}

describe('TrustGuardrailsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(CATALOG);
  });

  it('mostra plataforma e tenant juntos, distinguidos por TEXTO', async () => {
    render(<TrustGuardrailsPage />);

    expect(await screen.findByText('credential-mask')).toBeInTheDocument();
    expect(screen.getByText('termos-internos')).toBeInTheDocument();
    // Não só cor: a origem é legível.
    expect(screen.getByText('Plataforma')).toBeInTheDocument();
    expect(screen.getByText('Deste workspace')).toBeInTheDocument();
  });

  it('NÃO oferece remoção na linha de plataforma', async () => {
    render(<TrustGuardrailsPage />);
    const row = await screen.findByRole('row', { name: /credential-mask/ });

    // Ausência, não `disabled` — ADR D2. Um botão cinza convidaria a procurar como habilitá-lo.
    expect(within(row).queryByRole('button', { name: /remover/i })).not.toBeInTheDocument();
  });

  it('oferece remoção apenas na linha do tenant', async () => {
    render(<TrustGuardrailsPage />);
    await screen.findByText('termos-internos');

    expect(within(rowOf('termos-internos')).getByRole('button', { name: /remover/i })).toBeInTheDocument();
  });

  it('exige a frase digitada antes de remover', async () => {
    const user = await openRemovalDialog();

    const confirm = await screen.findByRole('button', { name: /remover guardrail/i });
    expect(confirm).toBeDisabled();
    expect(mockDelete).not.toHaveBeenCalled();

    await user.type(await screen.findByRole('textbox'), 'termos-internos');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(mockDelete).toHaveBeenCalledWith('val-7');
  });

  it('declara que uma proteção deixa de valer — não que "o item some da lista"', async () => {
    await openRemovalDialog();

    expect(await screen.findByText(/deixam de ser bloqueados/i)).toBeInTheDocument();
    expect(screen.getByText(/não pode ser desfeita/i)).toBeInTheDocument();
  });

  it('falha na remoção mantém a linha e mostra a mensagem do serviço', async () => {
    mockDelete.mockRejectedValueOnce(
      new ApiError(409, { code: 'CONFLICT', message: 'validator is referenced by an active policy' }),
    );
    const user = await openRemovalDialog();
    await user.type(await screen.findByRole('textbox'), 'termos-internos');
    await user.click(await screen.findByRole('button', { name: /remover guardrail/i }));

    expect(await screen.findByText('validator is referenced by an active policy')).toBeInTheDocument();
    // Sumir otimisticamente diria que a proteção acabou quando ela continua valendo.
    expect(screen.getByText('termos-internos')).toBeInTheDocument();
  });

  it('falha de leitura não vira "nenhuma guardrail"', async () => {
    mockList.mockRejectedValueOnce(new ApiError(502));
    render(<TrustGuardrailsPage />);

    expect(await screen.findByText(/não foi possível carregar o catálogo/i)).toBeInTheDocument();
    expect(screen.getByText(/NÃO significa que não há guardrails ativas/i)).toBeInTheDocument();
  });

  it('catálogo vazio convida a criar a primeira', async () => {
    mockList.mockResolvedValue({ validators: [] });
    render(<TrustGuardrailsPage />);

    expect(await screen.findByText(/nenhuma guardrail ativa/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /criar a primeira guardrail/i })).toBeInTheDocument();
  });
});
