import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

import { ApiError } from '@/lib/http/api';

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

  describe('quando o erro do campo aparece', () => {
    /**
     * O formulário abre vazio — que é o estado inicial legítimo, não um engano do operador.
     * Acusar "Dê um nome à guardrail" antes de ele tocar em qualquer campo transforma a tela
     * de partida numa tela de erro, e ensina a ignorar o vermelho justamente onde ele vai
     * importar. O erro pertence ao campo VISITADO e deixado inválido.
     */
    it('não acusa campo nenhum ao abrir', () => {
      render(<TrustGuardrailNewPage />);

      expect(screen.queryByText('Dê um nome à guardrail.')).not.toBeInTheDocument();
      expect(screen.queryByText('Adicione ao menos um termo a bloquear.')).not.toBeInTheDocument();
    });

    /** Monta a tela e visita o campo `Nome`, saindo dele sem preencher. */
    async function visitNameAndLeaveItEmpty() {
      const user = userEvent.setup();
      render(<TrustGuardrailNewPage />);
      await user.click(screen.getByLabelText('Nome'));
      await user.tab();
      return user;
    }

    it('acusa o campo depois que o operador o visita e o deixa inválido', async () => {
      await visitNameAndLeaveItEmpty();

      expect(await screen.findByText('Dê um nome à guardrail.')).toBeInTheDocument();
      // O campo que ele ainda não visitou continua calado.
      expect(screen.queryByText('Adicione ao menos um termo a bloquear.')).not.toBeInTheDocument();
    });

    it('para de acusar assim que o campo fica válido', async () => {
      const user = await visitNameAndLeaveItEmpty();
      expect(await screen.findByText('Dê um nome à guardrail.')).toBeInTheDocument();

      await user.type(screen.getByLabelText('Nome'), 'termos-internos');

      expect(screen.queryByText('Dê um nome à guardrail.')).not.toBeInTheDocument();
    });
  });

  describe('a tela tem saida e diz o que falta', () => {
    it('oferece volta ao catalogo — quem abriu por engano nao fica preso', () => {
      // O item "Trust" do menu leva ao OVERVIEW, nao de volta ao catalogo; sem esta saida a
      // unica escapatoria era o botao do navegador.
      render(<TrustGuardrailNewPage />);

      const back = screen.getByRole('link', { name: /voltar para as guardrails/i });
      expect(back).toHaveAttribute('href', '/trust/guardrails');
    });

    it('explica por que Testar esta desabilitado num rascunho vazio', () => {
      // Os erros por campo so aparecem depois da visita — correto —, mas isso deixava a tela
      // recem-aberta com um botao cinza e nenhuma pista. A frase descreve o proximo passo.
      render(<TrustGuardrailNewPage />);

      expect(screen.getByRole('button', { name: /testar/i })).toBeDisabled();
      expect(screen.getByText(/nome e ao menos um termo/i)).toBeInTheDocument();
    });

    it('some com a pista quando o rascunho fica testavel', async () => {
      const user = userEvent.setup();
      render(<TrustGuardrailNewPage />);

      await user.type(screen.getByLabelText('Nome'), 'regra-x');
      await user.type(screen.getByLabelText('Termos a bloquear'), 'segredo');

      expect(screen.queryByText(/nome e ao menos um termo/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /testar/i })).toBeEnabled();
    });
  });
});
