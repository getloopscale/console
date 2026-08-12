import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const mockConfetti = vi.fn();
vi.mock('canvas-confetti', () => ({ default: (...a: unknown[]) => mockConfetti(...a) }));

const mockToast = vi.fn();
vi.mock('@usetheo/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@usetheo/ui');
  return { ...actual, useToast: () => ({ toast: mockToast }) };
});

const mockBuilds = vi.fn();
vi.mock('@/hooks/projects/use-deployments', () => ({
  useDeployments: () => ({ builds: mockBuilds() as unknown[] }),
}));

import { FirstDeployCelebration } from './first-deploy-celebration';

/**
 * B-030 — a celebração do primeiro deploy sai da gaveta.
 *
 * `useFirstDeployTrigger` foi escrito em 2026-06, com cuidado que se vê no
 * código — respeita `prefers-reduced-motion`, trava por `localStorage` para não
 * repetir entre abas, filtra builds históricos por `mountedAt` para não celebrar
 * um deploy de seis meses atrás, e emite telemetria. E nunca teve consumidor:
 * 52 dias no repositório alcançado apenas pelo próprio teste.
 *
 * O componente abaixo é o consumidor. Ele não tem marcação — existe só para dar
 * um lugar ao hook dentro da árvore de `project-detail.tsx`, que já busca os
 * builds e por isso não paga nenhum request a mais.
 *
 * ## O que estes testes protegem
 *
 * O filtro de build histórico. É a diferença entre um marco e um incômodo: sem
 * ele, abrir a página de um projeto antigo depois de limpar o `localStorage`
 * dispara confetti por um deploy de seis meses atrás, e a celebração passa a
 * significar nada.
 */

const ONTEM = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const AGORA_MAIS_UM_MINUTO = new Date(Date.now() + 60_000).toISOString();

describe('FirstDeployCelebration (B-030)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockBuilds.mockReturnValue([]);
  });

  it('um build que TERMINOU AGORA dispara a celebração', async () => {
    mockBuilds.mockReturnValue([
      { build_id: 'b-1', status: 'succeeded', finished_at: AGORA_MAIS_UM_MINUTO },
    ]);
    render(<FirstDeployCelebration projectName="meu-app" liveUrl="https://meu-app.dev" />);

    await waitFor(() => expect(mockConfetti).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('https://meu-app.dev') }),
    );
  });

  it('um build ANTIGO não dispara nada', async () => {
    mockBuilds.mockReturnValue([
      { build_id: 'b-velho', status: 'succeeded', finished_at: ONTEM },
    ]);
    render(<FirstDeployCelebration projectName="meu-app" />);

    // Esta é a asserção que separa um marco de um incômodo. Abrir a página de um
    // projeto antigo não é um primeiro deploy, e celebrar ali gasta o momento.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockConfetti).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('um build que FALHOU não dispara nada', async () => {
    mockBuilds.mockReturnValue([
      { build_id: 'b-2', status: 'failed', finished_at: AGORA_MAIS_UM_MINUTO },
    ]);
    render(<FirstDeployCelebration projectName="meu-app" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockConfetti).not.toHaveBeenCalled();
  });

  it('celebra UMA vez — remontar a página não repete', async () => {
    mockBuilds.mockReturnValue([
      { build_id: 'b-1', status: 'succeeded', finished_at: AGORA_MAIS_UM_MINUTO },
    ]);
    const primeira = render(<FirstDeployCelebration projectName="meu-app" />);
    await waitFor(() => expect(mockConfetti).toHaveBeenCalledTimes(1));
    primeira.unmount();

    render(<FirstDeployCelebration projectName="meu-app" />);
    await new Promise((r) => setTimeout(r, 20));
    // A trava vive no localStorage e não no componente: navegar para fora e
    // voltar, ou abrir noutra aba, não recomeça a festa.
    expect(mockConfetti).toHaveBeenCalledTimes(1);
  });

  it('sem nome de projeto não faz nada — a página monta antes de saber qual é', async () => {
    mockBuilds.mockReturnValue([
      { build_id: 'b-1', status: 'succeeded', finished_at: AGORA_MAIS_UM_MINUTO },
    ]);
    render(<FirstDeployCelebration projectName={undefined} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockConfetti).not.toHaveBeenCalled();
  });

  it('não renderiza marcação — é só um lugar para o hook viver', () => {
    const { container } = render(<FirstDeployCelebration projectName="meu-app" />);
    // Se algum dia ele renderizar algo, o layout da página muda em silêncio.
    expect(container).toBeEmptyDOMElement();
  });
});
