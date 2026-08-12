import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/render';
import { ACCEPT_PATH, DeviceVerifyPage } from './device-verify';

function setSearch(qs: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search: qs, href: 'http://localhost/device-verify' + qs },
    writable: true,
  });
}

describe('DeviceVerifyPage', () => {
  let originalLocation: Location;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalLocation = window.location;
    fetchSpy = vi.fn();
    Object.defineProperty(window, 'fetch', { value: fetchSpy, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
    vi.resetAllMocks();
  });

  it('test_pre_populates_user_code_from_query', () => {
    setSearch('?device_challenge=abc&user_code=YC7V3TSE');
    render(<DeviceVerifyPage />);
    const input = screen.getByTestId('device-verify-user-code') as HTMLInputElement;
    expect(input.value).toBe('YC7V3TSE');
  });

  it('test_shows_error_when_device_challenge_missing', () => {
    setSearch('?user_code=YC7V3TSE');
    render(<DeviceVerifyPage />);
    expect(screen.getByTestId('device-verify-error').textContent).toMatch(/run.+theo login/i);
  });

  it('test_submit_disabled_until_code_present', () => {
    setSearch('?device_challenge=abc');
    render(<DeviceVerifyPage />);
    const submit = screen.getByTestId('device-verify-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('device-verify-user-code'), {
      target: { value: 'abcd1234' },
    });
    expect(submit.disabled).toBe(false);
  });

  it('test_NAO_segue_redirect_para_host_fora_da_allowlist_B031', async () => {
    // B-031 — este era um open-redirect: `redirect_to` vinha da resposta do
    // servidor e ia direto para window.location.href, sem checagem. O guard
    // isSafeRedirectUrl existia no repo, testado, e sem NENHUM chamador.
    //
    // Um servico de auth mal configurado, ou uma resposta injetada, levava o
    // usuario para fora com a confianca de estar num fluxo de login.
    setSearch('?device_challenge=chal-123&user_code=ABCD1234');
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ redirect_to: 'https://evil.example.com/phish' }),
    });
    const hrefAntes = 'http://localhost/';
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?device_challenge=chal-123&user_code=ABCD1234', href: hrefAntes },
      writable: true,
    });

    render(<DeviceVerifyPage />);
    fireEvent.change(screen.getByTestId('device-verify-user-code'), {
      target: { value: 'ABCD1234' },
    });
    fireEvent.click(screen.getByTestId('device-verify-submit'));

    // Fail-closed: erro visivel ao usuario, e a navegacao NAO acontece.
    await waitFor(() => {
      expect(screen.getByText(/unexpected redirect target/i)).toBeInTheDocument();
    });
    expect(window.location.href).toBe(hrefAntes);
  });

  it('test_submit_posts_to_accept_endpoint_and_follows_redirect', async () => {
    setSearch('?device_challenge=chal-123&user_code=ABCD1234');
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ redirect_to: 'https://auth-dev.usetheo.dev/oauth2/auth/next' }),
    });
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?device_challenge=chal-123&user_code=ABCD1234', href: 'http://localhost/' },
      writable: true,
    });

    render(<DeviceVerifyPage />);
    fireEvent.click(screen.getByTestId('device-verify-submit'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [path, init] = fetchSpy.mock.calls[0];
    expect(path).toBe(ACCEPT_PATH);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.device_challenge).toBe('chal-123');
    expect(body.user_code).toBe('ABCD1234');

    await waitFor(() => expect(window.location.href).toBe('https://auth-dev.usetheo.dev/oauth2/auth/next'));
  });

  it('test_shows_actionable_error_on_4xx_response', async () => {
    setSearch('?device_challenge=chal-123&user_code=BADCODE');
    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Invalid user code.' }),
    });

    render(<DeviceVerifyPage />);
    fireEvent.click(screen.getByTestId('device-verify-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('device-verify-error').textContent).toMatch(/Invalid user code/i),
    );
  });

  it('test_shows_network_error_fallback', async () => {
    setSearch('?device_challenge=chal-123&user_code=ABCD1234');
    fetchSpy.mockRejectedValue(new Error('network down'));

    render(<DeviceVerifyPage />);
    fireEvent.click(screen.getByTestId('device-verify-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('device-verify-error').textContent).toMatch(
        /could not reach the authentication service/i,
      ),
    );
  });
});
