import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

import { ApiError } from '@/lib/api';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockTest = vi.fn();
const mockCreate = vi.fn();
vi.mock('@/components/trust/trust-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/trust/trust-api')>();
  return {
    ...actual,
    testGuardrail: (...a: unknown[]) => mockTest(...a),
    createGuardrail: (...a: unknown[]) => mockCreate(...a),
  };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { TrustGuardrailNewPage } from './guardrail-new';

/**
 * M24 T5.1 — a tela cujo propósito é impedir que se grave sem testar (ADR D1).
 *
 * O teste que define o milestone é NEGATIVO: com o rascunho válido e sem dry-run, não existe
 * caminho acionável que crie a guardrail. Testar `disabled` não bastaria — o desenho recusado
 * pelo ADR é justamente o botão presente-porém-cinza.
 */

/** Monta a tela com um rascunho válido preenchido. */
async function openWithValidDraft() {
  const user = userEvent.setup();
  render(<TrustGuardrailNewPage />);
  await user.type(screen.getByLabelText('Nome'), 'termos-internos');
  await user.type(screen.getByLabelText('Termos a bloquear'), 'projeto-fenix');
  return user;
}

const saveButton = () => screen.queryByRole('button', { name: /salvar/i });

/** Roda o dry-run e devolve o controle já com o caminho de gravação disponível. */
async function runDryRun(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /testar/i }));
  return screen.findByRole('button', { name: /salvar/i });
}

/** A coreografia dos casos de erro tipado: testar → salvar → o serviço recusa. */
async function saveRejectedWith(error: ApiError) {
  mockTest.mockResolvedValueOnce({ valid: true, result: { action: 'block' } });
  mockCreate.mockRejectedValueOnce(error);
  const user = await openWithValidDraft();
  await user.click(await runDryRun(user));
}

describe('TrustGuardrailNewPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('NÃO oferece caminho para salvar antes do dry-run', async () => {
    await openWithValidDraft();

    // Nenhum elemento acionável de gravação existe — nem desabilitado.
    expect(saveButton()).not.toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('oferece salvar depois do dry-run, e grava a spec testada', async () => {
    mockTest.mockResolvedValueOnce({ valid: true, result: { action: 'block' } });
    mockCreate.mockResolvedValueOnce({ id: 'val-9' });
    const user = await openWithValidDraft();

    await user.click(await runDryRun(user));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const tested = (mockTest.mock.calls[0][0] as { spec: unknown }).spec;
    const created = (mockCreate.mock.calls[0][0] as { spec: unknown }).spec;
    expect(created).toEqual(tested);
  });

  it('mostra o veredito no futuro do pretérito — nada mudou ainda', async () => {
    mockTest.mockResolvedValueOnce({ valid: true, result: { action: 'block' } });
    const user = await openWithValidDraft();
    await runDryRun(user);

    expect(await screen.findByText(/seria bloqueada/i)).toBeInTheDocument();
  });

  it('alterar a regra depois do teste retira de novo o caminho de salvar', async () => {
    mockTest.mockResolvedValueOnce({ valid: true, result: { action: 'block' } });
    const user = await openWithValidDraft();
    await runDryRun(user);

    // Um termo a mais = outra regra. O veredito anterior não fala dela.
    await user.type(screen.getByLabelText('Termos a bloquear'), '\noutro-termo');

    expect(saveButton()).not.toBeInTheDocument();
    expect(await screen.findByText(/regra mudou depois do teste/i)).toBeInTheDocument();
  });

  it('reescrever um campo com o MESMO valor não invalida o veredito', async () => {
    // O par do teste anterior. Sem ele, "invalidar" poderia ser implementado por contagem de
    // eventos de edição — e o operador seria obrigado a re-testar sem ter mudado nada.
    mockTest.mockResolvedValueOnce({ valid: true, result: { action: 'block' } });
    const user = await openWithValidDraft();
    await runDryRun(user);

    const name = screen.getByLabelText('Nome');
    await user.clear(name);
    await user.type(name, 'termos-internos'); // idêntico ao anterior

    expect(await screen.findByRole('button', { name: /salvar/i })).toBeInTheDocument();
  });

  it('mostra a MENSAGEM DO SERVIÇO num 422 INVALID_SPEC', async () => {
    await saveRejectedWith(new ApiError(422, { code: 'INVALID_SPEC', message: 'terms must not be empty' }));

    expect(await screen.findByText('terms must not be empty')).toBeInTheDocument();
  });

  it('mostra a mensagem do serviço num 422 VALIDATOR_NAME_RESERVED', async () => {
    await saveRejectedWith(
      new ApiError(422, { code: 'VALIDATOR_NAME_RESERVED', message: 'name "pii" is reserved' }),
    );

    expect(await screen.findByText('name "pii" is reserved')).toBeInTheDocument();
    expect(await screen.findByText(/pertence à plataforma/i)).toBeInTheDocument();
  });

  it('mostra a mensagem do serviço num 409 CONFLICT', async () => {
    await saveRejectedWith(
      new ApiError(409, { code: 'CONFLICT', message: 'a validator with this name already exists' }),
    );

    expect(await screen.findByText('a validator with this name already exists')).toBeInTheDocument();
  });

  it('falha no dry-run não abre caminho para salvar', async () => {
    mockTest.mockRejectedValueOnce(new ApiError(500));
    const user = await openWithValidDraft();

    await user.click(screen.getByRole('button', { name: /testar/i }));

    expect(await screen.findByText(/não pôde ser executado/i)).toBeInTheDocument();
    expect(saveButton()).not.toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
