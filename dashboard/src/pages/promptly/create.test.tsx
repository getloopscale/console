import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/render';
import { fireEvent } from '@testing-library/react';
import { ApiError } from '@/lib/http/api';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockCreate = vi.fn();
vi.mock('@/pages/promptly/components/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/promptly/components/promptly-api')>();
  return { ...actual, createRevision: (...a: unknown[]) => mockCreate(...a) };
});

import { PromptlyCreatePage } from './create';

/**
 * M12 FU-2 — a tela de autoria não tinha teste de componente: 185 linhas cobertas só por um e2e
 * contra mocks. O e2e prova a jornada; ele não prova o que a tela faz quando o serviço RECUSA,
 * porque o mock dele sempre responde 201.
 *
 * Os dois casos declarados no plano e nunca escritos estão aqui.
 */
beforeEach(() => {
  mockCreate.mockReset();
  // Hipótese 4: `detail.test.tsx` dá um valor RESOLVIDO por padrão e só o caso de erro troca por
  // rejeição. Sem esse padrão, o mock devolve `undefined` entre o reset e o `mockRejectedValue`.
  mockCreate.mockResolvedValue({ name: 'x', version: 1 });
});

describe('M12 — a tela de criar revisão', () => {
  it('create_form_shows_rendered_preview_before_save', async () => {
    render(<PromptlyCreatePage />);

    await userEvent.type(await screen.findByLabelText('Nome do prompt'), 'boas-vindas');
    // `userEvent.type` trata `{` como descritor de tecla — `{{nome}}` viraria `{nome}}`. Para
    // texto de template, `fireEvent.change` é o que entrega os caracteres literais.
    fireEvent.change(screen.getByLabelText('Texto do prompt'), { target: { value: 'Olá {{nome}}!' } });

    // O marcador PERMANECE enquanto o campo está vazio — apagá-lo esconderia o buraco que o
    // modelo receberia.
    expect(await screen.findByTestId('promptly-preview')).toHaveTextContent('{{nome}}');

    fireEvent.change(screen.getByLabelText('nome'), { target: { value: 'Paulo' } });
    expect(screen.getByTestId('promptly-preview')).toHaveTextContent('Olá Paulo!');

    // E o preview aconteceu ANTES de qualquer escrita: nenhuma chamada ao serviço até aqui.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('create_form_renders_the_invalid_template_message', async () => {
    mockCreate.mockRejectedValue(
      new ApiError(400, {
        error: 'invalid_template',
        message: 'unbalanced or malformed braces — only {{identifier}} is supported',
      }),
    );
    render(<PromptlyCreatePage />);
    await userEvent.type(await screen.findByLabelText('Nome do prompt'), 'malformado');
    fireEvent.change(screen.getByLabelText('Texto do prompt'), { target: { value: 'Olá {{ nome' } });
    // M17 — a descrição passou a ser obrigatória NESTA tela (ADR-3). Sem ela a validação
    // barra a submissão e este teste mediria a recusa nova em vez do que veio medir.
    fireEvent.change(screen.getByLabelText('Por que esta revisão existe'), {
      target: { value: 'motivo do teste' },
    });
    await userEvent.click(screen.getByRole('button', { name: /criar revisão/i }));
    expect(await screen.findByText(/unbalanced or malformed braces/i)).toBeInTheDocument();
  });

  it('create_form_5xx_does_not_leak_the_upstream_body', async () => {
    // O controle negativo, sem o qual o repasse acima vira matcher cego.
    mockCreate.mockRejectedValue(
      new ApiError(502, { message: 'dial tcp 10.0.0.4:8080: connect: refused' }),
    );
    render(<PromptlyCreatePage />);
    await userEvent.type(await screen.findByLabelText('Nome do prompt'), 'x');
    fireEvent.change(screen.getByLabelText('Texto do prompt'), { target: { value: 'y' } });
    // M17 — a descrição passou a ser obrigatória NESTA tela (ADR-3). Sem ela a validação
    // barra a submissão e este teste mediria a recusa nova em vez do que veio medir.
    fireEvent.change(screen.getByLabelText('Por que esta revisão existe'), {
      target: { value: 'motivo do teste' },
    });
    await userEvent.click(screen.getByRole('button', { name: /criar revisão/i }));
    expect(await screen.findByText(/não foi possível/i)).toBeInTheDocument();
    expect(screen.queryByText(/10\.0\.0\.4/)).not.toBeInTheDocument();
  });

  it('create_form_blocks_submit_while_the_name_is_invalid', async () => {
    render(<PromptlyCreatePage />);

    await userEvent.type(await screen.findByLabelText('Nome do prompt'), 'time/saudacao');
    expect(screen.getByRole('button', { name: /criar revisão/i })).toBeDisabled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
