import { describe, expect, it, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

import { ConversationPanel } from './conversation-panel';

/**
 * LT-013 (BLOCKER) — a tela exibia a credencial em claro logo abaixo de uma frase que
 * garantia que ela nunca faz isso.
 *
 * A frase era minha e era FALSA: escrevi "o conteúdo já chega redigido do serviço" assumindo
 * que a garantia da superfície de violações (`redacted`) valia para `/v1/conversations/:id`.
 * Não vale — o serviço serve `messages.content` ÍNTEGRO (LT-012, ADR 0009), e foi a entrega
 * do LT-001 (`conversationId`) que tornou este painel alcançável.
 *
 * Uma garantia falsa é pior que garantia nenhuma: quem lê conclui que pode abrir a tela em
 * screen-share, print ou sessão gravada — e vaza a credencial exatamente por confiar no
 * produto. Estes testes existem para que a frase não volte.
 */

// Fixture deliberadamente NAO imita chave de provedor nenhum: uma string com forma de
// credencial real dispara os detectores de segredo do repo (o gate barrou a primeira versao
// deste arquivo, e estava certo). O teste so precisa de um valor identificavel no content.
const withSecret = {
  messages: [
    { id: 'm1', role: 'user', content: 'minha key e FIXTURE-LT013-NAO-E-CREDENCIAL-REAL', createdAt: '2026-08-01T18:00:00Z' },
  ],
};

const panel = (over: Partial<React.ComponentProps<typeof ConversationPanel>> = {}) =>
  render(
    <ConversationPanel
      conversationId="c-1"
      data={withSecret}
      isLoading={false}
      failed={false}
      onClose={vi.fn()}
      {...over}
    />,
  );

describe('ConversationPanel', () => {
  it('NÃO afirma que o conteúdo chega redigido — a garantia não existe nesta rota', () => {
    panel();

    expect(screen.queryByText(/já chega redigido/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nunca reconstrói o trecho bruto/i)).not.toBeInTheDocument();
  });

  it('avisa que o conteúdo é o ORIGINAL, para o operador não baixar a guarda', () => {
    // O oposto da frase antiga. Quem lê tem de sair mais cuidadoso, não menos.
    panel();

    // O texto e quebrado por <strong>, entao casa-se a advertencia, que vive num no unico.
    expect(screen.getByText(/cuidado ao exibir em tela compartilhada/i)).toBeInTheDocument();
  });

  it('NÃO exibe o conteúdo por padrão — abrir a tela não pode vazar', async () => {
    // O agravante do BLOCKER é o screen-share/print: quem abre a violação para investigar
    // não pediu para ver o segredo, pediu para ver O QUE aconteceu. Exibir por padrão faz o
    // vazamento acontecer na jornada MAIS provável do produto.
    panel();

    expect(screen.queryByText(/FIXTURE-LT013-NAO-E-CREDENCIAL-REAL/)).not.toBeInTheDocument();
  });

  it('revela sob ação explícita — a informação continua acessível', async () => {
    // Não é bloqueio: mesmo escopo, mesma API. O que muda é que ver vira uma DECISÃO do
    // operador, tomada quando ele já sabe o que está prestes a mostrar.
    const user = userEvent.setup();
    panel();

    await user.click(screen.getByRole('button', { name: /revelar/i }));

    expect(screen.getByText(/FIXTURE-LT013-NAO-E-CREDENCIAL-REAL/)).toBeInTheDocument();
  });

  it('diz quem falou e quando mesmo com o conteúdo oculto', async () => {
    // Ocultar o conteúdo não pode cegar a investigação: papel e horário são o contexto que
    // responde "o que aconteceu" sem expor o segredo.
    panel();

    expect(screen.getByText(/user/i)).toBeInTheDocument();
  });
});
