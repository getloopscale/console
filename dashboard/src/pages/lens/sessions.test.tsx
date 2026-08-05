import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensSessionsPage } from './sessions';

describe('LensSessionsPage (/observability/sessions)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M81 — a server-side pager reaches page 2 (limit/offset) and discloses the total', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    // total 120 > pageSize 50 → the pager shows; page 1 sends offset=0, Next sends offset=50.
    mockCloudFetch.mockImplementation((url: string) => {
      const offset = new URL(url, 'http://x').searchParams.get('offset') ?? '0';
      return Promise.resolve({
        sessions: [{ sessionId: `sess-${offset}`, traceCount: 1 }],
        total: 120,
        limit: 50,
        offset: Number(offset),
      });
    });
    render(<LensSessionsPage />);
    expect(await screen.findByText(/of 120/i)).toBeInTheDocument(); // total disclosed
    // the request carried the page window
    expect(mockCloudFetch.mock.calls.some((c) => String(c[0]).includes('offset=0'))).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText('sess-50')).toBeInTheDocument(); // page 2 fetched (offset=50)
    expect(mockCloudFetch.mock.calls.some((c) => String(c[0]).includes('offset=50'))).toBe(true);
  });

  it('M70 — a session row jumps to the traces list pre-filtered by session (no dead-end)', async () => {
    mockCloudFetch.mockResolvedValue({ sessions: [{ sessionId: 'sess-abc', traceCount: 4 }] });
    render(<LensSessionsPage />);
    const link = await screen.findByRole('link', { name: /view traces/i });
    expect(link).toHaveAttribute('href', '/observability/traces?session=sess-abc');
  });

  // M74 (audit S-1) — the empty state must name the `session.id` grouping key so a user with
  // traces-but-no-sessions understands what a session requires.
  it('M54 — a session row is identifiable: first message, last-active, cost, tokens (not just id+count)', async () => {
    mockCloudFetch.mockResolvedValue({
      sessions: [{
        sessionId: 'sess-rich',
        traceCount: 7,
        lastSeenAt: '2026-07-20T17:00:00.000Z',
        costUsd: 0.5,
        totalTokens: 1234,
        errorRate: 0,
        firstMessagePreview: 'refactor the auth module',
      }],
      total: 1,
    });
    render(<LensSessionsPage />);
    expect(await screen.findByText('refactor the auth module')).toBeInTheDocument(); // first message preview
    expect(screen.getByText('$0.50')).toBeInTheDocument(); // cost (formatCost: ≥ 0.01 → 2dp)
    expect(screen.getByText('1,234')).toBeInTheDocument(); // tokens
  });

  it('M54 — absent aggregate fields render an em-dash, never a fabricated 0', async () => {
    mockCloudFetch.mockResolvedValue({ sessions: [{ sessionId: 'sess-bare', traceCount: 1 }], total: 1 });
    render(<LensSessionsPage />);
    await screen.findByRole('link', { name: /view traces/i });
    // cost/tokens/first-message/last-active/errors absent → em-dashes (never a fabricated 0)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('M131 — a session row shows last message, duration, and user id (Arize parity)', async () => {
    mockCloudFetch.mockResolvedValue({
      sessions: [{
        sessionId: 'sess-m131',
        traceCount: 3,
        lastMessagePreview: 'Day 1: Arrival in Marrakech',
        durationMs: 5846,
        userId: 'u-8668',
      }],
      total: 1,
    });
    render(<LensSessionsPage />);
    expect(await screen.findByText('Day 1: Arrival in Marrakech')).toBeInTheDocument(); // last message
    expect(screen.getByText('5.8s')).toBeInTheDocument(); // duration humanized via formatDuration(5846)
    expect(screen.getByText('u-8668')).toBeInTheDocument(); // best-effort user id
  });

  /**
   * As colunas largas ganham teto de largura em CARACTERES, e o texto inteiro fica no DOM.
   *
   * Com onze colunas, `User` e as duas de mensagem esticavam a tabela e empurravam as colunas
   * numéricas para fora da área visível. O teto em `ch` mapeia direto para caracteres — em fonte
   * mono, `10ch` são exatamente dez.
   *
   * A asserção de que o texto **continua no documento** é o ponto: cortar a string resolveria a
   * largura e tiraria o conteúdo do DOM, onde leitor de tela e a busca da página o alcançam. O
   * `title` não substitui isso — ele não é anunciado de forma confiável.
   */
  it('as colunas largas truncam por largura, sem tirar o texto do documento', async () => {
    const mensagemLonga = 'refactor the auth module and then migrate every consumer to the new token shape';
    mockCloudFetch.mockResolvedValue({
      sessions: [{
        sessionId: 'sess-trunc',
        traceCount: 1,
        userId: 'usuario-muito-comprido-de-verdade',
        firstMessagePreview: mensagemLonga,
        lastMessagePreview: mensagemLonga,
      }],
      total: 1,
    });
    render(<LensSessionsPage />);

    // O texto INTEIRO está no documento — truncagem é visual, não perda de conteúdo.
    const usuario = await screen.findByText('usuario-muito-comprido-de-verdade');
    expect(usuario.className).toContain('max-w-[10ch]');
    expect(usuario.className).toContain('truncate');

    const mensagens = screen.getAllByText(mensagemLonga);
    expect(mensagens).toHaveLength(2); // First message e Last message
    for (const m of mensagens) {
      expect(m.className).toContain('max-w-[30ch]');
      expect(m.className).toContain('truncate');
      expect(m.getAttribute('title')).toBe(mensagemLonga); // o valor completo ao passar o cursor
    }
  });

  it('M131 — absent last-message/duration/user-id render em-dash (never fabricated)', async () => {
    mockCloudFetch.mockResolvedValue({ sessions: [{ sessionId: 'sess-bare', traceCount: 1 }], total: 1 });
    render(<LensSessionsPage />);
    await screen.findByRole('link', { name: /view traces/i });
    // the three M131 columns + the M54 columns are all absent → em-dashes, never a fabricated value
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(6);
  });

  it('M74 — the empty state names the session.id grouping key + a docs CTA', async () => {
    mockCloudFetch.mockResolvedValue({ sessions: [] });
    render(<LensSessionsPage />);
    expect(await screen.findByText(/session\.id/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /instrument/i });
    expect(cta).toHaveAttribute('href', expect.stringMatching(/observability/i));
  });

  it('M74 — the grouping-key hint does NOT render when sessions are present', async () => {
    mockCloudFetch.mockResolvedValue({ sessions: [{ sessionId: 'sess-abc', traceCount: 4 }] });
    render(<LensSessionsPage />);
    await screen.findByRole('link', { name: /view traces/i });
    expect(screen.queryByText(/session\.id/i)).not.toBeInTheDocument();
  });

  it('an absent trace count renders em-dash, a real 0 renders 0', async () => {
    mockCloudFetch.mockResolvedValue({
      sessions: [{ sessionId: 'sess-1' }, { sessionId: 'sess-2', traceCount: 0 }],
    });
    render(<LensSessionsPage />);
    await screen.findAllByRole('link', { name: /view traces/i });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // absent trace count (+ other absent cells)
    expect(screen.getByText('0')).toBeInTheDocument(); // honest zero trace count
  });
});
