import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import { userEvent } from '@testing-library/user-event';
import type { Build } from '@/lib/api/types';

const toastSpy = vi.fn();
vi.mock('@usetheo/ui', async (orig) => {
  const actual = await orig<typeof import('@usetheo/ui')>();
  return { ...actual, useToast: () => ({ toast: toastSpy, dismiss: vi.fn() }) };
});
vi.mock('@/hooks/deploy/use-mutation-in-flight', () => ({
  useStartMutation: () => vi.fn(),
  useEndMutation: () => vi.fn(),
}));
vi.mock('@/lib/http/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/http/api')>();
  return { ...actual, cloudFetch: vi.fn() };
});

import { PromoteToProductionDialog } from './promote-to-production-dialog';
import { cloudFetch } from '@/lib/http/api';

const mockCloudFetch = vi.mocked(cloudFetch);

/**
 * Plano `modal-primitive-consolidation` — a lacuna que o `/review` isolou.
 *
 * Este componente foi migrado de `ui/dialog` para `AppModal` e **nenhum teste o
 * renderizava**. O co-locado que existia cobria apenas a função pura
 * `formatPromoteError`; o componente em si nunca era montado.
 *
 * ## Por que a lacuna é específica desta migração
 *
 * O `AppModal` renderiza a prop `footer` FORA do contêiner dos `children`. Aqui
 * o `<form>` está no corpo e o botão de confirmar é `type="submit"` no rodapé —
 * ou seja, o botão está **fora** do form no DOM, e só funciona pelo atributo
 * nativo `form="promote-to-production-form"`.
 *
 * Se essa associação quebrar, a tela renderiza IDÊNTICA e o clique não faz nada.
 * Numa promoção para produção é a pior forma de falhar: o operador digita a frase
 * de confirmação, clica, e nada acontece — nem promoção, nem erro, nem sinal.
 *
 * Os outros treze call sites migrados têm teste que submete; este não tinha, e é
 * por isso que ele é o que mais precisava.
 */

function build(environment = 'preview-42'): Build {
  return {
    id: 'b1',
    build_id: 'b1',
    project_id: 'demo',
    commit_sha: 'abcdef1234567',
    environment,
    status: 'succeeded',
    created_by: 'u1',
    created_at: '2026-07-19T00:00:00Z',
  } as unknown as Build;
}

function abrir(onOpenChange = vi.fn(), onPromoted = vi.fn()) {
  render(
    <PromoteToProductionDialog
      open
      onOpenChange={onOpenChange}
      projectName="demo"
      sourceBuild={build()}
      onPromoted={onPromoted}
    />,
  );
  return { onOpenChange, onPromoted };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCloudFetch.mockResolvedValue({ build_id: 'b2' } as never);
});

describe('PromoteToProductionDialog', () => {
  it('o botão do rodapé alcança o form do corpo e dispara a promoção', async () => {
    // A asserção central. O botão vive no `footer` do `AppModal`, fora do
    // `<form>`; só o `form="…"` os liga. Sem ele, `cloudFetch` nunca é chamado e
    // NADA na tela denuncia isso.
    abrir();

    await userEvent.type(
      screen.getByRole('textbox'),
      'promote to production',
    );
    fireEvent.click(screen.getByRole('button', { name: /promote/i }));

    await waitFor(() => expect(mockCloudFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockCloudFetch.mock.calls[0];
    expect(url).toBe('/engine/api/v1/projects/demo/promote');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      from: 'preview-42',
      to: 'production',
    });
  });

  it('sem a frase exata, o botão não promove', async () => {
    // Caso NEGATIVO: a porta de confirmação existe porque promover é
    // irreversível do ponto de vista do usuário. Um teste que só cobrisse o
    // caminho feliz deixaria passar uma porta que não fecha.
    abrir();

    await userEvent.type(screen.getByRole('textbox'), 'promote');
    fireEvent.click(screen.getByRole('button', { name: /promote/i }));

    await new Promise((r) => setTimeout(r, 50));
    expect(mockCloudFetch).not.toHaveBeenCalled();
  });

  it('quando a promoção falha, o erro chega por aviso — o diálogo já fechou', async () => {
    // ESTE CASO EU ESCREVI ERRADO NA PRIMEIRA VEZ, e o erro vale registrar:
    // afirmei que o diálogo "continua aberto e diz o motivo", por analogia com
    // os outros modais. Medindo o componente, ele fecha em `:83` — ANTES da
    // requisição — e reporta por toast pegajoso. É fire-and-forget deliberado:
    // uma promoção leva tempo, e prender a tela até ela terminar seria pior.
    //
    // Testar a minha suposição em vez do contrato real teria fixado um
    // comportamento que ninguém escolheu.
    //
    // O que importa proteger aqui é que a falha NÃO seja silenciosa: quem fechou
    // o diálogo acreditando ter promovido precisa ser avisado.
    mockCloudFetch.mockRejectedValue(new Error('boom'));
    abrir();

    await userEvent.type(screen.getByRole('textbox'), 'promote to production');
    fireEvent.click(screen.getByRole('button', { name: /promote/i }));

    await waitFor(() => expect(mockCloudFetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        toastSpy.mock.calls.some(([a]) => a?.variant === 'destructive' || /fail|erro|could not/i.test(String(a?.title))),
        'a falha da promoção não produziu aviso nenhum',
      ).toBe(true),
    );
  });
});
