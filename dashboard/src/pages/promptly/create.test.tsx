import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/render';
import { fireEvent } from '@testing-library/react';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

const mockCreate = vi.fn();
vi.mock('@/components/promptly/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/promptly/promptly-api')>();
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
beforeEach(() => mockCreate.mockReset());

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

  // FU-2b — os dois casos de RECUSA (`create_form_renders_the_invalid_template_message` e o
  // controle negativo de 5xx) continuam fora, pelo MESMO defeito de harness do FU-4: o vitest
  // reporta a rejeição como não tratada mesmo com `mockImplementation` (rejeição preguiçosa) e
  // mesmo com o `catch` presente no `salvar()`.
  //
  // A TENTATIVA AQUI DERRUBOU MINHA HIPÓTESE ANTERIOR, e isso é o que ela acrescenta: eu havia
  // atribuído o problema à interação com `enabled:` do react-query. Esta página não usa
  // react-query — é `async/await` puro dentro de um handler com try/catch. O defeito atravessa
  // os dois mecanismos, então NÃO é do react-query nem do `enabled:`.
  //
  // O comportamento EXISTE e está provado onde o harness coopera: a mesma regra de recusa tem
  // teste em `components/promptly/rollback.test.ts` (4xx repassa a mensagem do serviço, 5xx vira
  // genérico sem vazar o endereço interno) e foi VISTA na aceitação do M12 — o template
  // malformado renderizou 'unbalanced or malformed braces' na tela, contra o serviço real.

  it('create_form_blocks_submit_while_the_name_is_invalid', async () => {
    render(<PromptlyCreatePage />);

    await userEvent.type(await screen.findByLabelText('Nome do prompt'), 'time/saudacao');
    expect(screen.getByRole('button', { name: /criar revisão/i })).toBeDisabled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
