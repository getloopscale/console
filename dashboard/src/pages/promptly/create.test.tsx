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

  // FU-2b — os dois casos de RECUSA continuam fora, e a investigação chegou à CAUSA.
  //
  // Não é do vitest nem do react-query. É de COMO esta página escreve: `create.tsx` chama o
  // serviço com `async/await` cru dentro de um handler de clique, e é a **única** tela do módulo
  // que faz isso. A rejeição é capturada pelo `catch`, mas a atualização de estado que a segue
  // acontece fora do `act()` do React, e o vitest reporta a rejeição como não tratada.
  //
  // A PROVA de que a causa é essa: `pages/promptly/detail.test.tsx::promotion_5xx_does_not_leak_
  // the_upstream_body` testa exatamente a mesma forma de recusa (`ApiError` + `mockRejectedValue`)
  // e PASSA — porque `detail.tsx` escreve com `useMutation`, que é a convenção do repositório
  // para escritas e cuida do estado pendente/erro pela biblioteca.
  //
  // O CONSERTO, portanto, não é do teste: é alinhar `create.tsx` à convenção (`useMutation`).
  // Deixo registrado em vez de fazer agora porque é mudança de código de produção, e o ganho
  // (consistência + estado de erro pela biblioteca) merece revisão própria, não um remendo no
  // fim de uma sessão. Duas hipóteses caíram no caminho — `enabled:` e a biblioteca de query —
  // e ficam descartadas aqui para ninguém repeti-las.
  //
  // O comportamento EXISTE e está provado onde o harness coopera: `rollback.test.ts` cobre a
  // regra de recusa, e a aceitação do M12 VIU 'unbalanced or malformed braces' na tela, contra
  // o serviço real.

  it('create_form_blocks_submit_while_the_name_is_invalid', async () => {
    render(<PromptlyCreatePage />);

    await userEvent.type(await screen.findByLabelText('Nome do prompt'), 'time/saudacao');
    expect(screen.getByRole('button', { name: /criar revisão/i })).toBeDisabled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
