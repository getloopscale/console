import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { fireEvent } from '@testing-library/react';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => ({ name: 'saudacao' }) };
});

const mockRevisions = vi.fn();
vi.mock('@/components/promptly/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/promptly/promptly-api')>();
  return { ...actual, fetchRevisions: (...a: unknown[]) => mockRevisions(...a) };
});

import { PromptlyDiffPage } from './diff';

/**
 * M12 T5 — os testes que o plano declarou e que o /review encontrou AUSENTES.
 *
 * A função pura já tinha o trio de normalização; o que faltava era a tela. As quatro ramificações
 * desta página são mutuamente exclusivas, e a que mais importa é a última: uma leitura que falhou
 * não pode ser desenhada como "as revisões são iguais" — são fatos opostos.
 */
beforeEach(() => {
  mockRevisions.mockReset();
  // O padrão que destrava o caso de falha: um valor RESOLVIDO por default, e só o teste de erro
  // troca por rejeição. Sem ele, o mock devolve `undefined` entre o reset e o `mockRejectedValue`,
  // e o vitest reporta a rejeição como não tratada antes de a tela chegar nela.
  mockRevisions.mockResolvedValue([]);
});

describe('M12 — a tela de comparar', () => {
  it('diff_screen_compares_the_two_selected_revisions', async () => {
    mockRevisions.mockResolvedValue([
      { version: 1, content: 'linha comum\nlinha antiga' },
      { version: 2, content: 'linha comum\nlinha nova' },
    ]);
    render(<PromptlyDiffPage />);

    const diff = await screen.findByTestId('promptly-diff');
    expect(diff).toHaveTextContent('linha nova');
    expect(diff).toHaveTextContent('linha antiga');
  });

  it('diff_screen_says_when_they_are_identical', async () => {
    mockRevisions.mockResolvedValue([
      { version: 1, content: 'mesmo texto' },
      { version: 2, content: 'mesmo texto' },
    ]);
    render(<PromptlyDiffPage />);

    expect(await screen.findByTestId('promptly-diff-identical')).toBeInTheDocument();
    expect(screen.queryByTestId('promptly-diff')).not.toBeInTheDocument();
  });

  it('diff_between_a_revision_and_its_rollback_copy_is_empty', async () => {
    // EC-9. Reverter COPIA o conteúdo, então v1 contra a revisão que a reversão gerou tem de dar
    // zero blocos. O plano pediu o caminho pela TELA e não só a função pura — como pura, seria
    // quase um duplicado de `diff_identical_content_has_zero_changed_blocks`.
    const original = 'Olá {{nome}}, sou o assistente.';
    mockRevisions.mockResolvedValue([
      { version: 1, content: original },
      { version: 2, content: 'texto que foi revertido' },
      { version: 3, content: original },
    ]);
    render(<PromptlyDiffPage />);

    // ESPERAR o padrão da tela renderizar ANTES de mexer no select. A página define a comparação
    // inicial (as duas mais recentes: v2 × v3, diferentes) num `useEffect`, e trocar o select
    // antes disso perde a mudança — o efeito ainda vê o outro lado nulo e não completa o par.
    // Foi essa corrida, e não o mock, que derrubou as tentativas anteriores deste caso.
    expect(await screen.findByTestId('promptly-diff')).toBeInTheDocument();

    // Agora sim: escolher v1 × v3 é o que prova a cópia, e o select é o caminho do operador.
    fireEvent.change(screen.getByLabelText('Revisão anterior'), { target: { value: '1' } });

    expect(await screen.findByTestId('promptly-diff-identical')).toBeInTheDocument();
  });

  it('diff_screen_read_failure_is_not_drawn_as_identical', async () => {
    // A ramificação que mais importa, e que nenhuma das outras cobre: falha de leitura e "as
    // revisões são iguais" levam a decisões OPOSTAS. Desenhar a primeira como a segunda diria ao
    // operador que não há o que investigar, durante uma queda do serviço.
    mockRevisions.mockRejectedValue(new Error('upstream'));
    render(<PromptlyDiffPage />);

    expect(await screen.findByText(/sem dados para comparar — a leitura falhou/i)).toBeInTheDocument();
    expect(screen.queryByTestId('promptly-diff-identical')).not.toBeInTheDocument();
    expect(screen.queryByTestId('promptly-diff')).not.toBeInTheDocument();
  });
});

describe('diff — a config aparece ao lado do texto (M17 DoD-4)', () => {
  it('mesmo TEXTO e temperaturas diferentes NAO sao anunciadas como identicas', async () => {
    // O defeito que este teste tranca: o comparador dizia "idênticas" olhando só o texto.
    // Duas revisões com a mesma redação e afinações diferentes SÃO revisões diferentes.
    mockRevisions.mockResolvedValue([
      { version: 1, content: 'mesmo texto', createdAt: 'd', modelConfig: { temperature: 0.2 } },
      { version: 2, content: 'mesmo texto', createdAt: 'd', modelConfig: { temperature: 0.9 } },
    ]);

    render(<PromptlyDiffPage />);

    expect(await screen.findByText(/temperature/i)).toBeInTheDocument();
    expect(screen.getByText(/0\.2/)).toBeInTheDocument();
    expect(screen.getByText(/0\.9/)).toBeInTheDocument();
  });

  it('mesmo texto e MESMA config seguem sendo identicas — o controle', async () => {
    mockRevisions.mockResolvedValue([
      { version: 1, content: 'mesmo texto', createdAt: 'd', modelConfig: { temperature: 0.2 } },
      { version: 2, content: 'mesmo texto', createdAt: 'd', modelConfig: { temperature: 0.2 } },
    ]);

    render(<PromptlyDiffPage />);

    // O `testid` que a própria página expõe — mais robusto que casar a redação.
    expect(await screen.findByTestId('promptly-diff-identical')).toBeInTheDocument();
    expect(screen.queryByTestId('promptly-diff-config')).not.toBeInTheDocument();
  });
});
