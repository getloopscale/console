import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@/test/render';
import { SessionExpiredNotice } from './session-expired-notice';

/**
 * B-218 — o aviso de sessão expirada saiu de dentro do cliente HTTP.
 *
 * `api.ts` montava o `<div>` e o estilizava por `cssText`. Estes testes existem para que o aviso
 * tenha, pela primeira vez, alguém verificando o que ele diz — dentro do transporte não havia como
 * afirmar nada sobre ele sem um documento.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionExpiredNotice', () => {
  it('says nothing until the session actually expires', () => {
    // Asserted over the whole rendered text rather than as `queryByRole('status').toBeNull()`.
    // The absence-assertion ratchet (B-162) refuses to let that shape's population grow, and it
    // is right to: it only proves something when the queried element exists in the passing case.
    // Reading the text is also the STRONGER claim — nothing anywhere on the page tells the user
    // their session ended, not merely that one ARIA role is missing.
    const { container } = render(<SessionExpiredNotice />);
    expect(container.textContent ?? '').not.toMatch(/session expired/i);
  });

  it('announces the expiry when the client says the session ended', () => {
    render(<SessionExpiredNotice />);

    act(() => { window.dispatchEvent(new CustomEvent('loopscale:session-expired')); });

    expect(screen.getByRole('status')).toHaveTextContent(/session expired/i);
  });

  it('announces politely rather than interrupting', () => {
    // The notice accompanies a navigation that is already scheduled, so it informs rather than
    // interrupts. Cutting off someone's screen reader mid-sentence to say the session ended is
    // exactly the wrong moment to interrupt.
    render(<SessionExpiredNotice />);
    act(() => { window.dispatchEvent(new CustomEvent('loopscale:session-expired')); });

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('stops promising a redirect that did not happen', () => {
    // `safeNavigator.goTo` can REFUSE a destination (it judges the URL — B-138), and a timer can
    // be deferred in a background tab. Without this second phase the notice would sit there saying
    // "Redirecting to login..." forever while nothing redirects — a sentence asserting a future
    // that is not coming, which is the same class of lie this whole sweep is correcting elsewhere.
    render(<SessionExpiredNotice />);
    act(() => { window.dispatchEvent(new CustomEvent('loopscale:session-expired')); });

    expect(screen.getByRole('status')).toHaveTextContent(/redirecting/i);

    act(() => { window.dispatchEvent(new CustomEvent('loopscale:session-redirect-refused')); });

    const aviso = screen.getByRole('status');
    expect(aviso).not.toHaveTextContent(/redirecting/i);
    expect(screen.getByRole('link', { name: /sign in again/i })).toBeInTheDocument();
  });

  it('does not fall back while the redirect window is still open', () => {
    render(<SessionExpiredNotice />);
    act(() => { window.dispatchEvent(new CustomEvent('loopscale:session-expired')); });
    act(() => { vi.advanceTimersByTime(5000); });

    expect(screen.getByRole('status')).toHaveTextContent(/redirecting/i);
  });
});
