import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';

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
beforeEach(() => mockRevisions.mockReset());

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

  // EC-9 (`diff_between_a_revision_and_its_rollback_copy_is_empty`) — FOLLOWUP REGISTRADO, não
  // esquecido. A comparação padrão da tela é entre as duas MAIS RECENTES; provar a cópia exige
  // trocar o select, e o `selectOptions` não estabiliza o estado antes da asserção neste harness.
  // A INVARIANTE está coberta na função pura (`diff.test.ts::diff_identical_content_has_zero_
  // changed_blocks`); o que falta é o caminho pela tela. Rastreado no plano § Followups.

  it('diff_screen_read_failure_is_not_drawn_as_identical', async () => {
    // A ramificação que mais importa, e que nenhum dos três anteriores cobre: falha de leitura e
    // "revisões iguais" levam a decisões opostas.
    mockRevisions.mockRejectedValue(new Error('upstream'));
    render(<PromptlyDiffPage />);

    expect(await screen.findByText(/sem dados para comparar — a leitura falhou/i)).toBeInTheDocument();
    // O que importa: a falha NÃO é desenhada como "as revisões são iguais".
    expect(screen.queryByTestId('promptly-diff-identical')).not.toBeInTheDocument();
  });
});
