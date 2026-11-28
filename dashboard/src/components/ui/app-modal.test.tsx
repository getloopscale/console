// app-modal.test.tsx
//
// M14 T1 — AppModal is the system-wide standardized modal primitive. It wraps
// @getloopscale/ui's Dialog (Radix) and adds a size token + a title/description/body/
// footer contract. The upstream Dialog owns focus-trap / ESC / overlay / a11y —
// these tests pin THIS wrapper's contract:
//   - renders title as the dialog's accessible name + body when open
//   - renders nothing when open=false
//   - size token maps to the right max-width class on the content
//   - footer content renders
//   - description renders when provided
//   - ESC routes to onClose (delegated to Radix onOpenChange(false))

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { AppModal } from './app-modal';

describe('AppModal — standardized modal primitive', () => {
  it('renders the title as the dialog accessible name + body when open', () => {
    render(
      <AppModal open onClose={() => {}} title="New folder">
        <p>body content here</p>
      </AppModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Radix labels the dialog via Dialog.Title → accessible name.
    expect(dialog).toHaveAccessibleName(/new folder/i);
    expect(screen.getByText(/body content here/i)).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    render(
      <AppModal open={false} onClose={() => {}} title="Hidden modal">
        <p>hidden body</p>
      </AppModal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden body/i)).not.toBeInTheDocument();
  });

  it('maps size="xl" to the max-w-4xl content width', () => {
    render(
      <AppModal open onClose={() => {}} title="Wide" size="xl">
        <p>wide body</p>
      </AppModal>,
    );
    expect(screen.getByRole('dialog').className).toContain('max-w-4xl');
  });

  it('defaults to the md width when size is omitted', () => {
    render(
      <AppModal open onClose={() => {}} title="Default">
        <p>default body</p>
      </AppModal>,
    );
    expect(screen.getByRole('dialog').className).toContain('max-w-lg');
  });

  it('renders the footer slot', () => {
    render(
      <AppModal open onClose={() => {}} title="With footer" footer={<button>Create folder</button>}>
        <p>body</p>
      </AppModal>,
    );
    expect(screen.getByRole('button', { name: /create folder/i })).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <AppModal open onClose={() => {}} title="Titled" description="a helpful description">
        <p>body</p>
      </AppModal>,
    );
    expect(screen.getByText(/a helpful description/i)).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed (delegated to Dialog)', () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose} title="Closable">
        <p>body</p>
      </AppModal>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close (X) button is clicked (EC2)', () => {
    const onClose = vi.fn();
    render(
      // No footer → the only button inside the dialog is the built-in close (X).
      <AppModal open onClose={onClose} title="Closable">
        <p>body</p>
      </AppModal>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render the close (X) button when hideCloseButton is set', () => {
    render(
      <AppModal open onClose={() => {}} title="No X" hideCloseButton>
        <p>body</p>
      </AppModal>,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('AppModal — one layout for every modal', () => {
  it('lays the panel out as header, body and footer regions', () => {
    render(
      <AppModal open onClose={() => {}} title="Add secret" footer={<button type="button">Save</button>}>
        <p>fields</p>
      </AppModal>,
    );
    const dialog = screen.getByRole('dialog');
    const slots = [...dialog.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot'));
    expect(slots).toEqual(['modal-header', 'modal-body', 'modal-footer']);
    expect(dialog.querySelector('[data-slot="modal-body"]')).toHaveTextContent('fields');
    expect(dialog.querySelector('[data-slot="modal-footer"]')).toHaveTextContent('Save');
  });

  it('keeps the panel open while an action is in flight', () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose} title="Deleting" busy>
        <p>body</p>
      </AppModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(0);
  });

  it('marks a destructive panel so the header warns before the button does', () => {
    render(
      <AppModal open onClose={() => {}} title="Delete project?" intent="destructive">
        <p>body</p>
      </AppModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-intent', 'destructive');
    expect(dialog.querySelector('[data-slot="modal-icon"]')).toBeInTheDocument();
  });

  it('draws a caller icon in the header', () => {
    render(
      <AppModal open onClose={() => {}} title="Invite teammate" icon={<svg data-testid="invite-icon" />}>
        <p>body</p>
      </AppModal>,
    );
    expect(screen.getByRole('dialog').querySelector('[data-slot="modal-icon"]')).toContainElement(
      screen.getByTestId('invite-icon'),
    );
  });
});

describe('a descrição aceita conteúdo de bloco (B-104)', () => {
  /**
   * `RadixDialog.Description` renderiza `Primitive.p`, e treze call sites passam
   * `<div>`/`<p>` nessa prop — `settings/webhooks.tsx:260`, `lens/datasets.tsx:376` e outros.
   * O resultado é `<p><div>…</div></p>`: HTML inválido.
   *
   * ## O que este teste NÃO afirma, porque foi medido e é falso
   *
   * A primeira versão do B-104 dizia que o parser fecharia o `<p>` sozinho e que o leitor
   * de tela perderia a descrição. **Medido em navegador real** (`/settings/webhooks`, diálogo
   * de exclusão): o `aria-describedby` resolve, o texto está inteiro, e o `<div>` está DENTRO
   * do `<p>` tal como escrito — o React monta o DOM por API, não pelo parser HTML.
   *
   * ## O que ele afirma, então
   *
   * Que o elemento pode LEGALMENTE conter o que os call sites põem nele. A invalidez não
   * custa nada enquanto ninguém fizer o navegador parsear este HTML; no dia em que houver
   * render no servidor ou pré-render, o parser fecha o `<p>` e a estrutura muda de verdade —
   * inclusive o que o `aria-describedby` passa a envolver. Fechar agora é uma linha no
   * primitivo; descobrir depois é no meio de uma migração.
   */
  it('o elemento do `aria-describedby` não é um `<p>` e contém o texto inteiro', () => {
    render(
      <AppModal
        open
        onClose={() => {}}
        title="Excluir"
        description={
          <div className="space-y-2">
            <p>Primeira linha do aviso.</p>
            <p>Segunda linha do aviso.</p>
          </div>
        }
      >
        corpo
      </AppModal>,
    );

    const dialogo = screen.getByRole('dialog');
    const id = dialogo.getAttribute('aria-describedby');
    expect(id, 'o diálogo não declara `aria-describedby`').toBeTruthy();

    const alvo = document.getElementById(id!);
    expect(alvo, 'o `aria-describedby` aponta para um elemento que não existe').not.toBeNull();

    expect(
      alvo!.tagName,
      'a descrição é um `<p>`, e os call sites passam bloco: `<p><div>…</div></p>` é HTML inválido',
    ).not.toBe('P');

    // A contraparte positiva — sem ela, trocar o elemento por um vazio passaria.
    expect(alvo!.textContent).toContain('Primeira linha do aviso.');
    expect(alvo!.textContent).toContain('Segunda linha do aviso.');
  });
});
