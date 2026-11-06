import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';
import { ListTruncationNotice } from './list-truncation-notice';

/**
 * B-114 — quando a lista trunca, a tela diz.
 *
 * ## Por que o campo do servidor não basta
 *
 * O servidor passou a responder `has_more` nas seis listas que aplicam um teto defensivo
 * (`internal/routes/list_truncation.go`). Um campo que nenhuma tela lê fecha metade do defeito: o
 * usuário continua vendo uma lista que parece completa e não é.
 *
 * É a mesma disciplina que a tríade de wiring deste repositório exige — o pilar (a) é o caller, e
 * um contrato sem consumidor é um contrato que ninguém exercita.
 *
 * ## Por que um componente, e não uma frase em cada tela
 *
 * Seis listas truncam. Seis frases divergem — e a que diverge primeiro é a que o usuário lê
 * primeiro. Uma frase só, num lugar só, é o que mantém a explicação igual em todas.
 */

describe('o aviso de truncamento', () => {
  it('não aparece quando a lista está inteira', () => {
    // A contraparte, e ela é a que importa mais: um aviso que sempre aparece é um aviso que
    // ninguém lê, e ele passaria a esconder o caso real.
    // Afirmado pelo papel, e não por `container` vazio: o helper de render monta os providers
    // (Toaster, tema), então o container nunca está vazio e a asserção passaria a medir o wrapper.
    render(<ListTruncationNotice hasMore={false} total={12} substantivo="views" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('diz quantas está mostrando, e que há mais', () => {
    render(<ListTruncationNotice hasMore={true} total={100} substantivo="views" />);

    const texto = screen.getByRole('status').textContent ?? '';
    // O número importa: "há mais" sozinho não diz ao usuário onde ele está. Ver 100 e saber que
    // são 100 de mais-que-100 é acionável; "alguns resultados omitidos" não é.
    expect(texto).toMatch(/100/);
    expect(texto).toMatch(/views/);
  });

  it('é anunciado por leitor de tela sem roubar o foco', () => {
    // `role="status"` (aria-live polite) e não `alert`: a lista carregou com sucesso. Interromper
    // a leitura para dizer "mostrando os primeiros 100" trata uma informação de contexto como
    // urgência.
    render(<ListTruncationNotice hasMore={true} total={100} substantivo="keys" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
