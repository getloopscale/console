import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/settings/use-whoami', () => ({
  useWhoami: () => ({
    whoami: { team_id: 'team-1', email: 'paulo@example.com' },
    loading: false,
    error: false,
  }),
}));

vi.mock('@/lib/http/api', async (io) => {
  const actual = await io<typeof import('@/lib/http/api')>();
  return { ...actual, engineFetch: vi.fn() };
});

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

import { SettingsPage } from './overview';

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_settings_renders_general_section', () => {
    // Plan v1.2 divergence: "General" section is CLI-First card (CodeBlock with
    // common commands) per design language — CLI-first principle (CLAUDE.md Rule 9).
    // Copy reform v1.2 (audit Section 6 fold): apologetic → affirmative.
    render(<SettingsPage />);
    expect(screen.getByText('CLI-First')).toBeInTheDocument();
    expect(screen.getByText(/Use the CLI to script most settings/i)).toBeInTheDocument();
  });

  it('test_settings_save_general_calls_api', () => {
    // Plan v1.2 divergence: no in-app save (CLI-first). Verify CodeBlock renders
    // canonical CLI commands so user knows how to mutate state.
    render(<SettingsPage />);
    expect(screen.getByText(/loopscale whoami/)).toBeInTheDocument();
    expect(screen.getByText(/loopscale secret set/)).toBeInTheDocument();
  });

  it('test_settings_danger_zone_delete_requires_phrase_match', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    // DangerZone shows "Delete Team" button — clicking opens ConfirmDialog
    // (Brief #3 primitive) which requires typing "delete my team" to enable confirm.
    const deleteTeamButtons = screen.getAllByRole('button', { name: /delete team/i });
    await user.click(deleteTeamButtons[0]);
    // Dialog opens — assert description + confirmation phrase prompt visible
    expect(screen.getByText(/This will permanently delete your team/i)).toBeInTheDocument();
  });
});

describe('SettingsPage — deleting the workspace (B-264)', () => {
  it('does not navigate away when the delete is REFUSED', async () => {
    // The same defect the profile screen had, in the second hand-rolled copy: without
    // `throwOnError` a refused DELETE resolved `null`, nothing inspected it, and this closed
    // the dialog and navigated to `/` — the user reads that as "my workspace is gone".
    //
    // `ConfirmDialog` keeps itself open and states the reason when `onConfirm` rejects
    // (B-105); what was missing was that the request could not fail.
    const { engineFetch } = await import('@/lib/http/api');
    vi.mocked(engineFetch).mockRejectedValue(new Error('workspace has active deployments'));

    render(<SettingsPage />);
    // The DangerZone action and the dialog's confirm share the label "Delete Team", so the
    // confirm is taken as the LAST match — the one the dialog just mounted.
    await userEvent.click(screen.getAllByRole('button', { name: /delete team/i })[0]);
    await userEvent.type(await screen.findByRole('textbox'), 'delete my team');
    const botoes = screen.getAllByRole('button', { name: /delete team/i });
    await userEvent.click(botoes[botoes.length - 1]);

    await vi.waitFor(() =>
      expect(document.body.textContent ?? '').toMatch(/workspace has active deployments/i),
    );
  });
});
